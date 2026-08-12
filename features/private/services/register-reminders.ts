import { registerReminderStep } from '@/features/notifications/services/reminder-scheduler';
import { syncCycleReminders } from '@/features/private/services/cycle-reminders';
import { syncTogetherReminders } from '@/features/private/services/together-reminders';

/**
 * Plugs Together's and Cycle's reminders into `resyncAllReminders()` without
 * that file ever importing this one — see `registerReminderStep`'s own
 * comment and data-coverage.test.ts's "never names its content in a
 * notification" assertion, which greps reminder-scheduler.ts's source for
 * the literal string `features/private` and fails the build's test suite if
 * it's there. Importing this file (a side effect at module load, no export
 * anyone calls) is what performs the registration — see app/_layout.tsx,
 * which imports it once alongside its other init-time calls.
 */
registerReminderStep('together', syncTogetherReminders);
registerReminderStep('cycle', syncCycleReminders);
