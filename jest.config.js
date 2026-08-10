/** Jest config for unit tests. Uses the jest-expo preset so Expo/RN modules
 * (expo-localization, etc.) are transformed/mocked. Tests target pure logic
 * first — money, streaks, sync — where a bug silently corrupts user data. */

const preset = require('jest-expo/jest-preset');

module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.expo/'],
  /**
   * The deploy scripts are `.mjs`, which the preset's transform (`\.[jt]sx?$`)
   * does not match — so importing one from a test dies on `Cannot use import
   * statement outside a module`. Merged rather than replaced: setting
   * `transform` wholesale would drop the preset's asset handling and every
   * `import icon from './x.png'` in the app would start failing instead.
   *
   * This is what lets scripts/migration-plan.test.ts cover the logic that
   * decides which migrations run against production.
   */
  transform: {
    ...preset.transform,
    '^.+\\.mjs$': ['babel-jest', { caller: { name: 'metro', bundler: 'metro', platform: 'ios' } }],
  },
  moduleFileExtensions: [
    'mjs',
    ...(preset.moduleFileExtensions ?? ['js', 'json', 'jsx', 'ts', 'tsx', 'node']),
  ],
  /**
   * `lucide-react-native` ships untranspiled ESM, so importing the Hub registry
   * (which uses it for module icons) dies on `Unexpected token 'export'`.
   *
   * Stubbed rather than transformed. Allowlisting it works, but the package is
   * ~1,500 icon modules and babel takes ~45 seconds over them — on every run,
   * for glyph data no test inspects. The stub answers any icon name with an
   * inert component and costs nothing.
   */
  moduleNameMapper: {
    '^lucide-react-native$': '<rootDir>/test/lucide-stub.js',
  },
  /**
   * See test/async-storage-setup.js — without it, every test that touches a
   * persisted zustand store dies on import. Registered once here so a new store
   * test does not have to rediscover why it cannot import anything.
   */
  setupFiles: [...(preset.setupFiles ?? []), '<rootDir>/test/async-storage-setup.js'],
};
