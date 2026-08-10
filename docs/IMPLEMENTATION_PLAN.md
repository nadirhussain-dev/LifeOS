# LifeOS — Implementation Plan

Derived from `TODO.md` on 2026-08-07. Two parts, and the split is the point:

- **Part A** — work I can do from here. Ordered into waves by dependency.
- **Part B** — work only you can do. Accounts, paid assets, secrets, decisions.

They are not independent. Part A wave 4 onward is mostly _writable_ but not
_verifiable_ until Part B items 1 and 2 land, because nothing in notifications,
widgets, sync or auth has ever been observed running on hardware. Where that is
the case it is said so per item rather than left implied.

Verification commands referenced below are the real ones in `package.json`:
`npm run typecheck`, `npm test`, `npm run test:sql`, `npm run check:i18n`,
`npm run check:tokens`, `npm run check:migrations`, `npm run lint`.

---

## Part A — I implement

### Wave 1 — small, unblocked, verifiable in CI

Nothing here needs a Supabase project or a device. All of it can land today.

**A1. Commit 0022 and wire the client half of self-service export.**
`supabase/migrations/0022_self_service_data_access.sql` exists and is untracked.
`export_own_data` takes no user id and reads `auth.uid()` — the safety argument
is that there is no parameter to get wrong. Nothing calls it. Needs:
a service in `features/moderation/` or `features/settings/`, a Settings → Privacy
→ "Export my data" row, and — the reason it was written — a route to it from the
blocked screen, which today offers only an email link.
_Closes:_ TODO "Appeals have no route back in".
_Verify:_ `npm run test:sql` (the migration), `npm test` + `npm run typecheck`
(the wiring), plus a wiring test in the shape of
`features/moderation/moderation-wiring.test.ts` so the route cannot silently
disappear again — that file already exists as the pattern for exactly this.

**A2. Reconcile `TODO.md` with what shipped.** Three entries are done and still
unchecked: widget i18n (`150dcbd`), Goals + Study schedulers (`45e8521`), and
conflict surfacing (`ae4e3a8`). Leave the Streak category unchecked — it has no
scheduler and is deferred by design.
_Verify:_ read it back; no tooling involved.

**A3. Sweep dead locale keys.** `finishSetup` is unused and was left in the
locales mid-flight. `npm run check:i18n` exists now (added in `c2cc353`) and
found six raw-rendering keys; extend or re-run it to catch the reverse case —
keys present in locales that nothing reads.
_Verify:_ `npm run check:i18n`, `npm test`.

**A4. Hoist the expense-group RLS policies.** The 0017 pass made owner policies
cheap by replacing per-row `auth.uid()` with `(select auth.uid())`. The
expense-group policies still call membership functions that take a per-row
argument, so the planner cannot hoist them. The fix is turning the membership
check into a join the planner can see through.
This is the one item in wave 1 that is **easy to get wrong in a way that leaks
between groups**, so it wants adversarial tests before it wants cleverness:
assert that member A cannot read group B's rows, for every policy touched, and
run those tests against the _old_ policies first to confirm they fail closed.
_Verify:_ `npm run test:sql` against WASM Postgres, `npm run check:migrations`.

**A5. Edge function for the GoTrue ban.** `account_status = 'blocked'` stops the
shared surfaces via RLS and pauses sync, but the JWT stays valid until it
expires — so blocking is defence-in-depth, not a hard stop. An edge function
calling `auth.admin.updateUserById(uid, { ban_duration })` is what kills live
sessions. I can write and test it; **deploying it needs Part B item 1.**
_Verify:_ unit tests locally; real behaviour is unverifiable from here.

### Wave 2 — needs wave 1, still no hardware

**A6. Per-user module switches.** 0011 is global-only. Add a second table for
per-account overrides plus the merge rule (user override wins; absence falls
through to global), then thread it through `features/module-flags/`. This is what
makes staged rollouts and one-off support fixes possible.
_Verify:_ `npm run test:sql`, `npm test`, `npm run typecheck`.

**A7. Operator console UI — `operator_report_queue()` first.** All moderation is
SQL in the editor today: fine for one owner, poor for a moderator working a queue
at 3am. Build the report queue screen before the module-switch admin UI or the
metrics dashboard, because it is the one with a live person waiting on it.
_Decision needed from you first — see B9._

**A8. Admin UI for module switches.** Today: `select
public.admin_set_module_enabled('split', false, 'reason');`. Same host decision
as A7, so it follows A7 rather than leading it.

### Wave 3 — widgets (writable now, verifiable only on a device build)

**A9. Instant widget refresh on more events.** Currently launch + mutations +
30-minute tick. Widen the trigger set.

**A10. Widget polish.** Picker preview image; light/dark render variants.

**A11. Water "+1 glass" widget.** Needs headless background-write wiring — the
task handler runs where the stores are not reliably available, which is the same
constraint that forced the snapshot design for visibility and i18n. Expect the
write path, not the UI, to be the work.

**A12. Habits check-off widget.** Streaks-style tappable list; same headless
write constraint as A11.

All four are **build-level verifiable only** (`typecheck` + `expo export`).
Whether they actually work is Part B item 2.

### Wave 4 — large, and each has a prerequisite decision

**A13. Media bytes via Supabase Storage.** Buckets with per-user RLS, a resumable
upload queue, per-user quotas, download-on-demand cache. `remote_path` already
exists on every media table and nothing writes it. At scale this is the line item
that dominates the bill — **so it wants B10 (quota + opt-in decision) before it
wants code.** Not started until that answer exists.

**A14. SQLCipher underneath the private space** (`docs/SQLCIPHER.md`). Private
rows are already encrypted field-by-field, so this is defence in depth — but it
also covers every _other_ module's data at rest, which is the real argument for
it. Sequenced after A13 only because it touches the database everything else is
mid-flight on.

**A15. Private media in the sync story.** Vault images live in `private-vault/`,
encrypted field-by-field, absent from `gallery_photos`; 0016 does not touch them.
Depends on A13's shape and on the E2E decision below — deliberately last of the
media work.

**A16. Vault video support.** The 8 MB image ceiling exists because encryption
runs in JavaScript. Needs a native crypto module, which means a config plugin and
a dev build — so it cannot be validated before Part B item 2 either.

### Wave 5 — the two designed-not-built pieces

Both are gated on the same unsolved problem: **key exchange between two devices
without the server ever seeing the key.** QR-based transfer is the usual answer.
Neither should start before the other work is stable, and neither is a week.

**A17. Secure shared spaces (couples / groups).**

- Space gets a random symmetric key; content encrypted under it, uploaded as
  ciphertext the server cannot read.
- Invite carries the key **out of band** — QR or link fragment. _This is the
  whole design._ Anything that posts the key to Supabase silently converts this
  into a server-readable feature while looking identical in the UI.
- Wire the already-built `SecureContentView` (screenshot block, watermark, no
  save/share, report button) to real shared content.
- ⚠️ Revocation is partial and the UI must say so: removing a member stops them
  fetching _new_ content; it cannot un-know the key they hold. Rotating on
  removal fixes future content only.

**A18. E2E sync for private modules.** `sensitive: true` in `sync-tables.ts` was
built for this — upload ciphertext only, server column opaque. Needs the vault
key on the second device. **Do not add a "recover my vault" server path; that is
escrow by another name**, and the escrow decision was already made deliberately
and documented.

### Not in Part A

- **Streak-at-risk notifications** — deferred by design. Local notifications
  cannot evaluate completion state at fire time, so every version nags after the
  habit is done. Revisit only with FCM or a background task.
- **FCM** — only if we add server-driven notifications. Local reminders don't
  need it.
- **Starter-habit revision** — thirteen suggestions written blind. This wants
  real usage data, not another guess from me.
- **Abuse threshold tuning** — 20 invitations/hr, 10 groups/day. Check
  `abuse_counters` against a week of real traffic first.
- **`record_anon_activity` hardening** — anon-key-callable, bounded by a
  UUID-shape check and one row per install per day. Padding-prone rather than
  dangerous. Move behind an edge function with per-IP limits only if guest
  numbers start mattering commercially.

---

## Part B — needs you

Ordered by how much each unblocks.

**B1. Create two Supabase projects — staging and production.** _Unblocks
everything: auth, sync, A5's deployment, and B2._
Export `SUPABASE_DB_URL_STAGING` / `SUPABASE_DB_URL_PRODUCTION` **in your shell,
never in `.env`** — Expo inlines `.env` into the app bundle. Then
`npm run migrate:staging`, verify, `npm run migrate:production`. Put the project
URL + anon key in `.env` (placeholders today).
⚠️ 0016 drops columns that older builds still push, so apply it _during_ a
release, not ahead of one — a stale client's sync fails loudly.

**B2. Device validation.** _The #1 item. Everything below "verifiable only on a
device" in Part A is waiting on this._
`eas login && eas init && eas build -p android --profile development`, install the
APK, confirm: reminders fire, widget renders, sign-in and sync work. Then the
private-space checks — PBKDF2 unlock latency on a mid-range Android (target
< 1.5 s), screenshot blocking actually engaging, decrypt time for a full vault
grid.

**B3. Generate the operator keypair, offline.** `generateOperatorKeypair()` in
`features/private/services/vault-escrow.ts`. Public half only into
`EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY`. **Keep the private half out of this repo
and out of the deployment** — HSM or an offline password manager, never an env
var on Supabase. It is the one secret that turns every escrow row into
plaintext, and the database it opens is a far likelier breach target than a key
kept offline.

**B4. Throw the two bootstrap switches, before anyone else has access.**

- `insert into public.admin_allowed_origins (id, ip_range, label) …` — until the
  first row exists the allowlist is **inert** and admin access is unrestricted.
- `insert into public.admins (user_id, note) values ('<your-uuid>', 'owner');` —
  nothing in `admin_*` works until this row exists.
  Both must be done before adding any staff account, since a staff account would
  otherwise be usable from anywhere.

**B5. Raise the server-side password floor.** Supabase → Auth →
`password_min_length` = 10, and consider leaked-password protection.
`features/auth/services/password-policy.ts` is advisory until then — it improves
the choice, it does not stop a crafted request.

**B6. Google sign-in consoles.** Code is done and bundles clean; it has never run
against a real provider.

- Google Cloud: OAuth consent screen + a **Web** OAuth client whose redirect URI
  is `https://<project-ref>.supabase.co/auth/v1/callback`. That is Supabase's
  URL, not the app's.
- Supabase → Providers → Google: client id + secret.
- Supabase → URL Configuration → Redirect URLs: add **both**
  `lifeos://auth/callback` and `lifeos:///auth/callback`. An unlisted redirect is
  refused before the user sees anything.

**B7. Paid Apple Developer account.** Gates three things: Apple sign-in (App ID
capability, a Sign in with Apple key — `.p8`, one download only — and a Services
ID, then Supabase → Providers → Apple), the iOS widget, and A16's native module
on iOS.
⚠️ **Guideline 4.8**: Sign in with Apple must be offered wherever another
third-party login is. Shipping Google to iOS without Apple is a rejection — they
go live together. Android can ship Google alone.

**B8. Two assets before any store submission.**

- Notification status-bar icon: 96×96 white-on-transparent PNG in `assets/`,
  then I wire `"icon"` into the `expo-notifications` plugin.
- Real bundle identifier: replace the `com.lifeos.app` placeholder.

**B9. Decide where the operator console lives** — blocks A7 and A8.
An in-app admin route, a separate internal web page, or Metabase pointed at
`admin_active_users()` / `admin_module_reach()`. My recommendation: Metabase for
the metrics, a small internal page for the report queue. Don't build a custom
metrics UI before there are numbers worth looking at.

**B10. Decide the media-bytes policy** — blocks A13.
Per-user quota (GB), whether cloud media is opt-in, and free-tier limits. This is
a cost decision before it is an engineering one.

**B11. Decide what happens to vaults with no escrow row.** Vaults created while
signed out, or created before 0015, stay unreadable by operators. Backfill on
next unlock, or leave them alone. Either is defensible; the choice changes what
you can tell a reviewer.

**B12. Decide what deleting a vault should do to the server escrow.** Today it
does nothing — the escrow row goes with the account. Either wire
`destroyVaultKeys()` to delete the `vault_escrow` row, or say plainly in the UI
that it does not.

**B13. Prepare the store-review answers.** Cycle and intimacy data is GDPR
Art. 9 special-category, and App Store 5.1.3 governs the health parts. **LifeOS
is no longer end-to-end encrypted** — the vault master key is sealed to an
operator key and uploaded, deliberately. Expect to justify that in the review
notes and the data-safety form. `PRIVACY.md` and the in-app copy already say so.

**B14. Write the wipe limitation into T&S.** A modified build can decline to run
`wipe_local`. The server-side denial cannot be declined; the local wipe can. Say
that, rather than implying devices are controllable.

---

## Suggested order of operations

1. You: **B1** (Supabase projects). I: **wave 1** in parallel — none of it needs
   the projects to exist.
2. You: **B2** (device build). This is where the real bug list starts, and it
   will probably reorder everything below it.
3. You: **B3 + B4** before anyone but you has access to anything.
4. Me: **wave 2**, once B2 has told us what actually broke.
5. You: **B5–B8** as the store timeline requires. **B9/B10** whenever you want
   A7/A8/A13 to start.
6. Me: **waves 3–4**, verified against a real device as they land.
7. **Wave 5** last, and as its own project — the key-exchange design deserves a
   written spec before code.

The honest summary: of ~54 open items, **about 20 are code**. The rest are
accounts, secrets, assets and decisions — and B2 is the one that turns a
build-verified app into an observed one.
