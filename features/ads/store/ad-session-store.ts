import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { toDateKey } from '@/lib/date';

/**
 * The runtime state the pacing rules are evaluated against.
 *
 * `ad-pacing.ts` is deliberately pure and takes every value as an argument, so
 * the rules can be tested without a store. This is where those values come
 * from — and the split matters, because two of them are per session and two
 * survive the app being killed, and holding all four in one place is what makes
 * the difference easy to get wrong.
 *
 * **Persisted**: which day the last session started on, so "first session of
 * the day" can be answered on a cold start, and when the last full-screen ad
 * was shown, so the cooldown is not reset free of charge by force-quitting.
 *
 * **Not persisted**: how many ads this session has shown, and when it began.
 * Both are properties of the session and a session does not survive a restart.
 * Persisting the session count would mean a user who reopens the app all day
 * carries yesterday's cap into today; persisting the start would mean the
 * launch guard stops guarding a launch.
 */
type AdSessionState = {
  /** Local day of the session in progress, so a new day is detectable. */
  sessionDay: string | null;
  /** Whether the session in progress is the first one of its day. */
  firstSessionToday: boolean;
  /** When the last full-screen ad of any format was shown. */
  lastShownAt: number | null;
  /** Full-screen ads shown this session. Reset by `beginSession`. */
  shownThisSession: number;
  /** When this session began, for the launch guard. */
  sessionStartedAt: number;
  hydrated: boolean;

  /** Called on every return to the foreground. */
  beginSession: (now?: number) => void;
  /** Called when a full-screen ad is actually shown, never when one is asked
   *  for — a request that never fills has cost the user nothing. */
  recordShown: (now?: number) => void;
};

export const useAdSessionStore = create<AdSessionState>()(
  persist(
    (set, get) => ({
      sessionDay: null,
      firstSessionToday: true,
      lastShownAt: null,
      shownThisSession: 0,
      sessionStartedAt: Date.now(),
      hydrated: false,

      beginSession: (now = Date.now()) => {
        const day = toDateKey(new Date(now));
        set({
          // The first session of a day is the one that finds a different day
          // written down. Everything after it, including a cold start an hour
          // later, is not.
          firstSessionToday: get().sessionDay !== day,
          sessionDay: day,
          shownThisSession: 0,
          sessionStartedAt: now,
        });
      },

      recordShown: (now = Date.now()) =>
        set((s) => ({ shownThisSession: s.shownThisSession + 1, lastShownAt: now })),
    }),
    {
      name: 'ad-session-store',
      storage: createJSONStorage(() => AsyncStorage),
      // See the header: the session half is deliberately left behind on a
      // restart, and only the two facts that outlive a session are written.
      partialize: (state) => ({
        sessionDay: state.sessionDay,
        lastShownAt: state.lastShownAt,
      }),
      onRehydrateStorage: () => () => {
        useAdSessionStore.setState({ hydrated: true });
      },
    },
  ),
);
