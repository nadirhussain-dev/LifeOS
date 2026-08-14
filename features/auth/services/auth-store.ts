import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { releaseThisDevice, revokeAllDevices } from '@/features/auth/services/device-session';
import {
  reconcileAccountOnSignIn,
  wipeDeviceData,
} from '@/features/sync/services/account-reconcile';
import { GUEST_SENTINEL, useSyncStore } from '@/features/sync/store/sync-store';
import { ensureProfileRow } from '@/features/auth/services/ensure-profile';
import { isSupabaseConfigured } from '@/lib/env';
import { reportError } from '@/lib/error-reporting';
import { looksOffline } from '@/lib/supabase-error';
import { passwordResetRedirectUrl, supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast-store';
import i18n from '@/lib/i18n';

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

/** How much a sign-out should tear down. Defaults are the ordinary case; every
 *  field exists for one caller that genuinely needs the other answer. */
export type SignOutOptions = {
  /**
   * Erase this device's copy of everything on the way out. On by default:
   * signing out is the moment a phone stops being yours, and leaving a full
   * local database behind — journal, finances, photographs — because the
   * session token was removed is a privacy answer that only looks complete.
   */
  wipeDevice?: boolean;
  /** Hand the account's device slot back so the next device signs in without
   *  a code. Off only when the slot is already gone (this device was revoked). */
  release?: boolean;
};

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
  /** Set once onboarding finishes on ANY device — see migration 0042. Lets a
   *  device that has never seen this account before (a fresh install, or
   *  after a wipe) skip straight to the dashboard on sign-in instead of
   *  re-running onboarding, which `useAuthGate` otherwise has no way to tell
   *  apart from a genuinely new account. */
  onboardingCompletedAt: number | null;
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
  /** Sends a 6-digit sign-up code to `email` and creates the account once it's
   *  verified (see `verifySignupOtp`). No password yet — that's a separate
   *  step once a session exists, via `updatePassword`. */
  sendSignupOtp: (email: string, displayName?: string) => Promise<AuthResult>;
  /** Verifies the sign-up code and establishes the session. */
  verifySignupOtp: (email: string, token: string) => Promise<AuthResult>;
  /**
   * Signs out and, unless told otherwise, wipes this device — see
   * `SignOutOptions`.
   *
   * This is the mechanism, not the flow. It does NOT push unsynced work
   * first, and it will therefore destroy anything that never reached the
   * server. UI call sites must go through `confirmAndSignOut()` in
   * `features/auth/services/sign-out-flow.ts`, which owns the evacuation and
   * the confirmation; the split exists because the evacuation lives in
   * `sync-engine`, which imports this store, and importing it back would put a
   * cycle between the two.
   */
  signOut: (options?: SignOutOptions) => Promise<void>;
  resetPassword: (email: string) => Promise<AuthResult>;
  /** Verifies a password-reset code and establishes the recovery session that
   *  `updatePassword` then sets the new password against. */
  verifyPasswordResetOtp: (email: string, token: string) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  deleteAccount: () => Promise<AuthResult>;
  continueAsGuest: () => void;
  loadProfile: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<AuthResult>;
  /** Re-reads the profile row after an avatar change. */
  refreshProfile: () => Promise<void>;
  /** Records that onboarding finished, on the account rather than just this
   *  device — see `AuthProfile.onboardingCompletedAt`. Best-effort: a guest
   *  has no row to write to, and a failure here must never block finishing
   *  onboarding locally, which is why onboarding's own `finish()` fires this
   *  without awaiting it. */
  markOnboardingComplete: () => Promise<void>;
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
  if (m.includes('otp') || m.includes('token has expired') || m.includes('token is invalid')) {
    return 'That code is incorrect or has expired. Request a new one.';
  }
  return message;
}

/**
 * Retries an auth call ONLY when the failure looks like it never reached a
 * decision — offline, or the server itself erroring — never a genuine
 * rejection (wrong password, invalid email, already registered), where
 * retrying would just repeat the same "no" three times slower.
 *
 * Deliberately NOT `lib/supabase-error.ts`'s `isRetryable`/`errorKind`: that
 * classifier is shaped for PostgREST's error codes (`PGRST5xx`, Postgres
 * SQLSTATEs), which a Supabase Auth error never carries. Every genuine
 * rejection auth returns is a definite 4xx with no code that classifier
 * recognises, so it fell through to 'unknown' — which `isRetryable` treats
 * as transient. That meant a wrong password got silently retried twice
 * before the "incorrect password" message ever reached the screen. Auth
 * errors DO carry an HTTP-shaped `status`, which is the reliable signal:
 * present and < 500 means the server made an actual decision.
 */
function isRetryableAuthError(error: { status?: number; message: string } | null): boolean {
  if (!error) return false;
  if (typeof error.status === 'number') return error.status >= 500;
  return looksOffline(error.message);
}

/** Short, fixed backoff — this runs inline in front of someone waiting to
 *  sign in, not unattended in the background like sync-engine.ts's
 *  minutes-long scheme. */
async function withRetry<T extends { error: { status?: number; message: string } | null }>(
  attempt: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let result = await attempt();
  for (
    let tries = 0;
    result.error && isRetryableAuthError(result.error) && tries < maxRetries;
    tries += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** tries));
    result = await attempt();
  }
  return result;
}

/**
 * Set for the duration of an explicit `signOut()`/`deleteAccount()` call, so
 * the `onAuthStateChange` listener can tell "the user chose to sign out"
 * apart from "the refresh token died silently" — both fire the same way,
 * and only the second one is news the user hasn't already acted on.
 */
let explicitSignOut = false;

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
          // A session that existed a moment ago and now doesn't, without this
          // device having asked for that (signOut()/deleteAccount() flip
          // `explicitSignOut` first) — the refresh token died: revoked,
          // expired past its grace window, or the account removed elsewhere.
          // Told here rather than left to surface as a pile of silent 401s on
          // whatever the user tries to do next.
          if (get().session && !session && !explicitSignOut) {
            toast.error(i18n.t('auth.sessionExpired'));
          }
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
        const { error } = await withRetry(() =>
          supabase.auth.signInWithPassword({ email: email.trim(), password }),
        );
        if (error) return { ok: false, error: friendly(error.message) };
        set({ isGuest: false });
        return { ok: true };
      },

      sendSignupOtp: async (email, displayName) => {
        if (!isSupabaseConfigured) return NOT_CONFIGURED;
        const { error } = await withRetry(() =>
          supabase.auth.signInWithOtp({
            email: email.trim(),
            options: {
              shouldCreateUser: true,
              data: displayName ? { display_name: displayName.trim() } : undefined,
            },
          }),
        );
        if (error) return { ok: false, error: friendly(error.message) };
        return { ok: true };
      },

      verifySignupOtp: async (email, token) => {
        if (!isSupabaseConfigured) return NOT_CONFIGURED;
        const { error } = await withRetry(() =>
          supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' }),
        );
        if (error) return { ok: false, error: friendly(error.message) };
        set({ isGuest: false });
        return { ok: true };
      },

      /**
       * Signs out and clears this device.
       *
       * The order is the interesting part, and each step is where it is
       * because the next one makes it impossible:
       *
       *  1. **Release the device slot**, while there is still a session to
       *     release it with. Skipping this would leave the roster claiming
       *     this phone holds the account, and the user's *next* phone would be
       *     met by a one-time code for a device that is no longer signed in.
       *  2. **Wipe.** Before the sign-out rather than after, because a crash
       *     between the two must not leave a signed-out phone carrying a full
       *     database.
       *  3. **Sign out.**
       *
       * The push of unsynced work happens before all of this, in
       * `confirmAndSignOut()` — see the note on the type above.
       */
      signOut: async (options) => {
        const wipeDevice = options?.wipeDevice ?? true;

        if ((options?.release ?? true) && get().session) {
          await releaseThisDevice();
        }

        if (wipeDevice) {
          try {
            wipeDeviceData();
          } catch (error) {
            // Reported, not fatal. Refusing to sign out because the wipe threw
            // would strand somebody signed in on a device they are trying to
            // leave — the worse of the two failures by a wide margin.
            reportError(error, { scope: 'sign-out-wipe' });
          }
        }

        explicitSignOut = true;
        try {
          await supabase.auth.signOut();
        } finally {
          explicitSignOut = false;
        }
        set({ session: null, user: null, profile: null, isGuest: false });
      },

      resetPassword: async (email) => {
        if (!isSupabaseConfigured) return NOT_CONFIGURED;
        const { error } = await withRetry(() =>
          supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: passwordResetRedirectUrl(),
          }),
        );
        if (error) return { ok: false, error: friendly(error.message) };
        return { ok: true };
      },

      verifyPasswordResetOtp: async (email, token) => {
        if (!isSupabaseConfigured) return NOT_CONFIGURED;
        const { error } = await withRetry(() =>
          supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'recovery' }),
        );
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

        // Before the account goes, not after: this queues a wipe for every
        // device on the roster and revokes them all. Once `deleteUser` runs the
        // rows cascade away and there is no longer an account to issue orders
        // on behalf of — so a phone that is offline right now would otherwise
        // keep its full local copy with nothing left to ever tell it otherwise.
        // Best-effort, and deliberately not allowed to block the deletion,
        // which is the user's right and not conditional on bookkeeping.
        await revokeAllDevices('account_deleted');

        // Server-side deletion (auth user + all their rows) runs in an edge
        // function — the client can't call auth.admin.deleteUser. See
        // supabase/functions/delete-account. Requires App/Play store compliance.
        const { error } = await supabase.functions.invoke('delete-account');
        if (error) return { ok: false, error: friendly(error.message) };
        // The full device wipe, not the account-switch one: there is no account
        // to come back to, so nothing about this install should still describe
        // the person who just deleted theirs.
        wipeDeviceData();
        explicitSignOut = true;
        try {
          await supabase.auth.signOut();
        } finally {
          explicitSignOut = false;
        }
        set({ session: null, user: null, profile: null, isGuest: false });
        return { ok: true };
      },

      continueAsGuest: () => {
        set({ isGuest: true });
        // Stamp a sentinel so a subsequent first-ever real sign-in on this
        // device can tell "unidentified guest scratch data" apart from
        // "nobody has ever used this device" — without it, that sign-in sees
        // lastUserId === null and (correctly, per its own fail-safe rule)
        // assumes there's nothing to wipe, so the new account silently
        // inherits whatever the guest created. Only stamp when nothing is
        // known yet: a returning real user who taps "continue as guest" must
        // keep their own captured uid, not lose it to this sentinel, and we
        // only trust the flag once the store has actually rehydrated.
        const sync = useSyncStore.getState();
        if (sync.hydrated && sync.lastUserId === null) {
          sync.setLastUserId(GUEST_SENTINEL);
        }
      },

      loadProfile: async () => {
        const user = get().user;
        if (!user) return;
        // Repairs a missing profiles row before anything depends on it — see
        // ensure-profile.ts for the Split group-creation failure this prevents.
        await ensureProfileRow();
        const { data } = await supabase
          .from('profiles')
          .select(
            'id, email, display_name, username, avatar_path, avatar_updated_at, onboarding_completed_at',
          )
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
            onboardingCompletedAt: data?.onboarding_completed_at ?? null,
          },
        });
      },

      /** Re-reads the profile row. loadProfile already does exactly this, so
       *  this is an alias that says what the caller means at the call site. */
      refreshProfile: async () => {
        await get().loadProfile();
      },

      markOnboardingComplete: async () => {
        const user = get().user;
        if (!user) return; // guest: nothing server-side to mark
        try {
          const now = Date.now();
          const { error } = await supabase
            .from('profiles')
            .update({ onboarding_completed_at: now })
            .eq('id', user.id);
          if (error) return;
          set((s) => ({
            profile: s.profile ? { ...s.profile, onboardingCompletedAt: now } : s.profile,
          }));
        } catch {
          // Best-effort — see this action's own doc comment.
        }
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
