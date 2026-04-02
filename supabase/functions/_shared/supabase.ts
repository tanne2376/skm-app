import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function createAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/**
 * Verify the Bearer token via the auth server and return the user.
 *
 * Uses the admin client's auth.getUser() which makes an HTTP call to
 * Supabase Auth to validate the token server-side. This works for both
 * HS256 and ES256 tokens.
 *
 * Edge functions are deployed with verify_jwt=false because the Supabase
 * relay's JWT verification does not support ES256 tokens. Authentication
 * is handled here instead.
 */
export async function getUserFromToken(authHeader: string): Promise<{ id: string; email: string } | null> {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token || token.split('.').length !== 3) return null;

    const adminClient = createAdminClient();
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) return null;

    return { id: user.id, email: user.email ?? '' };
  } catch {
    return null;
  }
}
