// JWT: ✅
import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  let body: { template_id?: string; payment_method?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body.', 400);
  }
  const { template_id, payment_method } = body;
  if (!template_id || (payment_method !== 'cash' && payment_method !== 'stripe')) {
    return errorResponse('template_id and payment_method ("cash"|"stripe") are required.', 400);
  }

  const adminClient = createAdminClient();

  // ── CASH ──────────────────────────────────────────────────────────────────
  if (payment_method === 'cash') {
    // RPC runs as service-role so auth.uid() is NULL — pass user_id explicitly.
    const { data: blockId, error } = await adminClient.rpc('create_cash_block_purchase', {
      p_template_id: template_id,
      p_user_id: user.id,
    });
    if (error) return errorResponse(error.message, 400);
    return jsonResponse({ block_id: blockId, mode: 'cash' });
  }

  // ── STRIPE ────────────────────────────────────────────────────────────────
  // 1. Insert pending block row (RPC runs as service-role; pass user_id).
  const { data: blockId, error: rpcError } = await adminClient.rpc(
    'create_pending_stripe_block_purchase',
    { p_template_id: template_id, p_user_id: user.id },
  );
  if (rpcError) return errorResponse(rpcError.message, 400);

  // From here on, any failure must roll back the pending block so the
  // 15-minute pending-purchase guard doesn't lock the student out.
  const rollback = async (reason: string, status = 500) => {
    const { error: rollbackErr } = await adminClient
      .from('blocks')
      .update({ status: 'cancelled' })
      .eq('id', blockId);
    if (rollbackErr) {
      // Log so we can detect blocks stuck in pending_stripe; the original
      // error is still the user-facing failure reason.
      console.error(
        `[create-block-purchase] Rollback failed for block ${blockId}:`,
        rollbackErr.message,
      );
    }
    return errorResponse(reason, status);
  };

  try {
    // 2. Resolve price and description for PaymentIntent
    const { data: block, error: blockReadErr } = await adminClient
      .from('blocks')
      .select('price_pence_snapshot, template_name_snapshot, sessions_total')
      .eq('id', blockId)
      .single();
    if (blockReadErr || !block) {
      return await rollback('Block not found after insert', 500);
    }

    const description = `Block: ${block.template_name_snapshot} (${block.sessions_total} sessions)`;

    // 3. Get-or-create Stripe customer
    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (profileErr) {
      return await rollback('Failed to load profile', 500);
    }

    let customerId: string;
    if (profile?.stripe_customer_id) {
      customerId = profile.stripe_customer_id;
    } else {
      // Idempotency key derived from user.id so a retried request finds the
      // same Stripe customer instead of minting a duplicate.
      const customer = await stripe.customers.create(
        {
          email: user.email,
          metadata: { supabase_user_id: user.id },
        },
        { idempotencyKey: `customer:${user.id}` },
      );
      customerId = customer.id;
      const { error: linkProfileErr } = await adminClient
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
      // If we can't persist the customer link, the next purchase attempt would
      // create another Stripe customer — fail fast so the user retries cleanly.
      if (linkProfileErr) {
        return await rollback('Failed to link Stripe customer to profile', 500);
      }
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: '2025-03-31.basil' },
    );

    // 4. Create PaymentIntent and link to block. Idempotency key keyed on the
    // pending block id so a retry doesn't create a second PaymentIntent for
    // the same purchase.
    const paymentIntent = await stripe.paymentIntents.create(
      {
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
      },
      { idempotencyKey: `block_purchase:${blockId}` },
    );

    const { error: linkError } = await adminClient.rpc('set_block_stripe_payment_intent', {
      p_block_id: blockId,
      p_payment_intent_id: paymentIntent.id,
    });
    if (linkError) {
      await stripe.paymentIntents.cancel(paymentIntent.id);
      return await rollback('Failed to link payment intent', 500);
    }

    return jsonResponse({
      block_id: blockId,
      mode: 'stripe',
      clientSecret: paymentIntent.client_secret,
      customerId,
      ephemeralKeySecret: ephemeralKey.secret,
    });
  } catch (e) {
    return await rollback((e as Error).message, 500);
  }
});
