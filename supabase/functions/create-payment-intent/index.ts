import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const { type, id } = await req.json() as { type: 'class' | 'one_to_one'; id: string };

  const adminClient = createAdminClient();

  // ── Get price and validate ────────────────────────────────────────────────
  let amountPence: number;
  let description: string;
  let sessionId: string | null = null;
  let oneToOneId: string | null = null;
  let existingCustomerId: string | null = null;

  if (type === 'class') {
    sessionId = id;

    // Block check, price, session, kids level, capacity and saved customer in
    // one round trip (see prepare_class_payment).
    const { data: prep, error: prepError } = await adminClient.rpc('prepare_class_payment', {
      p_user_id: user.id,
      p_session_id: id,
    });
    if (prepError || !prep) return errorResponse('Failed to check booking eligibility', 500);

    switch (prep.error) {
      case 'blocked':
        return errorResponse('You are blocked from booking classes this month due to 3 or more late cancellations.', 403);
      case 'not_found':
        return errorResponse('Session not found', 404);
      case 'unavailable':
        return errorResponse('Session not available', 400);
      case 'kids':
        return errorResponse('Kids classes are only available with a kids membership.', 403);
      case 'full':
        return errorResponse('Class is full', 409);
    }

    amountPence = prep.price;
    description = `Class booking: ${prep.name ?? ''}`;
    existingCustomerId = prep.customer_id ?? null;

  } else {
    oneToOneId = id;
    const [{ data: oto }, { data: profile }] = await Promise.all([
      adminClient
        .from('one_to_ones')
        .select('*, teacher:profiles!teacher_id(full_name)')
        .eq('id', id)
        .eq('status', 'available')
        .single(),
      adminClient
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .single(),
    ]);
    if (!oto) return errorResponse('Session not available', 400);
    amountPence = oto.price;
    description = `1-to-1 with ${(oto as any).teacher?.full_name}`;
    existingCustomerId = profile?.stripe_customer_id ?? null;
  }

  // ── Get or create Stripe customer ─────────────────────────────────────────
  let customerId: string;
  let saveCustomerId: PromiseLike<unknown> = Promise.resolve();
  if (existingCustomerId) {
    customerId = existingCustomerId;
  } else {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    saveCustomerId = adminClient
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id);
  }

  // ── Create ephemeral key + PaymentIntent (independent, so in parallel) ────
  const [ephemeralKey, paymentIntent] = await Promise.all([
    stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: '2025-03-31.basil' },
    ),
    stripe.paymentIntents.create({
      amount: amountPence,
      currency: 'gbp',
      customer: customerId,
      description,
      automatic_payment_methods: { enabled: true },
      metadata: {
        booking_type: type,
        session_id: sessionId ?? '',
        one_to_one_id: oneToOneId ?? '',
        student_id: user.id,
      },
    }),
    saveCustomerId,
  ]);

  // ── Insert pending booking ─────────────────────────────────────────────────
  if (type === 'class') {
    const { error: bookingError } = await adminClient.from('bookings').insert({
      session_id: sessionId,
      student_id: user.id,
      status: 'confirmed',
      payment_method: 'app',
      payment_status: 'pending',
      stripe_payment_intent_id: paymentIntent.id,
    });
    if (bookingError) {
      await stripe.paymentIntents.cancel(paymentIntent.id);
      // bookings_require_adult_waiver trigger
      if (bookingError.hint === 'waiver_required') return errorResponse(bookingError.message, 403);
      // Duplicate — already booked
      return errorResponse('You already have a booking for this class.', 409);
    }
  } else {
    // Only claim a still-open slot, so a stale checkout can't overwrite
    // someone else's booking.
    const { data: reserved, error: otoError } = await adminClient.from('one_to_ones').update({
      student_id: user.id,
      status: 'booked',
      payment_method: 'app',
      payment_status: 'pending',
      stripe_payment_intent_id: paymentIntent.id,
    }).eq('id', oneToOneId)
      .eq('status', 'available')
      .is('student_id', null)
      .select('id');
    if (otoError || !reserved?.length) {
      await stripe.paymentIntents.cancel(paymentIntent.id);
      // one_to_ones_require_adult_waiver trigger
      if (otoError?.hint === 'waiver_required') return errorResponse(otoError.message, 403);
      if (!otoError) return errorResponse('This 1-to-1 is no longer available.', 409);
      return errorResponse('Could not reserve this 1-to-1.', 500);
    }
  }

  return jsonResponse({
    clientSecret: paymentIntent.client_secret,
    customerId,
    ephemeralKeySecret: ephemeralKey.secret,
  });
});
