import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl as string;
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase configuration. Check your .env.local file.');
}

// iOS Keychain (SecureStore) has a ~2048-byte limit per item. A Supabase session
// JSON (access_token + refresh_token + user object) regularly exceeds this, causing
// setItem to fail silently so getItem always returns null — producing 401s on every
// edge-function call because the anon key is sent instead of the user JWT.
//
// This adapter splits large values across multiple Keychain entries and reassembles
// them on read, working around the per-item size limit.
const CHUNK_SIZE = 1800; // leave headroom under the 2048-byte limit

const LargeSecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    // Check whether the value was stored in chunks
    const countStr = await SecureStore.getItemAsync(`${key}__parts`);
    if (countStr !== null) {
      const count = parseInt(countStr, 10);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(`${key}__part_${i}`);
        if (part === null) return null; // incomplete — treat as missing
        parts.push(part);
      }
      return parts.join('');
    }
    // Fall back to plain single-entry storage (covers values within the size limit
    // and any sessions stored before this adapter was introduced)
    return SecureStore.getItemAsync(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (value.length <= CHUNK_SIZE) {
      // Small enough to store directly; clean up any leftover chunks first
      await LargeSecureStoreAdapter.removeItem(key);
      await SecureStore.setItemAsync(key, value);
      return;
    }
    // Split into chunks
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(
        `${key}__part_${i}`,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
    // Store the chunk count so getItem knows how many parts to reassemble
    await SecureStore.setItemAsync(`${key}__parts`, String(count));
    // Remove any plain-key entry from before this adapter was introduced
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },

  async removeItem(key: string): Promise<void> {
    const countStr = await SecureStore.getItemAsync(`${key}__parts`);
    if (countStr !== null) {
      const count = parseInt(countStr, 10);
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}__part_${i}`).catch(() => {});
      }
      await SecureStore.deleteItemAsync(`${key}__parts`).catch(() => {});
    }
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: LargeSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Must be false for React Native
  },
});

/** Return true if a JWT access token is expired or will expire within 60 s. */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' && payload.exp < Date.now() / 1000 + 60;
  } catch {
    return true; // treat unparseable tokens as expired
  }
}

/**
 * Invoke a Supabase Edge Function with the current user's JWT.
 *
 * `supabase.functions` is a getter that creates a new FunctionsClient on every
 * access using only the static anon key — it never attaches the user JWT
 * automatically. This wrapper reads the session and injects the Authorization
 * header so edge functions receive a real user token instead of the anon key.
 */
export async function invokeFunction<T = unknown>(
  name: string,
  body?: object,
): Promise<{ data: T; error: null } | { data: null; error: Error }> {
  let { data: { session } } = await supabase.auth.getSession();

  const expired = session?.access_token ? isTokenExpired(session.access_token) : null;
  console.log('[invokeFunction]', name, {
    hasSession: !!session,
    hasToken: !!session?.access_token,
    tokenExpired: expired,
  });

  // Refresh if the token is missing OR expired/about to expire.
  // getSession() returns the cached session — in React Native the background
  // auto-refresh timer can stall when the app is suspended, leaving a stale
  // token that the Supabase gateway rejects with 401.
  if (!session?.access_token || expired) {
    console.log('[invokeFunction]', name, 'refreshing session…');
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    console.log('[invokeFunction]', name, 'refresh result:', {
      hasSession: !!refreshed.session,
      hasToken: !!refreshed.session?.access_token,
      error: refreshError?.message ?? null,
    });
    session = refreshed.session;
  }

  if (!session?.access_token) {
    return { data: null, error: new Error('Not authenticated. Please sign in again.') };
  }

  console.log('[invokeFunction]', name, 'calling with token exp:', JSON.parse(atob(session.access_token.split('.')[1])).exp);
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  return { data: data as T, error: null };
}
