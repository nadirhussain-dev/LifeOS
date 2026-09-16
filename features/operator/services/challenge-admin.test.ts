import { friendlyChallengeError, shiftedEnd } from '@/features/operator/services/challenge-admin';

/**
 * The two pure pieces of the challenge admin console, and the first tests
 * `features/operator` has had.
 *
 * `shiftedEnd` decides the date an operator sees before extending a live
 * season, so a wrong answer here is a wrong answer they have already approved.
 * Its anchor rule is the subtle part: a season with no end anchors on *now*, so
 * "extend by 30" means the same thing whether or not the season had a bound —
 * and a `Date.parse` that returns NaN has to fall back rather than propagate,
 * because `new Date(NaN).toISOString()` throws and would take the screen down
 * mid-edit.
 *
 * `friendlyChallengeError` translates the refusals that are decisions rather
 * than faults. The one that matters is "close it instead": a season people have
 * joined cannot be deleted, and an operator who reads a raw Postgres raise
 * instead of that sentence is likely to go looking for a way to force it.
 */

/** 15 June 2026, midday UTC. */
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

describe('shiftedEnd', () => {
  it('extends from the existing end date', () => {
    const result = shiftedEnd('2026-07-01T00:00:00.000Z', 30, NOW);

    expect(result).toBe('2026-07-31T00:00:00.000Z');
  });

  it('anchors on now when the season has no end at all', () => {
    // The documented rule: "extend by 30" means the same thing either way.
    const result = shiftedEnd(null, 30, NOW);

    expect(result).toBe(new Date(NOW + 30 * 86_400_000).toISOString());
  });

  it('shortens a season on a negative shift', () => {
    const result = shiftedEnd('2026-07-01T00:00:00.000Z', -10, NOW);

    expect(result).toBe('2026-06-21T00:00:00.000Z');
  });

  it('returns the anchor unchanged for a zero shift', () => {
    expect(shiftedEnd('2026-07-01T00:00:00.000Z', 0, NOW)).toBe('2026-07-01T00:00:00.000Z');
  });

  it('falls back to now rather than throwing on an unparseable end date', () => {
    // `new Date(NaN).toISOString()` throws a RangeError. On an operator screen
    // that is a crash in the middle of editing a live season, and the stored
    // value that caused it stays exactly as it was.
    const result = shiftedEnd('not a date', 7, NOW);

    expect(result).toBe(new Date(NOW + 7 * 86_400_000).toISOString());
  });

  it('returns a value ISO 8601 round-trips', () => {
    // Handed straight back to Postgres as a timestamptz.
    const result = shiftedEnd(null, 1, NOW);

    expect(Number.isNaN(Date.parse(result))).toBe(false);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(shiftedEnd('2026-12-20T00:00:00.000Z', 20, NOW)).toBe('2027-01-09T00:00:00.000Z');
  });
});

describe('friendlyChallengeError', () => {
  it('explains that a joined season is closed rather than deleted', () => {
    // The most consequential translation here: without it an operator reads a
    // raw raise and goes looking for a way to force the delete.
    const message = friendlyChallengeError(
      'ERROR: season has runs, close it instead of deleting it',
    );

    expect(message).toContain('cannot be deleted');
    expect(message).toContain('Close it instead');
  });

  it('distinguishes staff from full admin', () => {
    const message = friendlyChallengeError('permission denied: not an administrator');

    expect(message).toContain('full admin access');
  });

  it('tells the operator to refresh when the season is gone', () => {
    const message = friendlyChallengeError('no such season');

    expect(message).toContain('no longer exists');
  });

  it('points at the field limits for a constraint violation', () => {
    // Both spellings the server produces reach the same sentence.
    expect(friendlyChallengeError('new row violates check constraint "tier_days"')).toContain(
      'outside what the season allows',
    );
    expect(friendlyChallengeError('check constraint failed')).toContain(
      'outside what the season allows',
    );
  });

  it('is case-insensitive', () => {
    // Postgres raises arrive in mixed case, and the matcher lowercases first.
    expect(friendlyChallengeError('NOT AN ADMINISTRATOR')).toContain('full admin access');
    expect(friendlyChallengeError('No Such Season')).toContain('no longer exists');
  });

  it('matches on a substring, not the whole message', () => {
    // Real messages arrive wrapped in Postgres context lines.
    const message = friendlyChallengeError(
      'ERROR:  no such season (SQLSTATE P0002)\nCONTEXT:  PL/pgSQL function admin_delete_season',
    );

    expect(message).toContain('no longer exists');
  });

  it('passes an unrecognised message through unchanged', () => {
    // Better an unfamiliar sentence than a wrong reassuring one — an operator
    // can paste it into a search; a swallowed error leaves nothing to go on.
    const raw = 'connection terminated unexpectedly';

    expect(friendlyChallengeError(raw)).toBe(raw);
  });

  it('does not throw on an empty message', () => {
    expect(friendlyChallengeError('')).toBe('');
  });
});
