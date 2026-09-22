import { TIMER_PHASE_END_KEY } from '@/features/notifications/services/notification-keys';
import type { TimerPhase } from '@/features/study/store/study-timer-store';
import { cancelScheduledByKey, scheduleTimerAlert } from '@/lib/notifications';

/**
 * Telling somebody their focus block is over when they are not looking at it.
 *
 * The timer screen detects the end of a phase from a 250ms `setInterval`, which
 * only runs while the screen is mounted and the app is in the foreground. That
 * is the one situation where the user did not need telling — they are watching
 * the countdown. Lock the phone for twenty-five minutes and JS is suspended, so
 * nothing fires: no haptic, no overlay, and the break never starts. The moment
 * an alert is worth anything is exactly the moment the old design could not
 * produce one.
 *
 * So the alarm is booked with the OS when the phase *starts* rather than raised
 * when it ends, and it is cancelled whenever the phase stops being the thing
 * that is running — paused, skipped, ended, or the screen left. Everything here
 * is fire-and-forget: a failure to schedule must not take down a session that
 * is otherwise fine, and a failure to cancel costs one stale alarm that the next
 * schedule replaces by key anyway.
 */

/** Text for each phase's alarm, supplied by the caller so the copy stays in the
 * i18n layer where `t` lives. */
export type PhaseAlertText = { title: string; body: string };

/**
 * Books the alarm for the phase that is running now.
 *
 * `endsAt` is an absolute timestamp rather than a duration because the OS
 * trigger is absolute: passing a duration would mean recomputing "now" twice
 * and scheduling a few milliseconds late every time.
 */
export function schedulePhaseEndAlert(params: { endsAt: number; text: PhaseAlertText }): void {
  void scheduleTimerAlert({
    title: params.text.title,
    body: params.text.body,
    date: params.endsAt,
    key: TIMER_PHASE_END_KEY,
    route: '/study/timer',
  }).catch(() => undefined);
}

/** Drops whatever alarm is queued. Safe to call when there is none. */
export function cancelPhaseEndAlert(): void {
  void cancelScheduledByKey(TIMER_PHASE_END_KEY).catch(() => undefined);
}

/** The i18n keys for a phase's alarm — the phase that is *ending* names it. */
export function alertKeysFor(phase: TimerPhase): { titleKey: string; bodyKey: string } {
  return phase === 'focus'
    ? { titleKey: 'study.alertFocusDoneTitle', bodyKey: 'study.alertFocusDoneBody' }
    : { titleKey: 'study.alertBreakDoneTitle', bodyKey: 'study.alertBreakDoneBody' };
}
