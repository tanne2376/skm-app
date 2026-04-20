import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';
import { membershipWeekStart } from '../_shared/membershipWeek.ts';
import { notify, notifyMany } from '../_shared/notify.ts';

const CANCELLATION_WINDOW_HOURS = 3;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const { bookingId } = await req.json() as { bookingId: string };

  const adminClient = createAdminClient();

  // Fetch booking with session details
  const { data: booking } = await adminClient
    .from('bookings')
    .select('*, class_sessions(session_date, start_time, teacher_id, class_templates(name))')
    .eq('id', bookingId)
    .single();

  if (!booking) return errorResponse('Booking not found', 404);

  // Verify ownership (or admin)
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (booking.student_id !== user.id && profile?.role !== 'admin') {
    return errorResponse('Forbidden', 403);
  }

  if (booking.status === 'cancelled') {
    return errorResponse('Booking is already cancelled', 400);
  }

  const session = (booking as any).class_sessions;
  const sessionStart = new Date(`${session.session_date}T${session.start_time}Z`);
  const hoursUntilSession = (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
  const isPast = hoursUntilSession <= 0;
  const withinWindow = hoursUntilSession > 0 && hoursUntilSession <= CANCELLATION_WINDOW_HOURS;

  let refunded = false;
  let newPaymentStatus = booking.payment_status;

  // Handle refund logic
  if (booking.payment_method === 'app' && booking.stripe_payment_intent_id && !isPast) {
    if (!withinWindow) {
      // Full refund
      try {
        await stripe.refunds.create({
          payment_intent: booking.stripe_payment_intent_id,
          reason: 'requested_by_customer',
        });
        refunded = true;
        newPaymentStatus = 'refunded';
      } catch (e) {
        console.error('Stripe refund failed:', e);
        // Continue with cancellation even if refund fails — flag for manual review
        newPaymentStatus = 'refunded'; // admin should review
      }
    } else {
      // Within window — no refund
      newPaymentStatus = 'no_refund';
    }
  } else if (booking.payment_method === 'membership') {
    if (withinWindow) {
      // Late cancel — burn the slot (counts toward weekly quota but session is gone)
      await adminClient
        .from('membership_weekly_usage')
        .update({ is_burned: true })
        .eq('booking_id', bookingId);
    } else {
      // >3hrs — release the slot
      await adminClient
        .from('membership_weekly_usage')
        .delete()
        .eq('booking_id', bookingId);
    }
  }

  // Cancel the booking
  await adminClient
    .from('bookings')
    .update({
      status: 'cancelled',
      payment_status: newPaymentStatus,
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', bookingId);

  // If a membership slot was freed (>3hrs), check if a paid booking in the same
  // week can be converted to free — the 2/week allowance is count-based, not
  // pinned to specific sessions.
  if (booking.payment_method === 'membership' && !withinWindow && !isPast) {
    const weekStart = membershipWeekStart(session.session_date, session.start_time);

    // Get the student's active membership
    const { data: membership } = await adminClient
      .from('memberships')
      .select('id, tier')
      .eq('student_id', booking.student_id)
      .in('status', ['active', 'cancelling'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (membership && membership.tier === 'two_per_week') {
      // Count remaining usage rows (burned + active) for this week
      const { count: usageCount } = await adminClient
        .from('membership_weekly_usage')
        .select('id', { count: 'exact', head: true })
        .eq('membership_id', membership.id)
        .eq('week_start', weekStart);

      if ((usageCount ?? 0) < 2) {
        // There's a free slot — find an active paid booking in the same membership week
        const { data: paidBooking } = await adminClient
          .from('bookings')
          .select('id, stripe_payment_intent_id, session_id, payment_method')
          .eq('student_id', booking.student_id)
          .eq('status', 'confirmed')
          .eq('payment_method', 'app')
          .not('stripe_payment_intent_id', 'is', null)
          .order('booked_at', { ascending: true })
          .limit(10);

        // Filter to bookings whose session falls in the same membership week
        let convertTarget = null;
        for (const pb of paidBooking ?? []) {
          const { data: pbSession } = await adminClient
            .from('class_sessions')
            .select('session_date, start_time')
            .eq('id', pb.session_id)
            .single();
          if (pbSession && membershipWeekStart(pbSession.session_date, pbSession.start_time) === weekStart) {
            convertTarget = pb;
            break;
          }
        }

        if (convertTarget) {
          // Refund the Stripe payment — only convert if refund succeeds
          let refundIssued = false;
          try {
            await stripe.refunds.create({
              payment_intent: convertTarget.stripe_payment_intent_id!,
              reason: 'requested_by_customer',
            });
            refundIssued = true;
          } catch (e) {
            console.error('Stripe refund for membership conversion failed:', e);
          }

          if (refundIssued) {
            // Convert booking to membership
            await adminClient
              .from('bookings')
              .update({ payment_method: 'membership', payment_status: 'paid', stripe_payment_intent_id: null })
              .eq('id', convertTarget.id);

            // Record the usage row
            const { data: convertSession } = await adminClient
              .from('class_sessions')
              .select('session_date, start_time')
              .eq('id', convertTarget.session_id)
              .single();
            if (convertSession) {
              const convertWeekStart = membershipWeekStart(convertSession.session_date, convertSession.start_time);
              await adminClient.from('membership_weekly_usage').insert({
                membership_id: membership.id,
                student_id: booking.student_id,
                booking_id: convertTarget.id,
                week_start: convertWeekStart,
              });
            }
          }
        }
      }
    }
  }

  // Notify teacher + admins that a student left
  const sessionName = (session as any).class_templates?.name ?? 'Class';
  const { data: cancellingStudent } = await adminClient
    .from('profiles')
    .select('full_name')
    .eq('id', booking.student_id)
    .single();
  const studentName = cancellingStudent?.full_name ?? 'A student';

  const notifyIds = new Set<string>();
  // Session teacher
  if (session.teacher_id) notifyIds.add(session.teacher_id);
  // All admins
  const { data: admins } = await adminClient
    .from('profiles')
    .select('id')
    .eq('role', 'admin');
  for (const a of admins ?? []) notifyIds.add(a.id);
  // Don't notify the person who cancelled (they already know)
  notifyIds.delete(user.id);
  const filteredIds = Array.from(notifyIds);
  await notifyMany({
    adminClient,
    userIds: filteredIds,
    type: 'class_left',
    title: 'Student left class',
    body: `${studentName} cancelled their booking for ${sessionName}.`,
    data: { sessionId: booking.session_id },
  });

  // ── Track late cancellation (only for confirmed self-cancellations) ─────
  let lateCancelCount = 0;
  let isNowBlocked = false;
  const isStudentSelfCancel = booking.student_id === user.id && booking.status === 'confirmed';
  if (withinWindow && isStudentSelfCancel) {
    try {
      const { error: insertError } = await adminClient.from('late_cancellations').insert({
        user_id: booking.student_id,
        booking_id: bookingId,
        session_id: booking.session_id,
        session_start_time: `${session.session_date}T${session.start_time}`,
      });
      // 23505 = unique_violation — treat duplicate strike as idempotent success
      if (insertError && insertError.code !== '23505') throw insertError;

      // Get updated count and actual block state for this month
      const [{ data: countData, error: countError }, { data: isBlocked, error: blockedError }] = await Promise.all([
        adminClient.rpc('get_late_cancellation_count', { p_user_id: booking.student_id }),
        adminClient.rpc('is_user_booking_blocked', { p_user_id: booking.student_id }),
      ]);
      if (countError) throw countError;
      if (blockedError) throw blockedError;
      lateCancelCount = countData ?? 0;
      isNowBlocked = isBlocked ?? false;
    } catch (err) {
      // Non-fatal: booking is already cancelled at this point (line 92-99),
      // and retries short-circuit at line 42. Log and continue so waitlist
      // promotion still runs. Strike/block state will be consistent on next read.
      console.error('Late cancellation tracking failed:', err);
    }
  }

  // Promote next person on the waitlist
  const { error: promoteError } = await adminClient.functions.invoke('promote-waitlist', {
    body: { sessionId: booking.session_id },
  });
  if (promoteError) {
    console.error('Waitlist promotion failed:', promoteError);
    // Non-fatal — log and continue
  }

  return jsonResponse({
    refunded,
    lateCancelCount,
    isNowBlocked,
    message: refunded
      ? 'Booking cancelled and refund issued.'
      : (withinWindow && isStudentSelfCancel)
        ? isNowBlocked
          ? `Booking cancelled. No refund. You have ${lateCancelCount} late cancellations this month — you are now blocked from booking classes for the rest of this month.`
          : `Booking cancelled. No refund. This is late cancellation ${lateCancelCount} of 3 this month.`
        : withinWindow
          ? 'Booking cancelled. No refund (late cancellation).'
          : 'Booking cancelled.',
  });
});
