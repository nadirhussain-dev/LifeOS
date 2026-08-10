import { filterByRole, roleGateHidesAny } from '@/features/private/config/private-modules';

/**
 * `filterByRole` is the whole of the role-gate: everything in
 * app/private/index.tsx and setup.tsx defers to it, so its edge cases are
 * worth pinning down directly rather than only through the screens.
 */
describe('filterByRole', () => {
  it('keeps universal modules for every gender, gated or not', () => {
    const ids = ['vault', 'intimacy', 'shared-albums'] as const;
    expect(filterByRole([...ids], 'female', false)).toEqual(ids);
    expect(filterByRole([...ids], 'male', false)).toEqual(ids);
    expect(filterByRole([...ids], null, false)).toEqual(ids);
  });

  it('hides cycle for a non-female account and recovery for a non-male one', () => {
    const ids = ['vault', 'cycle', 'recovery'] as const;
    expect(filterByRole([...ids], 'male', false)).toEqual(['vault', 'recovery']);
    expect(filterByRole([...ids], 'female', false)).toEqual(['vault', 'cycle']);
  });

  it('hides every gated module when gender is unset', () => {
    const ids = ['vault', 'cycle', 'recovery'] as const;
    expect(filterByRole([...ids], null, false)).toEqual(['vault']);
  });

  it('showAll bypasses the gate entirely, regardless of gender', () => {
    const ids = ['vault', 'cycle', 'recovery'] as const;
    expect(filterByRole([...ids], null, true)).toEqual(ids);
    expect(filterByRole([...ids], 'male', true)).toEqual(ids);
  });
});

describe('roleGateHidesAny', () => {
  it('is false when nothing in the list is gated away', () => {
    expect(roleGateHidesAny(['vault', 'cycle'], 'female')).toBe(false);
  });

  it('is true the moment the gate would drop something', () => {
    expect(roleGateHidesAny(['vault', 'cycle', 'recovery'], 'female')).toBe(true);
    expect(roleGateHidesAny(['cycle'], null)).toBe(true);
  });
});
