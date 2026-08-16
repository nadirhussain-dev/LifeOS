import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * That a server-side secret never acquires a client-side prefix.
 *
 * `RESEND_API_KEY` sends mail as our domain and `EXPO_ACCESS_TOKEN` pushes to
 * our users. Both are read only by Deno inside Supabase's runtime. Metro
 * inlines every `EXPO_PUBLIC_*` name into the bundle, so prefixing either one —
 * or copying it into the app's `.env.example` where every name around it is
 * prefixed — puts it in an APK that anyone who installs the app can unzip.
 *
 * That mistake is silent in both directions: the build succeeds, and the
 * function keeps working because it reads its own environment regardless. This
 * is the only thing that would notice.
 */

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Assignments only — the surrounding prose explains the prefix rule at length
 *  and must stay free to name it. */
const assignedNames = (file: string) =>
  [...file.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);

/**
 * Every `Deno.env.get('X')` across the functions, minus the `SUPABASE_*` names
 * the runtime injects for free.
 *
 * Derived rather than listed. A hand-written list only covers the secrets
 * somebody remembered to add to it, and the failure it misses is the expensive
 * one: a function reads a secret nobody documented, so nobody sets it, and it
 * throws on a cold start in production rather than here.
 */
const secretsReadByFunctions = (): string[] => {
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) sources.push(readFileSync(path, 'utf8'));
    }
  };
  walk(join(ROOT, 'supabase', 'functions'));

  const names = new Set<string>();
  for (const source of sources) {
    // `optionalSecret` as well as the raw call: it is the wrapper in
    // functions/_shared/env.ts that treats "" as absent, and a secret read
    // through it is every bit as undocumented as one read directly. Matching
    // only `Deno.env.get` would mean the derivation quietly stopped covering a
    // function the moment it started using the safer accessor — the exact kind
    // of hole this whole file exists to prevent.
    const reads = /(?:Deno\.env\.get|optionalSecret)\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g;
    for (const match of withoutComments(source).matchAll(reads)) {
      if (!match[1].startsWith('SUPABASE_')) names.add(match[1]);
    }
  }
  return [...names].sort();
};

/**
 * Source with its comments removed, because this file greps for code and a
 * comment is not code.
 *
 * These functions are heavily commented, and the comments talk about the very
 * thing being matched — `_shared/env.ts` explains itself with a literal
 * `Deno.env.get('X')`. Scanned naively, that made "X" a secret the template
 * was required to document, and the only way to satisfy it would have been to
 * put a fake name in `.env.example`.
 *
 * Line comments are only stripped where `//` opens the line. A URL inside a
 * string contains `//` too, and eating from there to the end of the line would
 * delete real code on any line that holds both a URL and an env read.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');

/** Names read only by Deno. Defaults that a function falls back to are still
 *  listed in the template, so the derived set is the whole set. */
const EDGE_ONLY = secretsReadByFunctions();

/** Every deployable function — derived, so a new one is covered on the day it
 *  is added rather than whenever somebody remembers this file. */
const FUNCTION_DIRS = readdirSync(join(ROOT, 'supabase', 'functions'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== '_shared')
  .map((e) => e.name);

describe('supabase/.env.example', () => {
  const template = read('supabase/.env.example');
  const names = assignedNames(template);

  it('assigns nothing that Metro would inline into the bundle', () => {
    expect(names.filter((n) => n.startsWith('EXPO_PUBLIC_'))).toEqual([]);
  });

  /** The prefix is reserved: one such line makes the whole push fail, not just
   *  that line, which reads as "secrets are broken" rather than "remove this". */
  it('assigns no SUPABASE_ name, which the CLI rejects', () => {
    expect(names.filter((n) => n.startsWith('SUPABASE_'))).toEqual([]);
  });

  it('covers every secret the functions actually read', () => {
    for (const name of EDGE_ONLY) expect(names).toContain(name);
  });

  /** A template that ships a usable-looking key invites pushing it as-is. */
  it('ships placeholders, not values that could be mistaken for real', () => {
    expect(template).toContain('re_REPLACE_WITH_RESEND_API_KEY');
    expect(template).not.toMatch(/RESEND_API_KEY=re_[A-Za-z0-9]{16,}/);
  });
});

describe('the app env template', () => {
  const appTemplate = read('.env.example');

  it('does not assign any edge-only secret', () => {
    const names = assignedNames(appTemplate);
    for (const name of EDGE_ONLY) expect(names).not.toContain(name);
  });
});

describe('the functions themselves', () => {
  it.each(FUNCTION_DIRS)('%s reads no EXPO_PUBLIC_ name', (fn) => {
    const source = read(join('supabase', 'functions', fn, 'index.ts'));
    expect(source).not.toContain('EXPO_PUBLIC_');
  });

  it('_shared reads no EXPO_PUBLIC_ name either', () => {
    for (const file of readdirSync(join(ROOT, 'supabase', 'functions', '_shared'))) {
      if (!file.endsWith('.ts')) continue;
      expect(read(join('supabase', 'functions', '_shared', file))).not.toContain('EXPO_PUBLIC_');
    }
  });
});
