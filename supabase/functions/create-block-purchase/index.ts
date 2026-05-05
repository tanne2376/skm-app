import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const { template_id, payment_method } = await req.json() as {
    template_id: string;
    payment_method: 'cash' | 'stripe';
  };

  if (!template_id || (payment_method !== 'cash' && payment_method !== 'stripe')) {
    return errorResponse('template_id and payment_method ("cash"|"stripe") are required.', 400);
  }

  const adminClient = createAdminClient();

  // ── CASH ──────────────────────────────────────────────────────────────────
  if (payment_method === 'cash') {
    const { data: blockId, error } = await adminClient.rpc('create_cash_block_purchase', {
      p_template_id: template_id,
    });
    if (error) return errorResponse(error.message, 400);
    return jsonResponse({ block_id: blockId, mode: 'cash' });
  }

  // ── STRIPE ────────────────────────────────────────────────────────────────
  // 1. Insert pending block row
  const { data: blockId, error: rpcError } = await adminClient.rpc(
    'create_pending_stripe_block_purchase',
    { p_template_id: template_id },
  );
  if (rpcError) return errorResponse(rpcError.message, 400);

  // 2. Resolve price and description for PaymentIntent
  const { data: block } = await adminClient
    .from('blocks')
    .select('price_pence_snapshot, template_name_snapshot, sessions_total')
    .eq('id', blockId)
    .single();
  if (!block) return errorResponse('Block not found after insert', 500);

  const description = `Block: ${block.template_name_snapshot} (${block.sessions_total} sessions)`;

  // 3. Get-or-create Stripe customer
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

  // 4. Create PaymentIntent and link to block
  let paymentIntent: Awaited<ReturnType<typeof stripe.paymentIntents.create>>;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: block.price_pence_snapshot,
      currency: 'gbp',
      customer: customerId,
      description,
      automatic_payment_methods: { enabled: true },
      metadata: {
        booking_type: 'block_purchase',
        block_id: blockId,
        template_id,
        student_id: user.id,
      },
    });
  } catch (e) {
    // Roll back the pending block row so the user isn't locked out for 15 min.
    await adminClient.from('blocks').update({ status: 'cancelled' }).eq('id', blockId);
    return errorResponse((e as Error).message, 500);
  }

  const { error: linkError } = await adminClient.rpc('set_block_stripe_payment_intent', {
    p_block_id: blockId,
    p_payment_intent_id: paymentIntent.id,
  });
  if (linkError) {
    await stripe.paymentIntents.cancel(paymentIntent.id);
    await adminClient.from('blocks').update({ status: 'cancelled' }).eq('id', blockId);
    return errorResponse('Failed to link payment intent', 500);
  }

  return jsonResponse({
    block_id: blockId,
    mode: 'stripe',
    clientSecret: paymentIntent.client_secret,
    customerId,
    ephemeralKeySecret: ephemeralKey.secret,
  });
});
