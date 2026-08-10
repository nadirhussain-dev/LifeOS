/**
 * Runs supabase/migrations against a real Postgres, in-process.
 *
 * PGlite is Postgres compiled to WASM, so this exercises the actual planner,
 * actual constraint triggers and actual row-level security — the parts
 * `check-migrations.mjs` can only look at, never run. No Docker, no daemon, no
 * hosted database.
 *
 * The Supabase pieces the migrations depend on are stubbed to the shape the real
 * platform provides:
 *   - `auth.users`, because profiles and every group table reference it
 *   - `auth.uid()`, reading a session GUC exactly as the real one reads the JWT
 *     claim, so `set_config('request.jwt.claim.sub', ...)` impersonates a user
 *   - the `anon` / `authenticated` / `service_role` roles the GRANTs target
 *
 * RLS is only enforced for non-superusers, so every assertion about a policy has
 * to run inside `asUser()` — which SETs ROLE to `authenticated`. Anything run as
 * the default superuser bypasses RLS entirely and would pass vacuously.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';

/** Stubs that stand in for the Supabase platform. */
const PRELUDE = `
  create schema if not exists auth;

  -- Minimal auth.users: the columns the migrations actually touch.
  create table if not exists auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );

  -- The real auth.uid() reads the verified JWT; this reads the same GUC that
  -- PostgREST sets, which is what makes impersonation below faithful.
  create or replace function auth.uid() returns uuid
  language sql stable as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $fn$;

  do $do$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin;
    end if;
  end $do$;

  -- Supabase grants these; without them a policy calling auth.uid() fails with
  -- "permission denied for schema auth" for every authenticated request.
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- -------------------------------------------------------------------------
  -- Storage, stubbed to the shape 0026 uses.
  --
  -- Supabase's storage schema is part of the platform rather than of any
  -- migration, so without this the media bucket, its four isolation policies
  -- and its quota trigger could not be applied here — which would mean the one
  -- part of the schema that decides whether one account can read another's
  -- photos was the one part with no test.
  --
  -- The metadata->>'size' expression is where Storage records object size, and
  -- the quota trigger reads exactly that, so the stub keeps the column as jsonb
  -- rather than inventing a tidier shape the real thing does not have.
  --
  -- NOTE: this prelude is a JS template literal. No backticks in these comments
  -- — one terminates the string, and the failure surfaces as a SyntaxError
  -- pointing at a SQL identifier, which is a confusing half-hour.
  -- -------------------------------------------------------------------------
  create schema if not exists storage;

  create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );

  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name text not null,
    owner uuid,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  alter table storage.objects enable row level security;

  -- The real signature: splits a path into its segments, 1-indexed.
  create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$
    select string_to_array(name, '/');
  $fn$;

  grant usage on schema storage to anon, authenticated, service_role;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;
`;

export async function bootDatabase() {
  const db = new PGlite();
  await db.exec(PRELUDE);

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`${file} failed to apply:\n  ${error.message}`);
    }
  }

  // Everything the app touches goes through PostgREST as `authenticated`, so the
  // role needs the same table privileges Supabase grants it. RLS is what
  // actually restricts rows; these grants only open the door.
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    grant select on all tables in schema public to anon;
    grant all on all sequences in schema public to authenticated, service_role;
  `);

  return { db, files };
}

/**
 * Runs `fn` as a signed-in user with RLS in force.
 *
 * Resets the role afterwards even on failure, so one failing assertion cannot
 * leave the connection impersonating somebody for every later test.
 */
export async function asUser(db, userId, fn) {
  await db.exec(`set role authenticated;`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

/**
 * Runs `fn` as a signed-out visitor: role `anon`, no JWT subject, so auth.uid()
 * returns NULL. This is the sign-up screen's actual identity, and the state in
 * which the username probe was failing — assertions made through asUser() can
 * never catch it, because by then the account already exists.
 */
export async function asAnon(db, fn) {
  await db.exec(`set role anon;`);
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

/** Creates an auth user (as superuser — sign-up is not what we're testing). */
export async function createUser(db, id, email) {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1::uuid, $2::text, jsonb_build_object('display_name', $3::text))
     on conflict (id) do nothing`,
    [id, email, email.split('@')[0]],
  );
  // 0001's trigger fires on auth.users insert and creates the profile row.
}

// --- tiny assertion kit ----------------------------------------------------

let passed = 0;
const failures = [];

export async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  ✗ ${name}`);
    console.log(`      ${error.message.split('\n')[0]}`);
  }
}

export function expectEqual(actual, expected, what = 'value') {
  if (actual !== expected) {
    throw new Error(
      `expected ${what} to be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

/** Asserts the callback rejects, optionally matching the message. */
export async function expectRejection(fn, match) {
  let threw = false;
  try {
    await fn();
  } catch (error) {
    threw = true;
    if (match && !error.message.toLowerCase().includes(match.toLowerCase())) {
      throw new Error(`rejected, but not with "${match}" — got: ${error.message}`);
    }
  }
  if (!threw) throw new Error('expected this to be rejected, but it succeeded');
}

export function summary() {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f.name}\n    ${f.message}`);
    process.exit(1);
  }
}
