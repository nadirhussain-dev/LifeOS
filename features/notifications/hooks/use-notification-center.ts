import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  recordNotificationDelivery,
  reconcilePassedNotifications,
} from '@/features/notifications/services/notification-log-repository';
import { useInAppNotificationStore } from '@/features/notifications/store/in-app-notification-store';
import {
  CATEGORY_META,
  type NotificationCategory,
} from '@/features/notifications/types/notification.types';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import { seedSlots } from '@/features/notifications/services/scheduling-budget';
import { reportError } from '@/lib/error-reporting';
import {
  addNotificationReceivedListener,
  getScheduledCount,
  hasNotificationPermission,
  invalidateScheduledQueueCache,
  sweepDuplicateKeys,
} from '@/lib/notifications';

/**
 * Turns an arriving notification into something the app itself can show.
 *
 * Two things happen on arrival, and neither used to:
 *
 *  1. **It is written down.** The inbox was a log of what had been *scheduled*,
 *     with delivery inferred from the clock — which excluded every repeating
 *     reminder (their `scheduledAt` is always the next fire) and every push
 *     (never scheduled on this device at all). So a shared-group notification
 *     could buzz the phone and leave no trace anywhere in the app.
 *  2. **It is presented in-app.** With the OS banner suppressed while the app
 *     is foregrounded, this is what the user actually sees — in the app's own
 *     type, tinted by module, and tappable straight through to the thing.
 *
 * Mounted once from the root layout. Renders nothing.
 */
export function useNotificationCenter(): void {
  const router = useRouter();
  const queryClient = useQueryClient();

  /**
   * Catch up on anything that fired while the app was not running.
   *
   * The listener below only hears arrivals in a live process, so a reminder
   * that fires overnight leaves no trace and the badge stays at zero even
   * though the inbox lists it. Reconciling on launch and on every return to
   * the foreground is when the answer can actually change — a notification
   * cannot fire between two foreground moments without one of them following
   * it. Cheap enough to run unconditionally: one indexed UPDATE that matches
   * nothing in the common case.
   */
  useEffect(() => {
    const catchUp = () => {
      try {
        if (reconcilePassedNotifications() > 0) {
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
      } catch (error) {
        reportError(error, { scope: 'notification-reconcile' });
      }

      /**
       * Re-read the OS permission on the same beat.
       *
       * Permission is not a one-time gate — it can be revoked in system
       * settings at any point, and revoking it kills every reminder silently:
       * the master switch, each category and each item's own toggle all go on
       * reading ON. Returning to the app is exactly when someone has come back
       * from those settings, so it is the moment to find out.
       */
      void hasNotificationPermission()
        .then(useNotificationsStore.getState().setSystemPermissionGranted)
        .catch(() => undefined);

      /**
       * Re-read the OS queue on the same beat, and settle two things that drift
       * while the app is backgrounded.
       *
       * The slot ledger is an in-process counter that only a rebuild reseeds
       * (see scheduling-budget.ts). Notifications that fired overnight left the
       * queue without telling it, so it over-counts — and on iOS, where the
       * ceiling is real, an over-counting ledger makes `hasHeadroom` decline
       * reminders there is actually room for. Returning to the foreground is
       * both when the answer has changed and when it is cheap to ask.
       *
       * The sweep is the other half: cancel-by-key only runs when something
       * schedules, so a key nothing touched this session keeps whatever it has
       * — including duplicates from a build that predates keys. This is what
       * cleans those up without waiting for the user to edit the item.
       */
      void (async () => {
        try {
          invalidateScheduledQueueCache();
          await sweepDuplicateKeys();
          seedSlots(await getScheduledCount());
        } catch (error) {
          reportError(error, { scope: 'notification-queue-reconcile' });
        }
      })();
    };

    catchUp();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });
    return () => sub.remove();
  }, [queryClient]);

  useEffect(() => {
    const unsubscribe = addNotificationReceivedListener((received) => {
      const { payload } = received;
      // A push may carry no category. `split` is the only source of those, and
      // an uncategorised arrival still deserves a row rather than vanishing.
      const category: NotificationCategory =
        payload.category && payload.category in CATEGORY_META ? payload.category : 'split';

      try {
        recordNotificationDelivery({
          logId: payload.logId,
          notificationId: received.notificationId,
          category,
          title: received.title,
          body: received.body,
          route: payload.route ?? null,
          params: payload.params ?? null,
        });
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch (error) {
        // A failed write must not cost the user the banner as well.
        reportError(error, { scope: 'notification-center' });
      }

      useInAppNotificationStore.getState().present({
        category,
        title: received.title,
        body: received.body,
        onPress: payload.route
          ? () =>
              router.push({
                pathname: payload.route as never,
                params: (payload.params ?? {}) as never,
              })
          : undefined,
      });
    });

    return unsubscribe;
  }, [router, queryClient]);
}
