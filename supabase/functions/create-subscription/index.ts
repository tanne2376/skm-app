import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const { tier } = await req.json() as { tier: 'two_per_week' | 'unlimited' };

  const adminClient = createAdminClient();

  // Block if active or cancelling membership already exists
  const { data: existing } = await adminClient
    .from('memberships')
    .select('id')
    .eq('student_id', user.id)
    .in('status', ['active', 'cancelling'])
    .maybeSingle();

  if (existing) return errorResponse('You already have an active membership.', 409);

  // Get or create Stripe customer
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

  const priceId = tier === 'unlimited'
    ? Deno.env.get('STRIPE_PRICE_UNLIMITED')!
    : Deno.env.get('STRIPE_PRICE_TWO_PER_WEEK')!;

  const amount = tier === 'unlimited' ? 10000 : 8000; // pence

  // Clean up any pending invoice items left from previous failed attempts
  const pendingItems = await stripe.invoiceItems.list({
    customer: customerId,
    pending: true,
  });
  for (const item of pendingItems.data) {
    await stripe.invoiceItems.del(item.id);
  }

  // Add a one-time invoice item so the first invoice charges the full monthly
  // amount immediately (the subscription itself won't prorate because we set
  // proration_behavior to 'none').
  await stripe.invoiceItems.create({
    customer: customerId,
    amount,
    currency: 'gbp',
    description: `SKM ${tier === 'unlimited' ? 'Unlimited' : '2x/Week'} — first month`,
  });

  // Create subscription with billing anchored to the 1st of every month.
  // proration_behavior 'none' means no prorated charge for the partial first
  // period — the one-time invoice item above covers it instead.
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    billing_cycle_anchor_config: { day_of_month: 1 },
    proration_behavior: 'none',
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.confirmation_secret'],
  });

  const latestInvoice = subscription.latest_invoice as any;
  const confirmationSecret = latestInvoice?.confirmation_secret;
  const clientSecret = confirmationSecret?.client_secret;

  if (!clientSecret) {
    await stripe.subscriptions.cancel(subscription.id);
    return errorResponse('Failed to initialise payment for membership.', 500);
  }

  // Ephemeral key required by PaymentSheet to manage saved payment methods
  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: '2025-03-31.basil' },
  );

  return jsonResponse({
    subscriptionId: subscription.id,
    clientSecret,
    ephemeralKeySecret: ephemeralKey.secret,
    customerId,
  });
});
