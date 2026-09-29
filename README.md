# Daykeep

A local-first personal life operating system — tasks, habits, journal, money,
health and memories in one app. Your data lives on your phone. It leaves only if
you create an account and switch sync on, module by module.

Built with Expo (React Native), SQLite on the device, and Supabase (Postgres +
Row Level Security) as the optional backend.

> **Status: pre-release.** The code typechecks, lints, and passes 471 unit tests
> plus 173 assertions against a real Postgres. It **runs on a physical Android
> device** from a dev build: the app launches, screens work, and local
> reminders have been observed firing and landing in the in-app inbox.
>
> Everything involving a server is still unproven — **no Supabase project has
> been created**, so sign-in and sync have never run against a real backend. iOS
> has never been built at all (it needs a paid Apple Developer account).
> Notifications and widgets cannot run in Expo Go — they need a dev build. See
> [Known limitations](#known-limitations) before trusting anything here.

---

## Contents

- [What it is](#what-it-is)
- [Modules](#modules)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [The two databases](#the-two-databases)
- [Testing](#testing)
- [Scripts](#scripts)
- [Building](#building)
- [Security and privacy](#security-and-privacy)
- [Documentation](#documentation)
- [Conventions](#conventions)
- [Known limitations](#known-limitations)

---

## What it is

Most life apps are a cloud service with an app attached: the data is theirs, the
device is a window onto it, and losing signal means losing the app. Daykeep is the
other way round.

- **Local-first.** Every write goes to on-device SQLite first. The app is fully
  functional with no account, no network, and no server — that is the normal
  mode, not a degraded one.
- **Sync is opt-in, per module.** You choose an account, then choose which
  modules upload. A module left switched off is never sent anywhere.
- **Guest mode is real.** You can use the entire app without an account. If you
  later sign up, local data migrates to your user id automatically rather than
  starting you over.
- **Honest about what it can see.** Anything the operator can technically read is
  stated in [PRIVACY.md](PRIVACY.md) and in the app itself, rather than being
  implied away. See [Security and privacy](#security-and-privacy).

---

## Modules

Four daily drivers sit in the tab bar with a launcher — **Today**, **Tasks**,
**Habits**, **Journal**, and the **Hub**. Everything else lives in the Hub,
grouped:

| Group         | Module   | What it does                                                       |
| ------------- | -------- | ------------------------------------------------------------------ |
| **Growth**    | Goals    | Goals with milestones and progress logs                            |
|               | Study    | Study sessions and subject tracking                                |
|               | Notes    | Notes with categories, tags, attachments and `[[wiki-links]]`      |
|               | Timeline | A chronological view across everything you have recorded           |
| **Wellbeing** | Sleep    | Sleep sessions and quality                                         |
|               | Water    | Water intake logging against a daily target                        |
| **Finance**   | Budget   | Transactions, debts and savings, in integer cents                  |
|               | Split    | Shared expense groups, invitations, balances and settlements       |
| **Memories**  | Gallery  | Photo/video albums, including progression ("story") views          |
|               | Music    | Local audio library, playlists and a player                        |
| **System**    | Settings | Theme, language, notifications, sync, app lock, data export/import |

Plus, behind a PIN and separate encryption, a **private space**: Vault, Cycle,
Recovery and Us. Its data is encrypted field-by-field on the device.

Cross-cutting: reminders and a notification inbox with quiet hours and a smart
digest, an Android home-screen widget, search across modules, a dashboard, four
languages (English, Arabic, Hindi, Urdu) with RTL layout, light and dark themes,
and biometric app lock.

---

## Architecture

```
app/                    Expo Router routes — screens only, no business logic
  (tabs)/               Today, Tasks, Habits, Journal, Hub
  (auth)/ (onboarding)/ Sign-in, sign-up, reset, first-run
features/<module>/      One folder per feature, consistently layered:
  components/           Presentational pieces for that feature
  hooks/                React Query hooks — the only thing screens call
  services/             Repositories and pure logic (the testable half)
  store/                Zustand stores for UI/session state
  types/                Types for the feature
database/               Drizzle schema, bootstrap DDL, client
lib/                    Cross-cutting: i18n, supabase, dates, money, errors
components/ constants/  Shared primitives and design tokens
supabase/migrations/    Numbered SQL migrations, 0001 → 0021
scripts/                Migration runner, SQL test harness, build tooling
docs/                   Operations, design system, SQLCipher notes
```

Three rules hold the layering together:

1. **Screens never touch the database.** They call hooks; hooks call
   repositories; repositories own the SQL. This is why the logic that matters is
   testable without rendering anything.
2. **Money is integer cents, never floats.** Formatting is locale-aware via
   `Intl.NumberFormat`, including zero-decimal currencies.
3. **Timestamps are epoch milliseconds** everywhere — device and server — so the
   sync engine can move rows without per-column mapping.

### How sync works

The engine in [`features/sync/services/sync-engine.ts`](features/sync/services/sync-engine.ts)
pushes local changes and pulls remote ones on launch, on foreground, and on
demand. Points worth knowing:

- **Last-write-wins**, on `updated_at`. Deletes are soft (`deleted_at`) and bump
  `updated_at`, because a hard delete leaves nothing to sync and the row simply
  comes back from another device.
- **Cursors are `(updated_at, id)` pairs.** A bare timestamp cursor cannot
  advance past a page of rows sharing one millisecond, and those rows become
  permanently invisible.
- **Both directions paginate.** PostgREST caps a response at 1000 rows whatever
  you ask for; treating that as "everything" means a large account syncs one page
  per launch.
- **13 syncable modules** covering every local table except `notification_log`,
  which is this phone's record of what it scheduled and is meaningless elsewhere.
- **Media syncs as rows, not bytes.** Albums, playlists, captions and ordering
  travel; the photo, video and audio files stay on the device that imported them
  and appear elsewhere as "Not on this device".

---

## Tech stack

| Layer        | Choice                                                          |
| ------------ | --------------------------------------------------------------- |
| App          | Expo SDK 54, React Native 0.81, React 19, TypeScript (`strict`) |
| Navigation   | Expo Router (file-based)                                        |
| Styling      | NativeWind (Tailwind) + design tokens in `constants/`           |
| Local data   | expo-sqlite + Drizzle ORM                                       |
| Server state | TanStack Query                                                  |
| Client state | Zustand                                                         |
| Backend      | Supabase — Postgres, Auth, Row Level Security, Edge Functions   |
| Forms        | React Hook Form + Zod                                           |
| i18n         | i18next / react-i18next, 4 locales, RTL-aware                   |
| Errors       | `reportError` choke point, on-device only — no backend          |
| Tests        | Jest + jest-expo, Testing Library, PGlite for SQL               |

---

## Getting started

### Prerequisites

- **Node 24+.** Required by the test suite: `database/schema.test.ts` executes
  the app's real bootstrap DDL through `node:sqlite`.
- npm, and the Expo CLI via `npx`.
- Optionally a Supabase project. Without one the app still runs — in guest mode.

### Install and run

```bash
npm install
cp .env.example .env       # fill in Supabase values, or leave them for guest mode
npm start                  # then press a / i, or scan the QR code
```

`npm run android` / `npm run ios` / `npm run web` start on a specific target.

> **Expo Go is not enough for everything.** Notifications, widgets, secure
> storage and biometrics need a development build:
> `eas build -p android --profile development`.

### Environment

Every variable is documented in [.env.example](.env.example). The short version:

| Variable                              | Required | Purpose                                       |
| ------------------------------------- | -------- | --------------------------------------------- |
| `EXPO_PUBLIC_APP_ENV`                 | Releases | `development` \| `staging` \| `production`    |
| `EXPO_PUBLIC_SUPABASE_URL`            | For auth | Supabase project URL                          |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`       | For auth | Anon key — safe client-side; RLS is the guard |
| `EXPO_PUBLIC_SUPABASE_REDIRECT_URL`   | No       | Password-reset deep link override             |
| `EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY` | No       | **Enables operator access to private spaces** |
| `SUPABASE_DB_URL_STAGING`             | Migrate  | Staging Postgres — **`.env.db`, not `.env`**  |
| `SUPABASE_DB_URL_PRODUCTION`          | Migrate  | Prod Postgres — **`.env.db`, not `.env`**     |

The two database URLs live in `.env.db` (`cp .env.db.example .env.db`), which is
gitignored; a shell export or a CI secret beats the file. They are kept out of
`.env` so the file Expo reads and the file holding a database password are not
the same file — a Postgres URL carries the password for a role that bypasses Row
Level Security entirely. Neither name has an `EXPO_PUBLIC_` prefix, which is what
actually keeps Metro from inlining them into the bundle. Never add one.

### Staging vs production

Two Supabase projects, and a build for either. A staging build installs as
`com.daykeep.app.staging` / "Daykeep (Staging)" so it sits _beside_ the real app
instead of replacing it, and shows an in-app badge naming the project it is
talking to.

```bash
npm run build:staging          # staging Supabase project
npm run build:production       # production
npm run migrate:staging        # schema -> staging DB
npm run migrate:production     # schema -> production DB, after confirming
```

**[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md) is the setup guide** — the EAS
environment variables, the second OAuth/AdMob registrations that a
distinct package id requires, and the four build-time guards that stop a
production build shipping against the staging database.

---

## The two databases

**On the device.** SQLite, created by `database/bootstrap.ts` on first launch:
tables, additive columns for older installs, backfills, then indexes — in that
order, because a column added with a default leaves existing rows at that default
and `updated_at` at a default is invisible to sync forever.

**On the server.** Postgres, defined by the 21 numbered migrations in
[`supabase/migrations/`](supabase/migrations/). Every table has Row Level
Security; a user reaches only their own rows, and the policies — not the client —
are what enforce it. Every per-user table also carries
`references auth.users(id) on delete cascade`, so deleting an account deletes
its data as one transaction rather than relying on a list somebody has to keep
up to date — see [0020](supabase/migrations/0020_account_deletion_cascade.sql).

### Running migrations

```bash
npm run migrate:status                              # what is applied where
npm run migrate -- --env staging --dry-run          # what would run
npm run migrate:staging                             # apply pending
npm run migrate:production                          # prompts before touching anything
npm run migrate -- --env staging --to 0016_full_sync_coverage.sql
npm run migrate:reset                               # staging only: drop it all, re-apply from 0001
```

The runner keeps a `schema_migrations` ledger with checksums, takes an advisory
lock so two deploys queue rather than interleave, and wraps each file in a
transaction with its ledger row. It **refuses to run when an applied migration
has been edited** — re-running an edited `create ... if not exists` file usually
succeeds while changing nothing, which looks like success and leaves your two
databases quietly different. Put the change in a new migration.

`--reset` rebuilds staging from empty, which is the only way to find out whether
the schema still builds as a sequence. It cannot reach production: there is no
override flag, and it compares the two URLs as well as the environment name.
Full detail in [docs/OPERATIONS.md](docs/OPERATIONS.md).

---

## Testing

```bash
npm test              # 288 unit tests
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run test:sql      # 173 assertions against real Postgres (PGlite, no Docker)
npm run check:migrations
```

Two suites, deliberately different in kind:

- **`npm test`** covers the pure logic where a bug silently corrupts data —
  money, habit streaks, sync table contracts, cycle and recovery math, vault
  crypto, the password policy, the migration planner — plus the SQLite bootstrap,
  executed rather than merely read.
- **`npm run test:sql`** applies every migration to a WASM Postgres and asserts
  that Row Level Security actually refuses what it should. Every policy assertion
  runs as `authenticated`, because Postgres exempts superusers from RLS and an
  assertion made on the default connection passes without proving anything.

CI runs all of the above on push and pull request.

---

## Scripts

| Script                              | Does                                    |
| ----------------------------------- | --------------------------------------- |
| `start` / `android` / `ios` / `web` | Run the app                             |
| `test` / `test:watch`               | Unit tests                              |
| `test:sql`                          | Migrations + RLS against real Postgres  |
| `check:migrations`                  | Static checks over the migration SQL    |
| `migrate*`                          | Apply/inspect/reset database migrations |
| `typecheck` / `lint`                | `tsc --noEmit` / eslint                 |
| `format` / `format:check`           | Prettier                                |
| `assets`                            | Regenerate brand assets (icons, splash) |
| `version:bump`                      | Bump the app version                    |

---

## Building

EAS profiles are defined in [eas.json](eas.json):

| Profile          | Output                        | Use                                  |
| ---------------- | ----------------------------- | ------------------------------------ |
| `development`    | APK with dev client           | Device testing; credentials optional |
| `preview`        | Internal APK                  | Sharing a build                      |
| `production`     | Store build, auto-incremented | Release                              |
| `production-apk` | Internal APK of production    | Sideloading a release build          |

```bash
eas build -p android --profile development
```

A local `.env` is **not** uploaded to EAS — each profile pulls variables from the
EAS environment it links to (`eas env:set --environment production ...`).
[app.config.js](app.config.js) fails a preview or production build outright when
the Supabase credentials are missing, because the bundler treats an unset
`EXPO_PUBLIC_` variable as an empty string: the build would otherwise succeed and
produce an app that installs fine and cannot sign anybody in.

### Releases are automatic

Every merge into `main` runs [release.yml](.github/workflows/release.yml), which:

1. runs the full CI suite — a version is never cut from code that does not pass;
2. bumps the minor version in `app.json` and `package.json`, commits it as
   `chore(release): vX.Y.Z [skip ci]`, and tags it;
3. builds `production-apk` on EAS **from that tag**, and puts a download link in
   the run summary.

The build is Android-only. An APK is an Android artefact, and the iOS half of
`eas.json`'s submit block is still `REPLACE_WITH_*` — `--platform all` would
queue a build that cannot finish.

Two things this needs from you, both one-off:

| What                                          | Where                                                                                                                                    | Without it                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `EXPO_TOKEN` secret                           | Repo → Settings → Secrets and variables → Actions. Token from [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) | The build job fails immediately, with instructions                                                  |
| `EXPO_PUBLIC_SUPABASE_URL` and `..._ANON_KEY` | The EAS **production** environment (`eas env:set --environment production …`)                                                            | `app.config.js` fails the build on purpose, rather than shipping an APK that cannot sign anybody in |

Opting out of a release: put `[skip version]` in the merge commit message. No
version is cut, and no build runs — the build job needs the version job.

To cut a major or patch release, or to rebuild without bumping, run the workflow
from the Actions tab: it takes the bump level, whether to build, and which
profile to use.

---

## Security and privacy

- **Row Level Security on every server table.** The client is not trusted; the
  policies are the enforcement. A blocked account is denied reads and writes at
  the database, not by a screen a modified client could skip.
- **The session lives in the OS keystore** (`lib/secure-session-storage.ts`),
  chunked, because a refresh token is a bearer credential for the account and
  AsyncStorage is an unencrypted file in the app sandbox.
- **PKCE** for auth, so a password-reset deep link carries a single-use code
  rather than the tokens themselves.
- **Password policy** following NIST SP 800-63B — length over composition rules.
  It is a client-side check and therefore advisory; the server-side floor is a
  Supabase project setting that still needs raising.
- **App lock** via biometrics/device credential, and a **private space** behind a
  separate PIN with field-level encryption.
- **Moderation** is documented, audited, and bounded: staff can reach an account
  only while a live report names it, admins can reach anything, and every access
  writes an audit row _before_ the data is produced.
- **Users can moderate for themselves.** Any member of a shared expense group
  can report the group or a person in it, and block that person outright. A
  block is enforced by the database, not the screen that offers it: it shuts
  being added to a group, being invited to one, and redeeming a token minted
  before the block. It does not remove either party from a group they already
  share — that would rewrite a ledger other people depend on — and the app says
  so rather than implying otherwise.

> **Daykeep is not end-to-end encrypted when a build carries
> `EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY`.** With that key set, every private
> space's master key is also sealed to the operator key and uploaded, so staff
> can open any signed-in user's private data for abuse handling. This is a
> deliberate product decision, the app says so on screen before a PIN is chosen,
> and leaving the variable empty keeps the app end-to-end encrypted. See
> [PRIVACY.md](PRIVACY.md).

---

## Documentation

| Document                                       | What is in it                                          |
| ---------------------------------------------- | ------------------------------------------------------ |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)       | Migrations, operator roles, blocking, purging          |
| [docs/design-system.md](docs/design-system.md) | Tokens, type scale, colour, motion, component patterns |
| [docs/SQLCIPHER.md](docs/SQLCIPHER.md)         | Encrypting the local database at rest                  |
| [PRIVACY.md](PRIVACY.md)                       | The user-facing privacy policy                         |
| [AUDIT.md](AUDIT.md)                           | Full-app audit: gaps, severities, what was fixed       |
| [TODO.md](TODO.md)                             | Roadmap and what is still blocked on you               |
| [TERMS.md](TERMS.md)                           | Terms of service, incl. the rules for shared groups    |
| [AGENTS.md](AGENTS.md)                         | Instructions for AI coding agents in this repo         |

---

## Conventions

- **TypeScript `strict`**, effectively no `any` and no `@ts-ignore`.
- **Comments explain _why_, not what.** The interesting comments in this codebase
  record the failure that motivated the code — keep that habit; it is the reason
  the tricky parts are followable a year later.
- **Conventional commits** (`feat(sync)!:`, `fix(auth):`), with a body that
  explains the reasoning rather than restating the diff.
- **Migrations are append-only.** Never edit an applied one; add the next number.
- Run `npm run typecheck && npm run lint && npm test && npm run test:sql` before
  opening a pull request. CI runs exactly that.

---

## Known limitations

Stated plainly, because each of these is the kind of thing a README usually
implies away:

- **Device validation is partial.** An Android dev build runs, and local
  reminders have been seen firing and reaching the in-app inbox. Not yet
  confirmed on hardware: the home-screen widget rendering, sign-in, and sync.
  Nothing has ever been built for iOS.
- **No Supabase project exists yet.** The migration runner supports staging and
  production; neither database has been created, so nothing has been applied
  anywhere real — which is why sign-in and sync remain unproven above.
- **Migration 0016 is breaking for old clients.** It drops columns older builds
  still push. Apply it with a client release, not ahead of one.
- **Media files never leave the device.** Only their metadata syncs. Uploading
  bytes needs Storage buckets, per-user quotas and a resumable queue.
- **The local device wipe needs a cooperating client.** A modified build can
  decline to run it; the server-side denial cannot be declined.
- **Appeals have no route back in.** A blocked user cannot export their own data,
  so a data-access request is served by an admin running SQL by hand.
- **The bundle identifier is `com.daykeep.app`.** Kept deliberately, but it is a
  generic name on a domain nobody here owns. Both stores only require
  uniqueness, so it will work; it is worth knowing it cannot be changed once
  either store has accepted a build under it.
- **The published policy URLs are live only after `pages.yml` has run once.**
  It publishes PRIVACY.md and TERMS.md, and enables Pages itself on first run
  (`enablement: true`). Until that run completes, the two links in Settings 404.
- **The governing-law clause in TERMS.md is an unfilled placeholder.**

---

## License

Proprietary — see [LICENSE](LICENSE). All rights reserved; `package.json` is
marked `"private": true`. Viewing this repository grants no license to its
contents. Third-party dependencies keep their own licenses.
