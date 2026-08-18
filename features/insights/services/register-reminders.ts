import { registerReminderStep } from '@/features/notifications/services/reminder-scheduler';
import { syncReviewReminder } from '@/features/insights/services/review-reminders';

/**
 * Plugs the weekly review into `resyncAllReminders()` without that file
 * importing this one — the same registration pattern the private space uses.
 * Importing this module performs the registration as a load-time side effect;
 * see app/_layout.tsx.
 */
registerReminderStep('review', syncReviewReminder);
