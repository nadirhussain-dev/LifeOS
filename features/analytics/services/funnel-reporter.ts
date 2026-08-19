import { getInstallId } from '@/features/analytics/services/install-id';
import { useFunnelStore } from '@/features/analytics/store/funnel-store';
import { useUsageStore } from '@/features/analytics/store/usage-store';
import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/**
 * Sends the buffered funnel counters.
 *
 * Same shape as `usage-reporter.ts`: one in-flight promise, never throws, and a
 * failed send puts the entries back so an offline stretch shows up as a catch-up
 * rather than as a period that never happened.
 *
 * ## The one rule that is not shared
 *
 * `record_funnel` is granted to `anon` as well as `authenticated`, because the
 * onboarding funnel is reported by installs that have no session — the account
 * step is one of the things being measured, and guests never sign in at all. A
 * reporter that required a session would report a completion rate computed only
 * over the people who completed the account step, which is the one population
 * whose completion rate is guaranteed to look fine.
 *
 * ## Consent is checked here, not only at the call site
 *
 * `funnel-store.track` lets the onboarding metrics accrue before the consent
 * card has been answered, because the card deliberately waits for onboarding to
 * end. This is the gate that makes that safe: **nothing is transmitted until
 * the question has an answer**, and the answer being "no" clears the buffer
 * rather than holding it. Both halves have to be true or the exception in
 * `PRE_CONSENT_METRICS` is just collection with extra steps.
 */

let inFlight: Promise<void> | null = null;

export function flushFunnel(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runFlush().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runFlush(): Promise<void> {
  if (!isSupabaseConfigured) return;

  const usage = useUsageStore.getState();
  const funnel = useFunnelStore.getState();
  if (!funnel.hydrated || !usage.hydrated) return;

  // Unanswered: hold. Refused: there is nothing buffered to send, and this
  // returns before asking for an install id in any case.
  if (!usage.enabled) return;

  const entries = funnel.drain();
  if (entries.length === 0) return;

  try {
    const installId = await getInstallId();
    const { error } = await supabase.rpc('record_funnel', {
      p_install_id: installId,
      p_entries: entries,
    });
    if (error) throw new Error(error.message);
  } catch {
    useFunnelStore.getState().restore(entries);
  }
}
