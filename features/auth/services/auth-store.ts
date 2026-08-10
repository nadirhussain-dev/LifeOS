import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  reconcileAccountOnSignIn,
  wipeLocalData,
} from '@/features/sync/services/account-reconcile';
import { ensureProfileRow } from '@/features/auth/services/ensure-profile';
import { isSupabaseConfigured } from '@/lib/env';
import { passwordResetRedirectUrl, supabase } from '@/lib/supabase';

/** Returned by auth actions when Supabase creds aren't present in the build —
 * avoids firing a doomed request at the placeholder host (which surfaces as a
 * confusing "Network request failed"). */
const NOT_CONFIGURED = {
  ok: false as const,
  error:
    'Cloud sync isn’t set up on this build. Add your Supabase keys to .env, then fully restart with `npx expo start -c`.',
};

/** Result shape both sign-in and sign-up return so screens can show a friendly
 * error without importing Supabase's error types. */
export type AuthResult = { ok: true } | { ok: false; error: string };

export type AuthProfile = {
  id: string;
  email: string | null;
  displayName: string | null;
  /** Unique account name. Null until claimed — sign-up creates the account
   *  first and claims the name after, so a lost race never blocks sign-up. */
  username: string | null;
  /** Storage path, not a URL — see features/profile/services/avatar.ts. */
  avatarPath: string | null;
  /** Cache-buster: the storage URL is stable, so without this every device
   *  keeps rendering the previous picture forever. */
  avatarUpdatedAt: number | null;
};

/** Outcome of claiming a name. 'taken' is a normal result, not an error: two
 *  people can pass the availability probe and race for the same name. */
export type UsernameClaim = 'ok' | 'taken' | 'invalid' | 'error';

/** Verdict from the availability probe.
 *
 *  'unavailable' is deliberately distinct from 'taken'. Collapsing the two (by
 *  returning a bare boolean and answering `false` on error) is what made a
 *  permission error on the RPC look identical to a name genuinely being in use:
 *  every name on the sign-up form read as taken, with no way to tell that the
 *  backend was the problem. A check that could not run must say so. */
export type UsernameAvailability = 'available' | 'taken' | 'invalid' | 'unavailable';

/** Mirrors the DB check constraint in 0002_username.sql. */
export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  /** True once the initial getSession has resolved — the gate waits for this
   * before deciding where to send the user (avoids a login-screen flash). */
  isInitialized: boolean;
  /** The user chose "continue without an account". Persisted so we don't force
   * the login screen on every launch. Cleared on sign-in. */
  isGuest: boolean;
  /** True once `isGuest` has been read back from AsyncStorage. The gate also
   * waits for this — otherwise a guest who reloads mid-session sees `isGuest`
   * at its unhydrated default of false and gets bounced to the login screen. */
  hasHydrated: boolean;

  init: () => void;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, displayName?: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  deleteAccount: () => Promise<AuthResult>;
  continueAsGuest: () => void;
  loadProfile: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<AuthResult>;
  /** Re-reads the profile row after an avatar change. */
  refreshProfile: () => Promise<void>;
  /** Whether `candidate` is well-formed and unclaimed by anyone else — or
   * whether the question could not be answered at all. */
  isUsernameAvailable: (candidate: string) => Promise<UsernameAvailability>;
  claimUsername: (candidate: string) => Promise<UsernameClaim>;
};

/** Maps Supabase's error messages to something a person wants to read. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'That email or password is incorrect.';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'An account with this email already exists.';
  if (m.includes('password should be')) return 'Password must be at least 6 characters.';
  if (m.includes('unable to validate email') || m.includes('invalid email'))
    return 'That email address looks invalid.';
  if (m.includes('email not confirmed')) return 'Please confirm your email first, then sign in.';
  if (m.includes('network')) return 'Network error — check your connection and try again.';
  return message;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      profile: null,
      isInitialized: false,
      isGuest: false,
      hasHydrated: false,

      init: () => {
        // isInitialized MUST flip true no matter what — otherwise the root
        // layout / index screen stay on the loading state forever. getSession()
        // can reject (e.g. a token refresh hits the network and fails), so
        // guard with catch + finally rather than only handling the happy path.
        supabase.auth
          .getSession()
          .then(({ data }) => {
            if (data.session) reconcileAccountOnSignIn(data.session.user.id);
            set({ session: data.session, user: data.session?.user ?? null });
            if (data.session) void get().loadProfile();
          })
          .catch(() => {
            // Offline / unconfigured — proceed with no session (guest-capable).
          })
          .finally(() => set({ isInitialized: true }));

        // Safety net: never let the app hang on the loading state if getSession
        // somehow never settles (e.g. a stalled network layer).
        setTimeout(() => {
          if (!get().isInitialized) set({ isInitialized: true });
        }, 4000);

        supabase.auth.onAuthStateChange((_event, session) => {
          // Wipe-before-sync if a different account signed in on this device.
          if (session) reconcileAccountOnSignIn(session.user.id);
          set({ session, user: session?.user ?? null, isInitialized: true });
          // A real session means we're no longer a guest.
          if (session) set({ isGuest: false });
          if (session) void get().loadProfile();
          else set({ profile: null });
        });
      },

      signIn: async (email, password) => {
        if (!isSupabaseConfigured) return NOT_CONFIGURED;
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) return { ok: false, error: friendly(error.message) };
        set({ isGuest: false });
        return { ok: true };
      },

      signUp: async (email, password, displayName) => {
        if (!isSupabaseConfigured) return NOT_CONFIGURED;
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: displayName ? { data: { display_name: displayName.trim() } } : undefined,
        });
        if (error) return { ok: false, error: friendly(error.message) };
        set({ isGuest: false });
        return { ok: true };
      },

      signOut: async () => {
        await supabase.auth.signOut();
        set({ session: null, user: null, profile: null, isGuest: false });
      },

      resetPassword: async (email) => {
        if (!isSupabaseConfigured) return NOT_CONFIGURED;
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: passwordResetRedirectUrl(),
        });
        if (error) return { ok: false, error: friendly(error.message) };
        return { ok: true };
      },

      updatePassword: async (newPassword) => {
        if (!isSupabaseConfigured) return NOT_CONFIGURED;
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) return { ok: false, error: friendly(error.message) };
        return { ok: true };
      },

      deleteAccount: async () => {
        if (!isSupabaseConfigured) return NOT_CONFIGURED;
        // Server-side deletion (auth user + all their rows) runs in an edge
        // function — the client can't call auth.admin.deleteUser. See
        // supabase/functions/delete-account. Requires App/Play store compliance.
        const { error } = await supabase.functions.invoke('delete-account');
        if (error) return { ok: false, error: friendly(error.message) };
        wipeLocalData();
        await supabase.auth.signOut();
        set({ session: null, user: null, profile: null, isGuest: false });
        return { ok: true };
      },

      continueAsGuest: () => set({ isGuest: true }),

      loadProfile: async () => {
        const user = get().user;
        if (!user) return;
        // Repairs a missing profiles row before anything depends on it — see
        // ensure-profile.ts for the Split group-creation failure this prevents.
        await ensureProfileRow();
        const { data } = await supabase
          .from('profiles')
          .select('id, email, display_name, username, avatar_path, avatar_updated_at')
          .eq('id', user.id)
          .maybeSingle();
        set({
          profile: {
            id: user.id,
            email: data?.email ?? user.email ?? null,
            displayName:
              data?.display_name ??
              (user.user_metadata?.display_name as string | undefined) ??
              null,
            username: data?.username ?? null,
            avatarPath: data?.avatar_path ?? null,
            avatarUpdatedAt: data?.avatar_updated_at ?? null,
          },
        });
      },

      /** Re-reads the profile row. loadProfile already does exactly this, so
       *  this is an alias that says what the caller means at the call site. */
      refreshProfile: async () => {
        await get().loadProfile();
      },

      updateDisplayName: async (displayName) => {
        const user = get().user;
        if (!user) return { ok: false, error: 'You need to be signed in.' };
        const { error } = await supabase
          .from('profiles')
          .update({ display_name: displayName.trim() })
          .eq('id', user.id);
        if (error) return { ok: false, error: friendly(error.message) };
        set((s) => ({
          profile: s.profile ? { ...s.profile, displayName: displayName.trim() } : s.profile,
        }));
        return { ok: true };
      },

      isUsernameAvailable: async (candidate) => {
        if (!USERNAME_PATTERN.test(candidate)) return 'invalid';
        // Without credentials there is nothing to ask, and firing at the
        // placeholder host just produces a confusing network error.
        if (!isSupabaseConfigured) return 'unavailable';
        // RPC, not a select: `profiles_own` RLS hides other people's rows, so a
        // direct query would report every taken name as free.
        const { data, error } = await supabase.rpc('is_username_available', { candidate });
        // An error means the probe failed, NOT that the name is spoken for. If
        // this ever fires with "permission denied", migration 0006 has not been
        // applied to the project — see supabase/migrations/0006_username_signup_probe.sql.
        if (error) return 'unavailable';
        return data === true ? 'available' : 'taken';
      },

      claimUsername: async (candidate) => {
        if (!USERNAME_PATTERN.test(candidate)) return 'invalid';
        const { data, error } = await supabase.rpc('claim_username', { candidate });
        if (error) return 'error';
        const result = data as UsernameClaim;
        if (result === 'ok') {
          set((s) => ({ profile: s.profile ? { ...s.profile, username: candidate } : s.profile }));
        }
        return result;
      },
    }),
    {
      name: 'auth-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the guest choice needs persisting — Supabase persists the session
      // itself, and everything else is derived on init.
      partialize: (state) => ({ isGuest: state.isGuest }),
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ hasHydrated: true });
      },
    },
  ),
);

/** True when the app should show its content (either signed in or an explicit
 * guest). Callable outside React. */
export function isSignedInOrGuest(): boolean {
  const s = useAuthStore.getState();
  return !!s.session || s.isGuest;
}
