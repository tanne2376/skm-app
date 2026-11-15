import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createRemoteJWKSet, decodeProtectedHeader, errors, jwtVerify } from 'npm:jose@5.9.6';

export function createAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

// The project's public signing keys, fetched once per worker and cached.
const jwks = createRemoteJWKSet(
  new URL(`${Deno.env.get('SUPABASE_URL')}/auth/v1/.well-known/jwks.json`),
);

/**
 * Verify the Bearer token and return the user.
 *
 * User tokens are signed with the project's asymmetric (ES256) key, so they're
 * verified locally against the cached JWKS — no round trip to Supabase Auth.
 * Trade-off: a token stays valid until it expires (≤1 h) even after sign-out
 * or account deletion. Legacy HS256 tokens, or a JWKS fetch failure, fall back
 * to auth.getUser(), which asks the auth server.
 *
 * Edge functions are deployed with verify_jwt=false because the Supabase
 * relay's JWT verification does not support ES256 tokens. Authentication
 * is handled here instead.
 */
export async function getUserFromToken(authHeader: string): Promise<{ id: string; email: string } | null> {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token || token.split('.').length !== 3) return null;

    if (decodeProtectedHeader(token).alg !== 'HS256') {
      try {
        const { payload } = await jwtVerify(token, jwks, { audience: 'authenticated' });
        if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') return null;
        return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' };
      } catch (e) {
        // Bad signature / expired / wrong claims → reject. Anything else
        // (JWKS unreachable) → fall back to the auth server below.
        if (
          e instanceof errors.JWSSignatureVerificationFailed ||
          e instanceof errors.JWTExpired ||
          e instanceof errors.JWTClaimValidationFailed ||
          e instanceof errors.JWTInvalid ||
          e instanceof errors.JWSInvalid ||
          e instanceof errors.JWKSNoMatchingKey
        ) return null;
      }
    }

    const adminClient = createAdminClient();
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) return null;

    return { id: user.id, email: user.email ?? '' };
  } catch {
    return null;
  }
}
