import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
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
    .select('id, stripe_subscription_id')
    .eq('student_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (error) return errorResponse('Failed to look up membership.', 500);
  if (!membership) return errorResponse('No active membership found.', 404);

  // Mark the subscription to cancel at the end of the current billing period
  await stripe.subscriptions.update(membership.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  // Set status to 'cancelling' so the UI shows it won't renew
  await adminClient
    .from('memberships')
    .update({ status: 'cancelling' })
    .eq('id', membership.id);

  return jsonResponse({ success: true });
});
