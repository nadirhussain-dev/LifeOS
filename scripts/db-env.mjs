/**
 * Where `SUPABASE_DB_URL_STAGING` / `SUPABASE_DB_URL_PRODUCTION` come from.
 *
 * The migration runner reads these from `process.env` and nothing else, which
 * is correct for CI — a secret store injects them and no file is involved — but
 * on a laptop it meant re-exporting two long connection strings in every new
 * shell. People stopped doing that and went back to pasting SQL into the
 * dashboard by hand, which is the exact failure mode scripts/migrate.mjs exists
 * to end.
 *
 * So: a file, read only to fill in what the environment has not already set.
 *
 * Precedence, highest first:
 *
 *   1. A real environment variable (shell export, CI secret) — always wins, so
 *      adding this loader cannot change what CI does.
 *   2. `.env.db`  — gitignored, the intended home for these two.
 *   3. `.env`     — read as a fallback because `.env.example` documents the
 *      keys there too, and somebody who put them in the file they already had
 *      should not get a "not set" error that names a file they have never seen.
 *
 * Note what is deliberately absent: no `EXPO_PUBLIC_` key is ever read here,
 * and nothing here runs inside Metro or app.config.js. This is a Node-only
 * path. A database URL carries the password for a role that bypasses row-level
 * security, and the one rule that keeps it out of an APK somebody can unzip is
 * that Metro only inlines `EXPO_PUBLIC_`-prefixed names.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Searched in order; the first file that defines a key wins it. */
export const SOURCES = ['.env.db', '.env'];

/** The only names this loader will take from a file. An allow-list rather than
 * "load everything": a `.env` full of `EXPO_PUBLIC_*` values has no business
 * reaching a script that connects to production, and quietly importing all of
 * it is how a stray `NODE_ENV` or `PGHOST` line starts changing behaviour from
 * a file nobody thought of as configuration for this. */
export const KEYS = ['SUPABASE_DB_URL_STAGING', 'SUPABASE_DB_URL_PRODUCTION'];

/**
 * A deliberately small dotenv parser: `KEY=value`, one per line.
 *
 * Supported because real connection strings need them:
 *  - a leading `export ` (people paste the line they had in their shell)
 *  - single or double quotes around the value, stripped
 *  - `#` inside an unquoted value, kept — a generated Postgres password
 *    contains punctuation, and treating `#` as a comment would silently
 *    truncate the password to something that fails to authenticate with a
 *    message pointing at the server rather than at this file
 *
 * Not supported, on purpose: `$VAR` interpolation, multi-line values, escape
 * sequences. Anything that needs them belongs in a shell export.
 */
export function parseEnvFile(text) {
  const values = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // A whole-line comment or a blank. Only `#` at the start counts.
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '')
      .trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
    }

    // First definition wins, matching the file-order precedence above.
    if (!values.has(key)) values.set(key, value);
  }

  return values;
}

/**
 * Fills any of KEYS that `env` does not already have, from the first SOURCES
 * file that defines them.
 *
 * Returns what it did so the caller can say so out loud. That matters more than
 * it looks: "which database did that actually run against" is the question you
 * ask *after* a migration has gone somewhere unexpected, and by then the shell
 * that would have answered it is gone.
 *
 * `root` is passed in rather than derived from `import.meta.url` because the
 * jest transform this repo uses targets Hermes, which has no `import.meta` —
 * and a loader that decides which database a migration reaches is worth being
 * able to test. migrate.mjs, which already resolves the repo root for the
 * migrations directory, hands it over.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} root repo root to resolve SOURCES against
 * @returns {{ key: string, file: string }[]} what was filled in, and from where
 */
export function loadDbEnv(env = process.env, root = process.cwd()) {
  const filled = [];

  for (const file of SOURCES) {
    const missing = KEYS.filter((key) => !(env[key] ?? '').trim());
    if (missing.length === 0) break;

    const path = join(root, file);
    if (!existsSync(path)) continue;

    let values;
    try {
      values = parseEnvFile(readFileSync(path, 'utf8'));
    } catch {
      // Unreadable is the same as absent. A permissions problem on `.env`
      // must not stop a run whose variables are already exported.
      continue;
    }

    for (const key of missing) {
      const value = (values.get(key) ?? '').trim();
      if (!value) continue;
      env[key] = value;
      filled.push({ key, file });
    }
  }

  return filled;
}
