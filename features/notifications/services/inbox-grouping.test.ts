import { groupScheduled } from '@/features/notifications/services/inbox-grouping';
import type { LoggedNotification } from '@/features/notifications/types/notification.types';

/**
 * The shape this fixes, from a real device: "Upcoming" showed four identical
 * "Time to study" rows and three identical "Time to hydrate · Daily reminder"
 * rows, furthest-away first, which pushed everything that had actually arrived
 * off the bottom of the screen.
 */

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

const row = (over: Partial<LoggedNotification> = {}): LoggedNotification => ({
  id: 'n1',
  notificationId: 'os-1',
  category: 'water',
  title: 'Time to hydrate',
  body: 'It’s been a while — grab some water.',
  route: null,
  params: null,
  scheduledAt: NOW + HOUR,
  repeats: 'daily',
  deliveredAt: null,
  readAt: null,
  canceledAt: null,
  createdAt: NOW,
  ...over,
});

describe('groupScheduled', () => {
  it('collapses the slots of one schedule into a single row', () => {
    // Hydration is composed from a daily trigger per slot, so the log holds one
    // identical row per slot — the wall of duplicates the user saw.
    const groups = groupScheduled([
      row({ id: 'a', scheduledAt: NOW + 3 * HOUR }),
      row({ id: 'b', scheduledAt: NOW + HOUR }),
      row({ id: 'c', scheduledAt: NOW + 2 * HOUR }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].ids.sort()).toEqual(['a', 'b', 'c']);
  });

  it('leads with the soonest occurrence, not whichever came back first', () => {
    const groups = groupScheduled([
      row({ id: 'late', scheduledAt: NOW + 6 * HOUR }),
      row({ id: 'soon', scheduledAt: NOW + HOUR }),
    ]);
    expect(groups[0].lead.id).toBe('soon');
  });

  it('orders schedules soonest first', () => {
    // The query returns newest-scheduledAt first, which for future rows means
    // furthest away — the upcoming list opened on "in 6 days".
    const groups = groupScheduled([
      row({ id: 'study', category: 'study', title: 'Time to study', scheduledAt: NOW + 6 * HOUR }),
      row({ id: 'water', scheduledAt: NOW + HOUR }),
    ]);
    expect(groups.map((g) => g.lead.id)).toEqual(['water', 'study']);
  });

  it('keeps genuinely different reminders apart', () => {
    const groups = groupScheduled([
      row({ id: 'water' }),
      row({ id: 'study', category: 'study', title: 'Time to study' }),
      row({ id: 'body', body: 'Different body' }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it('does not merge a one-off into a repeating reminder that reads the same', () => {
    // Same words, different promise: one fires tonight and is gone, the other
    // every day. Collapsing them would hide the one-off entirely.
    const groups = groupScheduled([row({ id: 'daily' }), row({ id: 'once', repeats: 'none' })]);
    expect(groups).toHaveLength(2);
  });

  it('reports a lone reminder as a group of one', () => {
    const groups = groupScheduled([row({ id: 'solo' })]);
    expect(groups).toEqual([
      { lead: expect.objectContaining({ id: 'solo' }), count: 1, ids: ['solo'] },
    ]);
  });

  it('has nothing to say about an empty inbox', () => {
    expect(groupScheduled([])).toEqual([]);
  });
});
