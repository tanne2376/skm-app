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

  // Block if active membership already exists
  const { data: existing } = await adminClient
    .from('memberships')
    .select('id')
    .eq('student_id', user.id)
    .eq('status', 'active')
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

  // Create subscription with incomplete status so payment is required upfront
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
  });

  const latestInvoice = subscription.latest_invoice as any;
  const paymentIntent = latestInvoice?.payment_intent;

  if (!paymentIntent?.client_secret) {
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
    clientSecret: paymentIntent.client_secret,
    ephemeralKeySecret: ephemeralKey.secret,
    customerId,
  });
});
