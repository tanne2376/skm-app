import { createAdminClient } from '../_shared/supabase.ts';
import { jsonResponse, errorResponse } from '../_shared/cors.ts';

// This function is called by a Supabase cron job every Monday at 00:00 UTC
// It can also be called manually by an admin
Deno.serve(async (req) => {
  // Only allow service role or admin users
  const authHeader = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const adminClient = createAdminClient();

  const isServiceRole = serviceKey && authHeader === `Bearer ${serviceKey}`;

  if (!isServiceRole) {
    // Allow admin users too
    const userToken = authHeader?.replace('Bearer ', '');
    if (userToken) {
      const { data: { user } } = await adminClient.auth.getUser(userToken);
      const { data: profile } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', user?.id ?? '')
        .single();
      if (profile?.role !== 'admin') {
        return errorResponse('Forbidden', 403);
      }
    } else {
      return errorResponse('Forbidden', 403);
    }
  }

  const { error: rpcError } = await adminClient.rpc('generate_sessions_ahead', { weeks_ahead: 4 });
  if (rpcError) return errorResponse('Failed to generate sessions.', 500);

  return jsonResponse({ ok: true, message: 'Sessions generated for next 4 weeks.' });
});
