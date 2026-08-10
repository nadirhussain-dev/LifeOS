/* global jest */
/**
 * Registers AsyncStorage's in-memory test double.
 *
 * Without this, AsyncStorage's native module is null under Jest and the package
 * *throws on import* rather than degrading — so any test that reached a zustand
 * store using `persist` died at its first import line, which rules out most of
 * the app's state. The package ships the double; nothing had ever pointed Jest
 * at it.
 *
 * Note that the shipped file is only the implementation — it does not register
 * itself. Listing it in `setupFiles` directly looks like it works and does
 * nothing at all, which is worth knowing before someone deletes this wrapper as
 * redundant.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
