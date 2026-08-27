import { setHours } from 'date-fns/setHours';
import { setMinutes } from 'date-fns/setMinutes';
import { setSeconds } from 'date-fns/setSeconds';
import { startOfDay } from 'date-fns/startOfDay';
import { AppState } from 'react-native';

import { REWARDS_MODULE_ID } from '@/features/challenge/config/rewards-flag';
import { costOfMissToday, outstandingModules } from '@/features/challenge/services/challenge-math';
import { reminderCopyFor } from '@/features/challenge/services/reminder-copy';
import { currentDay, useChallengeStore } from '@/features/challenge/store/challenge-store';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import {
  CHALLENGE_AT_RISK_KEY,
  CHALLENGE_LAST_CALL_KEY,
  CHALLENGE_REWARD_KEY,
  CHALLENGE_WIN_BACK_KEY,
} from '@/features/notifications/services/notification-keys';
import i18n from '@/lib/i18n';
import { cancelScheduledByKey, scheduleOneTimeNotification } from '@/lib/notifications';

/**
 * The at-risk reminder, and why it is re-scheduled rather than scheduled.
 *
 * The `'streak'` notification category has existed since the notifications
 * backbone shipped and has never had a scheduler behind it. TODO.md leaves it
 * unchecked "by design", and the reason given there is correct: a local
 * notification cannot evaluate anything at fire time, so a reminder scheduled
 * this morning cannot know whether the day was finished this afternoon. Firing
 * "you are about to lose your streak" at somebody who finished at lunchtime is
 * worse than not firing at all — it is the notification that gets the whole
 * category turned off.
 *
 * The way out is not a smarter trigger, it is a cheaper one. The app knows the
 * checklist state every time it changes, so the reminder is **cancelled and
 * re-scheduled on every write**, carrying the modules that are still
 * outstanding in its body. When the last one lands, it is cancelled outright
 * and nothing fires. Same shape as `syncDebtReminder`, for the same reason: a
 * schedule that is rebuilt from current state cannot drift from it.
 *
 * The text names what is missing rather than warning in general. "Journal not
 * logged" is something somebody can act on in fifteen seconds; "your streak is
 * at risk" is something they have to go and investigate, and mostly will not.
 *
 * ## Two reminders, not one, and only for the people with something to lose
 *
 * The 20:00 nudge is the last call while there is still an evening left. It now
 * carries the *price* as well as the list, because `demotionTarget()` has been
 * able to compute that number since 0048 and nothing has ever shown it to
 * anybody — "Journal and Water not logged" and "missing today drops you from 84
 * days to 60" are the same fact and not the same message.
 *
 * The 22:00 one exists only for somebody holding **no shields**, because they
 * are the only people for whom tonight is genuinely irreversible. Sending it to
 * everybody would be a second evening notification for a population whose miss
 * costs them a buffer they will earn back, which is how a category gets turned
 * off — and turning this category off costs the 20:00 reminder too.
 *
 * Both are cancelled outright the moment the day is complete, so neither can
 * fire at somebody who has already finished.
 *
 * ## How "the" reminder is identified
 *
 * Every schedule here carries a stable key and is cancelled **by that key**,
 * read back off the OS queue — never by an id held in a variable. Holding ids
 * in module-level memory is what produced the four identical 20:00 alerts this
 * file was reported for: memory is empty after a restart, and it is shared by
 * concurrent callers who each cancelled what the last one recorded. The queue
 * is the only record that survives both. See `serialize` and
 * notification-keys.ts.
 */

/** Fixed hour, late enough to be a last call and early enough to be actionable. */
const REMINDER_HOUR = 20;

/**
 * The second call, for people with no shield left.
 *
 * Late enough to be the last word on the day and early enough that fifteen
 * minutes of work is still possible. Past this there is nothing useful to say:
 * a notification at 23:50 about a day that ends at midnight is an accusation,
 * not a reminder.
 */
const LAST_CALL_HOUR = 22;

/**
 * Everything here runs one at a time.
 *
 * `syncChallengeReminder` is a cancel-then-schedule with several `await` points
 * in it, and it is called — fire-and-forget — from a store subscription that
 * fires on every change to the day's checklist. A single foreground flush
 * applies the server's response through several separate `set()` calls, so
 * overlapping invocations are the normal case, not a rare interleaving.
 *
 * Unserialised, each of those invocations cancelled whatever the *previous* one
 * had recorded and then scheduled its own, so N concurrent syncs left N
 * notifications queued for the same instant and a single remembered id — the
 * other N-1 were orphans nothing could ever cancel. That is the four identical
 * 20:00 alerts this file was reported for.
 *
 * A promise chain rather than a boolean `inFlight` flag: a flag makes the
 * second caller give up, which is wrong here, because the second caller is the
 * one holding the newer checklist. Chaining makes it wait its turn instead.
 * `catch` on both sides so one failed sync cannot wedge the queue forever.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * A resync that has been queued but has not started yet.
 *
 * Every resync reads the checklist at the moment it runs, so two of them
 * waiting in line compute the same answer and the second is pure waste — a
 * cancel and a reschedule of something identical. Collapsing them is only an
 * optimisation, but it is the difference between one OS round-trip per burst of
 * writes and one per write.
 *
 * Cleared the moment the work begins, not when it finishes: a change landing
 * while a resync is mid-flight must queue a fresh one, because that resync has
 * already read its state.
 */
let queuedResync: Promise<void> | null = null;

/** Whether the operator has switched the whole programme off. Absence means
 *  enabled — the fail-open rule the rest of the flag system follows. */
function programmeDisabled(): boolean {
  return useModuleFlagsStore.getState().flags[REWARDS_MODULE_ID]?.enabled === false;
}

/** The modules still outstanding today, read from current state. */
export function currentOutstanding(): string[] {
  const state = useChallengeStore.getState();
  const today = state.days[currentDay()];
  return outstandingModules(
    state.required,
    today?.writes ?? {},
    state.minWrites,
    // Under the live rule a module is only off the list once the server has
    // witnessed it, so the 20:00 nudge names work that was done offline rather
    // than falling silent on a locally-complete day that is not going to count.
    today?.attested ?? [],
    state.liveRequired,
  );
}

/** The moment a reminder at `hour` should fire, or null if it has passed. */
function fireAtHour(hour: number, now: Date): number | null {
  const at = setSeconds(setMinutes(setHours(startOfDay(now), hour), 0), 0).getTime();
  return at > now.getTime() ? at : null;
}

/** The moment today's reminder should fire, or null if that moment has passed. */
export function atRiskReminderDate(now: Date = new Date()): number | null {
  return fireAtHour(REMINDER_HOUR, now);
}

/**
 * Brings the pending reminder in line with what is still outstanding today.
 *
 * Called after anything that could change the answer. Cheap enough to call on
 * every write: cancelling and re-queueing one local notification costs nothing,
 * and the alternative — trying to be clever about when it is worth updating —
 * is how the schedule drifts out of step with the checklist.
 */
export function syncChallengeReminder(outstanding: string[]): Promise<void> {
  return serialize(() => applyReminder(() => outstanding));
}

/**
 * The same thing, reading the checklist itself.
 *
 * Preferred over passing `outstanding` in, because the read then happens when
 * the work runs rather than when it was queued — a sync that waited behind
 * three others cannot act on a checklist that has since moved on. It is also
 * what lets the launch rebuild call this without knowing anything about the
 * challenge's internals.
 */
export function resyncChallengeReminder(): Promise<void> {
  if (queuedResync) return queuedResync;
  const run = serialize(() => {
    queuedResync = null;
    return applyReminder(currentOutstanding);
  });
  queuedResync = run;
  return run;
}

async function applyReminder(readOutstanding: () => string[]): Promise<void> {
  // Cancel by key, not by remembered id. The OS queue is the only record that
  // survives a process restart, so this is what stops a cold start from
  // scheduling a second copy next to the one already queued — and it reaps
  // whatever duplicates an older build of this file left on the device.
  await cancelScheduledByKey(CHALLENGE_AT_RISK_KEY);
  await cancelScheduledByKey(CHALLENGE_LAST_CALL_KEY);

  const state = useChallengeStore.getState();
  // Checked here as well as at the tracking hook, so the launch rebuild cannot
  // revive reminders for a programme the operator has switched off.
  if (!state.enrolled || programmeDisabled()) return;

  const outstanding = readOutstanding();
  // Nothing outstanding means the day is done, or as done as this phone can
  // tell. Either way there is nothing to warn about — and somebody who has just
  // kept a day has already answered the question a pending win-back was going
  // to ask them in two days' time.
  if (outstanding.length === 0) {
    await cancelScheduledByKey(CHALLENGE_WIN_BACK_KEY);
    return;
  }

  const modules = outstanding.map((id) => i18n.t(`syncModule.${id}`)).join(', ');
  const cost = costOfMissToday(state.standing);
  const now = new Date();

  /*
   * The body says what is missing and then the most useful true thing that can
   * be added to it — a rung nearly reached, the price of missing, a shield that
   * will absorb it, or nothing.
   *
   * `reminder-copy.ts` owns that choice and the rotation, for two reasons. The
   * branching is worth testing without a store, a clock or a notifications
   * module in the way; and this notification fires on every unfinished evening
   * of a run that can last a year, so the framing has to move or the whole
   * category gets switched off by somebody who has read the identical sentence
   * three hundred times.
   *
   * `costOfMissToday` still returns null rather than zero whenever a number
   * would mislead, and the copy branches on that rather than interpolating a
   * zero.
   */
  // The next rung above where they stand. Read off the thresholds rather than
  // the ladder query, because those arrive with the counters and are the only
  // half guaranteed to be here — see `rungNames` on the store.
  const nextRungDay = state.standing.tierThresholds.find(
    (day) => day > state.standing.qualifiedDays,
  );
  const copy = reminderCopyFor({
    modules,
    cost,
    shields: state.standing.shields,
    qualifiedDays: state.standing.qualifiedDays,
    daysToRung: nextRungDay !== undefined ? nextRungDay - state.standing.qualifiedDays : null,
    rungName: nextRungDay !== undefined ? (state.standing.rungNames[nextRungDay] ?? null) : null,
    localDay: currentDay(),
  });
  const body = i18n.t(copy.bodyKey, copy.values);

  const fireAt = fireAtHour(REMINDER_HOUR, now);
  if (fireAt !== null) {
    await scheduleOneTimeNotification({
      title: i18n.t(copy.titleKey),
      body,
      date: fireAt,
      // `bypassQuietHours` is true for this category — a last call at 20:00 that
      // quiet hours swallowed would be a reminder that only ever fires for people
      // who did not need it.
      data: { category: 'streak', route: '/challenge', key: CHALLENGE_AT_RISK_KEY },
    });
  }

  // Only for a run with no buffer left. For everybody else tonight costs a
  // shield they will earn back, and a second evening notification about that is
  // how the whole category gets switched off.
  if (state.standing.shields > 0) return;
  const lastCallAt = fireAtHour(LAST_CALL_HOUR, now);
  if (lastCallAt === null) return;

  await scheduleOneTimeNotification({
    title: i18n.t('challenge.lastCallTitle'),
    body:
      cost !== null
        ? i18n.t('challenge.lastCallCost', { count: cost })
        : i18n.t('challenge.reminderOne', { modules }),
    date: lastCallAt,
    data: { category: 'streak', route: '/challenge', key: CHALLENGE_LAST_CALL_KEY },
  });
}

/** Drops the pending reminders — on sign-out, or on leaving a run. Queued
 *  behind any sync already in flight, so it cannot be undone by one. */
export function cancelChallengeReminder(): Promise<void> {
  return serialize(async () => {
    await cancelScheduledByKey(CHALLENGE_AT_RISK_KEY);
    await cancelScheduledByKey(CHALLENGE_LAST_CALL_KEY);
  });
}

/**
 * The one nudge after a run breaks.
 *
 * A broken run is the highest-churn moment the programme has, and until now
 * nothing happened at it at all: the fall was settled overnight by
 * `settle_stale_runs`, and the next thing the user heard from the app was the
 * ordinary 20:00 reminder about a streak they no longer felt they had.
 *
 * Framed as the next rung rather than the lost one. "You lost 24 days" is
 * information they already have and can do nothing with; "24 days to Ember"
 * is the same arithmetic pointed forwards. Nobody needs to be told they missed.
 *
 * Forty-eight hours, not twenty-four. A day later is still inside the sting,
 * and the message reads as the app twisting the knife; two days later it reads
 * as an invitation. It is also long enough that anybody who simply carried on
 * has already qualified another day and cancelled it.
 *
 * ## What this cannot do
 *
 * It is a local notification, so it can only be scheduled while the app is
 * running — which means it reaches somebody who opened the app after the fall
 * and never somebody who has already stopped. That is not a limitation of where
 * it is called from; it is what local notifications are. Reaching a user who
 * has genuinely gone requires server push, which this deliberately is not.
 */
const WIN_BACK_DELAY_MS = 48 * 60 * 60 * 1000;

export function scheduleWinBack(toDays: number, nextRungDays: number | null): Promise<void> {
  return serialize(async () => {
    await cancelScheduledByKey(CHALLENGE_WIN_BACK_KEY);

    if (!useChallengeStore.getState().enrolled || programmeDisabled()) return;

    await scheduleOneTimeNotification({
      title: i18n.t('challenge.winBackTitle'),
      body:
        nextRungDays !== null && nextRungDays > 0
          ? i18n.t('challenge.winBackNext', { count: nextRungDays })
          : i18n.t('challenge.winBackPlain', { count: toDays }),
      date: Date.now() + WIN_BACK_DELAY_MS,
      data: { category: 'streak', route: '/challenge', key: CHALLENGE_WIN_BACK_KEY },
    });
  });
}

/**
 * Announces a payout that landed while nobody was looking.
 *
 * ## Why this is worth a notification at all
 *
 * Everything else this file schedules is a warning. This is the only one that
 * is good news, and it is the one most likely to be missed: the flush that
 * credits a day runs on `background` as well as `active`, so the common shape
 * is somebody finishing their last habit, closing the app, and the day —
 * along with the rung it crossed — landing a second later with the screen
 * already dark. Before this, that person found out the next time they happened
 * to open the challenge screen.
 *
 * ## Only when the app is not in front of them
 *
 * The milestone sheet already handles the foreground case, and handles it
 * better — it shows the badge. A notification on top of it would be the app
 * telling somebody about a thing they are currently looking at.
 *
 * `AppState.currentState` rather than a flag threaded down from the caller:
 * this is asked at the moment of scheduling, which is the moment the answer has
 * to be true for.
 *
 * ## Rule 0.1, restated
 *
 * This is triggered by a day being *earned*. There is no path from an
 * advertising callback to here, and there must never be one — see the header of
 * 0048 and §0.1 of REWARDS_PROGRAM.
 */
const REWARD_NOTICE_DELAY_MS = 4000;

export function notifyRewardGranted(slugs: string[], rungName: string | null): Promise<void> {
  return serialize(async () => {
    if (slugs.length === 0) return;
    if (AppState.currentState === 'active') return;
    if (!useChallengeStore.getState().enrolled || programmeDisabled()) return;

    await cancelScheduledByKey(CHALLENGE_REWARD_KEY);
    await scheduleOneTimeNotification({
      title: rungName
        ? i18n.t('challenge.rewardTitle', { name: rungName })
        : i18n.t('challenge.rewardTitleGeneric'),
      body: i18n.t('challenge.rewardBody'),
      // A few seconds out rather than immediately: the flush that triggers this
      // runs as the app is being backgrounded, and a notification that arrives
      // in the same instant the app disappears reads as part of the app closing
      // rather than as news.
      date: Date.now() + REWARD_NOTICE_DELAY_MS,
      data: { category: 'streak', route: '/challenge/rewards', key: CHALLENGE_REWARD_KEY },
    });
  });
}

/**
 * Drops a pending win-back.
 *
 * Called the moment a day completes, because somebody who has just kept a day
 * has answered the question the win-back exists to ask — and receiving it
 * anyway, two days after getting back on the horse, reads as the app not
 * paying attention.
 */
export function cancelWinBack(): Promise<void> {
  return serialize(async () => {
    await cancelScheduledByKey(CHALLENGE_WIN_BACK_KEY);
  });
}
