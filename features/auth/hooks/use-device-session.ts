import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuthStore } from '@/features/auth/services/auth-store';
import {
  claimThisDevice,
  refreshDeviceSession,
  sendTakeoverOtp,
  verifyTakeoverOtp,
} from '@/features/auth/services/device-session';
import { useDeviceSessionStore } from '@/features/auth/store/device-session-store';
import { processDeviceCommands } from '@/features/moderation/services/device-commands';
import { syncNow } from '@/features/sync/services/sync-engine';
import { reportError } from '@/lib/error-reporting';

/**
 * Keeps this device's claim on the account current, and carries out the
 * consequences when it loses it.
 *
 * Mounted once from the root layout, alongside `useAccountStandingSync` — the
 * two are the same shape for the same reason: a verdict that has to be right on
 * launch and right again on every foreground, because the event this is
 * watching for (somebody signing in on their new phone) happens while this app
 * is in somebody's pocket.
 *
 * This module is the one place allowed to know about both `device-session`
 * (which talks to the server) and `auth-store` (which owns sign-out). Keeping
 * that knowledge here is what stops the two from importing each other.
 */
export function useDeviceSessionSync() {
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    if (!session) {
      useDeviceSessionStore.getState().clear();
      return;
    }

    void pass();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pass();
    });
    return () => sub.remove();
  }, [session]);
}

/**
 * One pass, run on sign-in and on every foreground.
 *
 * **Status before claim**, and that order is a bug fix rather than a
 * preference. A phone that was revoked while it sat closed comes back knowing
 * nothing. If it claimed first, the server would see another device holding the
 * account and answer `otp_required` — so the user would be shown "another
 * device has your account, enter a code to move it" about the very takeover
 * that already happened, and the wipe queued for this phone would never run.
 * Asking what this device's own standing is first gets the right answer to a
 * question the claim cannot even express.
 *
 * Skipped entirely while a takeover is mid-flight. Verifying the code swaps the
 * session, which fires `onAuthStateChange`, which re-runs the effect above —
 * without this guard that re-entry fires a fresh non-takeover claim, gets
 * `otp_required` back, and knocks the user off the screen they are standing on.
 */
async function pass(): Promise<void> {
  if (useDeviceSessionStore.getState().claiming) return;

  const standing = await refreshDeviceSession();

  if (standing === 'revoked') {
    await surrender();
    return;
  }
  // Not on the roster yet — the ordinary state between signing in and the
  // first claim. 'active' needs nothing (the status call was itself the
  // heartbeat) and 'unreachable' must change nothing at all.
  if (standing === 'unregistered') await claimThisDevice();
}

/**
 * Losing the account to another device, carried out.
 *
 * Each step is where it is because the step after it destroys what the step
 * before it needs:
 *
 *  1. **Run the queued wipe.** `processDeviceCommands` pushes whatever this
 *     device never synced before deleting it — which only works inside the
 *     evacuation window migration 0048 opens on the revoked row, and that
 *     window is minutes wide, not days. Doing this after the sign-out in step 3
 *     would mean pushing with no session at all.
 *  2. **Restore the verdict.** The wipe clears the device-session store along
 *     with everything else, and the notice screen is the only remaining
 *     explanation for a phone that just emptied itself. Written back after,
 *     exactly as `moderation-store` writes `wipeOutcome` after its own wipe.
 *  3. **Sign out.** Last, because the session is what made step 1 possible.
 */
async function surrender(): Promise<void> {
  const { revokedReason, otherDevice } = useDeviceSessionStore.getState();

  try {
    await processDeviceCommands();
  } catch (error) {
    // The revocation stands whether or not the wipe ran. Reported, then
    // pressed on with — the command is unacked, so the next launch retries it.
    reportError(error, { scope: 'device-session-wipe' });
  }

  useDeviceSessionStore.getState().setVerdict('revoked', otherDevice, revokedReason);

  await useAuthStore.getState().signOut({ wipeDevice: false, release: false });

  // Re-asserted after sign-out too: signing out clears the store again, and
  // the person holding this phone is owed the reason it just emptied.
  useDeviceSessionStore.getState().setVerdict('revoked', otherDevice, revokedReason);
}

/** Sends the code that authorises moving the account to this device. */
export async function requestTakeover(email: string) {
  return sendTakeoverOtp(email);
}

/**
 * Verifies the code and moves the account here — which revokes the other
 * device and queues its wipe, server-side, in one statement.
 *
 * Returns the claim result so the screen can distinguish "wrong code" from
 * "code was fine but the claim did not go through", which are different
 * problems with different next steps.
 */
export async function completeTakeover(
  email: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = useDeviceSessionStore.getState();
  store.setClaiming(true);
  try {
    const verified = await verifyTakeoverOtp(email, code);
    if (!verified.ok) return verified;

    const claim = await claimThisDevice({ takeOver: true });
    if (claim.status === 'claimed') {
      // The account's rows have never been pulled onto this device — until the
      // claim landed, RLS refused every one of them. Forced, because the
      // ordinary throttle would skip a sync this recent.
      void syncNow({ force: true });
      return { ok: true };
    }
    if (claim.status === 'otp_required') {
      return { ok: false, error: 'takeoverProofExpired' };
    }
    return { ok: false, error: claim.error };
  } finally {
    store.setClaiming(false);
  }
}

/** Reactive verdict for the overlay. */
export function useDeviceSession() {
  const verdict = useDeviceSessionStore((s) => s.verdict);
  const otherDevice = useDeviceSessionStore((s) => s.otherDevice);
  const revokedReason = useDeviceSessionStore((s) => s.revokedReason);
  return { verdict, otherDevice, revokedReason };
}
