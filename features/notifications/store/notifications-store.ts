import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_NOTIFICATION_SOUND_ID,
  type NotificationSoundId,
} from '@/features/notifications/config/notification-sounds';
import {
  CATEGORY_ORDER,
  type NotificationCategory,
} from '@/features/notifications/types/notification.types';

export type DeliveryMode = 'digest' | 'individual';

function allCategoriesEnabled(): Record<NotificationCategory, boolean> {
  return CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = true;
      return acc;
    },
    {} as Record<NotificationCategory, boolean>,
  );
}

export type NotificationsState = {
  /** Kill-switch for every LifeOS reminder. When false, nothing schedules. */
  masterEnabled: boolean;
  /** Per-category on/off. A category toggled off stops new scheduling; existing
   * queued reminders are cleared when the owning item next syncs. */
  categories: Record<NotificationCategory, boolean>;
  /** When on, non-bypassing reminders that land in the window are shifted out. */
  quietHoursEnabled: boolean;
  /** Quiet window as minutes-from-midnight. Wraps past midnight when start > end. */
  quietStartMinutes: number;
  quietEndMinutes: number;
  /**
   * The tone every LifeOS reminder arrives with.
   *
   * One app-wide choice rather than one per category, because on Android the
   * sound belongs to the notification *channel* and each tone therefore costs a
   * channel in the user's system settings — see
   * config/notification-sounds.ts for the full reasoning.
   */
  soundId: NotificationSoundId;
  /** 'individual' (the default) = every reminder fires at its own time;
   * 'digest' = opt-in, folding non-urgent nudges into one morning summary. */
  deliveryMode: DeliveryMode;
  digestHour: number;
  digestMinute: number;
  /** expo-notifications id for the currently-scheduled digest, so it can be
   * cancelled before rescheduling. */
  digestNotificationId: string | null;
  /**
   * When the app last accounted for reminders arriving — the watermark that
   * `recordMissedRepeatingDeliveries` measures "fired while you were away"
   * against.
   *
   * Null on a fresh install, and deliberately not backfilled: there is nothing
   * behind a first launch to have missed, and treating zero as the watermark
   * would record an occurrence for every repeating schedule the moment the app
   * first opens.
   */
  lastArrivalCheckAt: number | null;
  /**
   * Whether the OS currently permits notifications at all, re-read on every
   * return to the foreground.
   *
   * Permission is not a one-time gate: it can be revoked in system settings
   * long after it was granted, and when it is, every reminder in the app dies
   * silently. Nothing in-app changes — the master switch still reads ON, each
   * category still reads ON, each item's own reminder toggle still reads ON —
   * so the app goes on describing reminders that cannot fire. Only the
   * Notification Settings screen knew, and only while it was open.
   *
   * Null until the first check, so a surface can tell "not asked yet" from
   * "asked, and the answer was no" and stay quiet during launch.
   */
  systemPermissionGranted: boolean | null;

  setMasterEnabled: (enabled: boolean) => void;
  setCategoryEnabled: (category: NotificationCategory, enabled: boolean) => void;
  setSoundId: (id: NotificationSoundId) => void;
  setQuietHoursEnabled: (enabled: boolean) => void;
  setQuietHours: (startMinutes: number, endMinutes: number) => void;
  setDeliveryMode: (mode: DeliveryMode) => void;
  setDigestTime: (hour: number, minute: number) => void;
  setDigestNotificationId: (id: string | null) => void;
  setLastArrivalCheckAt: (at: number) => void;
  setSystemPermissionGranted: (granted: boolean) => void;
};

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set) => ({
      masterEnabled: true,
      categories: allCategoriesEnabled(),
      quietHoursEnabled: true,
      quietStartMinutes: 22 * 60,
      quietEndMinutes: 7 * 60,
      soundId: DEFAULT_NOTIFICATION_SOUND_ID,
      // Individual, not digest. Digest reads like a considerate default but it
      // silently cancels every water/habit/journal/goal reminder the user set up
      // (see CONSOLIDATED_CATEGORIES in services/delivery.ts) and replaces them
      // with one 8am summary. Nothing in the setup flows says so, so the honest
      // reading of "I set a reminder" is that the reminder fires. Digest is
      // still there, one tap away in Notification Settings.
      deliveryMode: 'individual',
      digestHour: 8,
      digestMinute: 0,
      digestNotificationId: null,
      lastArrivalCheckAt: null,
      systemPermissionGranted: null,

      setMasterEnabled: (masterEnabled) => set({ masterEnabled }),
      setCategoryEnabled: (category, enabled) =>
        set((state) => ({ categories: { ...state.categories, [category]: enabled } })),
      setSoundId: (soundId) => set({ soundId }),
      setQuietHoursEnabled: (quietHoursEnabled) => set({ quietHoursEnabled }),
      setQuietHours: (quietStartMinutes, quietEndMinutes) =>
        set({ quietStartMinutes, quietEndMinutes }),
      setDeliveryMode: (deliveryMode) => set({ deliveryMode }),
      setDigestTime: (digestHour, digestMinute) => set({ digestHour, digestMinute }),
      setDigestNotificationId: (digestNotificationId) => set({ digestNotificationId }),
      setLastArrivalCheckAt: (lastArrivalCheckAt) => set({ lastArrivalCheckAt }),
      setSystemPermissionGranted: (systemPermissionGranted) => set({ systemPermissionGranted }),
    }),
    {
      name: 'notifications-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      /**
       * Everything except the permission flag, which is a fact about the OS
       * rather than a preference. Writing it to disk would restore a stale
       * answer on the next launch and show — or hide — the "notifications are
       * blocked" notice based on what was true last time the app ran. It starts
       * null every launch and is filled in by the first real check.
       */
      partialize: (state) => {
        const { systemPermissionGranted: _omitted, ...persisted } = state;
        return persisted as NotificationsState;
      },
      // Changing the default above only affects fresh installs — everyone who
      // already ran the app has 'digest' written to disk and would keep losing
      // their reminders. v1 clears that one-time: an install still sitting on
      // the old default is moved to 'individual'. Anyone who chose digest
      // deliberately after this ships is on version 1 already and is left alone.
      migrate: (persisted, version) => {
        const saved = (persisted ?? {}) as Partial<NotificationsState>;
        if (version === 0 && saved.deliveryMode === 'digest') {
          return { ...saved, deliveryMode: 'individual' as DeliveryMode };
        }
        return saved;
      },
      // A category added in a later release won't exist in a persisted map read
      // back from an older install — backfill any missing ones to enabled.
      merge: (persisted, current) => {
        const saved = persisted as Partial<NotificationsState> | undefined;
        return {
          ...current,
          ...saved,
          categories: { ...allCategoriesEnabled(), ...(saved?.categories ?? {}) },
        };
      },
    },
  ),
);

/** True when a category may schedule right now — master on AND category on.
 * Callable outside React (used by the scheduling primitives). */
export function isCategoryEnabled(category: NotificationCategory): boolean {
  const state = useNotificationsStore.getState();
  return state.masterEnabled && (state.categories[category] ?? true);
}
