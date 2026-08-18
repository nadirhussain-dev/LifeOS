# Daykeep — Remaining Tasks

Roadmap for the **Reminders / Notifications / Widgets** work.
Everything in the shipped section is on branch `feat/notifications-and-widgets` and
verified with `tsc` + `expo config` + `expo export` (build-level only — see caveat).

> ⚠️ **Nothing below the "Shipped" list has been observed running on a device.**
> Notifications and widgets do **not** run in Expo Go or `expo export`; they need a
> dev/production build. First real test: `eas build -p android --profile development`.

---

## ✅ Shipped (this branch)

- [x] Central notifications backbone (categories, quiet hours, deep-link tap, inbox)
- [x] Unified Notification Settings screen + dashboard bell & unread badge
- [x] Smart-digest delivery mode (folds water/habits/journal into one morning brief)
- [x] All 8 module reminders tagged with category + deep-link route
- [x] Android home-screen widget "Today at a glance" (tasks/habits/water) with per-row deep links + live refresh
- [x] Android notification channels (heads-up vs quiet) + brand color
- [x] True kill switch (master/category OFF cancels queued reminders)
- [x] Per-module reminder screens reconciled with central switches (CategoryOffNotice)
- [x] `eas.json` + bundle identifiers for dev builds
- [x] **Auth**: email/password sign-up/in/out + reset, guest mode, auth gate, profile
- [x] **Sync engine (v1)**: offline-first local↔Supabase, last-write-wins, `'local'↔uid` translation (guest→account migration automatic), per-module allow-sync toggles, auto-sync on launch/foreground + manual "Sync now"
- [x] **Sync & Account** settings screen (profile, sync status, module toggles, sign out)
- [x] **Supabase server schema** — `supabase/migrations/0001_init.sql` (profiles + trigger + 15 v1 tables + RLS)

---

## 🔁 Sync coverage, performance & hardening (0016 + 0017 shipped)

Sync now covers **every** local table except `notification_log`, which is this
phone's record of what it scheduled and is meaningless anywhere else.

- [x] **The local database could not open on a fresh install.** `TABLE_BOOTSTRAP_SQL`
      had six missing commas; SQLite rejects all six, and a failing statement
      aborts the whole exec. Every check in CI passed because they all read the
      SQL as text and nothing ran it. `database/schema.test.ts` now executes it
      against a real SQLite (`node:sqlite`), which is why CI needs Node 24.
- [x] **Everything left over now syncs**: tags and tag links, wiki-links between
      entries, routine and playlist membership, custom journal prompts,
      per-module settings, and media metadata.
- [x] **Media syncs as rows, not bytes.** Albums, playlists, captions, ordering
      and favourites travel; the photo/video/audio files stay on the device that
      imported them and show as "Not on this device" elsewhere.
- [x] **Device-local columns stopped travelling.** `reminder_notification_id`
      had been syncing since 0001 — one phone's OS notification handles
      overwriting another's, which is how you get a reminder that cannot be
      switched off. Dropped server-side in 0016.
- [x] **Cursors are `(updated_at, id)` pairs.** A plain timestamp cursor cannot
      advance past a page-full of rows sharing one millisecond, and those rows
      become permanently invisible to sync.
- [x] **Both directions paginate.** PostgREST caps a response at 1000 rows
      regardless; the old code took that as "everything", so a large account
      synced one page per launch.
- [x] Chunked pushes, one transaction per pulled page, throttle + jittered
      exponential backoff, and local sync indexes (the row lookup during a pull
      was a full table scan per row).
- [x] **RLS made affordable** (0017): every owner policy re-evaluated
      `auth.uid()` per row. Now `(select auth.uid())`, an InitPlan computed once
      per statement that the index can be used against.
- [x] **A blocked account is refused server-side** (0017). It could previously
      write freely — the only check was in the client. 0017 denied writes and
      left reads alone; 0019 closed reads too, so see the moderation section
      below for what a block now means.
- [x] **Session moved to the OS keystore** (`lib/secure-session-storage.ts`),
      chunked because a Supabase session exceeds SecureStore's 2048-byte
      threshold. Existing sessions migrate on first read rather than logging
      everyone out.
- [x] PKCE flow (the reset deep link no longer carries tokens in a URL),
      AppState-driven token refresh, and a real password policy.

Still to do here:

- [ ] **Raise the server-side password floor to match the client.** Supabase
      project settings → Auth → `password_min_length` (10) and consider enabling
      leaked-password protection. `features/auth/services/password-policy.ts` is
      advisory until that is done — it improves the choice, it does not stop a
      crafted request.
- [x] **Media bytes** (0026). A private bucket, four isolation policies on one
      predicate (the first path segment is your own uid), a per-account quota
      enforced by a trigger rather than a policy, an opt-in that is off by
      default, and download-on-demand. Resumable by construction: each file is
      one request and `remote_path` is the record that it succeeded, so an
      interrupted run resumes by finding the rows whose column is still null.
- [ ] ⚠️ **Set the media quota.** `public.media_quota_bytes()` returns 2 GiB,
      which is a placeholder chosen to be obviously finite, not a costed
      decision. At a million accounts the difference between 2 GB and 20 GB is
      the difference between a hobby bill and a funding round. One statement to
      change, and it is the number the app and the trigger both read.
- [x] **The expense-group policies are hoistable now** (0023). Inverted rather
      than optimised: instead of "is the caller in _this row's_ group?" per row,
      "which groups is the caller in?" once per statement, tested with
      `group_id in (select public.my_expense_group_ids())`. Same predicate, so
      the whole existing 0003–0021 group suite passes unchanged — which is the
      evidence that mattered, given how this could have leaked. Three new tests
      cover the failure the new shape could introduce: a set that spans groups
      instead of scoping to one.
- [ ] **Nothing here has run against a real Supabase project or a real device.**
      The migrations are executed by `npm run test:sql` against WASM Postgres and
      the local schema by `npm test`; neither proves behaviour on hardware.

## 🛡 Moderation & operations (0018 + 0019 shipped — see docs/OPERATIONS.md)

- [x] **Migration runner** — `npm run migrate:status|staging|production`, with a
      `schema_migrations` ledger, checksums that refuse an edited-after-applied
      migration, an advisory lock, and a transaction per file. Two databases,
      staging and production, from shell env vars only.
- [x] **Two operator tiers.** `staff` can reach an account only while a live
      report names it; `admin` is unrestricted. Both audited, both still behind
      0014's origin allowlist. Existing rows default to `admin`.
- [x] **A block now blocks.** RLS denies reads _and_ writes; the device is sent
      a `wipe_local` command it acknowledges; production keeps the data
      soft-deleted so an unblock restores it.
- [x] **Evacuation window** so the wipe does not destroy what the cloud never
      received, and an honest list of what it could not save.
- [x] **Admin can read any row including soft-deleted ones**, with no password
      or PIN, against a table whitelist and with an audit row first.

Still to do here:

- [ ] **Register the admin origins before adding any staff.** Until the first
      `admin_allowed_origins` row exists the allowlist is inert (0014), which
      means a staff account would be usable from anywhere. That bootstrap is now
      load-bearing in a way it was not when there was one operator.
- [x] **User-side reporting and blocking** (0021). `submitReport` had existed
      since 0013 with no caller — the app had a complete abuse pipeline and no
      opening. There is now a report sheet on the group and on every member, a
      block reachable without reporting first, and a Settings → Blocked accounts
      screen to undo one. Enforcement is server-side across all three contact
      routes. `features/moderation/moderation-wiring.test.ts` fails if any of it
      becomes unreachable again.
- [x] **Operator console** — `app/settings/operator.tsx`. The report queue
      (already triaged by open-report count) and the global module switches,
      which asked for a uuid typed by hand until now. Deliberately a view over
      the existing RPCs and not a second permission system: the report gate, the
      admin/staff split and every audit row stay in the database, because rules
      the console enforced itself would be rules anybody could bypass with
      `curl`. The row is hidden unless `is_staff()` says otherwise, and defaults
      to hidden if the check fails.
- [ ] **An account page inside the console.** The queue hands over each uuid to
      copy, because acting on an account still means an RPC. Per-account module
      overrides (0024), status changes and report resolution all want that
      screen rather than a uuid field bolted onto a global list.
- [ ] **Wipe needs a cooperating client.** A modified build can decline to run
      it. The server-side denial cannot be declined; the local wipe can. Worth
      stating in any T&S policy rather than implying devices are controllable.
- [x] **A blocked account can get its own data** (0022). "Download my data" on
      the block screen calls `export_own_data`, which is SECURITY DEFINER so it
      sees past the block, includes the soft-deleted rows a purge left behind,
      and takes **no user id at all** — it reads `auth.uid()` and nothing else,
      which is the whole of its safety argument. A test asserts no overload
      taking a uuid exists, so adding one fails the build rather than review.
      `private_entries` stays out and the exported file says why: the server
      holds ciphertext sealed to a key it never had.
- [ ] **Appeals are still a mailto.** The data-access half is automated now;
      deciding an appeal is not, and probably should not be.
- [ ] **No staging project exists yet.** The runner supports one; nothing has
      been run against either database.

## 🔑 Sign-in providers (code done, consoles are yours) — docs/AUTH_PROVIDERS.md

Google and Apple sign-in are built and bundle clean. **Neither has run against a
real provider**, and cannot from here. Until the consoles are configured both
buttons appear (whenever the Supabase vars are set) and fail with "That sign-in
method is not switched on for this project yet." Email and guest are unaffected.

- [ ] **Google Cloud** — OAuth consent screen + a **Web** OAuth client whose
      redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`. That
      is Supabase's URL, not the app's; Google redirects to Supabase and Supabase
      redirects to the app.
- [ ] **Supabase → Providers → Google** — client id + secret.
- [ ] **Supabase → URL Configuration → Redirect URLs** — add both
      `daykeep://auth/callback` and `daykeep:///auth/callback`. An unlisted
      redirect is refused before the user sees anything.
- [ ] **Apple** — needs the paid developer account (same one blocking the iOS
      widget): App ID capability, a Sign in with Apple key (`.p8`, one download
      only), a Services ID, then Supabase → Providers → Apple.
- [ ] ⚠️ **Guideline 4.8**: Sign in with Apple must be offered wherever another
      third-party login is. Shipping Google to iOS without Apple is a rejection —
      they go live together. Android can ship Google alone.

## 🔒 Needs you (blocked on account / asset / decision)

- [ ] **Supabase projects** — create **two** (staging and production). Export
      `SUPABASE_DB_URL_STAGING` / `SUPABASE_DB_URL_PRODUCTION` in your shell —
      never in `.env`, which Expo inlines into the app bundle — then
      `npm run migrate:staging`, verify, `npm run migrate:production`. Put the
      project URL + anon key in `.env` (currently placeholders). Required before
      auth or sync can run. 0016 drops columns that older app builds still push,
      so apply it during a release rather than ahead of one — a stale client's
      sync will fail loudly.
- [ ] **Device validation** — _partly done._ An Android dev build runs on hardware and local reminders have been observed firing and landing in the in-app inbox. Still unconfirmed: the home-screen **widget** rendering, and **sign-in/sync** — the latter blocked on a Supabase project existing at all.
- [x] **Notification status-bar icon** — `assets/notification-icon.png` (96×96 RGBA) is wired into the `expo-notifications` plugin with `color: #6366f1`, and renders tinted in the tray.
- [ ] **Real bundle identifier** — replace the `com.daykeep.app` placeholder before any store submission.
- [ ] **iOS widget prerequisite** — a paid Apple Developer account (to build/test on a device).

## 🔐 Private space (shipped — these harden it further)

- [ ] **Device validation.** None of this has run on hardware. Priority checks:
      PBKDF2 unlock latency on a mid-range Android (target < 1.5s), screenshot
      blocking actually engaging, and decrypt time for a full vault grid.
- [ ] **SQLCipher underneath it** (`docs/SQLCIPHER.md`). Private rows are already
      encrypted field-by-field, so this is defence in depth rather than a
      prerequisite — but it would also cover the _other_ modules' data at rest.
- [x] **Hidden entry point.** The private-space row can now be removed from
      Settings, from inside the space itself. The way back is a long-press on
      the version number under Settings → About — wired up unconditionally,
      hidden or not, so the gesture can become habit before it becomes the only
      route. The confirmation names it and asks you to try it once.
- [ ] **Vault video support.** Images only today — the 8 MB ceiling exists
      because encryption runs in JavaScript. Needs a native crypto module.
- [ ] **Encrypted E2E sync for private modules.** The `sensitive` flag in
      `sync-tables.ts` was built for this: upload ciphertext only, so the server
      cannot read it. Requires key transfer between devices, which is its own
      design problem (QR-based key exchange is the usual answer).
- [ ] **Private media is not covered by the media-metadata sync** — and cannot
      be until the key-exchange question below is answered, since syncing it
      means either uploading ciphertext the other device cannot open or
      uploading the key. Belongs with "E2E sync for private modules", not with
      the media work. Vault images
      live in `private-vault/` and are encrypted field-by-field; they are not in
      `gallery_photos` and nothing in 0016 touches them.

## 🔑 Operator access & escrow (0014 + 0015 shipped) — READ THIS FIRST

**Daykeep is no longer end-to-end encrypted.** The vault master key is sealed to
an operator X25519 key and uploaded, so staff can open any signed-in user's
private space. This was a deliberate decision; the app copy and PRIVACY.md have
been rewritten to say so.

- [ ] **Generate the operator keypair, offline.**
      `generateOperatorKeypair()` in `features/private/services/vault-escrow.ts`.
      Put only the **public** half in `EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY`.
- [ ] **Keep the private half out of this repo and out of the deployment.** It
      is the one secret that turns every escrow row into plaintext, and the
      database it opens is a far likelier breach target than a key kept offline.
      HSM or an offline password manager; never an env var on Supabase.
- [ ] **Register admin origins before launch** —
      `insert into public.admin_allowed_origins (id, ip_range, label) …`.
      Until the first row exists the allowlist is inert and admin access is
      unrestricted (that is the bootstrap, and it is a switch you must throw).
- [ ] **Store review will ask.** Cycle/intimacy data is GDPR Art. 9
      special-category and App Store 5.1.3 governs the health parts. Expect to
      justify operator access in the review notes and the data-safety form.
- [x] **DECIDED (2026-08-10): stay end-to-end encrypted, do not switch escrow
      on.** `vault_escrow` had no SELECT policy, so Postgres refused `INSERT …
ON CONFLICT DO UPDATE` against it regardless of whether a conflicting row
      existed. PostgREST's `.upsert()` emitted exactly that, `uploadEscrow()`
      was the only writer, and `setup.tsx` never checked its result — the table
      was empty and every private space to date was accidentally end-to-end
      encrypted, while PRIVACY.md claimed staff could read it. 0025 fixed the
      write path (it now works, if configured), but the call here is to leave
      `EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY` unset — Art. 9 health data (cycle,
      recovery) server-side in decryptable form is a bigger breach target and
      harder App Store conversation than the abuse-handling case for it — and
      PRIVACY.md's "What Daykeep staff can access" section is rewritten to say
      plainly that this capability exists in code but is switched off, rather
      than asserting access that doesn't happen. Revisit only with a concrete
      abuse/legal need, and update PRIVACY.md before flipping the switch, not
      after.
- [x] **Escrow is backfilled on unlock** for a vault created while signed out or
      before 0015. Real space only: sealing the decoy's key would escrow the
      wrong vault, and a row that changes between unlocks is itself evidence a
      second space exists.
- [x] **Destroying a vault removes the server escrow** (`delete_own_vault_escrow`).
      It cleared the local keystore and nothing else, so the most explicit
      "I want this gone" the app offers left the space unreadable to its owner
      and readable to an operator.

## 🤝 Sharing & E2E sync — DESIGNED, NOT BUILT

Decisions are locked (end-to-end encryption kept; sharing protections are
best-effort and stated honestly). These two are the remaining large pieces.

**Secure shared spaces (couples / groups)** — the hard part is key exchange, not
the UI:

- [ ] Space has a random symmetric key. Content is encrypted under it and
      uploaded as ciphertext; the server stores bytes it cannot read.
- [ ] Invite carries the space key **out of band** — a QR code or a link
      fragment that never reaches the server. This is the whole design; anything
      that posts the key to Supabase silently converts this to server-readable.
      **The mechanism for this now exists**: `features/private/services/key-transfer.ts`
      is exactly a two-channel out-of-band key handoff, built for moving a vault
      between one person's devices, and a space invite is the same protocol with
      a different key. Reuse it rather than writing a second one.
- [ ] ⚠️ **DECIDE FIRST: what actually goes in a shared space.** This is the
      open question, and it is a product one rather than a cryptographic one.
      The key exchange, the ciphertext-at-rest pattern and the viewer all exist
      or are specified; what does not exist is an answer to "a couple shares…
      what?" — a note, a photo album, a whole module, a chat. The table shape,
      the sync rules and the revocation story all follow from that answer and
      none of them can be sensibly designed before it. Building the storage
      first would mean guessing, and a guess here is a migration to undo.
- [ ] Viewer: `SecureContentView` is already built (screenshot block, watermark,
      no save/share, report button). Wire it to real shared content.
- [ ] ⚠️ **Revocation is partial and must be said so in the UI.** Removing a
      member stops them fetching _new_ content; it cannot un-know the space key
      they already hold, so anything they already downloaded stays readable.
      Rotating the key on removal fixes future content only.

**E2E sync for private modules** — ✅ done, and most of it already was:

- [x] `private_entries.payload` has been `base64(nonce || AES-GCM(...))` since
      the vault was built, 0015 gave the server a table with per-user RLS, and
      the sync engine moves it like any other row. **Private modules have always
      synced end-to-end**; this entry was describing work that was finished.
- [x] **The vault key now moves between devices** — the part that was genuinely
      missing, and without which the second device receives ciphertext it can
      only ever render as noise. Two channels: the payload (the key wrapped
      under PBKDF2(one-time code, fresh salt)) travels however the user likes,
      and the code travels separately, ideally spoken. Neither reaches our
      server. `adoptVault` installs it under this device's own PIN — reusing
      `setUpVault` would mint a fresh master key and leave every already-synced
      private row permanently unreadable while looking like it worked.
- [x] No "recover my vault" server path, as instructed. It would be escrow by
      another name, and this app already has one escrow scheme it is honest
      about.
- [ ] **QR instead of paste.** The payload is already QR-sized, so this is a
      rendering change rather than a redesign — it needs `expo-camera` for
      scanning, which is a native module that cannot be verified without a
      device build. Same call as native Google sign-in.

## 🎛 Module switches (0011 shipped — these finish it)

- [x] **Privatised modules no longer write legible notifications.** A privatised
      module's reminders still fire and still deep-link, with text that names
      nothing ("You have a reminder") — dropping them would penalise somebody
      for using a privacy feature. An operator-_disabled_ module is suppressed
      outright instead, which is a different problem with a different answer.
      Both flip a full reminder resync, because the OS owns the text of anything
      already queued and will not let us edit it. See
      `features/notifications/services/notification-visibility.ts`.
- [x] **Widget respects both switches.** Visibility is decided in the app and
      baked into the snapshot, since the widget's task handler runs headless
      where those stores are not reliably available. `EMPTY_SNAPSHOT` defaults
      every row to hidden so an upgrade stops leaking immediately rather than on
      next launch.
- [x] **The widget speaks all four languages.** Strings are formatted in the app
      with i18next's own plural rules and put in the snapshot, for the same
      reason `show` is — i18next is not safe to initialise in the headless task
      handler. A language change rewrites the snapshot, because nothing else
      would ever invalidate it.
- [x] **Per-user switches** (0024). A user override wins; absence falls through
      to the global switch; absence of both means enabled. The override is a
      tri-state rather than a boolean, which is the load-bearing part — without
      a middle value there is no way to say "on for this account while off
      globally", and that is exactly what a staged rollout is. The client reads
      the merged `my_module_flags()` instead of the table. The internal
      per-account note is never returned to its subject; only the global row's
      user-facing `message` is.
- [x] **Admin UI for the global switches** — now in the operator console, with a
      confirmation and a field for the message users will see. Per-account
      overrides still want an account page; see the operator section.

## 📊 Operator surface (0010 shipped — these finish it)

- [ ] **Seed the admin roster** — `insert into public.admins (user_id, note) values ('<your-uuid>', 'owner');`
      from the SQL editor. Nothing in `admin_*` works until this row exists, and
      the table is invisible to clients by design.
- [x] **A hard block now ends the session** —
      `supabase/functions/ban-account` calls
      `auth.admin.updateUserById(uid, { ban_duration })`, which is what actually
      invalidates the token a blocked account is already holding. It reads the
      caller's JWT and asks the database `is_admin()` _as that caller_, so a
      client cannot claim its own privileges; banning yourself is refused,
      because it locks the only account that could unban anybody. **Needs
      `supabase functions deploy ban-account`.**
- [ ] **Admin dashboard** — point Metabase (or a small internal page) at
      `admin_active_users()` / `admin_module_reach()`. Don't build a custom UI
      before there are numbers worth looking at. Same reasoning parks the
      operator console and the module-switch UI: every capability behind them is
      callable from the SQL editor today, and this account has no users yet, so
      a bespoke console would be built against imagined usage.
- [ ] **Tune the thresholds** — 20 invitations/hr and 10 groups/day are guesses.
      Check `abuse_counters` against real traffic after a week before trusting
      them.
- [ ] **`record_anon_activity` is callable with only the anon key** — bounded by
      a UUID-shape check and one row per install per day, so it is padding-prone
      rather than dangerous. Move it behind an edge function with per-IP limits
      if guest numbers ever matter commercially.

## 🔁 Sync v2 (deeper coverage)

> Most of this list was **already delivered by 0016/0017** and the section had
> not been updated — child/log tables, per-module settings rows and media
> metadata all sync, and account-switch handling shipped as
> `features/sync/services/account-reconcile.ts`. What is genuinely left:

- [x] Media **bytes** via Supabase Storage (0026) — see the sync-hardening
      section above for the design and the one number still to set.
- [x] **Conflict surfacing.** Last-write-wins still wins — losing is just no
      longer silent. A local edit overwritten by a newer one from another device
      is recorded with a snapshot and offered back from Settings → Sync.
      Detection keys off the set of rows the push _just uploaded_, which is
      exactly "edited here since the last sync"; without that, every ordinary
      remote update would read as a conflict. Restoring stamps `updated_at` to
      now so the other device converges, rather than being undone by the next
      pull.

## 🚀 First run (rebuilt — what is left)

- [ ] **Nothing here has been seen on a device.** The seeding writes real habit
      rows and real settings on a real database; `expo export` proves it bundles,
      not that it runs.
- [ ] **Starter habits are a guess.** Thirteen suggestions across nine focus
      areas, written blind. Worth revisiting once anyone has actually used them.
- [x] **Dead locale keys swept**, and `npm run check:i18n` now fails the build on
      a key used in code that no locale defines, or a key English has that
      another language does not. Its first run found six of the former — four of
      which predated the onboarding rewrite, including a gender step that had
      been rendering `onboarding.genderQuestion` on screen as literal text.
- [ ] **The onboarding flag is per device, not per account.** A brand-new
      account signing in on a phone somebody else already onboarded lands
      straight in the tabs — no name, no focus areas, no starter data.
      `onboardingComplete` lives in `useProfileStore`, and an account switch
      keeps it deliberately (`wipeLocalData` calls `resetAnswers()`, not
      `reset()`), so `useAuthGate`'s `onboardingComplete || accountOnboarded`
      reads true for an account that has never seen the flow. Confirmed on a
      device: a Google sign-up landed on the profile screen with an empty
      display name and no username.
- [ ] **...and the obvious fix is a worse bug**, which is why the above is still
      open. Distrusting the flag whenever the loaded profile has no
      `onboardingCompletedAt` strands anyone who finished onboarding offline:
      `markOnboardingComplete` writes the local stamp only _after_ a successful
      server update and returns silently on failure, with no retry, so they
      would be bounced into the wizard on every launch, permanently. An
      optimistic local write does not save it either, because `loadProfile`
      re-reads the row and overwrites it. The flag has to become
      **account-scoped** first — record _which_ user id completed onboarding on
      this device, treat "some other account finished it" as not-onboarded, and
      keep "this account did, we just cannot reach the server" as onboarded.
      `app/auth/callback.tsx` and `app/(auth)/create-password.tsx` make the same
      `deviceOnboarded || accountOnboarded` call and want the same treatment.

---

## 🟢 Buildable next (verifiable only on a device build)

- [ ] **iOS widget** — "Today at a glance" via `expo-widgets` (SwiftUI/Expo UI).
      Still blocked on the paid Apple Developer account.
- [x] **Water "+1 glass"** — a button on the Today widget. The headless handler
      cannot write to SQLite, so a tap queues an intent and nudges the snapshot;
      the app turns intents into rows on its next run. The action carries the
      **local date of the tap**, so a glass logged at 11:50pm is not filed
      against tomorrow.
- [x] **Habits check-off widget** — its own widget (`DaykeepHabits`), because a
      list needs height and a glance needs none. Marks done; does not un-tick —
      a home-screen control has no undo, and `logHabit`'s upsert is what makes
      the safe direction replay-proof.
- [x] **Light/dark render variants** — `renderWidget` takes `{ light, dark }`
      and the launcher picks. The light accents are darkened rather than
      inverted, because #34d399 on white is about 1.8:1.
- [ ] **Widget picker preview image** — still needs a real PNG asset, which is
      an asset question rather than a code one.
- [x] **Both widgets refresh together** on every sync, so ticking a habit in the
      app does not leave a placed Habits widget stale until the half-hour tick.

---

## ⚖️ Deferred (by design)

- [ ] **Streak-at-risk notifications** — local notifications can't evaluate completion state at fire time, so any version nags after the habit is done. Revisit only with server push (FCM) or a background task. In-app confetti already covers celebrations.

---

## 🔵 Later / optional

- [ ] **FCM (server push)** — only if we add remote/server-driven notifications. Local reminders don't need it.
- [x] **Goals and Study categories are back.** Both have schedulers now:
      `features/goals/services/goal-reminders.ts` (one dated reminder per goal
      with a due date, capped at twelve and horizoned at 120 days, because iOS
      silently discards past 64 pending) and
      `features/study/services/study-reminders.ts` (one weekly trigger per
      selected weekday, not a daily one — a DAILY trigger nags on the days it
      was told not to). `streak` stays hidden, and its exclusion now carries the
      reason in the code: it genuinely needs to evaluate state at fire time.
