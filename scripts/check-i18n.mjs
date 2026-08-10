#!/usr/bin/env node
/**
 * i18n consistency check.
 *
 * Three failures this catches, in descending order of how badly they show:
 *
 *   1. **A key used in code that no locale defines.** i18next renders the key
 *      path itself, so the user sees `settings.goalRemindrs` in the middle of a
 *      settings screen. Nothing in tsc, eslint or the bundler notices.
 *   2. **A key English has that another language does not.** i18next falls back
 *      to English, so an Arabic user gets an English sentence in the middle of
 *      an Arabic screen — which reads as a bug rather than a gap.
 *   3. **A key nothing uses.** Harmless at runtime, but it is what a locale file
 *      accumulates over a rewrite, and every one of them is something a
 *      translator will eventually be paid to translate for nobody.
 *
 * Only 1 and 2 fail the build. Unused keys are reported and forgiven, because
 * the detection cannot be perfect — see below.
 *
 * ## Dynamic keys
 *
 * Plenty of keys are reached through a variable: `t(area.labelKey)`, or a
 * template like `t(`weekdayInitials.${day}`)`. The literal never appears with
 * the key attached. Two mitigations:
 *
 *   - A scan for *any* string literal shaped like a key path, anywhere in the
 *     source — which catches `labelKey: 'focus.habits'` in a config file even
 *     though the `t()` call site only sees a variable.
 *   - Template literals contribute their static prefix as a namespace wildcard,
 *     so `` t(`weekdayInitials.${d}`) `` marks that whole namespace as used.
 *
 * That is enough to make the unused list short and mostly true, and it is why
 * that list only warns.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LOCALES_DIR = join(ROOT, 'lib', 'i18n', 'locales');
const BASE_LOCALE = 'en';
const SCAN_DIRS = ['app', 'components', 'features', 'hooks', 'lib'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);

/** i18next plural/context suffixes. `readyHabits_other` is the same key as
 *  `readyHabits` as far as a call site is concerned. */
const SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

function stripSuffix(key) {
  for (const suffix of SUFFIXES) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
}

function flatten(object, prefix = '') {
  const out = new Set();
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of flatten(value, path)) out.add(nested);
    } else {
      out.add(stripSuffix(path));
    }
  }
  return out;
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (SCAN_EXTENSIONS.has(extname(entry))) files.push(full);
  }
  return files;
}

// --- load locales ------------------------------------------------------------

const localeFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const locales = {};
for (const file of localeFiles) {
  const name = file.replace(/\.json$/, '');
  locales[name] = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8'));
}

const baseKeys = flatten(locales[BASE_LOCALE]);
const namespaces = new Set([...baseKeys].map((key) => key.split('.')[0]));

// --- scan source -------------------------------------------------------------

/** Any 'a.b' / "a.b" / `a.b` literal whose first segment is a known namespace. */
const LITERAL = /['"`]([a-zA-Z][\w]*(?:\.[\w]+)+)['"`]/g;
/**
 * The static head of a template literal, up to its first interpolation:
 * `` `auth.passwordProblem.${problem}` `` yields `auth.passwordProblem.`.
 *
 * Deliberately the whole head rather than just the namespace. Matching only the
 * first segment would mark every key under `auth` as used the moment one
 * template touched it, which quietly disables the unused check for that
 * namespace — the opposite of what this is for.
 */
const TEMPLATE_PREFIX = /`([a-zA-Z][\w]*(?:\.[\w]*)*\.?)\$\{/g;
/**
 * A key assembled by concatenation: `t('settings.import_' + reason)`. The
 * literal is a prefix, not a key, and reporting it as missing is noise — the
 * real keys are `settings.import_*` and they exist.
 */
const CONCAT_PREFIX = /['"]([a-zA-Z][\w]*(?:\.[\w]+)*[._])['"]\s*\+/g;

/**
 * Comments are stripped before scanning.
 *
 * This file's own prose mentions key paths, and so does a lot of the codebase —
 * `ensure-profile.ts` explains a trigger on `auth.users`, which is a Postgres
 * table and was being reported as a missing translation. A checker that cries
 * wolf about documentation gets switched off.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const usedKeys = new Set();
/** Static heads of template-literal keys. A defined key starting with one of
 *  these is reachable, even though its full path never appears in source. */
const dynamicPrefixes = new Set();

const files = SCAN_DIRS.flatMap((dir) => {
  try {
    return walk(join(ROOT, dir));
  } catch {
    return [];
  }
});

/** Literal prefixes that are concatenated into a key at runtime. Any defined
 *  key starting with one of these counts as used, and the prefix itself is not
 *  reported as missing. */
const concatPrefixes = new Set();

for (const file of files) {
  const source = stripComments(readFileSync(file, 'utf8'));
  for (const [, prefix] of source.matchAll(CONCAT_PREFIX)) concatPrefixes.add(prefix);
  for (const [, key] of source.matchAll(LITERAL)) {
    if (namespaces.has(key.split('.')[0])) usedKeys.add(stripSuffix(key));
  }
  for (const [, prefix] of source.matchAll(TEMPLATE_PREFIX)) {
    if (namespaces.has(prefix.split('.')[0])) dynamicPrefixes.add(prefix);
  }
}

const matchesDynamicPrefix = (key) => [...dynamicPrefixes].some((prefix) => key.startsWith(prefix));

const isConcatPrefix = (key) => [...concatPrefixes].some((prefix) => key === prefix);
const matchesConcatPrefix = (key) =>
  [...concatPrefixes].some((prefix) => key.startsWith(prefix) && key !== prefix);

// --- report ------------------------------------------------------------------

let failed = false;

const missing = [...usedKeys].filter((key) => !baseKeys.has(key) && !isConcatPrefix(key)).sort();
if (missing.length > 0) {
  failed = true;
  console.error(`\n✗ ${missing.length} key(s) used in code but absent from ${BASE_LOCALE}.json.`);
  console.error('  i18next renders the key path itself, so these show raw on screen:');
  for (const key of missing) console.error(`    ${key}`);
}

for (const [name, data] of Object.entries(locales)) {
  if (name === BASE_LOCALE) continue;
  const keys = flatten(data);
  const gaps = [...baseKeys].filter((key) => !keys.has(key)).sort();
  if (gaps.length > 0) {
    failed = true;
    console.error(`\n✗ ${name}.json is missing ${gaps.length} key(s) that ${BASE_LOCALE} has.`);
    console.error('  These fall back to English mid-sentence, which reads as a bug:');
    for (const key of gaps.slice(0, 40)) console.error(`    ${key}`);
    if (gaps.length > 40) console.error(`    …and ${gaps.length - 40} more`);
  }
}

const unused = [...baseKeys]
  .filter((key) => !usedKeys.has(key) && !matchesDynamicPrefix(key) && !matchesConcatPrefix(key))
  .sort();
if (unused.length > 0) {
  console.warn(`\n⚠ ${unused.length} key(s) appear unused (warning only — see the header note):`);
  for (const key of unused) console.warn(`    ${key}`);
}

if (!failed) {
  console.log(
    `\n✓ ${baseKeys.size} keys, ${Object.keys(locales).length} locales, no missing translations.`,
  );
}

process.exit(failed ? 1 : 0);
