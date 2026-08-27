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
    /**
     * The same stub for the per-icon subpaths, which is how the app reaches
     * icons now: screens import `components/ui/icons.ts` (generated), and that
     * re-exports each glyph from `lucide-react-native/icons/<name>`.
     *
     * Needed because the pattern above is anchored, so a subpath fell straight
     * through to real resolution — and the `react-native` condition in the
     * package's exports map points at `dist/esm/icons/*.mjs`, untranspiled ESM
     * inside `node_modules`, which is `Cannot use import statement outside a
     * module`. Nineteen suites died on it the moment the call sites moved.
     *
     * Allowlisting the package in `transformIgnorePatterns` is the other fix
     * and still the wrong one, for the reason in test/lucide-stub.js: ~1,500
     * icon modules through babel is ~45s a run, for glyph data no test reads.
     * The stub's Proxy already answers `default`, which is the shape a per-icon
     * module has, so it serves both specifiers unchanged.
     */
    '^lucide-react-native/icons/.+$': '<rootDir>/test/lucide-stub.js',
    /**
     * The Deno edge functions import supabase-js by URL, which Jest cannot
     * resolve — so until this mapping existed they could not be tested at all,
     * and they are excluded from both tsconfig and eslint besides. That blind
     * spot is why the invite email survived the Daykeep rename still saying
     * "LifeOS". See test/supabase-js-stub.js.
     */
    '^https://esm\\.sh/@supabase/supabase-js@2$': '<rootDir>/test/supabase-js-stub.js',
    /**
     * The Safepay SDK, for the same reason and with the same consequence: the
     * two functions that decide whether anybody is on a paid plan could not be
     * executed by a test while this import was unresolvable. See
     * test/sfpy-node-sdk-stub.js.
     */
    '^https://esm\\.sh/@sfpy/node-sdk$': '<rootDir>/test/sfpy-node-sdk-stub.js',
  },
  /**
   * See test/async-storage-setup.js — without it, every test that touches a
   * persisted zustand store dies on import. Registered once here so a new store
   * test does not have to rediscover why it cannot import anything.
   */
  setupFiles: [...(preset.setupFiles ?? []), '<rootDir>/test/async-storage-setup.js'],
};
