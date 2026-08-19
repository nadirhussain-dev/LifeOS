import type { InsightKey } from '@/features/insights/types/insights.types';

/**
 * Where each finding lets you act on it.
 *
 * An insight you cannot act on is trivia. The point of this table is that the
 * screen never says "you sleep better on days you finish your habits" without
 * also offering the one control that would change it — otherwise the app has
 * described the user's life back to them and left them to go find the setting.
 *
 * ## Why a route and not a write
 *
 * The tempting version of this is a button that silently sets a bedtime
 * reminder for 22:30 or raises the water target by 500ml. It was not built that
 * way. A finding is a correlation over a few dozen days, and acting on it means
 * committing the user to a nightly notification or a new daily target — a
 * change they should see and confirm, not discover afterwards. Deep-linking to
 * the exact control keeps the loop to one tap while leaving the decision where
 * it belongs.
 *
 * Several findings share a destination, which is fine and slightly reassuring:
 * four separate signals all pointing at "set a bedtime" is the engine agreeing
 * with itself rather than fourteen unrelated suggestions.
 */
export type InsightAction = {
  /** Translation key for the button. Phrased as the change, not the screen —
   *  "Set a bedtime reminder", never "Open sleep settings". */
  labelKey: string;
  route: string;
};

export const INSIGHT_ACTION: Record<InsightKey, InsightAction> = {
  sleepFocus: { labelKey: 'insights.actionSleepGoal', route: '/sleep/settings' },
  sleepMood: { labelKey: 'insights.actionSleepGoal', route: '/sleep/settings' },
  sleepTasks: { labelKey: 'insights.actionSleepGoal', route: '/sleep/settings' },
  sleepSpending: { labelKey: 'insights.actionSleepGoal', route: '/sleep/settings' },
  bedtimeMood: { labelKey: 'insights.actionBedtime', route: '/sleep/settings' },
  lateNightSpending: { labelKey: 'insights.actionBedtime', route: '/sleep/settings' },

  habitsSleep: { labelKey: 'insights.actionHabits', route: '/(tabs)/habits' },
  habitsMood: { labelKey: 'insights.actionHabits', route: '/(tabs)/habits' },

  moodSpending: { labelKey: 'insights.actionBudget', route: '/budget/settings' },

  stressSleep: { labelKey: 'insights.actionJournalReminder', route: '/journal/reminder-settings' },
  journalMood: { labelKey: 'insights.actionJournalReminder', route: '/journal/reminder-settings' },

  waterEnergy: { labelKey: 'insights.actionWaterTarget', route: '/water-intake/settings' },
  studyMood: { labelKey: 'insights.actionStudyReminder', route: '/study/reminder-settings' },
  energyTasks: { labelKey: 'insights.actionTasks', route: '/(tabs)/tasks' },
};
