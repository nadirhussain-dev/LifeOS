import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { WaterReminderSettings } from '@/features/water-intake/types/water-intake.types';

export const GOAL_PRESETS_ML = [1500, 2000, 2500, 3000, 3500, 4000] as const;

/**
 * One glass, in millilitres — what a single quick-add logs.
 *
 * Lived as a private `const GLASS_ML = 250` in two dashboard components and is
 * now read by a third caller that cannot see either of them: the home-screen
 * widget's "+1" button. Three copies of a number that has to agree is how the
 * widget ends up logging a different amount from the tile directly above it.
 */
export const GLASS_ML = 250;

export const DEFAULT_REMINDER_SETTINGS: WaterReminderSettings = {
  enabled: false,
  intervalMinutes: 60,
  startHour: 8,
  endHour: 21,
};

type WaterSettingsState = {
  goalMl: number;
  reminders: WaterReminderSettings;
  /** Ids returned by expo-notifications for the currently-scheduled reminders,
   * kept so they can be cancelled before rescheduling with new settings. */
  scheduledNotificationIds: string[];
  setGoal: (ml: number) => void;
  setReminders: (settings: WaterReminderSettings, notificationIds: string[]) => void;
};

export const useWaterSettingsStore = create<WaterSettingsState>()(
  persist(
    (set) => ({
      goalMl: GOAL_PRESETS_ML[1],
      reminders: DEFAULT_REMINDER_SETTINGS,
      scheduledNotificationIds: [],
      setGoal: (goalMl) => set({ goalMl }),
      setReminders: (reminders, scheduledNotificationIds) =>
        set({ reminders, scheduledNotificationIds }),
    }),
    {
      name: 'water-settings-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
