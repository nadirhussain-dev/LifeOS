import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * When to be told a goal's deadline is coming.
 *
 * One preference for every goal rather than a per-goal setting, which is a
 * deliberate trade. Per-goal would need a column on `goals`, which is a synced
 * table — so a drizzle change, a bootstrap change, an additive migration and a
 * server migration, all to express something almost nobody varies per goal. This
 * is the same shape as the journal reminder, and if it turns out people really
 * do want it per goal, the column can be added later without changing what this
 * store means.
 *
 * `daysBefore: 0` is a real answer: some people want to hear about it on the
 * day and not before.
 */
export type GoalReminderSettings = {
  enabled: boolean;
  /** How many days ahead of the due date to fire. 0 = on the day. */
  daysBefore: number;
  hour: number;
  minute: number;
};

export const GOAL_REMINDER_DAY_OPTIONS = [0, 1, 3, 7, 14] as const;

export const DEFAULT_GOAL_REMINDER: GoalReminderSettings = {
  enabled: false,
  daysBefore: 3,
  hour: 9,
  minute: 0,
};

type GoalReminderState = {
  settings: GoalReminderSettings;
  /**
   * Every notification id currently queued for goal deadlines.
   *
   * A list, not one id, because this schedules one notification per goal with a
   * due date — unlike the journal's single daily nudge. They are cancelled as a
   * set before each rebuild, so a goal that was completed or had its date moved
   * cannot leave an orphan firing about a deadline that no longer exists.
   */
  scheduledNotificationIds: string[];
  setReminder: (settings: GoalReminderSettings, notificationIds: string[]) => void;
};

export const useGoalReminderStore = create<GoalReminderState>()(
  persist(
    (set) => ({
      settings: DEFAULT_GOAL_REMINDER,
      scheduledNotificationIds: [],
      setReminder: (settings, scheduledNotificationIds) =>
        set({ settings, scheduledNotificationIds }),
    }),
    {
      name: 'goal-reminder-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
