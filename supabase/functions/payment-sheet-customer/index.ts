import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';
import { getOrCreateStripeCustomer } from '../_shared/customer.ts';

// Customer + ephemeral key for a deferred-intent PaymentSheet. Lets the app
// load the sheet (with saved cards) before the user picks a payment method;
// nothing is booked or charged here — create-payment-intent does that when
// the user presses Pay.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const adminClient = createAdminClient();

  const { data: profile } = await adminClient
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  const customerId = await getOrCreateStripeCustomer(
    adminClient,
    user,
    profile?.stripe_customer_id ?? null,
  );

  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: '2025-03-31.basil' },
  );

  return jsonResponse({ customerId, ephemeralKeySecret: ephemeralKey.secret });
});
