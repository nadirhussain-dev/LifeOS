import { shouldCloseDay } from './use-day-closed';

/**
 * The day-closing moment, and the one property that makes it a moment.
 *
 * It has to fire on the *transition* and never on the state. "Everything is
 * done" stays true for the rest of the evening, so a celebration keyed off that
 * replays on every mount — and the best moment in the app becomes the thing
 * that glitches every time somebody opens the screen.
 *
 * That is invisible in a screenshot and would survive using the app once, which
 * is exactly why it is pinned here.
 *
 * Tested as a pure function rather than through the hook: `renderHook` from
 * `@testing-library/react-native` returns an empty object under this repo's
 * `jest-expo` preset — the library is installed but nothing had ever used it.
 * Rather than fight the harness for a wrapper around four lines, the decision
 * lives in a function and the hook is wiring.
 */

const base = {
  hydrated: true,
  enabled: true,
  complete: true,
  lastClosedDay: null as string | null,
  today: '2026-08-15',
};

describe('shouldCloseDay', () => {
  it('fires when the last module lands', () => {
    expect(shouldCloseDay(base)).toBe(true);
  });

  it('does not fire again for a day already closed', () => {
    // The state stays "complete" all evening. This is the assertion that stops
    // the moment replaying on every remount and cold start.
    expect(shouldCloseDay({ ...base, lastClosedDay: '2026-08-15' })).toBe(false);
  });

  it('fires again once the day has rolled over', () => {
    expect(shouldCloseDay({ ...base, lastClosedDay: '2026-08-14' })).toBe(true);
  });

  it('stays silent while the day is incomplete', () => {
    expect(shouldCloseDay({ ...base, complete: false })).toBe(false);
  });

  it('stays silent when nothing is committed to close', () => {
    expect(shouldCloseDay({ ...base, enabled: false })).toBe(false);
  });

  it('waits for hydration', () => {
    // Unhydrated, `lastClosedDay` is null even for a day closed hours ago —
    // firing here would celebrate this morning again at breakfast.
    expect(shouldCloseDay({ ...base, hydrated: false, lastClosedDay: null })).toBe(false);
  });

  it('is unmoved by a stale day from a previous run', () => {
    expect(shouldCloseDay({ ...base, lastClosedDay: '2020-01-01' })).toBe(true);
  });
});
