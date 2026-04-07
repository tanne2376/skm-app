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

  let refunded = false;

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

  // Reset row back to available so the slot can be booked again
  await adminClient
    .from('one_to_ones')
    .update({
      status: 'available',
      student_id: null,
      payment_method: null,
      payment_status: null,
      stripe_payment_intent_id: null,
    })
    .eq('id', oneToOneId);

  return jsonResponse({
    refunded,
    message: refunded
      ? 'Booking cancelled and full refund issued.'
      : withinWindow
        ? `Booking cancelled. No refund — session is within ${CANCELLATION_WINDOW_HOURS} hours.`
        : isPast
          ? 'Booking cancelled. Session has already passed.'
          : 'Booking cancelled.',
  });
});
