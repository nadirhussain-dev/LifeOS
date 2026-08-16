import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadDbEnv, parseEnvFile } from './db-env.mjs';

/**
 * Where the migration runner's database URLs come from.
 *
 * The precedence rule is the part that matters: an exported variable or a CI
 * secret must always beat a file. Get that backwards and a stale `.env.db` on
 * somebody's laptop silently overrides the connection string CI was told to
 * use — which is a migration running against a database nobody chose.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'daykeep-dbenv-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, contents: string) => writeFileSync(join(dir, name), contents);

describe('parseEnvFile', () => {
  it('reads plain KEY=value lines', () => {
    const values = parseEnvFile('A=one\nB=two\n');
    expect(values.get('A')).toBe('one');
    expect(values.get('B')).toBe('two');
  });

  it('skips comments and blank lines', () => {
    const values = parseEnvFile('# a comment\n\n  \nA=one\n');
    expect(values.get('A')).toBe('one');
    expect(values.size).toBe(1);
  });

  it('keeps a # inside a value', () => {
    // A generated Postgres password contains punctuation. Treating an inline #
    // as a comment truncates it, and the resulting failure points at the
    // server ("password authentication failed") rather than at this parser.
    expect(parseEnvFile('PW=super#secret').get('PW')).toBe('super#secret');
  });

  it('strips surrounding quotes but not inner ones', () => {
    expect(parseEnvFile('A="quoted"').get('A')).toBe('quoted');
    expect(parseEnvFile("A='quoted'").get('A')).toBe('quoted');
    expect(parseEnvFile('A=say "hi"').get('A')).toBe('say "hi"');
  });

  it('accepts a pasted shell export line', () => {
    expect(
      parseEnvFile('export SUPABASE_DB_URL_STAGING=postgres://x').get('SUPABASE_DB_URL_STAGING'),
    ).toBe('postgres://x');
  });

  it('keeps = inside the value', () => {
    // Connection strings carry query parameters.
    expect(parseEnvFile('URL=postgres://h/db?sslmode=require').get('URL')).toBe(
      'postgres://h/db?sslmode=require',
    );
  });

  it('takes the first definition of a repeated key', () => {
    expect(parseEnvFile('A=first\nA=second').get('A')).toBe('first');
  });

  it('ignores lines with no =', () => {
    expect(parseEnvFile('nonsense\nA=one').size).toBe(1);
  });
});

describe('loadDbEnv', () => {
  it('fills both URLs from .env.db', () => {
    write(
      '.env.db',
      'SUPABASE_DB_URL_STAGING=postgres://s\nSUPABASE_DB_URL_PRODUCTION=postgres://p',
    );
    const env: Record<string, string | undefined> = {};

    const filled = loadDbEnv(env, dir);

    expect(env.SUPABASE_DB_URL_STAGING).toBe('postgres://s');
    expect(env.SUPABASE_DB_URL_PRODUCTION).toBe('postgres://p');
    expect(filled).toEqual([
      { key: 'SUPABASE_DB_URL_STAGING', file: '.env.db' },
      { key: 'SUPABASE_DB_URL_PRODUCTION', file: '.env.db' },
    ]);
  });

  it('never overrides a variable the environment already has', () => {
    // The CI case. A secret store injected the real URL; a file checked out
    // beside it must not be able to redirect the migration somewhere else.
    write('.env.db', 'SUPABASE_DB_URL_PRODUCTION=postgres://from-file');
    const env = { SUPABASE_DB_URL_PRODUCTION: 'postgres://from-ci' };

    const filled = loadDbEnv(env, dir);

    expect(env.SUPABASE_DB_URL_PRODUCTION).toBe('postgres://from-ci');
    expect(filled).toEqual([]);
  });

  it('treats a blank exported variable as unset', () => {
    write('.env.db', 'SUPABASE_DB_URL_STAGING=postgres://s');
    const env = { SUPABASE_DB_URL_STAGING: '   ' };

    loadDbEnv(env, dir);

    expect(env.SUPABASE_DB_URL_STAGING).toBe('postgres://s');
  });

  it('falls back to .env for keys .env.db does not define', () => {
    write('.env.db', 'SUPABASE_DB_URL_STAGING=postgres://s');
    write('.env', 'SUPABASE_DB_URL_PRODUCTION=postgres://p');
    const env: Record<string, string | undefined> = {};

    const filled = loadDbEnv(env, dir);

    expect(env.SUPABASE_DB_URL_STAGING).toBe('postgres://s');
    expect(env.SUPABASE_DB_URL_PRODUCTION).toBe('postgres://p');
    expect(filled.map((f) => f.file)).toEqual(['.env.db', '.env']);
  });

  it('prefers .env.db over .env for the same key', () => {
    write('.env.db', 'SUPABASE_DB_URL_STAGING=postgres://db-file');
    write('.env', 'SUPABASE_DB_URL_STAGING=postgres://env-file');
    const env: Record<string, string | undefined> = {};

    loadDbEnv(env, dir);

    expect(env.SUPABASE_DB_URL_STAGING).toBe('postgres://db-file');
  });

  it('takes only the two database keys, never anything else', () => {
    // An allow-list, so a `.env` full of EXPO_PUBLIC_* values cannot start
    // changing the behaviour of a script that connects to production.
    write('.env.db', 'SUPABASE_DB_URL_STAGING=postgres://s\nPGHOST=evil\nNODE_ENV=production');
    const env: Record<string, string | undefined> = {};

    loadDbEnv(env, dir);

    expect(env.PGHOST).toBeUndefined();
    expect(env.NODE_ENV).toBeUndefined();
  });

  it('does nothing when no file exists', () => {
    const env: Record<string, string | undefined> = {};
    expect(loadDbEnv(env, dir)).toEqual([]);
    expect(env.SUPABASE_DB_URL_STAGING).toBeUndefined();
  });

  it('ignores a key present but empty in the file', () => {
    // The state `.env.db.example` ships in, copied but not yet filled. The
    // caller's "not set" error is far more useful than an empty string
    // reaching pg as a connection string.
    write('.env.db', 'SUPABASE_DB_URL_STAGING=\nSUPABASE_DB_URL_PRODUCTION=   ');
    const env: Record<string, string | undefined> = {};

    expect(loadDbEnv(env, dir)).toEqual([]);
    expect(env.SUPABASE_DB_URL_STAGING).toBeUndefined();
  });
});
