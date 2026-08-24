/**
 * Reproduction probe: importing the challenge route module graph mirrors what
 * happens when the user taps the Hub tile — the route is loaded on demand.
 * An import-time throw (circular binding, native autolinking) surfaces here.
 */
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('challenge route loads', () => {
  it('imports without throwing', () => {
    let mod: unknown;
    expect(() => {
      mod = require('@/app/challenge');
    }).not.toThrow();
    expect(mod).toBeDefined();
  });
});
