const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions are Deno edge functions (https:// / esm.sh imports,
    // Deno globals) — a different runtime that the Expo/Node eslint config
    // can't resolve and shouldn't lint.
    ignores: ['dist/*', 'supabase/functions/**'],
  },
  {
    /**
     * Icons come from the app's own barrel, never from lucide's.
     *
     * lucide-react-native's entry point re-exports all 1,748 icons it ships,
     * and Metro does not tree-shake — so a single import of it anywhere pulls
     * every one of them back into the bundle. That is 1.63 MB of Android
     * bytecode, measured, and it does not announce itself: the app builds, the
     * icon renders, and the only symptom is a bundle nobody re-measures.
     *
     * A rule rather than a note in a header, because the cost is paid by
     * whichever import lands first and is invisible to the person who writes
     * it. `components/ui/icons.ts` is the one file allowed to reach upstream —
     * see the override below — and the per-icon subpaths it uses are a
     * different specifier, so they are unaffected by this.
     */
    files: [
      'app/**/*.{ts,tsx}',
      'features/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
      'hooks/**/*.{ts,tsx}',
      'lib/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'lucide-react-native',
              message:
                "Import icons from '@/components/ui/icons' instead — importing lucide's barrel pulls all 1,748 icons into the bundle (~1.63 MB). Add the icon there with `npm run icons`.",
            },
          ],
        },
      ],
    },
  },
  {
    // The generated barrel is the one file that may reach upstream: it takes
    // each glyph from `lucide-react-native/icons/*` and re-exports the two
    // types, which have no per-icon module to come from.
    files: ['components/ui/icons.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
]);
