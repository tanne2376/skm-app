import Stripe from 'npm:stripe@17.7.0';

export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2025-03-31.basil',
  httpClient: Stripe.createFetchHttpClient(),
});
