import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  cancelChallengeReminder,
  syncChallengeReminder,
} from '@/features/challenge/services/challenge-reminders';
import { flushChallenge } from '@/features/challenge/services/challenge-reporter';
import { outstandingModules } from '@/features/challenge/services/challenge-math';
import { startChallengeWriteTracking } from '@/features/challenge/services/challenge-tracking';
import { REWARDS_MODULE_ID } from '@/features/challenge/config/rewards-flag';
import { currentDay, useChallengeStore } from '@/features/challenge/store/challenge-store';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';

/**
 * How long a foreground stretch has to last before it is worth counting. Below
 * this, the user checked the time on a notification.
 */
const MIN_SESSION_SECONDS = 3;

/**
 * Mounted once at the root. Observes writes, accrues foreground time, and hands
 * the day's evidence to the server at the moments it is most complete.
 *
 * Foreground seconds are measured from wall-clock timestamps rather than an
 * interval, because a timer stops being paid attention to the moment the app is
 * backgrounded — and "how long was the app open" measured by a timer that does
 * not run while it is closed is a number that only ever reads correctly by
 * accident.
 *
 * Flushing on `background` as well as `active` is deliberate: on the way out the
 * buffer is at its fullest and the request competes with nothing the user is
 * waiting for.
 *
 * ## The operator's switch reaches this too
 *
 * Hiding the Hub tile and blocking the route — which `module_flags` already does
 * for every module — would leave the interesting half running: an enrolled
 * account would go on observing writes, uploading days and scheduling reminders
 * for a feature nobody can see. That is the worst version of a kill switch,
 * because the operator believes it is off.
 *
 * So the flag is checked here as well, and `enabled === false` tears everything
 * down: the observer is removed, nothing is reported, and any pending reminder
 * is cancelled. Absence still means enabled — the same fail-open rule the rest
 * of the flag system follows, so a network blip cannot silently stop somebody's
 * streak being recorded.
 */
export function useChallengeTracking(): void {
  const hydrated = useChallengeStore((s) => s.hydrated);
  const enrolled = useChallengeStore((s) => s.enrolled);
  const disabled = useModuleFlagsStore((s) => s.flags[REWARDS_MODULE_ID]?.enabled === false);

  useEffect(() => {
    if (!hydrated || !enrolled || disabled) {
      // Reached when the operator switches the programme off mid-session, not
      // only on a cold start with it already off.
      if (disabled) void cancelChallengeReminder();
      return;
    }

    const stopWriteTracking = startChallengeWriteTracking();
    let since: number | null = Date.now();

    const bank = () => {
      if (since === null) return;
      const seconds = (Date.now() - since) / 1000;
      since = null;
      if (seconds >= MIN_SESSION_SECONDS) {
        useChallengeStore.getState().addActiveSeconds(seconds);
      }
    };

    void flushChallenge();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        since = Date.now();
        void flushChallenge();
        return;
      }
      bank();
      void flushChallenge();
    });

    /**
     * The reminder is rebuilt from current state on every change to the buffer,
     * which is what lets a local notification carry text that is true when it
     * fires — see challenge-reminders.ts. Subscribed to the store rather than
     * called from each write site, so nothing has to remember to do it.
     */
    const resync = () => {
      const state = useChallengeStore.getState();
      const writes = state.days[currentDay()]?.writes ?? {};
      void syncChallengeReminder(outstandingModules(state.required, writes, state.minWrites));
    };
    resync();
    const unsubscribe = useChallengeStore.subscribe((state, previous) => {
      if (state.days !== previous.days || state.required !== previous.required) resync();
    });

    return () => {
      bank();
      stopWriteTracking();
      unsubscribe();
      subscription.remove();
      void cancelChallengeReminder();
    };
  }, [hydrated, enrolled, disabled]);
}
