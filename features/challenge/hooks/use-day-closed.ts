import { useEffect, useState } from 'react';

import { currentDay, useChallengeStore } from '@/features/challenge/store/challenge-store';
import { dayKept } from '@/lib/haptics';

/**
 * Fires the day-closing moment, exactly once, on the edge.
 *
 * The distinction this hook exists for: **the moment belongs to the transition,
 * not to the state.** "Everything is done" is true for the rest of the evening
 * and all of the next morning; if the celebration keyed off that, it would
 * replay every time the screen mounted, and the one moment the day has would
 * read as a glitch.
 *
 * So it watches for incomplete → complete, plays once, and writes the day to the
 * store. The write is persisted, which is what makes it survive a cold start —
 * the most likely way somebody returns to this screen an hour later.
 *
 * It fires on the **local** completion rather than waiting for the server to
 * confirm. That is deliberate: the user finished, and a moment that arrives a
 * network round trip after the action that earned it is not a moment. If the
 * server later disagrees the counters correct themselves quietly — but the
 * feeling belonged to the tap.
 */
/**
 * Whether the moment should play right now.
 *
 * Pure, and separate from the hook, for two reasons. It is the whole decision —
 * everything else in this file is wiring — and it is the part with a property
 * worth pinning: fires on the edge, once, and never again for that day. Keeping
 * it a function means that property is testable directly rather than through a
 * renderer.
 */
export function shouldCloseDay(input: {
  hydrated: boolean;
  enabled: boolean;
  complete: boolean;
  lastClosedDay: string | null;
  today: string;
}): boolean {
  // Before rehydration `lastClosedDay` is still null even for a day closed
  // hours ago, so acting on it would replay this morning's moment at breakfast.
  if (!input.hydrated || !input.enabled || !input.complete) return false;
  return input.lastClosedDay !== input.today;
}

export function useDayClosed(complete: boolean, enabled: boolean): boolean {
  const lastClosedDay = useChallengeStore((s) => s.lastClosedDay);
  const markDayClosed = useChallengeStore((s) => s.markDayClosed);
  const hydrated = useChallengeStore((s) => s.hydrated);

  /** Drives the animation. Distinct from "the day is done", which stays true. */
  const [justClosed, setJustClosed] = useState(false);

  useEffect(() => {
    const today = currentDay();
    if (!shouldCloseDay({ hydrated, enabled, complete, lastClosedDay, today })) return;

    markDayClosed(today);
    setJustClosed(true);
    dayKept();

    // Long enough for the weave to settle, short enough that it is over before
    // anybody thinks to dismiss it. Nothing is blocked while it runs.
    const timer = setTimeout(() => setJustClosed(false), 2400);
    return () => clearTimeout(timer);
  }, [complete, enabled, hydrated, lastClosedDay, markDayClosed]);

  return justClosed;
}
