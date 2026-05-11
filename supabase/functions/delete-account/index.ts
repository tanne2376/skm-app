import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

// Account deletion (Apple guideline 5.1.1(v)).
// 1. Cancel any active Stripe subscription immediately.
// 2. Anonymise the profile and release future bookings via RPC.
// 3. Delete the auth.users row so the user can no longer sign in.
//
// Stripe customer + historic financial rows are intentionally
// retained — see migration 023 and the privacy policy.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const adminClient = createAdminClient();

  const { data: activeMemberships, error: membershipError } = await adminClient
    .from('memberships')
    .select('id, stripe_subscription_id, payment_method')
    .eq('student_id', user.id)
    .in('status', ['active', 'cancelling']);

  if (membershipError) {
    console.error('Membership lookup failed:', membershipError);
    return errorResponse('Failed to look up memberships.', 500);
  }

  for (const m of activeMemberships ?? []) {
    if (m.payment_method !== 'cash' && m.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(m.stripe_subscription_id);
      } catch (e) {
        // Already cancelled / not found is fine; otherwise bail so the
        // user can retry (we have not anonymised anything yet).
        const code = (e as { code?: string })?.code;
        if (code !== 'resource_missing') {
          console.error('Stripe cancel failed:', e);
          return errorResponse('Failed to cancel subscription.', 502);
        }
      }
    }
    await adminClient
      .from('memberships')
      .update({ status: 'cancelled' })
      .eq('id', m.id);
  }

  const { error: rpcError } = await adminClient.rpc(
    'anonymize_profile_for_deletion',
    { p_user_id: user.id },
  );
  if (rpcError) {
    console.error('Anonymise RPC failed:', rpcError);
    return errorResponse('Failed to anonymise profile.', 500);
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('auth.admin.deleteUser failed:', deleteError);
    return errorResponse('Failed to delete account.', 500);
  }

  return jsonResponse({ success: true });
});
