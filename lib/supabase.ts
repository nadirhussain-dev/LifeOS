import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { AppState } from 'react-native';

import { getDeviceId } from './device-id';
import { env, isSupabaseConfigured } from './env';
import { secureSessionStorage } from './secure-session-storage';

// createClient needs syntactically valid args even when the app is unconfigured
// (guest mode). Fall back to a harmless placeholder so import never throws; auth
// and sync are gated on isSupabaseConfigured, so no real calls are made until
// creds are set.
const url = isSupabaseConfigured ? env.EXPO_PUBLIC_SUPABASE_URL : 'https://placeholder.supabase.co';
const anonKey = isSupabaseConfigured ? env.EXPO_PUBLIC_SUPABASE_ANON_KEY : 'placeholder-anon-key';

export const supabase = createClient(url, anonKey, {
  auth: {
    // The OS keystore, not a plaintext file — see lib/secure-session-storage.ts.
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    /**
     * PKCE rather than the implicit flow. The password-reset link arrives as a
     * deep link, and under the implicit flow that link carries the tokens
     * themselves — in a URL, which is logged by the OS, offered to the share
     * sheet, and handed to whichever app claims the scheme. PKCE sends a
     * single-use code that is worthless without the verifier held on this
     * device.
     */
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-client-info': 'daykeep-mobile' },
    /**
     * Stamps every request with this install's device id, which is what
     * migration 0048's `may_access_own_data()` matches against the account's
     * device roster to enforce one-device-at-a-time.
     *
     * A wrapped fetch rather than a static entry in `headers` above, for two
     * reasons that both matter:
     *
     *  - The id lives in the OS keystore and is therefore only available
     *    asynchronously. A static header would have to be resolved before
     *    `createClient` runs, which is at module load, which cannot await.
     *  - It has to reach *every* path that talks to the project — PostgREST,
     *    RPC, Storage, Edge Functions — and each of those builds its own
     *    request. `global.fetch` is the single choke point they all share.
     *
     * `await`ing here costs nothing after the first call: `getDeviceId()`
     * resolves from a cached promise.
     */
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      try {
        headers.set('x-daykeep-device', await getDeviceId());
      } catch {
        // No keystore, no id. Sending the request without the header is right:
        // the server treats an unidentified device as unknown, which is the
        // conservative reading, and an account that has never registered a
        // device is unrestricted either way.
      }
      return fetch(input, { ...init, headers });
    },
  },
});

/**
 * Supabase's token refresh runs on a timer, and a timer in a backgrounded React
 * Native app is not guaranteed to fire — the OS suspends it. Without this, a
 * phone left alone past the access token's lifetime comes back to a stack of
 * 401s and, depending on how long it slept, a refresh token the server has
 * already rotated past. The visible symptom is "it logged me out overnight".
 *
 * Registered here rather than in a hook so it is tied to the client's own
 * lifetime, and cannot be forgotten by a screen that fails to mount.
 */
if (isSupabaseConfigured) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}

/** Where the password-reset email should link back to. Uses the configured
 * redirect if set, otherwise the app's own deep link. */
export function passwordResetRedirectUrl(): string {
  return env.EXPO_PUBLIC_SUPABASE_REDIRECT_URL || Linking.createURL('/reset-password');
}
