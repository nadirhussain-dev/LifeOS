import { reminderTime } from '@/features/goals/services/goal-reminder-time';
import {
  useGoalReminderStore,
  type GoalReminderSettings,
} from '@/features/goals/store/goal-reminder-store';
import { listGoals } from '@/features/goals/services/goals-repository';
import i18n from '@/lib/i18n';
import { cancelNotifications, scheduleOneTimeNotification } from '@/lib/notifications';

/**
 * Deadline reminders for goals.
 *
 * The `goals` notification category has existed since the notifications backbone
 * was built and nothing ever scheduled into it, which is why its switch was
 * hidden from Settings — a toggle that controls nothing is worse than a missing
 * one. This is the scheduler that earns it back.
 *
 * ## One notification per goal, rebuilt wholesale
 *
 * Unlike the journal's single daily nudge, this fans out: one dated reminder per
 * active goal that has a due date. That makes cancel-then-rebuild the only
 * correct update strategy, because the set changes for reasons that never touch
 * this module — a goal completed, a deadline moved, a goal deleted. Diffing
 * would need a per-goal id column; rebuilding needs nothing and cannot leave an
 * orphan firing about a deadline that no longer exists.
 *
 * ## What it deliberately does not do
 *
 * Nag about overdue goals. A local notification cannot evaluate anything at fire
 * time, so an "you're late" reminder would keep arriving for a goal finished
 * three weeks ago — the same reason streak-at-risk notifications are still
 * deferred. Reminders are only ever scheduled ahead of the date.
 */

/** Beyond this, a "deadline coming" reminder is noise rather than help, and iOS
 *  only holds 64 pending notifications in total (see SCHEDULING_BUDGET). Someone
 *  with forty goals should not spend that budget on dates a year out. */
const HORIZON_DAYS = 120;
const MAX_GOAL_REMINDERS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cancels every queued goal reminder and schedules a fresh set from the current
 * goals. Idempotent, so it is safe on every launch and after any settings
 * change. Returns the ids it queued, which the caller stores.
 */
export async function syncGoalReminders(
  settings: GoalReminderSettings = useGoalReminderStore.getState().settings,
): Promise<string[]> {
  const store = useGoalReminderStore.getState();
  await cancelNotifications(store.scheduledNotificationIds);

  if (!settings.enabled) {
    store.setReminder(settings, []);
    return [];
  }

  const now = Date.now();
  const horizon = now + HORIZON_DAYS * DAY_MS;

  let goals: ReturnType<typeof listGoals>;
  try {
    goals = listGoals('active');
  } catch {
    // The table not being ready yet must not sink the whole resync.
    store.setReminder(settings, []);
    return [];
  }

  const due = goals
    .filter((goal) => goal.dueDate != null && goal.completedAt == null)
    .map((goal) => ({ goal, fireAt: reminderTime(goal.dueDate as number, settings) }))
    // Already past, or too far out to be worth a slot.
    .filter((entry) => entry.fireAt > now && entry.fireAt <= horizon)
    // Soonest first, so that if the cap bites it drops the most distant
    // deadlines rather than an arbitrary set.
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, MAX_GOAL_REMINDERS);

  const ids: string[] = [];
  for (const { goal, fireAt } of due) {
    const daysLeft = Math.max(0, Math.round(((goal.dueDate as number) - fireAt) / DAY_MS));
    const id = await scheduleOneTimeNotification({
      title: i18n.t('goals.reminderNotifTitle', { title: goal.title }),
      body:
        daysLeft === 0
          ? i18n.t('goals.reminderNotifToday')
          : i18n.t('goals.reminderNotifBody', { count: daysLeft }),
      date: fireAt,
      data: { category: 'goals', route: '/goals/[id]', params: { id: goal.id } },
    });
    if (id) ids.push(id);
  }

  store.setReminder(settings, ids);
  return ids;
}
