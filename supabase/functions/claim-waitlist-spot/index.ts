// JWT: ❌ (handles its own auth via getUserFromToken)
//
// A waitlisted student claims a spot that was offered to them by
// promote-waitlist (which set claim_window_started_at on their
// booking). The claim is processed identically to the original
// booking flow except the booking row already exists — we update it
// in place rather than insert a new one.
//
// Body: { bookingId, paymentMethod, membershipId? }
//   - cash:       direct update to status='confirmed', payment='cash'/'pending'
//   - membership: check quota, update row, insert weekly_usage
//   - app:        create Stripe PaymentIntent, return clientSecret
//                 (stripe-webhook flips payment_status to 'paid')
//
// Validation:
//   - booking is mine
//   - booking is currently waitlisted
//   - claim window is set and not yet expired
//   - session still has open capacity
//
// Concurrency: the "claim it" UPDATE is conditional on
// status='waitlisted' so two simultaneous claims can't both succeed.

import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';
import { membershipWeekStart } from '../_shared/membershipWeek.ts';

const CLAIM_WINDOW_MS = 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);
  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  let body: { bookingId?: string; paymentMethod?: 'cash' | 'membership' | 'app'; membershipId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body.', 400);
  }
  const { bookingId, paymentMethod, membershipId } = body;
  if (!bookingId || !paymentMethod) {
    return errorResponse('bookingId and paymentMethod are required.', 400);
  }
  if (!['cash', 'membership', 'app'].includes(paymentMethod)) {
    return errorResponse('Invalid paymentMethod.', 400);
  }

  const adminClient = createAdminClient();

  // Late-cancellation block check (matches normal booking flows)
  const { data: isBlocked } = await adminClient.rpc('is_user_booking_blocked', {
    p_user_id: user.id,
  });
  if (isBlocked) {
    return errorResponse(
      'You are blocked from booking classes this month due to late cancellations.',
      403,
    );
  }

  const { data: booking } = await adminClient
    .from('bookings')
    .select('id, student_id, session_id, status, claim_window_started_at, waitlist_position')
    .eq('id', bookingId)
    .single();

  if (!booking) return errorResponse('Booking not found.', 404);
  if (booking.student_id !== user.id) return errorResponse('Forbidden', 403);
  if (booking.status !== 'waitlisted') {
    return errorResponse('This booking is not waitlisted.', 409);
  }
  if (!booking.claim_window_started_at) {
    return errorResponse('No spot has been offered to you yet.', 409);
  }
  const startedAt = new Date(booking.claim_window_started_at).getTime();
  if (Date.now() - startedAt >= CLAIM_WINDOW_MS) {
    return errorResponse('Your claim window has expired.', 409);
  }

  // Verify the session still has open capacity
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('*, class_templates(capacity, name)')
    .eq('id', booking.session_id)
    .single();
  if (!session) return errorResponse('Session not found.', 404);
  if ((session as any).is_cancelled) {
    return errorResponse('Session has been cancelled.', 409);
  }

  const capacity =
    (session as any).capacity ?? (session as any).class_templates?.capacity ?? 20;
  const { count: confirmedCount } = await adminClient
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', booking.session_id)
    .eq('status', 'confirmed');
  if ((confirmedCount ?? 0) >= capacity) {
    return errorResponse('No spots available.', 409);
  }

  const sessionName = (session as any).class_templates?.name ?? 'Class';

  // ─── CASH ─────────────────────────────────────────────────────────────────
  if (paymentMethod === 'cash') {
    const { data: updated, error } = await adminClient
      .from('bookings')
      .update({
        status: 'confirmed',
        payment_method: 'cash',
        payment_status: 'pending',
        waitlist_position: null,
        claim_window_started_at: null,
      })
      .eq('id', bookingId)
      .eq('status', 'waitlisted')
      .select('id');
    if (error) return errorResponse(error.message, 500);
    if (!updated?.length) {
      return errorResponse('Spot is no longer available.', 409);
    }
    return jsonResponse({ confirmed: true, paymentMethod: 'cash' });
  }

  // ─── MEMBERSHIP ───────────────────────────────────────────────────────────
  if (paymentMethod === 'membership') {
    if (!membershipId) return errorResponse('membershipId is required.', 400);

    const { data: membership } = await adminClient
      .from('memberships')
      .select('id, tier, payment_method, payment_status')
      .eq('id', membershipId)
      .eq('student_id', user.id)
      .eq('status', 'active')
      .single();
    if (!membership) return errorResponse('Membership not found or inactive.', 403);

    // Cash-pending memberships past their 72hr grace can't book
    if (membership.payment_method === 'cash' && membership.payment_status === 'pending') {
      const { data: graceExpired } = await adminClient.rpc(
        'membership_cash_grace_expired',
        { p_membership_id: membershipId },
      );
      if (graceExpired) {
        return errorResponse(
          'Cash payment must be confirmed by a class leader to keep using your membership.',
          403,
        );
      }
    }

    if (membership.tier === 'two_per_week') {
      const weekStart = membershipWeekStart(session.session_date, session.start_time);
      const { count } = await adminClient
        .from('membership_weekly_usage')
        .select('id', { count: 'exact', head: true })
        .eq('membership_id', membershipId)
        .eq('week_start', weekStart);
      if ((count ?? 0) >= 2) {
        return errorResponse('Weekly class quota reached (2/2). Upgrade to unlimited.', 400);
      }
    }

    const { data: updated, error } = await adminClient
      .from('bookings')
      .update({
        status: 'confirmed',
        payment_method: 'membership',
        payment_status: 'paid',
        waitlist_position: null,
        claim_window_started_at: null,
      })
      .eq('id', bookingId)
      .eq('status', 'waitlisted')
      .select('id');
    if (error) return errorResponse(error.message, 500);
    if (!updated?.length) {
      return errorResponse('Spot is no longer available.', 409);
    }

    if (membership.tier === 'two_per_week') {
      const weekStart = membershipWeekStart(session.session_date, session.start_time);
      await adminClient.from('membership_weekly_usage').insert({
        membership_id: membershipId,
        student_id: user.id,
        booking_id: bookingId,
        week_start: weekStart,
      });
    }

    return jsonResponse({ confirmed: true, paymentMethod: 'membership' });
  }

  // ─── APP (Stripe) ─────────────────────────────────────────────────────────
  const { data: priceData } = await adminClient.rpc('get_session_price', {
    p_session_id: booking.session_id,
  });
  const amountPence: number = priceData ?? 1500;

  // Get / create Stripe customer
  const { data: profile } = await adminClient
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  let customerId: string;
  if (profile?.stripe_customer_id) {
    customerId = profile.stripe_customer_id;
  } else {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await adminClient
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id);
  }

  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: '2025-03-31.basil' },
  );

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountPence,
    currency: 'gbp',
    customer: customerId,
    description: `Waitlist claim: ${sessionName}`,
    automatic_payment_methods: { enabled: true },
    metadata: {
      booking_type: 'class',
      session_id: booking.session_id,
      student_id: user.id,
      booking_id: bookingId,
    },
  });

  // Move booking to confirmed-but-pending immediately. If PaymentSheet
  // fails on the client, the client invokes cancel-booking and we go
  // back to status='cancelled' (the client knows the spot is lost).
  const { data: updated, error } = await adminClient
    .from('bookings')
    .update({
      status: 'confirmed',
      payment_method: 'app',
      payment_status: 'pending',
      stripe_payment_intent_id: paymentIntent.id,
      waitlist_position: null,
      claim_window_started_at: null,
    })
    .eq('id', bookingId)
    .eq('status', 'waitlisted')
    .select('id');

  if (error || !updated?.length) {
    // Race: someone else (admin promotion?) modified the booking.
    // Cancel the PaymentIntent so we don't leave dangling Stripe state.
    await stripe.paymentIntents.cancel(paymentIntent.id);
    return errorResponse('Spot is no longer available.', 409);
  }

  return jsonResponse({
    confirmed: false,
    paymentMethod: 'app',
    clientSecret: paymentIntent.client_secret,
    customerId,
    ephemeralKeySecret: ephemeralKey.secret,
    amount: amountPence,
  });
});
