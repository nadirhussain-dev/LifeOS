import {
  buildChecklist,
  daysToNextShield,
  daysToNextTier,
  demotionTarget,
  estimatedDailyMinutes,
  nextTier,
  outstandingModules,
  resolveShieldEarnDays,
  tierDayAt,
} from './challenge-math';
import type { ChallengeTier } from '@/features/challenge/types/challenge.types';

/**
 * The same ladder and the same fixtures as the SQL suite
 * (scripts/test-migrations.mjs, "streak challenge (0048)").
 *
 * That overlap is the point of this file. The server owns every decision, and
 * this module only draws the result — but two implementations of one rule drift
 * apart silently, and the drift shows up as a UI that promises a shield the
 * server never grants. Sharing the fixtures is what makes the drift loud.
 */
const LADDER: ChallengeTier[] = [
  [7, 'Spark'],
  [30, 'Ember'],
  [60, 'Flame'],
  [90, 'Blaze'],
  [120, 'Keystone'],
  [180, 'Half Year'],
  [240, 'Forge'],
  [300, 'Summit'],
  [365, 'Year One'],
].map(([dayThreshold, name]) => ({
  dayThreshold: dayThreshold as number,
  name: name as string,
  rewardKind: 'digital' as const,
  rewardTitle: null,
  rewardDescription: null,
}));

describe('the ladder', () => {
  it('stands on the highest rung passed, and on none before the first', () => {
    expect(tierDayAt(LADDER, 0)).toBe(0);
    expect(tierDayAt(LADDER, 6)).toBe(0);
    expect(tierDayAt(LADDER, 7)).toBe(7);
    expect(tierDayAt(LADDER, 93)).toBe(90);
    expect(tierDayAt(LADDER, 365)).toBe(365);
  });

  it('names the next rung, and stops naming one at the top', () => {
    expect(nextTier(LADDER, 0)?.dayThreshold).toBe(7);
    expect(nextTier(LADDER, 132)?.name).toBe('Half Year');
    expect(nextTier(LADDER, 365)).toBeNull();
  });

  it('counts down to the next rung rather than to the end', () => {
    expect(daysToNextTier(LADDER, 132)).toBe(48);
    expect(daysToNextTier(LADDER, 364)).toBe(1);
    expect(daysToNextTier(LADDER, 365)).toBeNull();
  });
});

describe('shields', () => {
  it('counts down to the next one on the interval', () => {
    expect(daysToNextShield(0, 30, 0, 3)).toBe(30);
    expect(daysToNextShield(18, 30, 1, 3)).toBe(12);
    expect(daysToNextShield(29, 30, 1, 3)).toBe(1);
  });

  it('starts the next interval immediately after one lands', () => {
    expect(daysToNextShield(30, 30, 1, 3)).toBe(30);
  });

  it('promises nothing once the buffer is full — the cap is hard', () => {
    expect(daysToNextShield(29, 30, 3, 3)).toBeNull();
  });
});

describe('what a miss would cost', () => {
  it('costs nothing at all while a shield is held', () => {
    expect(demotionTarget(LADDER, 93, 0, 45, 2)).toBe(93);
  });

  it('falls to the rung below on the first unshielded miss', () => {
    // Mirrors "0048 with no shield left, progress falls to the rung below".
    expect(demotionTarget(LADDER, 93, 0, 45, 0)).toBe(90);
  });

  it('steps one rung further on a second miss inside the window', () => {
    // Mirrors "0048 a second miss inside the window drops one rung further":
    // 60 is below 65, and the second miss steps past it to 30.
    expect(demotionTarget(LADDER, 65, 1, 45, 0)).toBe(30);
  });

  it('caps the fall at the top of the ladder, where the rungs are far apart', () => {
    // Mirrors "0048 the demotion cap bites at the top of the ladder": the rung
    // below 364 is 300, a fall of 64, held to 45.
    expect(demotionTarget(LADDER, 364, 0, 45, 0)).toBe(319);
  });

  it('never falls below zero', () => {
    expect(demotionTarget(LADDER, 3, 5, 45, 0)).toBe(0);
  });
});

describe('the shield interval a selection earns', () => {
  it('is the base rate for the bare minimum', () => {
    expect(resolveShieldEarnDays(30, 20, 0, false)).toBe(30);
  });

  it('improves with each extra module, then levels off', () => {
    expect(resolveShieldEarnDays(30, 20, 1, false)).toBe(27);
    expect(resolveShieldEarnDays(30, 20, 2, false)).toBe(25);
    expect(resolveShieldEarnDays(30, 20, 5, false)).toBe(25);
  });

  it('stacks with the annual plan, clamped at the floor', () => {
    // Mirrors "0048 extras and the annual plan stack down to the shield floor".
    expect(resolveShieldEarnDays(30, 20, 2, true)).toBe(20);
    expect(resolveShieldEarnDays(30, 20, 5, true)).toBe(20);
  });

  it('never lets a perk take the interval below the floor', () => {
    expect(resolveShieldEarnDays(22, 20, 2, true)).toBe(20);
  });
});

describe("today's checklist", () => {
  const required = ['habits', 'water', 'journal'];

  it('ticks only what has cleared the write threshold', () => {
    const list = buildChecklist(required, { habits: 2, water: 5 }, 1);
    expect(list.map((i) => i.done)).toEqual([true, true, false]);
    expect(list[2]).toEqual({
      moduleId: 'journal',
      writes: 0,
      done: false,
      // The live-rule fields (0065) default to the pre-rule world, so a caller
      // that passes neither gets exactly the old behaviour back.
      attested: false,
      liveRequired: false,
      counts: false,
    });
  });

  it('respects a threshold above one', () => {
    expect(buildChecklist(required, { habits: 1 }, 2)[0].done).toBe(false);
  });

  it('names what is outstanding, which is what the reminder quotes', () => {
    // Mirrors "0048 two of three modules writes nothing and names what is
    // outstanding".
    expect(outstandingModules(required, { habits: 2, water: 5 }, 1)).toEqual(['journal']);
  });

  it('is empty once the day is done', () => {
    expect(outstandingModules(required, { habits: 1, water: 1, journal: 1 }, 1)).toEqual([]);
  });

  it('ignores modules that were never committed to', () => {
    // An extra module going untouched must never cost the day, so it does not
    // appear here at all.
    expect(outstandingModules(required, { habits: 1, water: 1, journal: 1, tasks: 0 }, 1)).toEqual(
      [],
    );
  });
});

describe('what a selection costs per day', () => {
  const estimates = { habits: 30, water: 20, journal: 60, study: 900, sleep: 60, budget: 180 };

  it('sums the estimates the picker quotes', () => {
    expect(estimatedDailyMinutes(['habits', 'water', 'journal'], estimates)).toBe(2);
  });

  it('makes an expensive selection visibly expensive before anyone commits', () => {
    expect(estimatedDailyMinutes(['study', 'sleep', 'budget'], estimates)).toBe(19);
  });

  it('never rounds a real commitment down to nothing', () => {
    expect(estimatedDailyMinutes(['water'], estimates)).toBe(1);
  });
});

/**
 * The live-write rule (migration 0065), from the display side.
 *
 * The property worth pinning is the *divergence*: `done` and `counts` have to
 * be the same field when the rule is off and different fields when it is on.
 * A regression that collapsed them would be invisible in every other test here
 * — the checklist would look right, the ticks would land, and the day would
 * silently fail on the server.
 */
describe('the live-write rule', () => {
  const required = ['habits', 'water', 'journal'];
  const allDone = { habits: 1, water: 1, journal: 1 };

  it('counts local writes when the season does not require live ones', () => {
    const list = buildChecklist(required, allDone, 1, [], false);
    expect(list.every((i) => i.counts)).toBe(true);
    expect(outstandingModules(required, allDone, 1, [], false)).toEqual([]);
  });

  it('does not count a locally-finished module the server never witnessed', () => {
    const list = buildChecklist(required, allDone, 1, [], true);
    // Done on this phone, and counting for nothing — the exact state a user
    // who worked through the evening offline is in.
    expect(list.every((i) => i.done)).toBe(true);
    expect(list.every((i) => i.counts)).toBe(false);
  });

  it('names the offline modules as outstanding, so the nudge tells the truth', () => {
    expect(outstandingModules(required, allDone, 1, ['habits'], true)).toEqual([
      'water',
      'journal',
    ]);
  });

  it('counts only what was attested, whatever the local buffer says', () => {
    const list = buildChecklist(required, { habits: 9, water: 0, journal: 0 }, 1, ['water'], true);
    const byId = Object.fromEntries(list.map((i) => [i.moduleId, i]));
    // Nine local writes and no attestation loses to zero local writes and one
    // attestation, which is the whole rule in one assertion.
    expect(byId.habits.counts).toBe(false);
    expect(byId.water.counts).toBe(true);
  });

  it('treats an attestation below the write threshold as not done', () => {
    // The caller filters by `minWrites` before passing `attested` (see
    // `useChallengeLiveToday`), so an attested module is only listed once it
    // has cleared the bar — this pins that `counts` does not quietly re-admit
    // it through the local buffer.
    const list = buildChecklist(required, { habits: 5 }, 3, [], true);
    expect(list[0].done).toBe(true);
    expect(list[0].counts).toBe(false);
  });
});
