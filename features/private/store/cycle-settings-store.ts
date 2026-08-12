import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The one-time consent gate for cycle-math.ts's `fertileWindow` — see that
 * file's header for why this exists at all. Kept out of `private-store.ts`
 * deliberately: that store's own rule is "nothing here says which modules
 * hold data" (see its header), and whether this device has acknowledged the
 * disclaimer is exactly that kind of content-shaped fact about Cycle
 * specifically, not a cross-module preference.
 *
 * Never gates whether the number is *computed* — cycle.tsx always shows the
 * fixed inline notice alongside it regardless of this flag. It only decides
 * whether the one-time dialog needs to interrupt the screen again.
 */
type CycleSettingsState = {
  fertileWindowAck: boolean;
  /** The currently-queued "period expected soon" notification, so a
   *  reschedule (vault unlock, a new/edited entry) can cancel the stale one
   *  first — see cycle-reminders.ts. `resyncAllReminders()`'s own
   *  `cancelAllScheduled()` sweep makes this redundant for the launch-time
   *  path, but that sweep never runs from either of this id's own reactive
   *  triggers. */
  reminderNotificationId: string | null;
  hydrated: boolean;
  setFertileWindowAck: (ack: boolean) => void;
  setReminderNotificationId: (id: string | null) => void;
};

export const useCycleSettingsStore = create<CycleSettingsState>()(
  persist(
    (set) => ({
      fertileWindowAck: false,
      reminderNotificationId: null,
      hydrated: false,
      setFertileWindowAck: (fertileWindowAck) => set({ fertileWindowAck }),
      setReminderNotificationId: (reminderNotificationId) => set({ reminderNotificationId }),
    }),
    {
      name: 'cycle-settings-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useCycleSettingsStore.setState({ hydrated: true });
      },
    },
  ),
);
