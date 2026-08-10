import { isModuleEnabled } from '@/features/module-flags/store/module-flags-store';
import { privatisedModules } from '@/features/private/store/private-store';
import type { NotificationCategory } from '@/features/notifications/types/notification.types';
import i18n from '@/lib/i18n';

/**
 * Which Hub module owns each notification category.
 *
 * Reminders are scheduled per module, but the two switches that can hide a
 * module — the operator's kill switch and the user's "keep this private" —
 * both key off a module id, and nothing connected the two. So a privatised
 * Budget still put "Rent is due tomorrow — £1,450" on the lock screen, and a
 * module the operator had pulled kept reminding people about a feature they
 * could no longer open.
 *
 * `digest` maps to nothing on purpose: it is a sentence assembled from several
 * modules at once, so it cannot be suppressed or redacted as a unit. It is
 * filtered line by line where it is built instead — see `buildDigestSummary`.
 *
 * `streak` belongs to habits: it celebrates a habit chain, so if habits are
 * hidden the celebration names something hidden.
 */
export const MODULE_FOR_CATEGORY: Record<NotificationCategory, string | null> = {
  tasks: 'tasks',
  habits: 'habits',
  journal: 'journal',
  water: 'water',
  sleep: 'sleep',
  study: 'study',
  budget: 'budget',
  calendar: 'timeline',
  notes: 'notes',
  goals: 'goals',
  split: 'split',
  streak: 'habits',
  digest: null,
};

export type CategoryVisibility =
  /** Schedule it as written. */
  | 'ok'
  /** Do not schedule it at all, and cancel any already queued. */
  | 'suppressed'
  /** Schedule it, but with text that names nothing. */
  | 'redacted';

/**
 * What may be said about this category right now.
 *
 * The two gates are deliberately different, because the two problems are.
 *
 * An operator-disabled module is *broken or withdrawn*. Reminding somebody
 * about a screen that redirects them to the Hub is noise at best, and at worst
 * it is a reminder to do a thing the app has decided they should not currently
 * do. Suppress it.
 *
 * A privatised module is *working perfectly and none of my business*. Dropping
 * its reminders would quietly degrade the app as a punishment for using a
 * privacy feature — the user still wants the nudge, they just do not want it
 * legible to whoever is looking at the phone. So it still fires, still deep
 * links, and says nothing.
 *
 * Note the privatised check ignores whether the vault is currently unlocked.
 * A notification scheduled now fires in an hour, or tomorrow morning, and the
 * lock state at *that* moment is the one that matters — which is unknowable
 * here, so the private answer is the only safe one.
 */
export function categoryVisibility(category: NotificationCategory): CategoryVisibility {
  const moduleId = MODULE_FOR_CATEGORY[category];
  if (!moduleId) return 'ok';
  if (!isModuleEnabled(moduleId)) return 'suppressed';
  if (privatisedModules().includes(moduleId)) return 'redacted';
  return 'ok';
}

/** Whether this module's content may be named in something the OS will render
 *  outside the app. Used by the digest, which has to drop lines rather than
 *  redact the whole sentence. */
export function moduleMayBeNamed(moduleId: string): boolean {
  return isModuleEnabled(moduleId) && !privatisedModules().includes(moduleId);
}

/**
 * The text a redacted reminder carries.
 *
 * It says "LifeOS" and "You have a reminder", and specifically not "a reminder
 * from your private space" — the second version is still a leak. It tells
 * anyone glancing at the lock screen that this phone has a private space and
 * that there is something in it, which is most of what they wanted to know.
 * The deep link is kept, so tapping it lands on the route guard and asks for
 * the PIN.
 */
export function redactedContent(): { title: string; body: string } {
  return { title: i18n.t('notif.redactedTitle'), body: i18n.t('notif.redactedBody') };
}

/**
 * Applies the policy to one notification's text. Returns null when it must not
 * be scheduled at all.
 */
export function resolveNotificationContent(
  category: NotificationCategory | undefined,
  content: { title: string; body: string },
): { title: string; body: string } | null {
  if (!category) return content;
  switch (categoryVisibility(category)) {
    case 'suppressed':
      return null;
    case 'redacted':
      return redactedContent();
    default:
      return content;
  }
}
