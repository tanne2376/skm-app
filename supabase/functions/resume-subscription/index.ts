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

  // Find user's cancelling membership
  const { data: membership, error } = await adminClient
    .from('memberships')
    .select('id, stripe_subscription_id')
    .eq('student_id', user.id)
    .eq('status', 'cancelling')
    .maybeSingle();

  if (error) return errorResponse('Failed to look up membership.', 500);
  if (!membership) return errorResponse('No cancelling membership found.', 404);

  // Undo the pending cancellation
  await stripe.subscriptions.update(membership.stripe_subscription_id, {
    cancel_at_period_end: false,
  });

  // Restore active status
  await adminClient
    .from('memberships')
    .update({ status: 'active' })
    .eq('id', membership.id);

  return jsonResponse({ success: true });
});
