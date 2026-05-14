import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

const CANCELLATION_WINDOW_HOURS = 24;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const { oneToOneId } = await req.json() as { oneToOneId: string };

  const adminClient = createAdminClient();

  const { data: oto } = await adminClient
    .from('one_to_ones')
    .select('*')
    .eq('id', oneToOneId)
    .single();

  if (!oto) return errorResponse('Session not found', 404);
  if (oto.status !== 'booked') return errorResponse('Session is not booked', 400);

  // Only the student who booked, the session teacher, or an admin may cancel
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const isStudent = oto.student_id === user.id;
  const isTeacher = oto.teacher_id === user.id || oto.creator_id === user.id;
  const isAdmin = profile?.role === 'admin';

  if (!isStudent && !isTeacher && !isAdmin) {
    return errorResponse('Forbidden', 403);
  }

  const sessionStart = new Date(`${oto.session_date}T${oto.start_time}`);
  const hoursUntilSession = (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
  const isPast = hoursUntilSession <= 0;
  const withinWindow = !isPast && hoursUntilSession <= CANCELLATION_WINDOW_HOURS;

  // Capture the original booking student before we wipe the row — late-cancel
  // strikes must be attributed to the person who held the slot, not the caller
  // (e.g. an admin cancelling on their behalf).
  const originalStudentId = oto.student_id as string | null;
  const isStudentSelfCancel =
    originalStudentId !== null && originalStudentId === user.id;

  let refunded = false;
  let blockRefunded = false;

  // Issue Stripe refund if paid via app and session hasn't started
  if (oto.payment_method === 'app' && oto.stripe_payment_intent_id && !isPast) {
    if (!withinWindow) {
      try {
        await stripe.refunds.create({
          payment_intent: oto.stripe_payment_intent_id,
          reason: 'requested_by_customer',
        });
        refunded = true;
      } catch (e) {
        console.error('Stripe refund failed:', e);
        // Continue with cancellation — flag for manual review via Stripe dashboard
      }
    }
  }

  // Refund a block session if the booking was paid via a block. Mirrors
  // the Stripe rule: only refund if outside the no-refund window.
  if (oto.payment_method === 'block' && oto.block_id && !isPast && !withinWindow) {
    const { error: refundErr } = await adminClient.rpc('refund_block_slot', {
      p_block_id: oto.block_id,
    });
    if (refundErr) {
      console.error('Block slot refund failed:', refundErr);
    } else {
      blockRefunded = true;
    }
  }

  // Reset row back to available so the slot can be booked again
  await adminClient
    .from('one_to_ones')
    .update({
      status: 'available',
      student_id: null,
      payment_method: null,
      payment_status: null,
      stripe_payment_intent_id: null,
      block_id: null,
    })
    .eq('id', oneToOneId);

  // ── Track late cancellation (only for student self-cancels inside window) ─
  let lateCancelCount: number | null = null;
  let isNowBlocked: boolean | null = null;
  let hasFreshLateCancelState = false;
  if (isStudentSelfCancel && withinWindow) {
    try {
      const { error: insertError } = await adminClient
        .from('late_cancellations')
        .insert({
          user_id: originalStudentId,
          one_to_one_id: oneToOneId,
          session_start_time: `${oto.session_date}T${oto.start_time}`,
        });
      // 23505 = unique_violation — treat duplicate strike as idempotent success
      if (insertError && insertError.code !== '23505') throw insertError;

      const [{ data: countData, error: countError }, { data: isBlocked, error: blockedError }] =
        await Promise.all([
          adminClient.rpc('get_late_cancellation_count', { p_user_id: originalStudentId }),
          adminClient.rpc('is_user_booking_blocked', { p_user_id: originalStudentId }),
        ]);
      if (countError) throw countError;
      if (blockedError) throw blockedError;
      lateCancelCount = countData ?? 0;
      isNowBlocked = isBlocked ?? false;
      hasFreshLateCancelState = true;
    } catch (err) {
      // Non-fatal: cancellation has already taken effect above. Strike/block
      // state will be consistent on next read.
      console.error('Late cancellation tracking failed:', err);
    }
  }

  return jsonResponse({
    refunded,
    blockRefunded,
    ...(hasFreshLateCancelState && { lateCancelCount, isNowBlocked }),
    message: refunded
      ? 'Booking cancelled and full refund issued.'
      : blockRefunded
        ? 'Booking cancelled and block session refunded.'
        : (withinWindow && isStudentSelfCancel && hasFreshLateCancelState)
          ? isNowBlocked
            ? `Booking cancelled. No refund — session is within ${CANCELLATION_WINDOW_HOURS} hours. You have ${lateCancelCount} late cancellations this month — you are blocked from booking for the rest of this month.`
            : `Booking cancelled. No refund — session is within ${CANCELLATION_WINDOW_HOURS} hours. This is late cancellation ${lateCancelCount} of 3 this month.`
          : withinWindow
            ? `Booking cancelled. No refund — session is within ${CANCELLATION_WINDOW_HOURS} hours.`
            : isPast
              ? 'Booking cancelled. Session has already passed.'
              : 'Booking cancelled.',
  });
});
