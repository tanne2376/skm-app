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

  // Find user's cancelling membership
  const { data: membership, error } = await adminClient
    .from('memberships')
    .select('id, stripe_subscription_id, payment_method')
    .eq('student_id', user.id)
    .eq('status', 'cancelling')
    .maybeSingle();

  if (error) return errorResponse('Failed to look up membership.', 500);
  if (!membership) return errorResponse('No cancelling membership found.', 404);

  // Cash memberships have no Stripe subscription to undo — just flip the status back.
  if (membership.payment_method !== 'cash') {
    try {
      await stripe.subscriptions.update(membership.stripe_subscription_id, {
        cancel_at_period_end: false,
      });
    } catch (stripeError) {
      console.error('Stripe update failed:', stripeError);
      return errorResponse('Failed to update subscription.', 500);
    }
  }

  // Restore active status
  const { error: updateError } = await adminClient
    .from('memberships')
    .update({ status: 'active' })
    .eq('id', membership.id);
  if (updateError) {
    console.error('DB update failed:', updateError);
    return errorResponse('Failed to update membership status.', 500);
  }

  return jsonResponse({ success: true });
});
