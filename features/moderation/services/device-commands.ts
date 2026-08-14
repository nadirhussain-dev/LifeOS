import { useAuthStore } from '@/features/auth/services/auth-store';
import { useModerationStore } from '@/features/moderation/store/moderation-store';
import { evacuateBeforeWipe } from '@/features/sync/services/sync-engine';
import { wipeDeviceData, wipeLocalData } from '@/features/sync/services/account-reconcile';
import { getDeviceId } from '@/lib/device-id';
import { isSupabaseConfigured } from '@/lib/env';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * Instructions the operator has left for this account's devices.
 *
 * Today there is one: `wipe_local`, issued when an account is blocked. The
 * device fetches it on launch and on each foreground, carries it out, and
 * acknowledges it — the acknowledgement is the point as much as the wipe is,
 * because "blocked" alone cannot tell an operator whether a phone ever came
 * back to receive the instruction.
 *
 * ## This is not the enforcement
 *
 * A modified client can decline to run any of this. What actually stops a
 * blocked account is migration 0019's row-level security, which refuses every
 * read and every write server-side regardless of what the app does. This
 * removes the *local* copy, which the server cannot reach on its own — and it
 * only works on a cooperating client, which is a real limitation and not one
 * any amount of app-side code can fix.
 */

export type DeviceCommand = {
  id: string;
  command: 'wipe_local';
  detail: Record<string, unknown>;
  issuedAt: string;
};

/** What a wipe actually cost, kept so the block screen can be specific. */
export type WipeOutcome = {
  at: number;
  /** Modules whose rows never reached the server and are now gone. */
  unsaved: string[];
  /** Rows the final push managed to save. */
  pushed: number;
};

let inFlight: Promise<void> | null = null;

/**
 * Fetches and runs anything outstanding. Never throws — a failure here must not
 * take down app startup, and the command stays unacknowledged so the next
 * launch tries again.
 */
export function processDeviceCommands(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<void> {
  if (!isSupabaseConfigured) return;
  if (!useAuthStore.getState().user) return;

  let commands: DeviceCommand[];
  try {
    // Named, because a command can now be aimed at ONE device: migration 0047
    // queues a wipe for the phone that just lost the account, and the phone
    // that just took it must not carry that order out on itself. Commands with
    // no target (a moderator blocking the whole account) still reach everyone.
    const { data, error } = await supabase.rpc('pending_device_commands', {
      p_device_id: await getDeviceId(),
    });
    if (error || !data) return;
    commands = (data as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      command: row.command as 'wipe_local',
      detail: (row.detail ?? {}) as Record<string, unknown>,
      issuedAt: String(row.issued_at),
    }));
  } catch {
    // Offline. The command is server-side and outlives this attempt.
    return;
  }

  for (const command of commands) {
    if (command.command !== 'wipe_local') continue;
    await performLocalWipe(command);
  }
}

/**
 * The wipe, in the order the order matters.
 *
 * 1. Push whatever can still be pushed, so the wipe is recoverable.
 * 2. Work out what could not be saved, BEFORE destroying the evidence of it.
 * 3. Wipe.
 * 4. Acknowledge, reporting what was lost.
 *
 * Step 4 is last on purpose. Acknowledging first would mean a crash during the
 * wipe leaves the operator believing a device was cleaned when it was not, and
 * the retry would never happen — an unacknowledged command is repeated on the
 * next launch, which is the behaviour that fails safe.
 */
async function performLocalWipe(command: DeviceCommand): Promise<void> {
  let outcome: WipeOutcome = { at: Date.now(), unsaved: [], pushed: 0 };

  try {
    const evacuation = await evacuateBeforeWipe();
    outcome = { at: Date.now(), unsaved: evacuation.unsaved, pushed: evacuation.pushed };
  } catch (error) {
    // The push failing does not cancel the wipe — the instruction stands, and
    // the account is blocked either way. It does mean nothing was saved, and
    // the record has to say so rather than claiming an empty loss list.
    reportError(error, { scope: 'device-wipe-evacuation' });
    outcome = { at: Date.now(), unsaved: ['*'], pushed: 0 };
  }

  try {
    // Two different wipes, because the two orders mean different things.
    //
    // A moderation block leaves the device in use by the same person, who may
    // be unblocked tomorrow — so `wipeLocalData` keeps the onboarding flag and
    // does not pretend the app was never set up here.
    //
    // Losing the account to another device is the opposite: this phone is done
    // with this account, possibly because it was sold or handed on, and the
    // whole point of the order is that nothing personal survives it. That is
    // `wipeDeviceData`, which also clears the onboarding answers.
    if (
      command.detail.reason === 'signed_in_elsewhere' ||
      command.detail.reason === 'account_deleted'
    ) {
      wipeDeviceData();
    } else {
      wipeLocalData();
    }
  } catch (error) {
    // A failed wipe must not be acknowledged. Leaving the command outstanding
    // is what gets it retried on the next launch.
    reportError(error, { scope: 'device-wipe' });
    return;
  }

  // Written after the wipe, since the wipe clears the stores this sits beside.
  useModerationStore.getState().setWipeOutcome(outcome);

  try {
    await supabase.rpc('ack_device_command', {
      p_id: command.id,
      p_detail: { wiped: true, unsyncedModules: outcome.unsaved, pushedRows: outcome.pushed },
    });
  } catch {
    // The wipe happened; only the receipt failed. Re-acking on a later launch
    // is harmless — the function is a no-op once `acked_at` is set.
  }
}
