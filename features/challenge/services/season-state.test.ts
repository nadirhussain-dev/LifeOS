import {
  canJoin,
  daysUntil,
  isRunning,
  operatorFix,
  seasonNotice,
  windowLabel,
  type SeasonStatus,
} from '@/features/challenge/services/season-state';

/**
 * The words both consoles quote.
 *
 * These are pure mappings, which is exactly why they are worth pinning: the
 * failure they replace was not a wrong calculation but two screens making
 * different ones, and the only defence against that returning is that there is
 * one mapping and it is fixed.
 */

const NOW = Date.parse('2026-08-18T12:00:00Z');

const status = (over: Partial<SeasonStatus> & Pick<SeasonStatus, 'state'>): SeasonStatus => ({
  name: 'Season One',
  ...over,
});

describe('canJoin', () => {
  it('is true only for an open season', () => {
    expect(canJoin('open')).toBe(true);
    for (const state of ['none', 'closed', 'upcoming', 'ended', 'notReady', 'full'] as const) {
      expect(canJoin(state)).toBe(false);
    }
  });
});

describe('isRunning', () => {
  it('counts a full season as running', () => {
    // The distinction that protects everybody already in it: "no room for a new
    // person" must never be rendered to two hundred existing runs as "stopped".
    expect(isRunning('full')).toBe(true);
    expect(isRunning('open')).toBe(true);
  });

  it('does not count a season that has been switched off or has ended', () => {
    expect(isRunning('closed')).toBe(false);
    expect(isRunning('ended')).toBe(false);
    expect(isRunning('notReady')).toBe(false);
  });
});

describe('daysUntil', () => {
  it('has no answer without a date', () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil(undefined, NOW)).toBeNull();
  });

  it('refuses to guess at an unparseable date', () => {
    expect(daysUntil('not a date', NOW)).toBeNull();
  });

  it('rounds up, so a date later today still reads as a day away', () => {
    expect(daysUntil('2026-08-18T23:00:00Z', NOW)).toBe(1);
  });

  it('goes negative once the date is past', () => {
    expect(daysUntil('2026-08-01T12:00:00Z', NOW)).toBe(-17);
  });
});

describe('seasonNotice', () => {
  it('names the season and counts down when it starts soon', () => {
    const notice = seasonNotice(
      status({ state: 'upcoming', startsAt: '2026-08-23T00:00:00Z' }),
      NOW,
    );
    expect(notice.bodyKey).toBe('challenge.stateUpcomingSoon');
    expect(notice.values).toEqual({ name: 'Season One', count: 5 });
    expect(notice.retryable).toBe(true);
  });

  it('gives the date instead of a countdown when it is far off', () => {
    // Past a fortnight "in 63 days" stops meaning anything and a date somebody
    // can put in a calendar starts meaning more.
    const notice = seasonNotice(
      status({ state: 'upcoming', startsAt: '2026-10-20T00:00:00Z' }),
      NOW,
    );
    expect(notice.bodyKey).toBe('challenge.stateUpcomingOn');
    expect(notice.dateIso).toBe('2026-10-20T00:00:00Z');
  });

  it('hands the date over unformatted, for the caller to localise', () => {
    // Formatting here would render a Gregorian English date inside an Urdu
    // screen. The component that knows the viewer's locale does it instead.
    const notice = seasonNotice(status({ state: 'ended', endsAt: '2026-08-01T00:00:00Z' }), NOW);
    expect(notice.dateIso).toBe('2026-08-01T00:00:00Z');
  });

  it('distinguishes the half-configured season from having no season at all', () => {
    // The distinction the old screen could not draw: both of these used to
    // render as "No season is open right now", so "wait two days" and "somebody
    // needs to finish this" were indistinguishable to everyone, staff included.
    expect(seasonNotice(status({ state: 'notReady' }), NOW).titleKey).toBe(
      'challenge.stateNotReadyTitle',
    );
    expect(seasonNotice(status({ state: 'none' }), NOW).titleKey).toBe('challenge.stateNoneTitle');
  });

  it('does not offer a retry for the one state that needs no retrying', () => {
    expect(seasonNotice(status({ state: 'open' }), NOW).retryable).toBe(false);
    expect(seasonNotice(status({ state: 'full' }), NOW).retryable).toBe(true);
  });

  it('never counts down past zero', () => {
    // A season whose end date slipped past before the settler caught up must
    // not tell anybody it has "-3 days left".
    const notice = seasonNotice(status({ state: 'open', endsAt: '2026-08-01T00:00:00Z' }), NOW);
    expect(notice.values.count).toBe(0);
  });

  it('says how long an open season runs when it has an end date', () => {
    const notice = seasonNotice(status({ state: 'open', endsAt: '2026-11-14T00:00:00Z' }), NOW);
    expect(notice.bodyKey).toBe('challenge.stateOpenUntil');
    expect(notice.values.count).toBe(88);
  });

  it('does not invent an end date for a season that has none', () => {
    expect(seasonNotice(status({ state: 'open' }), NOW).bodyKey).toBe('challenge.stateOpenBody');
  });
});

describe('operatorFix', () => {
  it('has nothing to say about a healthy season', () => {
    expect(operatorFix('open')).toBeNull();
  });

  it('points at a fix for every state a user is stuck on', () => {
    for (const state of ['notReady', 'closed', 'upcoming', 'ended', 'full'] as const) {
      expect(operatorFix(state)).toMatch(/^operator\./);
    }
  });
});

describe('windowLabel', () => {
  it('marks an unbounded end with a dash rather than inventing one', () => {
    expect(windowLabel('2026-08-16T00:00:00Z', null)).toBe('2026-08-16 → —');
  });

  it('survives a malformed timestamp instead of rendering "Invalid Date"', () => {
    expect(windowLabel('nonsense', null)).toBe('— → —');
  });
});
