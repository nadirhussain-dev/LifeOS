import { pickSeason } from '@/app/settings/operator/rewards';
import type { SeasonState } from '@/features/challenge/services/season-state';
import type { AdminSeason } from '@/features/operator/services/challenge-admin';

/**
 * Which season the operator console reports on.
 *
 * Worth testing because every failure here is silent and reads as a working
 * screen. The numbers underneath are aggregates with no units and no
 * denominator: a zero from "reporting on a season that starts next month" looks
 * exactly like a zero from "the programme is not landing", and the second one
 * gets acted on.
 *
 * What is deliberately *not* tested here any more is whether a season is live.
 * That used to be a client-side derivation from `enabled` and two dates, and
 * the app derived the same fact from a different column — so both were tested,
 * both passed, and they disagreed in production. The word now comes from
 * `challenge_season_state()` and is covered against a real Postgres in
 * scripts/test-migrations.mjs.
 */

const season = (id: string, state: SeasonState): AdminSeason => ({
  id,
  name: `Season ${id}`,
  enabled: state !== 'closed',
  state,
  startsAt: null,
  endsAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  maxEnrollments: null,
  dayGraceHours: 0,
  minActiveSeconds: 30,
  minWrites: 1,
  requiredModules: 3,
  moduleLockDays: 30,
  moduleSwapsAllowed: 2,
  shieldEarnDays: 30,
  shieldFloorDays: 20,
  shieldCap: 3,
  maxDemotionDays: 45,
  termsUrl: null,
  eligibleModules: 8,
  tierCount: 9,
  enrolledCount: 0,
  activeCount: 0,
});

describe('pickSeason', () => {
  it('has nothing to report on when there are no seasons', () => {
    expect(pickSeason([])).toBeNull();
  });

  it('prefers the running season over a more recently created draft', () => {
    // The original bug: rows arrive newest-first and `limit(1)` took the draft
    // created for next month while a season was actually running.
    const rows = [season('draft', 'closed'), season('running', 'open')];
    expect(pickSeason(rows)?.id).toBe('running');
  });

  it('reports on the unjoinable season rather than a closed one', () => {
    // `notReady` is the state staging sat in for weeks. It is the one an
    // operator most needs pointed at, so it must outrank a tidy closed draft —
    // the alternative is the console quietly reporting on the wrong row while
    // the broken one is the reason they opened the screen.
    const rows = [season('draft', 'closed'), season('half-built', 'notReady')];
    expect(pickSeason(rows)?.id).toBe('half-built');
  });

  it('prefers a full season to one that has not started', () => {
    const rows = [season('next', 'upcoming'), season('full', 'full')];
    expect(pickSeason(rows)?.id).toBe('full');
  });

  it('falls back to the newest when none is running', () => {
    // Still shown rather than hidden — it is the one being worked on, and the
    // card says what it is doing, so the zeros below are attributable.
    const rows = [season('newest', 'closed'), season('older', 'closed')];
    expect(pickSeason(rows)?.id).toBe('newest');
  });

  it('keeps arrival order among equals, so the newest live season wins', () => {
    const rows = [season('newer', 'open'), season('older', 'open')];
    expect(pickSeason(rows)?.id).toBe('newer');
  });
});
