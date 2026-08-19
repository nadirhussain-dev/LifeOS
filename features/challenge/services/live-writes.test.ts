import { shouldAttest } from '@/features/challenge/services/live-writes';

/**
 * The gate in front of every attestation.
 *
 * Worth testing directly rather than through the caller because both of its
 * failure directions are silent and expensive. Too strict, and a real user's
 * writes are never witnessed and their streak quietly never counts. Too loose,
 * and the rule the whole of 0065 exists to enforce stops being enforced — a
 * background widget tap, or a write while signed out, would attest work the
 * user was not present for.
 */
describe('shouldAttest', () => {
  const base = {
    enrolled: true,
    signedIn: true,
    foreground: true,
    committed: ['habits', 'water'],
    module: 'habits',
    lastAt: undefined,
    now: 1_000_000,
  };

  it('attests a committed module written in the foreground by a signed-in member', () => {
    expect(shouldAttest(base)).toBe(true);
  });

  it('refuses when the app is not in the foreground', () => {
    // "Live on the app" means exactly that. A widget tap routes through drizzle
    // and is deliberately observed, but it must not be able to earn a day
    // without the app ever being opened.
    expect(shouldAttest({ ...base, foreground: false })).toBe(false);
  });

  it('refuses when nobody is signed in', () => {
    // The ledger is server-side and per account; there is nothing to attest to.
    expect(shouldAttest({ ...base, signedIn: false })).toBe(false);
  });

  it('refuses when the user is not in a run', () => {
    expect(shouldAttest({ ...base, enrolled: false })).toBe(false);
  });

  it('refuses a module the user never committed to', () => {
    // The server refuses it too. Checking here saves the round trip on every
    // write in every uncommitted module, which is most writes in the app.
    expect(shouldAttest({ ...base, module: 'budget' })).toBe(false);
  });

  it('throttles a second attestation inside the minimum gap', () => {
    expect(shouldAttest({ ...base, lastAt: base.now - 5_000 })).toBe(false);
  });

  it('allows one again once the gap has passed', () => {
    expect(shouldAttest({ ...base, lastAt: base.now - 20_000 })).toBe(true);
  });

  it('allows the first write of a module regardless of another module timing', () => {
    // The gate is per module, not global: logging water must not swallow the
    // attestation for habits thirty seconds later.
    expect(shouldAttest({ ...base, module: 'water', lastAt: undefined })).toBe(true);
  });
});
