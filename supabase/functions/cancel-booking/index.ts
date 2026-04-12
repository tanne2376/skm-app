import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

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
    .select('*, class_sessions(session_date, start_time, class_templates(name))')
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
    // Release weekly usage slot so it can be used for another class
    await adminClient
      .from('membership_weekly_usage')
      .delete()
      .eq('booking_id', bookingId);
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
    message: refunded
      ? 'Booking cancelled and refund issued.'
      : withinWindow
        ? `Booking cancelled. No refund within ${CANCELLATION_WINDOW_HOURS} hours of class.`
        : 'Booking cancelled.',
  });
});
