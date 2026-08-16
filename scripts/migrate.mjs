#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql to a real database.
 *
 * Until now these files were pasted into the Supabase SQL editor by hand, in
 * filename order, by somebody remembering which ones they had already run.
 * That works exactly until it doesn't: the failure mode is a half-applied
 * migration on production at the moment you are least able to think clearly.
 *
 * What this gives you instead:
 *
 *  - **A ledger.** `public.schema_migrations` records every file applied, when,
 *    and by whom. Running twice is a no-op rather than a set of errors you have
 *    to read carefully to confirm are harmless.
 *  - **Checksums.** A migration that has already been applied and has since
 *    been *edited* is refused. Editing an applied migration means staging and
 *    production silently disagree about what the schema is, and nothing else
 *    would ever tell you.
 *  - **One at a time.** A session-level advisory lock, so two people deploying
 *    at once queue instead of interleaving.
 *  - **All or nothing, per file.** Each migration runs inside a transaction
 *    with its own ledger row, so a failure leaves that file unapplied rather
 *    than half-applied. (Postgres has transactional DDL; this is the one real
 *    advantage it has over most databases and it is worth using.)
 *  - **Production says its name.** `--env production` refuses to proceed unless
 *    you also pass `--yes`, and prints what it is about to do first.
 *  - **A reset that cannot reach production.** `--reset` drops `public` and
 *    re-applies every migration from 0001, which is the fastest way to find out
 *    whether the whole stack still builds from nothing. It runs against staging
 *    and only staging: no flag widens it, and it checks the URL as well as the
 *    name, because the name is just a label on an environment variable.
 *
 * Usage:
 *   npm run migrate:status                    # what's applied where
 *   npm run migrate -- --env staging          # apply everything pending
 *   npm run migrate -- --env staging --dry-run
 *   npm run migrate -- --env production --yes
 *   npm run migrate -- --env staging --to 0016_full_sync_coverage.sql
 *   npm run migrate:reset                     # staging only: drop it all, re-apply from 0001
 *
 * Connection strings come from the environment:
 *   SUPABASE_DB_URL_STAGING     postgres://...
 *   SUPABASE_DB_URL_PRODUCTION  postgres://...
 *
 * A shell export or a CI secret always wins; failing that they are read from
 * the gitignored `.env.db` (see scripts/db-env.mjs for the precedence and for
 * why these two names must never gain an `EXPO_PUBLIC_` prefix).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { loadDbEnv } from './db-env.mjs';
import { assertResettable, checksum, findOrphans, plan } from './migration-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/**
 * Both environments: the variable each one's URL comes from, and a reader for
 * it.
 *
 * The reader is a closure over a *static* `process.env.X` rather than
 * `process.env[name]`, because `expo/no-dynamic-env-var` forbids the dynamic
 * form — and for a good reason that applies here too: Expo's bundler rewrites
 * `process.env.EXPO_PUBLIC_*` by literal match at build time, so an indexed
 * access silently reads nothing in any bundled context. This script is Node-only
 * and would have been fine, but keeping one rule for the whole repo is worth
 * more than saving a line here.
 */
const ENVIRONMENTS = {
  staging: {
    variable: 'SUPABASE_DB_URL_STAGING',
    read: () => process.env.SUPABASE_DB_URL_STAGING,
  },
  production: {
    variable: 'SUPABASE_DB_URL_PRODUCTION',
    read: () => process.env.SUPABASE_DB_URL_PRODUCTION,
  },
};

/** Arbitrary but fixed: two runs must pick the same number to queue behind each
 * other. Derived from the string so it is reproducible and collision-unlikely
 * against any other advisory lock the database uses. */
const LOCK_ID = 0x1_1fe_05; // "daykeep"

const LEDGER = `
  create table if not exists public.schema_migrations (
    filename    text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now(),
    applied_by  text
  );
`;

/**
 * A reset is a drop and a rebuild of `public`, plus the privileges Supabase
 * creates that schema with.
 *
 * `cascade` reaches outside the schema, which is the point: 0001's
 * `on_auth_user_created` trigger lives on `auth.users` and depends on
 * `public.handle_new_user()`, so it goes when the function does — and 0001 can
 * then create it again. Without cascade the drop simply refuses.
 *
 * The grants matter as much as the drop. PostgREST reaches everything as
 * `anon` / `authenticated` / `service_role`, and a freshly created `public`
 * grants them nothing at all. Skip this and you get a database that is
 * structurally perfect and completely unreachable: every request from the app
 * fails with "permission denied for schema public", and nothing in that message
 * points back at this command.
 *
 * `alter default privileges` rather than `grant on all tables`, because at this
 * moment there are no tables — the ones that matter are created by the
 * migrations that run next.
 *
 * Two deliberate departures from Supabase's own template: it grants `create` on
 * `public` to `anon` and `authenticated` as well, which is a quirk worth not
 * reproducing, and roles are granted only if they exist, so this also works
 * against a plain Postgres that has never heard of Supabase.
 *
 * The ledger is inside `public` and goes with it, which is what makes the
 * re-apply that follows a full one rather than a no-op.
 */
const RESET = `
  drop schema if exists public cascade;
  create schema public;

  do $do$
  declare
    role_name text;
  begin
    foreach role_name in array array['postgres', 'anon', 'authenticated', 'service_role'] loop
      if not exists (select 1 from pg_roles where rolname = role_name) then
        continue;
      end if;
      execute format('grant usage on schema public to %I', role_name);
      if role_name in ('postgres', 'service_role') then
        execute format('grant create on schema public to %I', role_name);
      end if;
      execute format(
        'alter default privileges in schema public grant all on tables to %I', role_name);
      execute format(
        'alter default privileges in schema public grant all on sequences to %I', role_name);
      execute format(
        'alter default privileges in schema public grant all on functions to %I', role_name);
    end loop;
  end $do$;
`;

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { env: null, dryRun: false, yes: false, to: null, status: false, reset: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env') args.env = argv[++i];
    else if (arg === '--to') args.to = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--yes' || arg === '-y') args.yes = true;
    else if (arg === '--status') args.status = true;
    else if (arg === '--reset') args.reset = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

/** Every migration on disk, in the order they must be applied. */
function onDisk() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(MIGRATIONS, filename), 'utf8');
      return { filename, sql, checksum: checksum(sql) };
    });
}

function connectionString(environment) {
  const target = ENVIRONMENTS[environment];
  if (!target) {
    throw new Error(
      `unknown environment "${environment}" — expected one of: ${Object.keys(ENVIRONMENTS).join(', ')}`,
    );
  }
  const url = target.read();
  if (!url) {
    throw new Error(
      `${target.variable} is not set.\n` +
        `  Supabase → Project Settings → Database → Connection string (URI).\n` +
        `  Use the session pooler (port 5432), not the transaction pooler (6543).\n` +
        `  Put it in .env.db (gitignored, see .env.db.example), or export it in your shell.\n` +
        `  Never rename it to EXPO_PUBLIC_* — that is what would inline it into the app bundle.`,
    );
  }
  return url;
}

async function connect(environment) {
  const client = new pg.Client({
    connectionString: connectionString(environment),
    // Supabase terminates TLS with a certificate chain Node does not trust by
    // default. The connection is still encrypted; what is skipped is the
    // authenticity check, which is why the host must come from an environment
    // variable you control rather than from anything user-supplied.
    ssl: { rejectUnauthorized: false },
    application_name: 'daykeep-migrate',
  });
  await client.connect();
  return client;
}

/** What the database says it has, keyed by filename. */
async function applied(client) {
  await client.query(LEDGER);
  const { rows } = await client.query(
    `select filename, checksum, applied_at from public.schema_migrations`,
  );
  return new Map(rows.map((row) => [row.filename, row]));
}

/** Turns a refused plan into the message a person needs to act on. */
function explain(result) {
  if (result.reason === 'drift') {
    return (
      `these migrations were edited after they were applied:\n` +
      result.drift.map((f) => `  - ${f.filename}`).join('\n') +
      `\n\nAn applied migration is history and cannot be rewritten: this database has\n` +
      `already run the old text, and re-running the new text is not the same thing.\n` +
      `Most of these files are \`create ... if not exists\`, so a re-run would often\n` +
      `succeed while changing nothing — which looks like success and is not.\n\n` +
      `Put the change in a NEW migration. (If the edit was only to a comment and you\n` +
      `are certain, update the checksum in public.schema_migrations by hand.)`
    );
  }
  if (result.reason === 'unknown-target') {
    return `--to ${result.target}: no migration by that name`;
  }
  return `refused: ${result.reason}`;
}

async function showStatus() {
  const files = onDisk();
  for (const [environment, target] of Object.entries(ENVIRONMENTS)) {
    console.log(`\n${environment}`);
    if (!target.read()) {
      console.log(`  ${target.variable} not set — skipped`);
      continue;
    }
    let client;
    try {
      client = await connect(environment);
      const ledger = await applied(client);
      for (const file of files) {
        const record = ledger.get(file.filename);
        const drift = record && record.checksum !== file.checksum;
        const mark = drift ? '~' : record ? '✓' : ' ';
        const when = record ? record.applied_at.toISOString().slice(0, 16).replace('T', ' ') : '';
        console.log(
          `  ${mark} ${file.filename.padEnd(44)} ${drift ? 'EDITED SINCE APPLIED' : when}`,
        );
      }
      const pending = files.filter((f) => !ledger.has(f.filename)).length;
      console.log(`  ${pending} pending`);
    } catch (error) {
      console.log(`  unreachable: ${error.message.split('\n')[0]}`);
    } finally {
      await client?.end();
    }
  }
  console.log('');
}

/**
 * What is in the database right now, so the confirmation prompt describes what
 * is about to be lost rather than asking about it in the abstract.
 *
 * The account count is the number that actually stops somebody: "14 tables" is
 * what a staging reset looks like, and so is "14 tables, 9,300 accounts" — but
 * only one of those is staging.
 */
async function describe(client) {
  const { rows } = await client.query(
    `select count(*)::int as tables from pg_tables where schemaname = 'public'`,
  );
  const tables = rows[0].tables;

  // auth.users is Supabase's, not ours, and a plain Postgres will not have it.
  // Referencing a missing relation fails at parse time, so this is two queries.
  const { rows: probe } = await client.query(`select to_regclass('auth.users') is not null as ok`);
  if (!probe[0].ok) return { tables, users: null };

  const { rows: counted } = await client.query(`select count(*)::int as users from auth.users`);
  return { tables, users: counted[0].users };
}

async function confirmReset(environment, before, files) {
  const phrase = `reset ${environment}`;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\nAbout to DESTROY the ${environment} database:`);
    console.log(`  - drop schema public — ${before.tables} table(s) and every row in them`);
    if (before.users !== null) {
      // Logins live in auth.users, which is outside `public` and survives. Every
      // one of those accounts signs in afterwards to an empty app — a worse
      // surprise than losing the logins outright, so say it before, not after.
      // (0007 backfills their profile rows, so they come back as accounts, not
      // as broken ones.)
      console.log(`  - ${before.users} account(s) keep their login and lose everything they own`);
    }
    console.log(`  - re-apply all ${files.length} migration(s) from ${files[0]?.filename}`);
    const answer = await rl.question(`\nType "${phrase}" to continue: `);
    return answer.trim() === phrase;
  } finally {
    rl.close();
  }
}

async function confirmProduction(pending) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\nAbout to apply ${pending.length} migration(s) to PRODUCTION:`);
    for (const file of pending) console.log(`  - ${file.filename}`);
    const answer = await rl.question(`\nType "production" to continue: `);
    return answer.trim() === 'production';
  } finally {
    rl.close();
  }
}

/**
 * Drops and rebuilds `public`, leaving the caller to re-apply.
 *
 * Returns whether to continue. A dry run and a declined confirmation both stop
 * here rather than falling through to the apply loop: with the schema still
 * standing, the ledger would report "0 pending" and print a reassuring "up to
 * date" for a command that was asked to rebuild everything.
 *
 * @returns {Promise<boolean>}
 */
async function resetSchema(client, args, files) {
  const before = await describe(client);

  if (args.dryRun) {
    console.log(
      `${args.env}: would drop schema public (${before.tables} table(s)) and re-apply ` +
        `${files.length} migration(s) (dry run, nothing changed)`,
    );
    for (const file of files) console.log(`  - ${file.filename}`);
    return false;
  }

  if (!args.yes && !(await confirmReset(args.env, before, files))) {
    console.log('aborted');
    process.exitCode = 1;
    return false;
  }

  process.stdout.write(`  drop schema public … `);
  // In a transaction so a failure part-way through leaves the schema as it was,
  // rather than dropped-but-not-granted — which is a database the app cannot
  // reach and nothing here would mention again.
  await client.query('begin');
  try {
    await client.query(RESET);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    console.log('FAILED');
    throw new Error(`reset failed and was rolled back:\n  ${error.message}`);
  }
  console.log('ok');
  return true;
}

async function run(args) {
  const files = onDisk();
  const client = await connect(args.env);

  try {
    // Session-level, so it is held for as long as this process is connected and
    // released automatically if it dies. pg_advisory_lock blocks; a second
    // deploy waits rather than racing.
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);

    if (args.reset && !(await resetSchema(client, args, files))) return;

    const ledger = await applied(client);

    const orphans = findOrphans(files, ledger);
    if (orphans.length > 0) {
      console.warn(
        `warning: ${args.env} has migrations this checkout does not:\n` +
          orphans.map((f) => `  - ${f}`).join('\n') +
          `\n  (a deleted file, or this database belongs to another project)`,
      );
    }

    const result = plan(files, ledger, { to: args.to });
    if (!result.ok) throw new Error(explain(result));
    const { pending } = result;

    if (pending.length === 0) {
      console.log(`${args.env}: up to date (${ledger.size} applied)`);
      return;
    }

    if (args.dryRun) {
      console.log(`${args.env}: ${pending.length} pending (dry run, nothing applied)`);
      for (const file of pending) console.log(`  - ${file.filename}`);
      return;
    }

    if (args.env === 'production' && !args.yes) {
      const ok = await confirmProduction(pending);
      if (!ok) {
        console.log('aborted');
        process.exitCode = 1;
        return;
      }
    }

    const who = process.env.USER || process.env.USERNAME || 'unknown';
    for (const file of pending) {
      const started = Date.now();
      process.stdout.write(`  ${file.filename} … `);
      // The migration and its ledger row commit together. Anything else lets a
      // crash between the two leave a file applied but unrecorded, which the
      // next run would then try to apply again.
      await client.query('begin');
      try {
        await client.query(file.sql);
        await client.query(
          `insert into public.schema_migrations (filename, checksum, applied_by)
           values ($1, $2, $3)`,
          [file.filename, file.checksum, who],
        );
        await client.query('commit');
        console.log(`ok (${Date.now() - started}ms)`);
      } catch (error) {
        await client.query('rollback');
        console.log('FAILED');
        throw new Error(`${file.filename} failed and was rolled back:\n  ${error.message}`);
      }
    }

    console.log(`${args.env}: applied ${pending.length} migration(s)`);
  } finally {
    // Best-effort: if the connection is already broken the lock dies with it.
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end();
  }
}

// ---------------------------------------------------------------------------

try {
  // Before anything reads a URL. Exported variables are left alone, so this is
  // a no-op in CI; on a laptop it is what makes `npm run migrate:staging` work
  // without re-exporting a connection string in every new shell.
  //
  // Announced rather than silent: "which database did that actually run
  // against" is a question you only ask once a migration has gone somewhere
  // unexpected, and at that point the answer needs to be in the scrollback.
  for (const { key, file } of loadDbEnv(process.env, ROOT)) {
    console.log(`${key} <- ${file}`);
  }

  // Inside the try: a mistyped flag is the most likely error anybody will hit,
  // and it should print the reason rather than a Node stack trace.
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  } else if (args.status) {
    if (args.reset) throw new Error('--status and --reset ask for different things');
    await showStatus();
  } else if (!args.env) {
    throw new Error('--env is required (staging | production), or pass --status');
  } else {
    if (args.reset) {
      // Both checks live before connect(), so `--env production --reset` never
      // opens a connection to production at all, let alone holds its lock.
      const verdict = assertResettable(args.env, {
        url: ENVIRONMENTS[args.env]?.read(),
        productionUrl: ENVIRONMENTS.production.read(),
      });
      if (!verdict.ok) throw new Error(verdict.reason);

      // A prompt nobody can answer is a hang, and a reset that reaches the
      // prompt is already holding the advisory lock — so it would be a hang
      // that blocks everybody else's deploy too. Refuse now instead.
      if (!args.yes && !args.dryRun && !process.stdin.isTTY) {
        throw new Error(
          '--reset needs a terminal to confirm at.\n' +
            '  Pass --yes if you are running unattended and mean it.',
        );
      }
    }
    await run(args);
  }
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}
