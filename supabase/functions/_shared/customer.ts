import { createAdminClient } from './supabase.ts';
import { stripe } from './stripe.ts';

/**
 * The user's Stripe customer ID, creating the customer on first use.
 *
 * The ID is only written while the column is still empty, so two first-time
 * requests racing each other settle on one customer (the loser's is left
 * unused). That matters because saved cards belong to one customer: a sheet
 * built for the overwritten customer would offer cards the PaymentIntent
 * can't use.
 */
export async function getOrCreateStripeCustomer(
  adminClient: ReturnType<typeof createAdminClient>,
  user: { id: string; email: string },
  knownCustomerId: string | null,
): Promise<string> {
  if (knownCustomerId) return knownCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { supabase_user_id: user.id },
  });

  const { data: claimed, error } = await adminClient
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', user.id)
    .is('stripe_customer_id', null)
    .select('stripe_customer_id');
  if (error) throw error;
  if (claimed?.length) return customer.id;

  // Another request stored a customer first — use that one.
  const { data: profile, error: readError } = await adminClient
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();
  if (readError || !profile?.stripe_customer_id) {
    throw readError ?? new Error('Could not resolve Stripe customer');
  }
  return profile.stripe_customer_id;
}
