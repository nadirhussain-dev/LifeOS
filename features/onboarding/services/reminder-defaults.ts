import { syncGoalReminders } from '@/features/goals/services/goal-reminders';
import { useGoalReminderStore } from '@/features/goals/store/goal-reminder-store';
import { scheduleJournalReminder } from '@/features/journal/services/journal-reminders';
import { useJournalReminderStore } from '@/features/journal/store/journal-reminder-store';
import type { FocusArea } from '@/features/profile/store/profile-store';
import { syncStudyReminders } from '@/features/study/services/study-reminders';
import { useStudyReminderStore } from '@/features/study/store/study-reminder-store';
import {
  cancelWaterReminders,
  scheduleWaterReminders,
} from '@/features/water-intake/services/water-reminders';
import { useWaterSettingsStore } from '@/features/water-intake/store/water-settings-store';
import { reportError } from '@/lib/error-reporting';

/**
 * Turning module reminders on during first run.
 *
 * ## The gap this closes
 *
 * "Reminders are on by default" was true at the switchboard and false at every
 * socket. `notifications-store.ts` ships `masterEnabled: true` with every
 * category enabled — and then each module's own reminder ships `enabled: false`
 * (`DEFAULT_JOURNAL_REMINDER`, `DEFAULT_GOAL_REMINDER`, the study store, the
 * water store), so a new user got nothing until they went looking for a
 * settings screen they did not know existed.
 *
 * This flips the sockets, once, at the only moment the app has been told what
 * the person actually cares about.
 *
 * ## Only what they asked for
 *
 * Keyed off the focus areas from the previous step, never "all of them".
 * Somebody who picked Money and Sleep should not be reminded to log a study
 * session — that is the notification that gets the whole category switched off,
 * and switching a category off costs the reminders they *did* want.
 *
 * ## The times are not invented here
 *
 * Every module already ships a default schedule chosen by whoever built it —
 * journal at 21:00, study at 19:00 on weekdays, water hourly from 08:00 to
 * 21:00, and goals three days before each deadline at 09:00. This turns those
 * on; it does not second-guess them. There is not a single time in this file.
 *
 * Goals is the odd one and worth naming: it is not a daily nudge but one
 * reminder per goal deadline, so switching it on queues nothing at all until
 * the user actually sets a goal with a date. That is honest — the setting is
 * genuinely on — but it means "reminders on for Goals" is a promise about the
 * future rather than something the user will hear from tomorrow.
 *
 * ## Four modules, and why not the other four
 *
 * The plan named eight. Four of them cannot honestly be defaulted on:
 *
 *  - **Sleep** needs a target bedtime, and onboarding never asks for one.
 *    `syncBedtimeReminder` returns early without it, so enabling the flag would
 *    do nothing — and inventing a bedtime would produce a nightly alarm at an
 *    hour the user never chose, which is worse than no reminder.
 *  - **Habits** are reminded per habit, at a per-habit time. The starter habits
 *    seeded next door have no time attached, and one blanket hour would fire
 *    "evening stretch" at nine in the morning.
 *  - **Tasks** are reminded per task, relative to a due date. There is nothing
 *    to schedule until a task with a date exists.
 *  - **Budget** has per-debt reminders only. A weekly review nudge is a feature
 *    that does not exist yet, not a default that is switched off.
 *
 * Each of those wants its own build. Turning on a switch that schedules nothing
 * would leave the user with a settings screen claiming a reminder they will
 * never receive, which is the failure mode this whole area already has.
 *
 * ## The OS ceiling is somebody else's job, and already handled
 *
 * iOS keeps 64 pending notifications. Every scheduling call below already
 * refuses when the ledger is out of headroom (`hasHeadroom(SCHEDULING_BUDGET)`),
 * and `reminder-scheduler.ts` rebuilds in importance order with water last
 * precisely because it is the biggest consumer. So this cannot silently push a
 * task due tomorrow out of the queue — it just gets less than it asked for,
 * which is the correct failure.
 */

/** A module whose daily reminder this can switch on. */
export type DefaultedReminder = 'journal' | 'study' | 'goals' | 'water';

/**
 * The focus area that turns each one on.
 *
 * One-to-one and deliberately literal. A cleverer mapping — "wellbeing implies
 * water" — is the kind of inference that produces a notification the user
 * cannot trace back to anything they said.
 */
const FOCUS_FOR_REMINDER: Record<DefaultedReminder, FocusArea> = {
  journal: 'journal',
  study: 'study',
  goals: 'goals',
  water: 'water',
};

/**
 * Which reminders a set of focus answers turns on.
 *
 * Pure and exported for its test: it is the whole policy, and the failure —
 * reminding somebody about a module they never chose — is the kind that gets
 * notifications disabled app-wide rather than reported.
 */
export function remindersForFocus(focusAreas: FocusArea[]): DefaultedReminder[] {
  return (Object.keys(FOCUS_FOR_REMINDER) as DefaultedReminder[]).filter((id) =>
    focusAreas.includes(FOCUS_FOR_REMINDER[id]),
  );
}

/**
 * Switches them on and schedules them. Returns what actually landed.
 *
 * Same isolation as `applyOnboardingSeed`: each module is caught separately, so
 * one failure costs its own reminder and nothing else. The return value is read
 * by the step that tells the user what is now on — it must name what happened,
 * not what was attempted, or the app is describing reminders that do not exist.
 *
 * Callers must have permission already. This does not request it: the ask
 * belongs in front of the explanation, not behind four scheduling calls that
 * silently no-op.
 */
export async function applyReminderDefaults(focusAreas: FocusArea[]): Promise<DefaultedReminder[]> {
  const wanted = remindersForFocus(focusAreas);
  const landed: DefaultedReminder[] = [];

  const step = async (id: DefaultedReminder, run: () => Promise<void>) => {
    if (!wanted.includes(id)) return;
    try {
      await run();
      landed.push(id);
    } catch (error) {
      reportError(error, { scope: `onboarding-reminders:${id}` });
    }
  };

  await step('journal', async () => {
    const store = useJournalReminderStore.getState();
    const settings = { ...store.settings, enabled: true };
    store.setReminder(settings, await scheduleJournalReminder(settings));
  });

  await step('goals', async () => {
    const store = useGoalReminderStore.getState();
    // Written before syncing, because `syncGoalReminders` reads the store
    // rather than taking an argument — the same shape every module's resync
    // uses, and the reason the order here is not arbitrary.
    store.setReminder({ ...store.settings, enabled: true }, []);
    await syncGoalReminders();
  });

  await step('study', async () => {
    const store = useStudyReminderStore.getState();
    await syncStudyReminders({ ...store.settings, enabled: true });
  });

  await step('water', async () => {
    const store = useWaterSettingsStore.getState();
    // Water has no single `sync*` entry point — it schedules a spread of
    // reminders and hands back their ids, so cancelling the old set is the
    // caller's job. There is nothing queued during onboarding, but doing it
    // anyway keeps this the same shape as the settings screen: a schedule
    // rebuilt from current state cannot drift from it.
    await cancelWaterReminders(store.scheduledNotificationIds);
    const settings = { ...store.reminders, enabled: true };
    store.setReminders(settings, await scheduleWaterReminders(settings));
  });

  return landed;
}
