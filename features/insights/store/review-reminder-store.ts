import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The weekly review nudge.
 *
 * One notification a week, and the only one in the app whose job is to start a
 * ritual rather than to catch a lapse. Sunday evening by default because that is
 * when a week is over and the next one is not yet fixed — a Monday morning
 * review arrives after the decisions it should have informed.
 *
 * `weekday` is 0-based with Sunday = 0, matching `Habit.scheduleDays` and
 * `Date#getDay`. The 1-based-Sunday quirk in expo-notifications is owned by
 * `scheduleWeeklyNotification` and converted in exactly that one place.
 *
 * On by default, unlike every other reminder here. A review nobody is told about
 * is a screen nobody opens, and the whole argument for this feature is that it
 * becomes a habit — but it is still one switch in Notification Settings, under
 * its own category, and turning that category off cancels it like any other.
 */
export type ReviewReminderSettings = {
  enabled: boolean;
  /** 0 = Sunday. */
  weekday: number;
  hour: number;
  minute: number;
};

export const DEFAULT_REVIEW_REMINDER: ReviewReminderSettings = {
  enabled: true,
  weekday: 0,
  hour: 19,
  minute: 0,
};

type ReviewReminderState = {
  settings: ReviewReminderSettings;
  scheduledNotificationId: string | null;
  setReminder: (settings: ReviewReminderSettings, notificationId: string | null) => void;
};

export const useReviewReminderStore = create<ReviewReminderState>()(
  persist(
    (set) => ({
      settings: DEFAULT_REVIEW_REMINDER,
      scheduledNotificationId: null,
      setReminder: (settings, scheduledNotificationId) =>
        set({ settings, scheduledNotificationId }),
    }),
    {
      name: 'review-reminder-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
