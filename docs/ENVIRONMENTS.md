# Environments — staging and production

Daykeep has two real backends and one app that can be built against either.
This document is how you keep them apart.

The rule everything here serves: **a staging build and a production build must
be impossible to confuse, on the phone and in the build log.** Not merely
labelled differently — actually unable to be mistaken for each other.

---

## 1. What differs

|                    | development               | staging                   | production                   |
| ------------------ | ------------------------- | ------------------------- | ---------------------------- |
| Supabase project   | staging (or none)         | **staging**               | **production**               |
| Android package    | `com.daykeep.app`         | `com.daykeep.app.staging` | `com.daykeep.app`            |
| iOS bundle id      | `com.daykeep.app`         | `com.daykeep.app.staging` | `com.daykeep.app`            |
| App name           | Daykeep                   | **Daykeep (Staging)**     | Daykeep                      |
| Deep-link scheme   | `daykeep://`              | `daykeep-staging://`      | `daykeep://`                 |
| In-app badge       | shown                     | shown                     | none                         |
| EAS build profile  | `development`             | `staging`                 | `production`                 |
| EAS environment    | `development`             | `preview`                 | `production`                 |
| Database migration | `npm run migrate:staging` | `npm run migrate:staging` | `npm run migrate:production` |

Because the package id differs, **a staging build installs alongside the real
app** rather than replacing it. A tester can hold both. Neither one's local data
touches the other's.

The identity rules are one object — `IDENTITY` in
[scripts/build-env.js](../scripts/build-env.js) — and app.config.js applies
them. Nothing is hardcoded per-platform in `app.json`.

### A note on the names

EAS has exactly three environments — `development`, `preview`, `production` —
and those names cannot be changed. Ours are `development`, `staging`,
`production`, because "staging" is what the database is called and matching the
database mattered more than matching EAS. **`preview` _is_ staging.**
`PROFILE_ENVIRONMENT` in `scripts/build-env.js` is the entire mapping between
the two vocabularies; there is no second place to check.

---

## 2. First-time setup

### 2.1 Two Supabase projects

Create both at [supabase.com](https://supabase.com). Not two schemas in one
project — the value of staging is that a destructive migration destroys nothing
that matters, which is only true if it is a genuinely separate database.

Then apply the schema to each:

```bash
cp .env.db.example .env.db      # fill in both connection strings
npm run migrate:status          # confirm both are reachable and empty
npm run migrate:staging
npm run migrate:production      # prints the plan, asks before applying
```

Use the **session pooler (port 5432)**, not the transaction pooler (6543).

### 2.2 The EAS environments

Local `.env` is never uploaded to EAS. Each build profile is linked to an EAS
environment, and a build sees only that environment's variables.

Set all three variables **in one command block per environment**, so they cannot
drift apart:

```bash
# staging  ->  EAS environment "preview"
eas env:set --environment preview --name EXPO_PUBLIC_APP_ENV --value "staging"
eas env:set --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value "https://<staging-ref>.supabase.co"
eas env:set --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<staging anon key>"

# production
eas env:set --environment production --name EXPO_PUBLIC_APP_ENV --value "production"
eas env:set --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "https://<prod-ref>.supabase.co"
eas env:set --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<prod anon key>"
```

Keeping them together is not tidiness — it is what makes the guard in §4 work.

Verify before building. A variable that exists but sits in a different
environment is invisible to the build, and that is the usual reason a build
comes out with no working credentials:

```bash
npm run env:staging       # eas env:list --environment preview
npm run env:production
```

### 2.3 Credentials to add later

The three above are the only ones a build _requires_. Everything below is
optional, and every one of them is **deliberately left unset** rather than
pre-created with a placeholder — this codebase treats blank as "use the safe
default", and a dummy value replaces that default with a broken one:

| Variable                                                  | Unset behaviour                        | A dummy value instead                                                                           |
| --------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ADMOB_ANDROID_APP_ID` / `ADMOB_IOS_APP_ID`               | Google's universal test App IDs        | **Crashes the app on launch** — the Ads SDK aborts on an invalid App ID baked into the manifest |
| `EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_ANDROID` / `_IOS`       | Google's test banner units             | Ads silently fail to fill                                                                       |
| `EXPO_PUBLIC_SENTRY_DSN`                                  | Errors stay local (console + banner)   | Sentry init fails on a malformed DSN                                                            |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`     | Source-map upload skipped              | Fatal `sentry-cli` exit **if** §2.5's flag is ever removed                                      |
| `EXPO_PUBLIC_PRIVACY_URL` / `TERMS_URL` / `SUPPORT_EMAIL` | The published defaults in `lib/env.ts` | Overrides working links with dead ones                                                          |
| `EXPO_PUBLIC_SUPABASE_REDIRECT_URL`                       | The app's own deep link                | Breaks password-reset return                                                                    |
| `EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY`                     | Vault stays end-to-end encrypted       | Seals users' master keys to a key nobody holds                                                  |

EAS also refuses an empty value in non-interactive mode, so "create it now, fill
it in later" is not available even if it were wise. This table is the checklist
instead. When a real value exists, paste the matching line:

```bash
eas env:set --environment production --name ADMOB_ANDROID_APP_ID --value "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"
eas env:set --environment production --name ADMOB_IOS_APP_ID --value "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"
eas env:set --environment production --name EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_ANDROID --value "ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ"
eas env:set --environment production --name EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_IOS --value "ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ"
eas env:set --environment production --name EXPO_PUBLIC_SENTRY_DSN --value "https://...@...ingest.sentry.io/..."
eas env:set --environment production --name SENTRY_AUTH_TOKEN --value "..." --visibility secret
```

`env:set` is create-or-update, so re-running one to change a value is fine.
`secret` is worth using only for `SENTRY_AUTH_TOKEN`: an `EXPO_PUBLIC_` value is
inlined into the JS bundle regardless, so hiding it in the dashboard buys
nothing and only stops you reading it back.

### 2.4 Per-environment services

Because staging has its own package id, anything registered _against_ a package
id needs a second registration. Skipping these does not break the build; it
breaks the feature, at runtime, only in staging:

- **Google OAuth** — a second Android OAuth client for
  `com.daykeep.app.staging` with the staging build's SHA-1
  (`eas credentials`), plus `daykeep-staging://` in the staging Supabase
  project's Auth → Redirect URLs allow-list.
- **Apple Sign In** — a second App ID / Service ID for the staging bundle id.
- **AdMob** — a second app and ad units, or leave `ADMOB_*` unset in the preview
  environment so staging keeps serving Google's self-labeled test ads. Unset is
  the better default.
- **Sentry** — either a second project, or leave `EXPO_PUBLIC_SENTRY_DSN` unset
  for staging so test crashes never land in the production issue stream.

### 2.5 Sentry is optional

Nothing about Sentry can fail a build. `eas.json` sets
`SENTRY_DISABLE_AUTO_UPLOAD=true` on every profile, so the source-map upload is
skipped and `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` are not needed
at all.

That flag is doing real work. Without it, an unset auth token is **fatal**:
`sentry-cli` exits 1 with `An organization ID or slug is required (provide with
--org)` and the Gradle build dies — a confusing failure a long way from its
cause.

The cost of leaving it off is that production stack traces arrive **minified**,
which is the difference between a stack trace and a wall of `a.b.c(d)`.
app.config.js warns about this on every production build so it is a decision
rather than a discovery during an incident.

To turn readable traces on, both steps are required:

1. Set the three variables in the production EAS environment.
2. Remove `SENTRY_DISABLE_AUTO_UPLOAD` from the `production` profile in
   `eas.json`.

Step 1 alone does nothing — and app.config.js says exactly that in the build log
if it finds the variables set while the flag is still on.

Runtime crash reporting is a separate, independent switch:
`EXPO_PUBLIC_SENTRY_DSN`. Unset means no reporting at all; set means errors are
reported, minified traces or not.

---

## 3. Building

```bash
npm run build:staging          # eas build --profile staging --platform android
npm run build:production       # eas build --profile production --platform android
npm run build:production:apk   # production credentials, APK instead of AAB
```

Every build prints its identity before bundling. Read this line — it is the
cheapest confirmation you will get, and the project ref is the only thing that
distinguishes two otherwise-identical working builds:

```
[daykeep] environment=production profile=production supabase=abcdefghijkl
```

### 3.1 What CI builds, and when

In practice nobody runs those commands — the branch you push to selects the
database, and two workflows do the rest:

| You push to       | Workflow                                        | Profile          | Environment  | Talks to       |
| ----------------- | ----------------------------------------------- | ---------------- | ------------ | -------------- |
| any branch ≠ main | [preview.yml](../.github/workflows/preview.yml) | `staging`        | `preview`    | **staging**    |
| `main`            | [release.yml](../.github/workflows/release.yml) | `production-apk` | `production` | **production** |

Neither workflow contains a credential, and neither one chooses a database.
They choose a _profile_; `eas.json` maps the profile to an EAS environment; the
environment holds the keys. That indirection is the point — there is no step in
either file that could be edited to give a branch build production keys, short
of changing the profile name, which is also what the build log prints.

`release.yml` additionally bumps the semver in `app.json` and tags it, which is
why only main produces a version. A branch preview reuses whatever version is
already there; its `versionCode` still increments, so a newer preview always
installs over an older one.

Both workflows need an `EXPO_TOKEN` repository secret
(expo.dev/settings/access-tokens → GitHub → Settings → Secrets and variables →
Actions). Each fails on its first step with instructions when it is missing,
rather than several minutes later inside `eas build`.

**Cost.** `preview.yml` triggers on every push to every non-main branch, which
on a metered EAS plan adds up quickly. Cancelling the GitHub job does not cancel
an EAS build that has already queued. To build only when a pull request opens or
updates, swap its trigger for `pull_request`.

---

## 4. The guards

Four checks, all in [app.config.js](../app.config.js), all failing the build
rather than the app. Each exists because the mistake it catches is otherwise
silent until somebody's data is in the wrong place.

1. **Missing credentials.** A `staging`/`production` build without
   `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY` fails with the
   `eas env:set` commands to fix it. Previously such a build succeeded and
   produced an APK that installed fine but could not sign anyone in — the
   bundler treats an unset `EXPO_PUBLIC_` var as an empty string, so nothing
   flagged it.

2. **Missing `EXPO_PUBLIC_APP_ENV`.** A release build must say which
   environment it is. Without it the app falls back to `development`, which
   means the badge distinguishing a staging install from a real one goes
   missing from exactly the build where being wrong costs the most.

3. **Profile and environment disagreeing.** The reason `EXPO_PUBLIC_APP_ENV` is
   a variable rather than derived from the profile. The realistic mistake is not
   typing the wrong profile — it is a variable assigned to the wrong EAS
   environment months ago, so the production build has quietly been reading the
   staging project ever since. Nothing surfaces that, because a Supabase URL
   pointing at the wrong project behaves perfectly. Since `APP_ENV` travels
   _with_ the credentials (§2.2), a production build reading preview's values
   arrives with `APP_ENV=staging`, and the build stops.

4. **Reset cannot reach production.** `npm run migrate:reset` drops the `public`
   schema and re-applies from `0001`. It refuses if the staging and production
   URLs resolve to the same database, and it checks the URL rather than the
   environment name — because the name is just a label on a variable
   (`scripts/migration-plan.mjs`).

Guards 1–3 are only fatal on the EAS build server. Locally they warn: EAS
evaluates the config on your machine to compute the fingerprint, where the
variables are legitimately absent.

---

## 5. Working locally

Point your `.env` at **staging**, never production:

```
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<staging anon key>
```

A dev build keeps `com.daykeep.app`, so it will replace a production install on
your own device. That is deliberate — a third package id buys nothing when you
are the only person holding the phone — but it is worth knowing before you
install a dev build over an account you care about.

---

## 6. Changing a schema

Always in this order. The runner keeps a checksummed ledger, so re-running is a
no-op rather than a pile of errors you have to read carefully to confirm are
harmless.

```bash
npm run test:sql                              # pglite, no network
npm run migrate -- --env staging --dry-run    # what would run
npm run migrate:staging
# exercise the staging build against it
npm run migrate:production
```

A migration that has already been applied and has since been _edited_ is
refused. Editing an applied migration means staging and production silently
disagree about what the schema is, and nothing else would ever tell you.
