# Operations — migrations, roles, and moderation

Two things live here: how schema changes reach a database, and what an operator
can actually do to an account. They are in one document because the second is
enforced entirely by the first.

---

## 1. Databases

Two Supabase projects, not two schemas in one project.

| Environment  | Variable                     | What it is for                                       |
| ------------ | ---------------------------- | ---------------------------------------------------- |
| `staging`    | `SUPABASE_DB_URL_STAGING`    | Where a migration is run for the first time, always. |
| `production` | `SUPABASE_DB_URL_PRODUCTION` | Real accounts.                                       |

Separate projects rather than separate schemas, because the point of staging is
that a mistake there costs nothing — and that is only true when the mistake
cannot reach production's tables through a search-path slip or a
`security definer` function that forgot to pin one.

Both URLs live in **`.env.db`** (gitignored — `cp .env.db.example .env.db`), and
a shell export or a CI secret always beats the file. They are kept out of `.env`
so the file Expo reads and the file holding a database password are not the same
file; the rule that actually keeps them out of the bundle is that neither name
has an `EXPO_PUBLIC_` prefix, since Metro inlines only prefixed names. Never add
one. `scripts/db-env.mjs` has the precedence in full.

The app's own environment — which Supabase project a _build_ talks to — is a
separate mechanism. See [ENVIRONMENTS.md](ENVIRONMENTS.md).

Use the **session pooler (port 5432)**, not the transaction pooler (6543): the
runner holds an advisory lock across statements and wraps each migration in an
explicit transaction, and the transaction pooler supports neither.

---

## 2. Running migrations

```bash
npm run migrate:status                        # what is applied where
npm run migrate -- --env staging --dry-run    # what would run
npm run migrate:staging                       # apply
npm run migrate:production                    # prompts before touching anything
npm run migrate -- --env staging --to 0016_full_sync_coverage.sql
```

The runner keeps a ledger in `public.schema_migrations` (filename, checksum,
when, by whom), takes a session advisory lock so two deploys queue instead of
interleaving, and runs each file inside a transaction together with its ledger
row — so a failure leaves that migration unapplied rather than half-applied.

**It refuses to run if an already-applied migration has been edited.** This is
the check worth understanding: editing an applied migration does not change the
database that already ran it, so staging and production quietly stop being the
same schema. Re-running it is not a fix either — these files are mostly
`create ... if not exists`, so a re-run of an edited file often succeeds while
doing nothing, which looks like success. Put the change in a **new** migration.

The order is always: **staging → verify → production.** `npm run test:sql`
applies every migration to a throwaway WASM Postgres and asserts the policies
refuse what they should; it runs in CI, and it is not a substitute for staging.

### Rebuilding staging from nothing

```bash
npm run migrate:reset                            # prompts, then drops and re-applies all of it
npm run migrate -- --env staging --reset --dry-run   # what it would destroy, destroying nothing
npm run migrate -- --env staging --reset --yes       # unattended (CI)
```

This drops `schema public` and applies every migration from 0001 in order. It is
the only way to find out whether the schema still builds from empty — a stack of
migrations that each worked when applied can still fail as a sequence, and
nothing else in the repo runs them against a real server in order.

**It will not touch production.** Not with `--yes`, not with any flag: there
isn't one. `--env production --reset` is refused before a connection is opened.
It also compares `SUPABASE_DB_URL_STAGING` against `SUPABASE_DB_URL_PRODUCTION`
and refuses if they match, because the environment name is a label on a variable
and the variable is what actually gets dialled — pasting production's URL into
the staging one for a quick query is a normal thing to do and a bad thing to
still be true an hour later.

What survives: **`auth.users`**, which lives outside `public`. Everybody can
still sign in, to an empty account — 0007's backfill gives them their profile row
back, and nothing else comes back. What is restored alongside the schema are the
grants and default privileges for `anon` / `authenticated` / `service_role`;
without them the rebuilt database is structurally perfect and returns "permission
denied for schema public" to every request the app makes.

### Deploying 0016 specifically

0016 drops columns that older app builds still push (`reminder_notification_id`,
`sync_status`, `server_updated_at`). Apply it **with** a client release, not
ahead of one — a stale client's sync will fail loudly against the new schema.

---

## 3. Operator roles

`public.admins` has a `role` column.

| Role    | Can reach                                        | Gate                                    |
| ------- | ------------------------------------------------ | --------------------------------------- |
| `staff` | One account's profile and the reports against it | **Only while a live report names them** |
| `admin` | Any account, any row, deleted rows included      | None, beyond a stated reason            |

Both tiers additionally require a registered origin (`admin_allowed_origins`,
migration 0014). A staff account on an unregistered network is not staff.

**Every call is audited** to `admin_audit_log`, _before_ the data is produced —
so a query that errors halfway still records that somebody looked. Staff access
additionally records **which report justified it**, so a later review reads
"opened account X because of report Y" rather than "opened account X".

Add an operator:

```sql
insert into public.admins (user_id, role, note)
values ('<uuid>', 'staff', 'moderation, hired 2026-08');
```

Existing rows default to `admin`, so a deploy does not demote the owner out of
their own console.

### What "live report" means

`staff_access_report()` grants access when a report against that account is
`open`, or was `actioned` within the last 30 days. A **dismissed** report grants
nothing from the moment it is dismissed — staff looked, found nothing, and the
reason to keep looking is gone. The 30-day tail exists because work does not
stop at the verdict: appeals arrive, and a moderator has to be able to check
their own decision.

### Staff surface

```sql
select * from public.operator_report_queue(100);                    -- the queue
select * from public.operator_user_profile('<uuid>', 'report r-12'); -- one account
select * from public.operator_user_reports('<uuid>', 'report r-12'); -- its reports
```

`operator_user_reports` never returns `reporter_id`. Telling the reported
party's moderator who complained is one leak away from telling the reported
party, and retaliation against reporters is what stops people reporting at all.

### Admin surface

```sql
-- Any table, any user, soft-deleted rows included. No password, no PIN.
select * from public.admin_user_rows('<uuid>', 'journal_entries', 'report r-12', true, 500);

-- Private-space ciphertext, plus the escrow key to open it offline (0015).
select * from public.admin_fetch_private_entries('<uuid>', 'report r-12', 500);
select * from public.admin_fetch_vault_escrow('<uuid>', 'report r-12');
```

`admin_user_rows` takes the table name against a **whitelist**
(`operator_readable_tables()`). Without one, a function that selects from any
name an admin types is a function that will happily read `auth.users`.

---

## 4. Blocking an account

```sql
-- Block, allow 15 minutes for the device to upload what it has, then wipe it.
select public.admin_block_user('<uuid>', 'sustained harassment, report r-12', null, true, 15);

-- Active abuse: cut off immediately, no evacuation window.
select public.admin_block_user('<uuid>', 'CSAM referral, report r-31', null, true, 0);

select public.admin_unblock_user('<uuid>', 'appeal upheld');
```

What a block does:

1. **Server access stops.** Migration 0019 gates every synced table's policy —
   reads _and_ writes — on `may_access_own_data()`. This is the only real
   enforcement; the app-side block screen is UX that a modified client ignores.
2. **The device wipes itself.** A `wipe_local` row is queued in
   `device_commands`; the app picks it up on launch and on each foreground.
3. **Their data survives in production**, so an unblock restores it.

### The evacuation window, and what it costs

Those three are in tension: wipe the device, keep the data, and a blocked
account may not upload. The resolution is `evacuation_until` — a short window
during which the account can still reach _its own_ rows, so the device gets one
final push before wiping. It is not a loophole: what a block cuts off is reach
into _other people's_ surfaces, and that is `can_share()` (0010), which this does
not touch.

**Modules the user had sync switched OFF were never uploaded and are lost.** An
evacuation does not override that setting — consent to upload is not something a
block should retroactively revoke. The app names those modules on the block
screen before it wipes, and the device reports them back in `ack_detail` so an
operator handling an appeal knows what is actually gone.

`p_evacuation_minutes => 0` skips the window entirely. That makes the wipe
unrecoverable for anything not already synced. It is the right call for active
abuse and it is a decision, not a default.

### Checking whether a wipe actually happened

```sql
select user_id, issued_at, acked_at, ack_detail
  from public.device_commands
 where command = 'wipe_local' order by issued_at desc;
```

`acked_at is null` means the device never came back — off, uninstalled, or
factory reset. That is materially different from a wipe that ran, and "the
account is blocked" alone cannot tell you which.

Unblocking cancels any outstanding wipe, so a phone that was off through the
whole episode does not wake up and empty an account that is fine again.

### Purging content

```sql
select public.admin_purge_user_data('<uuid>', 'confirmed abuse, report r-12');
```

**Soft** delete — sets `deleted_at`, which is also what the sync engine reads as
a tombstone, so the purge propagates to every device that syncs. The rows stay
for an appeal, for a legal hold, and for the case where the block turns out to
be wrong. A hard delete would destroy the evidence the report was about along
with the ability to reverse a mistake.

---

## 5. Outbound email

Two separate senders, which is the thing most likely to confuse:

| Email                               | Sent by                   | Configured in                      |
| ----------------------------------- | ------------------------- | ---------------------------------- |
| Signup code, reset code, magic link | Supabase Auth             | Dashboard → Auth → Email Templates |
| Group invitation                    | Resend, via `send-invite` | `supabase secrets`                 |

**Auth emails do not go through Resend** unless custom SMTP is set under Auth →
SMTP Settings. Out of the box they use Supabase's shared sender, which is rate
limited and not suitable for production volume. The three templates in
`supabase/templates/` are pasted into the dashboard by hand — they are not
deployed by anything, so editing the file changes nothing until it is pasted.

### Turning invitations on

```bash
cp supabase/.env.example supabase/.env   # paste the Resend key in, then:
npm run secrets:push                     # supabase secrets set --env-file supabase/.env
supabase functions deploy send-invite
```

`supabase/.env` is gitignored and holds every secret an edge function needs
that Supabase does not inject for you — the Resend key and the Expo push token.
Committed template: `supabase/.env.example`.

**These do not go in `.env` or in EAS.** EAS variables are for an app build, and
no build can reach a function's environment, so a key set there is never read by
anything. Worse, a name given an `EXPO_PUBLIC_` prefix is inlined into the APK,
where anyone who installs the app can unzip it out — and the Resend key sends
mail as our domain.

Secrets and code deploy separately: pushing a secret does not redeploy a
function, and deploying a function does not carry secrets with it. A function
picks up a changed secret on its next cold start.

The sending domain must be verified in Resend with SPF and DKIM published, or
invitations land in spam. Nothing in the app can detect this — delivery looks
identical to the app whether the mail arrives or is filtered.

### Verifying it, in the order that isolates the fault

1. `npm run secrets:list` — if `RESEND_API_KEY` is absent, or still holds the
   `re_REPLACE_WITH_...` placeholder from the template, the function returns
   `emailed: false` and the members screen quietly opens the share sheet
   instead. That is the designed fallback, and it looks like success.
2. Send an invitation and read the response. `{emailed: true}` means Resend
   accepted it; `{emailed: false, reason: ...}` carries the provider's own error
   text, which is usually `domain not verified` or an invalid key.
3. Resend dashboard → Emails. Accepted-but-bounced only shows here.

Note the deliberate design: **the invitation is created and redeemable whether or
not the email sends**. A provider outage degrades to sharing a link by hand, it
does not block anyone from joining a group.

---

## 6. Limits worth knowing

- **The local wipe needs a cooperating client.** A modified build can decline to
  run it. The server-side denial cannot be declined; the wipe can. No amount of
  app-side code fixes this.
- **This is not end-to-end encrypted.** It stopped being so at 0015. `PRIVACY.md`
  says so, and the store data-safety form has to as well.
- **Nothing here has been exercised against a real Supabase project or on
  hardware.** `npm run test:sql` proves the policies behave against WASM
  Postgres; `npm test` covers the client sequencing. Neither is a device.
