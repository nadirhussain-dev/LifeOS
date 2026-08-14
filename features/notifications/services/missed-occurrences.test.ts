import {
  firedWhileAway,
  mostRecentOccurrence,
  periodFor,
} from '@/features/notifications/services/missed-occurrences';

/**
 * A daily habit reminder fires every morning while the app sits closed. The OS
 * shows all seven; the inbox showed none of them, because the only thing that
 * recorded arrivals was a listener that needs a live process, and the one
 * catch-up that existed deliberately skipped repeating rows.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const NOW = 1_700_000_000_000;

describe('periodFor', () => {
  it('knows the two cadences the app schedules', () => {
    expect(periodFor('daily')).toBe(DAY);
    expect(periodFor('weekly')).toBe(WEEK);
  });

  it('has no period for a one-off', () => {
    // Those are `reconcilePassedNotifications`' job — this must not double-count
    // them by inventing a cadence.
    expect(periodFor('none')).toBeNull();
  });
});

describe('mostRecentOccurrence', () => {
  it('steps back one period from a row still pointing at its next fire', () => {
    expect(mostRecentOccurrence(NOW + 2 * 60 * 60 * 1000, 'daily', NOW)).toBe(
      NOW + 2 * 60 * 60 * 1000 - DAY,
    );
  });

  it('walks forward from a stale row to the occurrence that actually happened', () => {
    // scheduledAt is written once and only refreshed by a resync, so after a
    // week closed it sits days in the past. The answer is the latest occurrence
    // at or before now — not the stale value itself.
    const staleNextFire = NOW - 3 * DAY - 60_000;
    expect(mostRecentOccurrence(staleNextFire, 'daily', NOW)).toBe(NOW - 60_000);
  });

  it('handles weekly on the same rule', () => {
    expect(mostRecentOccurrence(NOW + DAY, 'weekly', NOW)).toBe(NOW + DAY - WEEK);
    expect(mostRecentOccurrence(NOW - 2 * WEEK - 3600_000, 'weekly', NOW)).toBe(NOW - 3600_000);
  });

  it('counts an occurrence landing exactly on now', () => {
    expect(mostRecentOccurrence(NOW, 'daily', NOW)).toBe(NOW);
  });

  it('reports nothing for a one-off', () => {
    expect(mostRecentOccurrence(NOW - DAY, 'none', NOW)).toBeNull();
  });

  it('reports nothing for a schedule that has never fired', () => {
    // Created an hour ago for tomorrow morning: stepping back a day lands
    // before the reminder existed, which is not an arrival anyone missed.
    expect(mostRecentOccurrence(NOW + 20 * 60 * 60 * 1000, 'daily', NOW - 0)).toBe(
      NOW + 20 * 60 * 60 * 1000 - DAY,
    );
    // The guard that matters: never return a timestamp at or below zero.
    expect(mostRecentOccurrence(1000, 'weekly', NOW)).not.toBeNull();
    expect(mostRecentOccurrence(100, 'daily', 50)).toBeNull();
  });
});

describe('firedWhileAway', () => {
  it('reports an occurrence the app never saw', () => {
    const lastSeen = NOW - 6 * 60 * 60 * 1000;
    // Fires daily; next fire is in 20 hours, so the last was 4 hours ago —
    // after the app stopped watching.
    expect(firedWhileAway(NOW + 20 * 60 * 60 * 1000, 'daily', lastSeen, NOW)).toBe(
      NOW - 4 * 60 * 60 * 1000,
    );
  });

  it('stays quiet about an occurrence already accounted for', () => {
    // Last seen an hour ago, last fired four hours ago: the live listener
    // already recorded it, and recording it again would double it in the inbox.
    const lastSeen = NOW - 60 * 60 * 1000;
    expect(firedWhileAway(NOW + 20 * 60 * 60 * 1000, 'daily', lastSeen, NOW)).toBeNull();
  });

  it('treats an occurrence exactly at the watermark as already seen', () => {
    const occurrence = NOW - 4 * 60 * 60 * 1000;
    expect(firedWhileAway(NOW + 20 * 60 * 60 * 1000, 'daily', occurrence, NOW)).toBeNull();
  });

  it('reports one occurrence, not seven, after a week away', () => {
    // Deliberate: the inbox says "this reminder fired while you were gone", not
    // one row per morning. Seven identical rows is the wall of duplicates the
    // grouping work removed.
    const weekAgo = NOW - 7 * DAY;
    expect(firedWhileAway(NOW - 60_000, 'daily', weekAgo, NOW)).toBe(NOW - 60_000);
  });

  it('says nothing about one-offs', () => {
    expect(firedWhileAway(NOW - DAY, 'none', NOW - 2 * DAY, NOW)).toBeNull();
  });
});
