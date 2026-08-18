import { isSeasonLive, pickSeason, type SeasonRow } from '@/app/settings/operator/rewards';

/**
 * Which season the operator console reports on.
 *
 * Worth testing because every failure here is silent and reads as a working
 * screen. The numbers underneath are aggregates with no units and no
 * denominator: a zero from "reporting on a season that starts next month" looks
 * exactly like a zero from "the programme is not landing", and the second one
 * gets acted on.
 */

const NOW = Date.parse('2026-08-17T12:00:00Z');

const season = (over: Partial<SeasonRow> & { id: string }): SeasonRow => ({
  name: `Season ${over.id}`,
  enabled: true,
  starts_at: null,
  ends_at: null,
  ...over,
});

describe('isSeasonLive', () => {
  it('needs the season’s own switch, not just a date window', () => {
    // The trap this whole card exists for: `challenge_seasons.enabled` defaults
    // to false and is a different switch from the `rewards` module flag.
    expect(isSeasonLive(season({ id: 'a', enabled: false }), NOW)).toBe(false);
  });

  it('is live with the switch on and no window at all', () => {
    expect(isSeasonLive(season({ id: 'a' }), NOW)).toBe(true);
  });

  it('is not live before it starts', () => {
    expect(isSeasonLive(season({ id: 'a', starts_at: '2026-09-01T00:00:00Z' }), NOW)).toBe(false);
  });

  it('is not live after it ends', () => {
    expect(isSeasonLive(season({ id: 'a', ends_at: '2026-08-01T00:00:00Z' }), NOW)).toBe(false);
  });

  it('is live inside the window', () => {
    const row = season({
      id: 'a',
      starts_at: '2026-08-01T00:00:00Z',
      ends_at: '2026-09-01T00:00:00Z',
    });
    expect(isSeasonLive(row, NOW)).toBe(true);
  });
});

describe('pickSeason', () => {
  it('has nothing to report on when there are no seasons', () => {
    expect(pickSeason([], NOW)).toBeNull();
  });

  it('prefers the live season over a more recently created one', () => {
    // The bug: rows arrive newest-first, and `limit(1)` took the draft created
    // for next month while a season was actually running.
    const rows = [
      season({ id: 'draft', enabled: false }),
      season({ id: 'running', starts_at: '2026-08-01T00:00:00Z' }),
    ];
    expect(pickSeason(rows, NOW)?.id).toBe('running');
  });

  it('falls back to the newest when none is live', () => {
    // Still shown rather than hidden — it is the one being worked on, and the
    // card says it is closed so the zeros below are attributable.
    const rows = [
      season({ id: 'newest', enabled: false }),
      season({ id: 'older', enabled: false }),
    ];
    expect(pickSeason(rows, NOW)?.id).toBe('newest');
  });

  it('picks the first live season when several qualify', () => {
    const rows = [season({ id: 'newer' }), season({ id: 'older' })];
    expect(pickSeason(rows, NOW)?.id).toBe('newer');
  });
});
