import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const adminClient = createAdminClient();

  // Find user's active membership
  const { data: membership, error } = await adminClient
    .from('memberships')
    .select('id, stripe_subscription_id, payment_method')
    .eq('student_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (error) return errorResponse('Failed to look up membership.', 500);
  if (!membership) return errorResponse('No active membership found.', 404);

  // Cash memberships have no Stripe subscription — cancel immediately.
  // The billing period already ends on the 1st of next month, so we
  // mark as 'cancelling' and let it expire naturally.
  if (membership.payment_method !== 'cash') {
    try {
      await stripe.subscriptions.update(membership.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
    } catch (stripeError) {
      console.error('Stripe update failed:', stripeError);
      return errorResponse('Failed to update subscription.', 500);
    }
  }

  // Set status to 'cancelling' so the UI shows it won't renew
  const { error: updateError } = await adminClient
    .from('memberships')
    .update({ status: 'cancelling' })
    .eq('id', membership.id);
  if (updateError) {
    console.error('DB update failed:', updateError);
    return errorResponse('Failed to update membership status.', 500);
  }

  return jsonResponse({ success: true });
});
