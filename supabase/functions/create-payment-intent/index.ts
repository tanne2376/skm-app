import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const userClient = createUserClient(authHeader);
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const { type, id } = await req.json() as { type: 'class' | 'one_to_one'; id: string };

  const adminClient = createAdminClient();

  // ── Get price and validate ────────────────────────────────────────────────
  let amountPence: number;
  let description: string;
  let sessionId: string | null = null;
  let oneToOneId: string | null = null;

  if (type === 'class') {
    sessionId = id;
    // Use DB function to get effective price (handles overrides)
    const { data: priceData } = await adminClient.rpc('get_session_price', { p_session_id: id });
    if (!priceData) return errorResponse('Session not found', 404);
    amountPence = priceData;

    const { data: session } = await adminClient
      .from('class_sessions')
      .select('*, class_templates(name)')
      .eq('id', id)
      .single();
    if (!session || session.is_cancelled) return errorResponse('Session not available', 400);
    description = `Class booking: ${(session as any).class_templates?.name}`;

  } else {
    oneToOneId = id;
    const { data: oto } = await adminClient
      .from('one_to_ones')
      .select('*, teacher:profiles!teacher_id(full_name)')
      .eq('id', id)
      .eq('status', 'available')
      .single();
    if (!oto) return errorResponse('Session not available', 400);
    amountPence = oto.price;
    description = `1-to-1 with ${(oto as any).teacher?.full_name}`;
  }

  // ── Capacity check with advisory lock (prevents race conditions) ──────────
  if (type === 'class') {
    const { data: lockAcquired } = await adminClient.rpc('pg_try_advisory_xact_lock', {
      key: parseInt(sessionId!.replace(/-/g, '').slice(0, 9), 16) % 2147483647,
    });

    const { data: capacityData } = await adminClient.rpc('get_session_capacity', { p_session_id: sessionId });
    const { data: countData } = await adminClient.rpc('get_session_booking_count', { p_session_id: sessionId });

    if (countData !== null && capacityData !== null && countData >= capacityData) {
      return errorResponse('Class is full', 409);
    }
  }

  // ── Get or create Stripe customer ─────────────────────────────────────────
  const { data: profile } = await adminClient
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  let customerId: string;
  if (profile?.stripe_customer_id) {
    customerId = profile.stripe_customer_id;
  } else {
    const { data: authUser } = await userClient.auth.getUser();
    const customer = await stripe.customers.create({
      email: authUser.user?.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await adminClient
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id);
  }

  // ── Create ephemeral key ───────────────────────────────────────────────────
  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: '2025-03-31.basil' },
  );

  // ── Create PaymentIntent ───────────────────────────────────────────────────
  const paymentIntent = await stripe.paymentIntents.create({
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
  });

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
      // Duplicate — already booked
      await stripe.paymentIntents.cancel(paymentIntent.id);
      return errorResponse('You already have a booking for this class.', 409);
    }
  } else {
    await adminClient.from('one_to_ones').update({
      student_id: user.id,
      status: 'booked',
      payment_method: 'app',
      payment_status: 'pending',
      stripe_payment_intent_id: paymentIntent.id,
    }).eq('id', oneToOneId);
  }

  return jsonResponse({
    clientSecret: paymentIntent.client_secret,
    customerId,
    ephemeralKeySecret: ephemeralKey.secret,
  });
});
