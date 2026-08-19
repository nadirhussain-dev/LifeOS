import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { toDateKey } from '@/lib/date';

/**
 * The day the app is currently accruing into.
 *
 * The device's local date, deliberately — not the server's. The server holds
 * the authoritative day (derived from `now()` and the offset frozen at
 * enrolment) and accepts a submission only for yesterday or today, so a phone
 * whose clock or timezone has drifted a little still lands inside the window,
 * and one that has drifted a lot is refused rather than quietly credited to the
 * wrong day. Buffering under the device's own idea of the date is what lets the
 * day accrue with no network at all.
 */
export function currentDay(): string {
  return toDateKey(new Date());
}

/** One day's evidence: what was touched, and for how long. */
export type DayBuffer = {
  /** Per module, how many rows the user changed. Never a boolean — the server's
   *  `min_writes` is a season setting and may be more than one. */
  writes: Record<string, number>;
  activeSeconds: number;
  /**
   * Modules the *server* has confirmed seeing a live write for today (0065).
   *
   * Distinct from `writes`, and the distinction is the whole live-write rule:
   * `writes` is what this phone did, `attested` is what the server watched it
   * do. Under a season with `require_live_writes` only the second one can
   * credit a day, so the checklist has to be able to draw both.
   *
   * Optional because it arrived after the store was already persisted on real
   * devices — an install carrying days written by the previous build parses
   * fine and simply has nothing attested, which is the correct reading of a
   * day recorded before the rule existed.
   */
  attested?: string[];
  /**
   * Modules whose attestation failed — almost always because the device was
   * offline at the moment of the write.
   *
   * Kept so the checklist can say "this did not count" while the day is still
   * fixable. Deliberately **not** a retry queue: see
   * `services/live-writes.ts` for why replaying these would reopen the exact
   * loophole the rule closes.
   */
  attestFailed?: string[];
};

/** A buffered day, ready to be offered to the server. */
export type PendingDay = DayBuffer & { day: string };

/**
 * Only today and yesterday are worth keeping. The server refuses anything
 * older, so a third day would be a buffer that grows forever and is never
 * accepted — the shape of bug that shows up as a support ticket about storage
 * six months later.
 */
const RETAINED_DAYS = 2;

type ChallengeState = {
  /** Set once the user is actually in a run. Nothing is buffered before that:
   *  somebody who never joins should not accumulate counters for a feature they
   *  are not using. */
  enrolled: boolean;
  seasonId: string | null;
  /** The committed modules, cached from the server so the checklist renders
   *  offline and on first paint. */
  required: string[];
  minWrites: number;
  /**
   * Whether the current season demands server-witnessed writes (0065).
   *
   * Mirrored here from `challenge_live_today()` because the at-risk reminder is
   * rebuilt outside React — `use-challenge-tracking.ts` subscribes to this
   * store, not to the query cache — and a reminder that named the wrong
   * outstanding modules would be worse than none. Defaults to false so a fresh
   * install, or a server that predates the column, gets the old lenient rule.
   */
  liveRequired: boolean;
  /**
   * Where the run stands, cached from `challenge_today()` (0067).
   *
   * Here for one consumer: the at-risk reminder, which is rebuilt outside React
   * on every write and cannot fetch anything. Without a cache it could only say
   * which modules were outstanding; with it, it can say what missing them
   * costs — and that number is the difference between a warning somebody acts
   * on and one they scroll past.
   *
   * Zeroes mean "not known yet", and `costOfMissToday` treats them as "quote no
   * cost" rather than "quote zero". A server that predates the column, or a
   * first launch before the query lands, must produce the old reminder rather
   * than an invented number.
   */
  standing: ChallengeStanding;
  days: Record<string, DayBuffer>;
  /**
   * The newest `challenge_events` row the user has been shown.
   *
   * Kept on the device rather than the server because it is a property of this
   * phone having displayed something, not of the account — and because a
   * "seen" column would mean a write to the ledger every time somebody opened
   * a screen. A second device showing the demotion notice again is a much
   * smaller problem than either of those.
   */
  lastSeenEventId: number;
  /**
   * The last local day whose closing moment has been played.
   *
   * Without it the moment fires again on every remount — navigating away and
   * back would replay the haptic and the line, which turns the one moment the
   * day has into a glitch. Persisted rather than kept in memory because a cold
   * start is the most likely way back to the screen.
   */
  lastClosedDay: string | null;
  hydrated: boolean;

  setEnrolment: (enrolment: { seasonId: string; required: string[]; minWrites: number }) => void;
  markEventsSeen: (eventId: number) => void;
  /** Records that today's closing moment has been played. */
  markDayClosed: (day: string) => void;
  clearEnrolment: () => void;
  /** One row changed in one module. Called from the database write observer. */
  recordWrite: (module: string, day?: string) => void;
  /** The server confirmed a live write for this module, on the day it says. */
  markAttested: (module: string, day: string) => void;
  /** An attestation did not reach the server. Recorded for the UI only. */
  markAttestFailed: (module: string, day?: string) => void;
  /** Replaces today's attested set from `challenge_live_today()` — the server
   *  is the authority, and a second device's work belongs in this list too. */
  setAttested: (modules: string[], day: string) => void;
  /** Records whether the live rule applies, from the same response. */
  setLiveRequired: (required: boolean) => void;
  /** Caches the counters the reminder needs to price a miss. */
  setStanding: (standing: ChallengeStanding) => void;
  /** Foreground time, added in chunks by the session timer. */
  addActiveSeconds: (seconds: number, day?: string) => void;
  /** Everything worth sending, oldest first — a stale day should be offered
   *  before today's, so the ledger fills in order. */
  pendingDays: () => PendingDay[];
  /** Drops days the server would no longer accept. */
  prune: (today?: string) => void;
  /** Forgets one specific day, once the server has said it will never take it. */
  dropDay: (day: string) => void;
};

/** The counters a miss is priced from. See `standing` on the state below. */
export type ChallengeStanding = {
  qualifiedDays: number;
  shields: number;
  recentMisses: number;
  maxDemotionDays: number;
  /** Ascending rung thresholds. Empty until the server has been heard from. */
  tierThresholds: number[];
};

const emptyStanding = (): ChallengeStanding => ({
  qualifiedDays: 0,
  shields: 0,
  recentMisses: 0,
  maxDemotionDays: 0,
  tierThresholds: [],
});

const emptyDay = (): DayBuffer => ({ writes: {}, activeSeconds: 0 });

/** Adds one entry to an optional string list, without duplicates. */
const withItem = (list: string[] | undefined, item: string): string[] =>
  list?.includes(item) ? list : [...(list ?? []), item];

/** Removes one entry, returning undefined for an empty result so the persisted
 *  shape stays as small as it was before this field existed. */
const withoutItem = (list: string[] | undefined, item: string): string[] | undefined => {
  const next = (list ?? []).filter((x) => x !== item);
  return next.length > 0 ? next : undefined;
};

/** The `RETAINED_DAYS` most recent keys, newest first. */
function recentKeys(days: Record<string, DayBuffer>, today: string): string[] {
  return Object.keys(days)
    .filter((d) => d <= today)
    .sort()
    .slice(-RETAINED_DAYS);
}

export const useChallengeStore = create<ChallengeState>()(
  persist(
    (set, get) => ({
      enrolled: false,
      seasonId: null,
      required: [],
      minWrites: 1,
      liveRequired: false,
      standing: emptyStanding(),
      days: {},
      lastSeenEventId: 0,
      lastClosedDay: null,
      hydrated: false,

      setEnrolment: ({ seasonId, required, minWrites }) =>
        set({ enrolled: true, seasonId, required, minWrites }),

      markEventsSeen: (eventId) =>
        set((s) => ({ lastSeenEventId: Math.max(s.lastSeenEventId, eventId) })),

      markDayClosed: (day) => set({ lastClosedDay: day }),

      // Leaving a run drops the buffer with it. Counters for a season somebody
      // is no longer in have nowhere to go, and keeping them means they would
      // flush into whatever season they joined next.
      clearEnrolment: () =>
        set({
          enrolled: false,
          seasonId: null,
          required: [],
          liveRequired: false,
          standing: emptyStanding(),
          days: {},
          lastSeenEventId: 0,
          lastClosedDay: null,
        }),

      recordWrite: (module, day = currentDay()) => {
        if (!get().enrolled) return;
        set((s) => {
          const buffer = s.days[day] ?? emptyDay();
          return {
            days: {
              ...s.days,
              [day]: {
                ...buffer,
                writes: { ...buffer.writes, [module]: (buffer.writes[module] ?? 0) + 1 },
              },
            },
          };
        });
      },

      markAttested: (module, day) =>
        set((s) => {
          const buffer = s.days[day] ?? emptyDay();
          return {
            days: {
              ...s.days,
              [day]: {
                ...buffer,
                attested: withItem(buffer.attested, module),
                // A module that has just been witnessed is no longer failing.
                attestFailed: withoutItem(buffer.attestFailed, module),
              },
            },
          };
        }),

      markAttestFailed: (module, day = currentDay()) =>
        set((s) => {
          const buffer = s.days[day] ?? emptyDay();
          // Never contradict a success already recorded today: one dropped
          // request after the server has seen the module does not un-see it.
          if (buffer.attested?.includes(module)) return {};
          return {
            days: {
              ...s.days,
              [day]: { ...buffer, attestFailed: withItem(buffer.attestFailed, module) },
            },
          };
        }),

      setLiveRequired: (liveRequired) => set({ liveRequired }),

      setStanding: (standing) => set({ standing }),

      setAttested: (modules, day) =>
        set((s) => {
          const buffer = s.days[day] ?? emptyDay();
          return {
            days: {
              ...s.days,
              [day]: {
                ...buffer,
                attested: modules.length > 0 ? modules : undefined,
                attestFailed: (buffer.attestFailed ?? []).filter((m) => !modules.includes(m)),
              },
            },
          };
        }),

      addActiveSeconds: (seconds, day = currentDay()) => {
        if (!get().enrolled || seconds <= 0) return;
        set((s) => {
          const buffer = s.days[day] ?? emptyDay();
          return {
            days: {
              ...s.days,
              [day]: { ...buffer, activeSeconds: buffer.activeSeconds + Math.round(seconds) },
            },
          };
        });
      },

      pendingDays: () => {
        const { days } = get();
        const today = currentDay();
        return recentKeys(days, today)
          .map((day) => ({ day, ...days[day] }))
          .filter((d) => d.activeSeconds > 0 || Object.keys(d.writes).length > 0);
      },

      prune: (today = currentDay()) =>
        set((s) => {
          const keep = new Set(recentKeys(s.days, today));
          return {
            days: Object.fromEntries(Object.entries(s.days).filter(([day]) => keep.has(day))),
          };
        }),

      dropDay: (day) =>
        set((s) => ({
          days: Object.fromEntries(Object.entries(s.days).filter(([d]) => d !== day)),
        })),
    }),
    {
      name: 'challenge-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      // Prune on the way in rather than waiting for the first write: an app
      // reopened after a fortnight away should not carry a fortnight of days it
      // can no longer submit.
      onRehydrateStorage: () => (state) => {
        useChallengeStore.setState({ hydrated: true });
        if (state) useChallengeStore.getState().prune();
      },
    },
  ),
);

/** Callable outside React — the write observer is not a component. */
export function recordChallengeWrite(module: string): void {
  useChallengeStore.getState().recordWrite(module);
}
