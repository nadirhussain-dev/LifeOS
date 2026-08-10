import {
  useModuleFlagsStore,
  type ModuleFlag,
} from '@/features/module-flags/store/module-flags-store';
import { resyncAllReminders } from '@/features/notifications/services/reminder-scheduler';
import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/**
 * Pulls the remote module switches.
 *
 * Never throws, and — importantly — never clears the cache on failure. A failed
 * fetch leaves the last known state in place rather than reverting to "no
 * overrides": if the operator has pulled a module because it corrupts data,
 * a flaky connection must not quietly hand it back.
 *
 * The mirror of that rule is in the store: a module with no entry is enabled.
 * So the failure modes are "keep the last instruction" and "assume fine", which
 * between them cover every case without ever bricking the app.
 */
let inFlight: Promise<void> | null = null;

export function refreshModuleFlags(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runRefresh(): Promise<void> {
  if (!isSupabaseConfigured) return;

  try {
    /**
     * `my_module_flags()` (migration 0024), not the `module_flags` table.
     *
     * The RPC merges the global switches with this account's own overrides —
     * user wins, absence falls through to global, absence of both means
     * enabled — so staged rollouts and one-account support fixes stop meaning
     * "take the feature away from everybody". It returns only the modules that
     * are *off*, which is why an empty response and a failed request can go on
     * being treated identically.
     *
     * A guest has no session and so no overrides; the RPC returns the global
     * set for them, which is the same answer the table gave.
     */
    const { data, error } = await supabase.rpc('my_module_flags');
    if (error || !data) return;

    const flags: Record<string, ModuleFlag> = {};
    for (const row of data as { module?: unknown; enabled?: unknown; message?: unknown }[]) {
      const module = typeof row.module === 'string' ? row.module : null;
      if (!module) continue;
      flags[module] = {
        enabled: row.enabled !== false,
        message: typeof row.message === 'string' && row.message.length > 0 ? row.message : null,
      };
    }
    const before = disabledSet(useModuleFlagsStore.getState().flags);
    useModuleFlagsStore.getState().setFlags(flags);
    const after = disabledSet(flags);

    // A module the operator has just pulled may still have a fortnight of its
    // reminders queued with the OS, and those keep firing — pointing at a
    // screen the guard now redirects away from. Rebuilding drops them (see
    // notification-visibility.ts), and rebuilding on the way back restores
    // them. Only on an actual change: a resync cancels and re-schedules
    // everything the app owns, which is not something to do on every
    // foreground.
    if (!sameSet(before, after)) void resyncAllReminders();
  } catch {
    // Keep whatever we already had — see the note above.
  }
}

function disabledSet(flags: Record<string, ModuleFlag>): Set<string> {
  return new Set(
    Object.entries(flags)
      .filter(([, flag]) => !flag.enabled)
      .map(([module]) => module),
  );
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}
