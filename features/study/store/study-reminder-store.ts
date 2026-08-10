import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The daily "sit down and study" nudge.
 *
 * Days are explicit rather than every-day, because study is the one module here
 * where a weekday/weekend split is the normal case rather than a refinement, and
 * a reminder that fires on a Sunday you never study gets the whole category
 * switched off.
 *
 * `days` is 0-based with Sunday = 0, matching `Habit.scheduleDays` and
 * `Date#getDay`, so the weekday conversion happens in exactly one place —
 * `scheduleWeeklyNotification`, which already owns the 1-based-Sunday quirk in
 * expo-notifications.
 */
export type StudyReminderSettings = {
  enabled: boolean;
  /** 0 = Sunday. Empty means no reminder fires, same as disabled. */
  days: number[];
  hour: number;
  minute: number;
};

export const DEFAULT_STUDY_REMINDER: StudyReminderSettings = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  hour: 19,
  minute: 0,
};

type StudyReminderState = {
  settings: StudyReminderSettings;
  /** One id per selected weekday — a weekly trigger each, not one daily one.
   *  Kept so they can all be cancelled before rescheduling. */
  scheduledNotificationIds: string[];
  setReminder: (settings: StudyReminderSettings, notificationIds: string[]) => void;
};

export const useStudyReminderStore = create<StudyReminderState>()(
  persist(
    (set) => ({
      settings: DEFAULT_STUDY_REMINDER,
      scheduledNotificationIds: [],
      setReminder: (settings, scheduledNotificationIds) =>
        set({ settings, scheduledNotificationIds }),
    }),
    {
      name: 'study-reminder-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
