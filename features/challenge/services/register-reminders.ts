import { resyncChallengeReminder } from '@/features/challenge/services/challenge-reminders';
import { registerReminderStep } from '@/features/notifications/services/reminder-scheduler';

/**
 * Puts the streak reminders into the launch rebuild.
 *
 * They were the one thing in the app that scheduled notifications and was not
 * reachable from `resyncAllReminders()` — which meant the rebuild's opening
 * `cancelAllScheduled()` deleted them and nothing ever put them back. Both
 * effects run on launch, independently, so whether the evening reminder
 * survived a given start-up came down to which one happened to finish second.
 *
 * Registered the same way Insights and the private space are, rather than by
 * importing this from reminder-scheduler.ts: the rebuild must not grow a direct
 * dependency on every feature that schedules. Importing this file performs the
 * registration as a load-time side effect — see app/_layout.tsx.
 *
 * `resyncChallengeReminder` reads the checklist itself and no-ops for anybody
 * not in a run, so the step costs an enrolled-flag check for everyone else.
 */
registerReminderStep('challenge', resyncChallengeReminder);
