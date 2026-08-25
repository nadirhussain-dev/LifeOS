import {
  authErrorMessage,
  type AuthAction,
  type SupabaseAuthError,
} from '@/features/auth/services/auth-errors';
import {
  useDeviceSessionStore,
  type DeviceVerdict,
  type OtherDevice,
} from '@/features/auth/store/device-session-store';
import { deviceLabel, devicePlatform, getDeviceId } from '@/lib/device-id';
import { isSupabaseConfigured } from '@/lib/env';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * This device's side of the one-account-one-device rule (migration 0047).
 *
 * The server owns the rule; this file only asks it questions and reports the
 * answers into `device-session-store`. It deliberately imports neither
 * `auth-store` nor anything that leads back to it: sign-out has to call
 * `releaseThisDevice()` from inside the auth store, and a module cycle between
 * the two is the kind of thing that works until a bundler reorders it and then
 * fails at launch with an undefined function. Reacting to a revocation —
 * wiping and signing out — therefore lives one level up, in
 * `hooks/use-device-session.ts`, which is allowed to know about both.
 */

/**
 * `revoked_reason` for a device that handed the account back itself, on an
 * ordinary sign-out (`release_device`). The one revocation reason that is not a
 * lockout — see `refreshDeviceSession`.
 */
export const RELEASED_BY_THIS_DEVICE = 'signed_out';

export type ClaimResult =
  | { status: 'claimed'; tookOver: boolean }
  | { status: 'otp_required'; otherDevice: OtherDevice | null }
  /** The question could not be asked — offline, or no credentials in this
   *  build. Explicitly NOT a refusal: locking someone out of an offline-first
   *  app because a request failed would be the worst possible reading. */
  | { status: 'unavailable'; error: string };

type ClaimPayload = {
  status?: string;
  takeOver?: boolean;
  otherDevice?: OtherDevice | null;
};

type StatusPayload = {
  status?: string;
  revokedReason?: string | null;
  revokedAt?: string | null;
  evacuationUntil?: string | null;
  activeDevice?: OtherDevice | null;
};

/**
 * Registers this device as the account's, or reports that another one holds it.
 *
 * Called on every sign-in and every foreground. Safe to repeat: re-claiming a
 * device that already holds the account only refreshes its `last_seen_at`.
 *
 * `takeOver` is the second half of the code flow — pass it only after
 * `verifyTakeoverOtp()` has succeeded, because the server checks the JWT for a
 * fresh one-time-code authentication and will hand back `otp_required` again
 * if the proof is missing or has aged out.
 */
export async function claimThisDevice(options?: { takeOver?: boolean }): Promise<ClaimResult> {
  if (!isSupabaseConfigured) {
    return { status: 'unavailable', error: 'Cloud sync isn’t set up on this build.' };
  }

  try {
    const { data, error } = await supabase.rpc('claim_device', {
      p_device_id: await getDeviceId(),
      p_label: deviceLabel(),
      p_platform: devicePlatform(),
      p_take_over: options?.takeOver ?? false,
    });

    if (error) {
      // A missing function means migration 0047 has not been applied. That is
      // an operator problem, not this user's, and refusing them access to
      // their own data over it would be the wrong trade — the account simply
      // stays unrestricted, exactly as it was before this feature existed.
      return { status: 'unavailable', error: error.message };
    }

    const payload = (data ?? {}) as ClaimPayload;

    if (payload.status === 'otp_required') {
      const other = payload.otherDevice ?? null;
      setVerdict('otp_required', other, null);
      return { status: 'otp_required', otherDevice: other };
    }

    setVerdict('active', null, null, null);
    return { status: 'claimed', tookOver: payload.takeOver === true };
  } catch (error) {
    return { status: 'unavailable', error: messageOf(error) };
  }
}

/**
 * What the server currently says about this device — deliberately the SERVER's
 * answer, not the store's cached verdict.
 *
 * 'unregistered' and 'unreachable' are separated because collapsing them is a
 * real bug rather than a tidiness question: the first means "claim me", the
 * second means "change nothing". Answering "claim me" to a request that never
 * arrived would fire a claim on every foreground while offline.
 */
export type DeviceStanding = 'active' | 'revoked' | 'unregistered' | 'unreachable';

/**
 * Re-reads this device's standing and doubles as its heartbeat.
 *
 * Reports rather than acts. A revoked device has to push, wipe and sign out in
 * that order (see `use-device-session.ts`) — putting that behind a function
 * whose name says "refresh" is how it ends up running from somewhere that only
 * wanted a status line.
 *
 * Only 'active' and 'revoked' touch the store. 'unregistered' must NOT: a
 * device waiting on a one-time code is unregistered by definition, and writing
 * that back would take the takeover screen down and leave the app rendering an
 * empty dashboard that RLS is refusing to fill.
 */
export async function refreshDeviceSession(): Promise<DeviceStanding> {
  if (!isSupabaseConfigured) return 'unreachable';

  try {
    const { data, error } = await supabase.rpc('device_status', {
      p_device_id: await getDeviceId(),
    });
    if (error) return 'unreachable';

    const payload = (data ?? {}) as StatusPayload;

    if (payload.status === 'revoked') {
      // Losing the account and letting go of it are not the same event, and
      // 0047's `device_status` reported both as 'revoked'. Migration 0051 fixes
      // that server-side, but this app also runs against databases that only
      // have 0047 — including every already-deployed one — so the distinction
      // is drawn here too.
      //
      // Treating a self-release as a revocation is what turned the most
      // ordinary sequence there is — sign in, sign out, sign in again on the
      // same phone — into a wipe, a "your account was opened on another device"
      // notice, and a second forced sign-out. Answered as 'unregistered', which
      // is what it is: the caller claims, and the server decides whether that
      // claim needs a code.
      if (payload.revokedReason === RELEASED_BY_THIS_DEVICE) return 'unregistered';

      setVerdict(
        'revoked',
        payload.activeDevice ?? null,
        payload.revokedReason ?? null,
        payload.revokedAt ?? null,
      );
      return 'revoked';
    }
    if (payload.status === 'active') {
      setVerdict('active', null, null, null);
      return 'active';
    }
    return 'unregistered';
  } catch {
    // Offline. The last known verdict stands; the server enforces the real one
    // on the next request that reaches it either way.
    return 'unreachable';
  }
}

/**
 * The same translation every other auth call in the app already got.
 *
 * These two requests were the only ones that skipped `authErrorMessage` and
 * returned `error.message` straight to the screen, and the result was not
 * merely untidy. auth-js turns any 5xx into
 * `AuthRetryableFetchError(_getErrorMessage(response), status)`, and
 * `_getErrorMessage` falls through to `JSON.stringify` when handed a `Response`
 * — which carries no `msg`, `message`, `error_description` or `error`. So on a
 * relay failure `error.message` is the entire serialised response: status,
 * every header, the `set-cookie`, the blob ids. That is what rendered, in red,
 * on the device-gate screen, above a button the user was being asked to trust.
 *
 * The mapped answer for that case is `emailNotSent`, which is also the only
 * honest one: nothing was delivered, so waiting for a code that is coming is
 * exactly the wrong thing to do.
 *
 * Reported as well as translated, on the same terms as `auth-store`'s `fail()`:
 * a 5xx here is our fault, not the user's, and from the outside it is
 * indistinguishable from an email that simply never arrived — so nobody files
 * a bug about it and it is invisible until somebody sends a screenshot.
 */
function takeoverFailure(error: SupabaseAuthError, action: AuthAction): string {
  if (typeof error.status === 'number' && error.status >= 500) {
    reportError(new Error(`device takeover ${action}: ${error.status} ${error.code ?? ''}`), {
      scope: 'device-session-otp',
      action,
    });
  }
  return authErrorMessage(error, action);
}

/**
 * Sends the one-time code that authorises taking the account over.
 *
 * Uses the same email-OTP channel as sign-up, with `shouldCreateUser: false` —
 * there is nothing to create here, and leaving it on would turn a typo in a
 * signed-in user's own email into a brand new empty account.
 */
export async function sendTakeoverOtp(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Cloud sync isn’t set up on this build.' };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false },
  });
  if (error) return { ok: false, error: takeoverFailure(error, 'sendSignInCode') };
  return { ok: true };
}

/**
 * Verifies the code, which replaces the current session with one whose JWT
 * carries the `amr` proof `claim_device(take_over => true)` requires.
 *
 * The session swap is the mechanism, not a side effect — it is why this is a
 * proof the server can check rather than a boolean the client asserts.
 */
export async function verifyTakeoverOtp(
  email: string,
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Cloud sync isn’t set up on this build.' };
  }
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  });
  if (error) return { ok: false, error: takeoverFailure(error, 'verifyCode') };
  return { ok: true };
}

/**
 * Hands the account back voluntarily, on sign-out.
 *
 * Best-effort and never throws. A sign-out that failed because the release
 * request did would strand somebody signed in on a device they are trying to
 * leave, which is a far worse outcome than a stale roster row — and a stale row
 * self-corrects the next time any device claims the account, since that claim
 * revokes whatever it finds.
 */
export async function releaseThisDevice(): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.rpc('release_device', { p_device_id: await getDeviceId() });
  } catch (error) {
    reportError(error, { scope: 'device-session-release' });
  }
}

/**
 * Revokes every device on the account and queues each one a wipe — called
 * immediately before account deletion, while there is still an account to
 * issue orders on behalf of.
 *
 * Best-effort for the same reason as above: deletion is the user's right and
 * must not be blocked by a bookkeeping call, and the cascade removes these rows
 * moments later regardless.
 */
export async function revokeAllDevices(reason = 'account_deleted'): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.rpc('revoke_all_devices', { p_reason: reason });
  } catch (error) {
    reportError(error, { scope: 'device-session-revoke-all' });
  }
}

function setVerdict(
  verdict: DeviceVerdict,
  other: OtherDevice | null | undefined,
  reason: string | null | undefined,
  revokedAt?: string | null,
): void {
  useDeviceSessionStore.getState().setVerdict(verdict, other, reason, revokedAt);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not reach the server.';
}
