import {
  applyContribution,
  canGoalReceiveContributions,
  habitLogContribution,
} from '@/features/goals/services/goal-contributions';

describe('canGoalReceiveContributions', () => {
  it('accepts count goals, whose scale is a fact the user named', () => {
    expect(canGoalReceiveContributions({ progressMode: 'count' })).toBe(true);
  });

  it('refuses percent goals rather than inventing a share of "get fit"', () => {
    expect(canGoalReceiveContributions({ progressMode: 'percent' })).toBe(false);
  });

  it('refuses milestone goals, which already have a mechanism for discrete work', () => {
    expect(canGoalReceiveContributions({ progressMode: 'milestones' })).toBe(false);
  });
});

describe('applyContribution', () => {
  it('adds the contribution', () => {
    expect(applyContribution({ currentValue: 12 }, 3)).toEqual({ value: 15, delta: 3 });
  });

  it('subtracts when work is undone', () => {
    expect(applyContribution({ currentValue: 12 }, -3)).toEqual({ value: 9, delta: -3 });
  });

  it('floors at zero and reports the delta it actually applied', () => {
    // The progress feed is the audit trail the chart is drawn from, so it must
    // record the change the goal made, not the one that was asked for.
    expect(applyContribution({ currentValue: 2 }, -5)).toEqual({ value: 0, delta: -2 });
  });

  it('does nothing at zero going down', () => {
    expect(applyContribution({ currentValue: 0 }, -1)).toEqual({ value: 0, delta: 0 });
  });

  it('ignores a zero or non-finite delta instead of writing an empty log row', () => {
    expect(applyContribution({ currentValue: 5 }, 0)).toEqual({ value: 5, delta: 0 });
    expect(applyContribution({ currentValue: 5 }, Number.NaN)).toEqual({ value: 5, delta: 0 });
  });
});

describe('habitLogContribution', () => {
  it('counts a boolean habit as one occurrence', () => {
    expect(habitLogContribution('boolean', null)).toBe(1);
  });

  it('counts a negative habit as one occurrence too', () => {
    expect(habitLogContribution('negative', 4)).toBe(1);
  });

  it('contributes what a measuring habit measured', () => {
    // "Run 100km" wants the kilometres, not the number of runs.
    expect(habitLogContribution('distance', 5)).toBe(5);
    expect(habitLogContribution('duration', 45)).toBe(45);
    expect(habitLogContribution('count', 12)).toBe(12);
  });

  it('falls back to one occurrence when a measuring habit logged nothing usable', () => {
    expect(habitLogContribution('count', null)).toBe(1);
    expect(habitLogContribution('count', 0)).toBe(1);
    expect(habitLogContribution('count', Number.NaN)).toBe(1);
  });
});
