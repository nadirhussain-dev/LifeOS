/**
 * Regenerates components/ui/icons.ts — the app's own icon barrel.
 *
 * `npm run icons`
 *
 * ---------------------------------------------------------------------------
 * Why the app has a barrel of its own
 * ---------------------------------------------------------------------------
 * `lucide-react-native`'s entry point re-exports every icon it ships — 1,748 of
 * them, eagerly, in one module. Metro does not tree-shake by default (Expo's
 * tree-shaking is still behind `EXPO_UNSTABLE_TREE_SHAKING`), so a single
 * `import { Plus } from 'lucide-react-native'` anywhere in the app pulls all
 * 1,748 into the bundle and registers all 1,748 as modules at startup. The app
 * draws 190 of them.
 *
 * Measured on `expo export --platform android`, barrel vs. this file:
 *
 *     barrel:       14,750,195 bytes
 *     deep imports: 13,032,994 bytes
 *     saved:         1,717,201 bytes  (1.63 MB, 11.6% of the bundle)
 *
 * The icons are reached through `lucide-react-native/icons/*`, which is a
 * documented export subpath in the package's own `exports` map — not a reach
 * into `dist/`, so it survives the package's internal layout changing.
 *
 * ---------------------------------------------------------------------------
 * Why this is generated rather than hand-written
 * ---------------------------------------------------------------------------
 * The file is a list of 190 names that has to stay in step with what the app
 * actually imports, and the failure mode of doing that by hand is a build
 * error at the call site — annoying, but the *other* direction is the real
 * problem: an icon that stops being used stays in the barrel forever and
 * nothing points at it. Regenerating is how the list shrinks.
 *
 * The name → module mapping is read out of the installed package rather than
 * derived from the name, because lucide's file names are not a transform of its
 * export names. Roughly 20 of the ones this app uses are legacy aliases:
 * `AlertCircle` lives in `circle-alert.mjs`, `Waves` in `waves-horizontal.mjs`,
 * `Trash2` in `trash-2.mjs`. Kebab-casing the export name gets those wrong, and
 * gets them wrong *silently* if the resulting path happens to exist.
 *
 * ---------------------------------------------------------------------------
 * Keeping it honest
 * ---------------------------------------------------------------------------
 * `--check` re-derives the file and exits non-zero if what is on disk differs,
 * so CI catches a barrel that drifted from its call sites. eslint's
 * `no-restricted-imports` separately bans importing the upstream barrel, which
 * is what stops the 1.63 MB coming back one import at a time.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT = join(ROOT, 'components/ui/icons.ts');
const UPSTREAM = join(ROOT, 'node_modules/lucide-react-native/dist/esm/lucide-react-native.mjs');

/** Where the app's own code lives. `scripts/` and `test/` are excluded on
 *  purpose — nothing there renders. */
const SOURCE_DIRS = ['app', 'features', 'components', 'hooks', 'lib'];

/** Type-only exports, which are erased before Metro sees them and so cost
 *  nothing. Re-exported from the upstream barrel because there is no per-icon
 *  module to take them from. */
const TYPE_EXPORTS = ['LucideIcon', 'LucideProps'];

const check = process.argv.includes('--check');

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/**
 * Every icon the app imports, from either specifier.
 *
 * Both are matched so this is runnable before, during and after the migration
 * that introduced it — mid-migration the two coexist, and a generator that only
 * understood the destination would emit a barrel missing every icon that had
 * not been moved yet.
 */
function usedIcons(files) {
  const used = new Set();
  const pattern =
    /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"](?:lucide-react-native|@\/components\/ui\/icons)['"]/gs;

  for (const file of files) {
    const code = readFileSync(join(ROOT, file), 'utf8');
    for (const match of code.matchAll(pattern)) {
      for (const specifier of match[1].split(',')) {
        // `Link as LinkIcon` imports `Link`; `type LucideIcon` is not an icon.
        const name = specifier
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim();
        if (name && !TYPE_EXPORTS.includes(name)) used.add(name);
      }
    }
  }
  return used;
}

/** Export name → the icon module that actually holds it, read from the
 *  installed barrel's own `export { default as X } from './icons/y.mjs'` lines. */
function upstreamMap() {
  const map = new Map();
  for (const line of readFileSync(UPSTREAM, 'utf8').split('\n')) {
    const match = /^export \{(.*)\} from ['"]\.\/icons\/(.*?)\.mjs['"];?$/.exec(line);
    if (!match) continue;
    for (const specifier of match[1].split(',')) {
      const name = /default as (\w+)/.exec(specifier);
      if (name) map.set(name[1], match[2]);
    }
  }
  return map;
}

const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(dir)).filter(
  (file) => file !== 'components/ui/icons.ts',
);
const used = usedIcons(files);
const map = upstreamMap();

if (map.size === 0) {
  console.error(`\nNo icon exports found in ${UPSTREAM}.`);
  console.error('The package layout changed — this script needs updating.\n');
  process.exit(1);
}

const missing = [...used].filter((name) => !map.has(name)).sort();
if (missing.length > 0) {
  console.error(`\n${missing.length} imported icon(s) do not exist in lucide-react-native:\n`);
  for (const name of missing) console.error(`  - ${name}`);
  console.error('\nCheck the spelling, or the icon was renamed upstream.\n');
  process.exit(1);
}

const names = [...used].sort();
const body = [
  '// GENERATED by scripts/gen-icon-barrel.mjs — do not edit by hand.',
  '// Run `npm run icons` after adding or removing an icon import.',
  '//',
  "// Every icon the app draws, imported from lucide's per-icon modules instead of",
  '// its 1,748-icon entry point. Metro does not tree-shake, so importing the',
  '// upstream barrel anywhere pulls all of them into the bundle — 1.63 MB of',
  '// Android bytecode measured. See the script header for the numbers and for why',
  '// the name → module mapping cannot be derived from the name.',
  '',
  ...names.map(
    (name) => `export { default as ${name} } from 'lucide-react-native/icons/${map.get(name)}';`,
  ),
  '',
  `export type { ${TYPE_EXPORTS.join(', ')} } from 'lucide-react-native';`,
  '',
].join('\n');

if (check) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    console.error('\ncomponents/ui/icons.ts is missing. Run `npm run icons`.\n');
    process.exit(1);
  }
  if (current !== body) {
    console.error('\ncomponents/ui/icons.ts is out of date with the app’s icon imports.');
    console.error('Run `npm run icons` and commit the result.\n');
    process.exit(1);
  }
  console.log(`components/ui/icons.ts is up to date — ${names.length} icons.`);
} else {
  writeFileSync(OUT, body);
  console.log(
    `Wrote components/ui/icons.ts — ${names.length} icons, from ${files.length} source files.`,
  );
}
