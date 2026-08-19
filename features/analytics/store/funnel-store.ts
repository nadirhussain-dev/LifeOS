import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { PRE_CONSENT_METRICS, type FunnelMetric } from '@/features/analytics/config/funnel-metrics';
import { today, useUsageStore } from '@/features/analytics/store/usage-store';

/**
 * Buffered funnel counters.
 *
 * A sibling of `usage-store` rather than a field inside it, because the two
 * have different keys and different consent timing: usage counters are per
 * module and per account and only ever accrue after consent, while these are
 * per install and — for the onboarding half — necessarily accrue before the
 * consent card has appeared. Folding them together would mean one of those two
 * rules quietly applying to both.
 *
 * Same shape otherwise: one row per (day, metric) holding one integer, drained
 * on flush and restored on failure. No timestamps, no ordering, no free text.
 */

export type FunnelEntry = { day: string; metric: FunnelMetric; count: number };

/** Matches `record_funnel`'s window — older entries are skipped there, so
 *  keeping them here would buffer them forever. */
const MAX_AGE_DAYS = 7;

const keyOf = (day: string, metric: string) => `${day}:${metric}`;

function isRecent(day: string): boolean {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10);
  return day >= cutoff;
}

type FunnelState = {
  pending: Record<string, FunnelEntry>;
  hydrated: boolean;

  track: (metric: FunnelMetric) => void;
  drain: () => FunnelEntry[];
  restore: (entries: FunnelEntry[]) => void;
  /** Drops everything buffered. Called when consent is refused. */
  clear: () => void;
};

export const useFunnelStore = create<FunnelState>()(
  persist(
    (set, get) => ({
      pending: {},
      hydrated: false,

      track: (metric) => {
        const usage = useUsageStore.getState();
        // Three states, not two. Consented: record. Refused: record nothing,
        // ever. Not yet asked: record only the metrics that cannot wait for the
        // answer, and only because the reporter will not send them until there
        // is one — see PRE_CONSENT_METRICS for the full argument.
        const allowed =
          usage.enabled || (!usage.consentDecided && PRE_CONSENT_METRICS.includes(metric));
        if (!allowed) return;

        const day = today();
        const key = keyOf(day, metric);
        set((s) => {
          const current = s.pending[key] ?? { day, metric, count: 0 };
          return { pending: { ...s.pending, [key]: { ...current, count: current.count + 1 } } };
        });
      },

      drain: () => {
        const entries = Object.values(get().pending).filter((e) => isRecent(e.day));
        set({ pending: {} });
        return entries;
      },

      restore: (entries) =>
        set((s) => {
          const pending = { ...s.pending };
          for (const e of entries) {
            if (!isRecent(e.day)) continue;
            const key = keyOf(e.day, e.metric);
            const current = pending[key];
            pending[key] = current ? { ...current, count: current.count + e.count } : e;
          }
          return { pending };
        }),

      clear: () => set({ pending: {} }),
    }),
    {
      name: 'funnel-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useFunnelStore.setState({ hydrated: true });
      },
    },
  ),
);

/** Callable outside React — most of these fire from navigation and scheduling
 *  code that is not a component. */
export function trackFunnel(metric: FunnelMetric): void {
  useFunnelStore.getState().track(metric);
}
