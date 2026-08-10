import { syncDebtReminder } from '@/features/budget/services/debt-reminders';
import { listDebts } from '@/features/budget/services/debts-repository';
import { syncGoalReminders } from '@/features/goals/services/goal-reminders';
import { syncStudyReminders } from '@/features/study/services/study-reminders';
import { syncHabitReminder } from '@/features/habits/services/habit-reminders';
import { listHabits } from '@/features/habits/services/habits-repository';
import { scheduleJournalReminder } from '@/features/journal/services/journal-reminders';
import { useJournalReminderStore } from '@/features/journal/store/journal-reminder-store';
import { syncNoteReminder } from '@/features/notes/services/note-reminders';
import { listNotesWithReminders } from '@/features/notes/services/notes-repository';
import { syncDigest } from '@/features/notifications/services/digest';
import { syncTaskReminder } from '@/features/tasks/services/task-reminders';
import { listTasks } from '@/features/tasks/services/tasks-repository';
import { syncBedtimeReminder } from '@/features/sleep/services/sleep-reminders';
import { scheduleCalendarEventReminder } from '@/features/timeline/services/calendar-event-reminders';
import { listUpcomingCalendarEvents } from '@/features/timeline/services/calendar-events-repository';
import { scheduleWaterReminders } from '@/features/water-intake/services/water-reminders';
import { useWaterSettingsStore } from '@/features/water-intake/store/water-settings-store';
import { reportError } from '@/lib/error-reporting';
import { cancelAllScheduled, hasNotificationPermission } from '@/lib/notifications';

/**
 * Rebuilds every reminder the app owns, from scratch.
 *
 * ## Why this has to exist
 *
 * Until now a reminder was scheduled exactly once — at the moment its item was
 * saved — and never revisited. But `scheduleOneTimeNotification` /
 * `scheduleDailyNotification` return `null`, and the owning row then stores
 * `reminderNotificationId = null`, in *all* of these cases:
 *
 *   - notification permission has not been granted yet
 *   - the reminder's category is switched off
 *   - delivery mode is "smart digest" (every non-urgent category is folded in)
 *   - the master switch is off
 *   - the computed time has already passed
 *
 * None of them is permanent, and none of them was ever retried. So a user who
 * created ten tasks and then granted permission had ten reminders that would
 * never fire; turning a category off and on again destroyed its reminders for
 * good; and the master toggle called `cancelAllScheduled()` on the way out with
 * nothing to undo it on the way back in. The code said as much in a comment —
 * "reminders return as each item is re-saved" — which is not something a user
 * can be expected to know, or to do for every item they own.
 *
 * Restoring a backup had the same shape: the restored rows carry notification
 * ids belonging to an install that no longer exists, and nothing rescheduled.
 *
 * ## How
 *
 * Cancel everything, then rebuild from the database. That is deliberately a
 * full rebuild rather than a diff: the OS queue and the app's stored ids can
 * disagree in both directions (ids pointing at nothing after a reinstall,
 * queued notifications whose item was deleted while the app was closed), and a
 * rebuild is the only cheap operation that is correct from every starting
 * state. It is idempotent, so running it on every launch is safe.
 *
 * ## What it will not do
 *
 * Prompt. A resync runs unattended — on launch, after a settings change — and
 * a permission dialog that appears with no user action behind it gets refused,
 * which is worse than not asking. So it checks permission first and returns
 * early, and the settings screen calls it again once permission is granted.
 */

export type ResyncResult = {
  /** False when nothing was rebuilt because there is no permission (yet). */
  ran: boolean;
  scheduled: number;
  failed: number;
};

/** In-flight resync, so overlapping triggers (launch + a settings change) can't
 *  interleave a cancel-all with somebody else's rebuild. */
let inFlight: Promise<ResyncResult> | null = null;

export function resyncAllReminders(): Promise<ResyncResult> {
  if (!inFlight) {
    inFlight = runResync().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runResync(): Promise<ResyncResult> {
  if (!(await hasNotificationPermission())) {
    return { ran: false, scheduled: 0, failed: 0 };
  }

  // Clears the OS queue and the inbox rows that mirror it, so orphans from a
  // deleted item or a previous install cannot survive the rebuild.
  await cancelAllScheduled();

  let scheduled = 0;
  let failed = 0;

  /** Each module is isolated: one broken table must not cost every other
   *  module its reminders. */
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run();
      scheduled++;
    } catch (error) {
      failed++;
      reportError(error, { scope: `reminder-resync:${name}` });
    }
  };

  // Ordered by how much it matters that it survives the iOS 64-notification
  // ceiling: a missed task due-time is a real failure, a missed hydration nudge
  // is not. See SCHEDULING_BUDGET in lib/notifications.
  await step('tasks', async () => {
    for (const task of listTasks('active', 'due-date')) {
      if (task.reminderEnabled && task.dueDate) await syncTaskReminder(task);
    }
  });

  await step('calendar', async () => {
    for (const event of listUpcomingCalendarEvents(Date.now())) {
      if (event.reminderMinutesBefore != null) await scheduleCalendarEventReminder(event);
    }
  });

  await step('debts', async () => {
    for (const debt of listDebts()) {
      if (debt.reminderDaysBefore != null) await syncDebtReminder(debt);
    }
  });

  await step('sleep', () => syncBedtimeReminder());

  await step('notes', async () => {
    for (const note of listNotesWithReminders()) {
      await syncNoteReminder(note);
    }
  });

  await step('habits', async () => {
    for (const habit of listHabits()) {
      if (habit.reminderTime) await syncHabitReminder(habit);
    }
  });

  await step('journal', async () => {
    const settings = useJournalReminderStore.getState().settings;
    const id = await scheduleJournalReminder(settings);
    useJournalReminderStore.getState().setReminder(settings, id);
  });

  // Goal deadlines are dated one-shots, so they are the reminders most exposed
  // to the rebuild: a goal completed while the app was closed leaves a queued
  // notification about a deadline that no longer matters, and only a resync
  // clears it. Both of these store their own ids.
  await step('goals', () => syncGoalReminders());

  await step('study', () => syncStudyReminders());

  // Last, and the biggest consumer by far — every 30 minutes from 08:00 to
  // 21:00 is 27 notifications on its own. If anything is going to be squeezed
  // out by the platform ceiling, it should be this.
  await step('water', async () => {
    const { reminders } = useWaterSettingsStore.getState();
    const ids = await scheduleWaterReminders(reminders);
    useWaterSettingsStore.getState().setReminders(reminders, ids);
  });

  await step('digest', () => syncDigest());

  return { ran: true, scheduled, failed };
}
