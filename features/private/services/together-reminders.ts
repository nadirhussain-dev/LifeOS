import { listAlbums, listMilestones } from '@/features/private/services/album-repository';
import { nextMilestone, TOGETHER_MILESTONES } from '@/features/private/services/together';
import i18n from '@/lib/i18n';
import { scheduleOneTimeNotification } from '@/lib/notifications';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Beyond this, a "something's coming up" nudge is noise rather than help —
 *  same reasoning as goal-reminders.ts's HORIZON_DAYS, just tighter: a
 *  milestone is a single date, not a deadline someone is working toward. */
const HORIZON_DAYS = 14;

function nextDayCountMilestone(startDate: number, now: number): number | null {
  const daysSoFar = Math.floor((now - startDate) / DAY_MS);
  const days = TOGETHER_MILESTONES.find((d) => d > daysSoFar);
  return days === undefined ? null : startDate + days * DAY_MS;
}

/**
 * A single "something's coming up" nudge for the Together module's nearest
 * milestone — whichever of the day-count ones (TOGETHER_MILESTONES) or a
 * custom one (`milestoneDate`/`recurring`) is sooner.
 *
 * Deliberately generic: the body never names the milestone, the album, or
 * either person. This is the app's most relationship-sensitive category, and
 * a real title on a lock screen is exactly the disclosure the rest of the
 * private space (screenshot blocking, the decoy space) exists to prevent —
 * simplest to just never have anything worth redacting in the first place,
 * rather than lean on notification-visibility.ts's redaction path, which
 * only ever engages for a module the user explicitly privatised.
 *
 * Reads Supabase directly rather than local SQLite — shared albums have no
 * local table, see album-repository.ts's header — and needs no vault key at
 * all: `milestoneDate`/`recurring` are plaintext columns (0039), same as
 * `relationshipStartDate`/`createdAt` (0041). Best-effort: offline or
 * signed-out, this quietly schedules nothing, same contract as every other
 * step in reminder-scheduler.ts.
 */
export async function syncTogetherReminders(): Promise<void> {
  const albums = await listAlbums();
  const hub = albums.find((a) => a.isTogetherHub);
  if (!hub) return;

  const now = Date.now();
  const startDate = hub.relationshipStartDate ?? hub.createdAt;
  const milestones = await listMilestones(hub.id);
  const custom = nextMilestone(milestones, new Date(now));

  const candidates = [
    nextDayCountMilestone(startDate, now),
    custom ? now + custom.daysAway * DAY_MS : null,
  ].filter((v): v is number => v !== null);
  if (candidates.length === 0) return;

  const fireAt = Math.min(...candidates);
  if (fireAt <= now || fireAt > now + HORIZON_DAYS * DAY_MS) return;

  // Reuses the app's own redaction copy (notification-visibility.ts)
  // unconditionally, rather than only when the user has separately chosen to
  // privatise this module — see this function's header on why "generic
  // always" beats "generic if opted in" for a category this sensitive.
  await scheduleOneTimeNotification({
    title: i18n.t('notif.redactedTitle'),
    body: i18n.t('notif.redactedBody'),
    date: fireAt,
    data: { category: 'together', route: '/private/together' },
  });
}
