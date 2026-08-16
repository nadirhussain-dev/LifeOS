# Daykeep — Full-App Audit (gaps & refactors to reach global/production standard)

Date: 2026-07-24. Scope: architecture & code quality, backend/sync/security, UX/accessibility/performance, and production-readiness. Read-only analysis; nothing changed.

**Overall:** The product code is unusually disciplined — `strict` TS with ~0 `any`/`@ts-ignore`, a clean repository/hook/store layering, integer-cents money, a strong theme/token system, and genuinely good "why" comments. The gaps are **not sloppiness** — they're the engineering safety-net and correctness edges that separate a well-built prototype from a shippable, multi-device, global product: **sync correctness, at-rest security, tests, observability, and store/legal compliance.**

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low. Each item tagged by area.

---

## ✅ Fixed in the remediation pass (2026-07-25)

Verified each step with `tsc --noEmit` + `jest` (18 tests) + `expo export` (all green).

- **[DATA] Delete-sync bug** — all 15 synced repos now bump `updatedAt` on soft-delete, so deletes propagate (no more resurrecting data).
- **[DATA] Account-switch bleed** — `reconcileAccountOnSignIn()` wipes local data + cursors + profile when a different uid signs in (tracked via `sync-store.lastUserId`); wired into the auth store.
- **[OBSERVABILITY] Error visibility** — root `ErrorBoundary` (recover UI), `lib/error-reporting.ts` choke point, query/mutation `onError` un-gated for production (Sentry-ready via `setErrorSink`).
- **[CORRECTNESS] Currency** — `money.ts` now uses `Intl.NumberFormat` + device locale (`expo-localization`), fixing zero-decimal currencies (JPY/KRW) and locale formatting; half-cent rounding fixed (`+ EPSILON`).
- **[HABITS] Streak bug found & fixed** — `calculateHabitStreaks` current-streak was capped at 0/1 and best-streak couldn't exceed it; rewritten (full backward run + full-history best) and locked with tests.
- **[TESTING] Test infra** — `jest-expo` + `@testing-library/react-native`; `test`/`typecheck`/`format:check` scripts; unit tests for `money.ts` and `habit-streaks.ts` (18 tests).
- **[CI] Pipeline** — `.github/workflows/ci.yml` runs typecheck + lint + tests on push/PR.
- **[DATA/PERF] Server indexes** — `(user_id, updated_at)` index on all 15 sync tables in the migration.
- **[ARCH] features↔widgets cycle** — broken: feature hooks no longer import widgets; the widget refreshes via a query-cache subscription (`use-widget-sync`).
- **[LEGAL] Data export** — now covers budget, goals, sleep, study, and gallery (was omitted).
- **[BUILD] Release config** — `runtimeVersion` (fingerprint) + iOS `privacyManifests` (required-reason APIs) added to app.json.
- **[A11y] Primitives** — `Button` now sets `accessibilityRole`/`accessibilityState`; shared `QueryError` state + wired into the transactions screen (loading skeleton + retry) as the rollout pattern.
- **[BUILD] Missing dep** — installed `expo-local-authentication` (app-lock imported it but it was absent; build was broken).

**Still requires you (external — can't be done from here):**

- **Sentry**: `npx expo install @sentry/react-native`, add its config plugin + DSN, then `setErrorSink((e, ctx) => Sentry.captureException(e, { extra: ctx }))` at startup. The choke point is ready.
- **At-rest encryption (SQLCipher)**: swap the SQLite layer (e.g. op-sqlite) with a key in `expo-secure-store` — a native change to validate on a device.
- **In-app account deletion**: needs a Supabase edge function (`auth.admin.deleteUser` + delete the user's rows) — the client can't do it. Add a "Delete account" action calling it.
- **Privacy policy + store data-safety declarations**, real bundle id, `eas init`, EAS env values, notification mono-icon.

**Perf & a11y sweep (2026-07-25, second pass):**

- **[PERF] Gallery** — migrated to `expo-image` (downsampling/disk-cache/recycling) everywhere except the view-shot capture path in `compare.tsx`; the "All Photos" grid is now a virtualized `FlashList` (`PhotoGridList`).
- **[PERF] Transaction history** — now a virtualized `FlashList` (+ loading skeleton + error state).
- **[A11y] Dynamic type** — `Text` caps scaling at 1.4× (overridable); **SwipeableRow** exposes `accessibilityActions` for swipe-only archive/delete (wired into the task row).
- **[UX] Error states** — `QueryError` (retry) wired into Tasks, Habits, and Transactions on load failure.

**Launch-prep pass (2026-07-27):**

- **[BUILD]** Installed the missing `expo-asset` peer dep (would crash outside Expo Go) and de-duplicated native modules; `@types/jest` pinned to the SDK-expected version → `expo-doctor` 18/18.
- **[A11y]** All remaining `TextInput`s now set `accessibilityLabel` (auth field, all pickers, goal/habit forms, note/journal/study editors, gallery caption) — `grep` confirms zero unlabeled inputs.
- **[UX]** Optimistic `complete`/`reopen` on tasks (mirrors the shipped habit toggle) so the checkbox fills instantly with rollback on error.
- **[CI]** `format:check` added to the pipeline; whole repo run through Prettier so it stays clean. Lint config now ignores the Deno edge function.

**Still remaining (large refactors — recommend doing alongside device testing):**

- Feature barrels (`index.ts` public API per module) + ban deep cross-feature imports.
- Repository CRUD + reminder-service dedup (shared helpers).
- Optimistic photo-favorite (spans multiple gallery cache keys — deferred; verify on device).
- i18n string extraction (~247 strings) + hardcoded semantic-color → token cleanup.
- Schema drift (drizzle-kit migrations) and sync-cursor keyset (ms `>` edge).
- **External / device-only:** SQLCipher engine swap (key + guide ready — `docs/SQLCIPHER.md`, flip on the first dev build), Sentry DSN, Supabase project + deploy the `delete-account` edge function, real bundle id, notification mono-icon.

---

## ✅ Sync now carries the history (2026-07-30, fifth)

`tsc` · `eslint` · **128** jest tests · **52** SQL tests · 9 migrations · prettier clean.

**"Cloud sync" synced the definitions, not the record.** v1 covered each module's primary table — your habits, your goals, your subjects — and none of the tables holding what you actually did with them. Sign in on a second device and you got your habits back with **every streak at zero**, goals at 0%, no water history and no study sessions. Sync looked like it was working, which is the worst way for it not to.

The cause was mechanical, not a scoping decision anyone would defend: the engine detects change with `updated_at` and needs a soft-delete column so a removal propagates, and **none of the history tables had either**. 15 of 38 tables synced; now 22.

Added to sync: `habit_logs`, `habit_skips`, `water_intake_logs`, `goal_milestones`, `goal_progress_logs`, `study_sessions`, `journal_reflections` — plus a new **Water** entry in the per-module sync toggles, which previously had no way to be turned on or off because none of its data moved.

Three things this needed beyond adding a column:

- **`BACKFILL_SQL`.** A column added as `NOT NULL DEFAULT 0` leaves every existing row at 0, and the push is `WHERE updated_at > cursor` starting at 0. `0 > 0` is false — so without the backfill, all history already on the device would be permanently invisible to sync, and the bug would look exactly like sync working. Runs after `ADDITIVE_COLUMNS`, idempotent.
- **Hard deletes became soft.** Un-ticking a habit, undoing a glass of water and deleting a progress log all removed the row outright. That cannot sync: the row is simply resurrected by the next pull from another device, silently re-ticking a habit the user cleared. All reads now filter tombstones, and re-ticking a previously-cleared day revives its row rather than inserting a duplicate alongside it.
- **`0009_history_sync.sql`** — 7 mirror tables, RLS scoped to `user_id = auth.uid()`, and a `(user_id, updated_at)` index on each, which is exactly how the engine reads them.

**`sync-contract.test.ts`** holds the line: every registered table is asserted to have `id`, `user_id`, `updated_at` and `deleted_at`, to appear in a Supabase migration, to be listed after its parent, and to have a backfill. A table registered without them doesn't error — it just never syncs — which is precisely how this gap opened.

Still not synced, for reasons that are not interchangeable: **media** (`gallery_*`, `songs`, `playlists`, both attachment tables) because the rows point at files in private storage and syncing a row without its file gives another device broken references; **join tables** (`note_tag_links`, `habit_routine_items`, `playlist_songs`) which have no single-column id; **settings singletons** (`sleep_settings`, `study_settings`, `budget_settings`) keyed by `user_id` with no `id`; and `journal_prompts` (app content) / `notification_log` (device bookkeeping), which never should.

---

## ✅ Branding, search and notification presentation (2026-07-30, fourth)

`tsc` · `eslint` · **100** jest tests · 48 SQL tests · `expo config` resolves · all 4 locales at key parity (1391 each).

**The app shipped with Expo's placeholder art.** `icon.png`, `adaptive-icon.png` and `splash-icon.png` were still the `create-expo-app` output — grey concentric circles on graph paper — so every EAS build installed with a stock Expo icon and flashed the same placeholder on launch. The config had pointed at the right paths all along; the files behind them had never been replaced.

`scripts/make-brand-assets.mjs` (`npm run assets`) now draws all seven from one geometry function. **Twelve** marks were drawn and compared at the size an icon is actually met at — a settings row and a status bar, not a store page — and all twelve are kept in a `MARKS` registry with `ACTIVE` selecting the one that ships, so changing the app's identity is a one-word edit and a re-run rather than a redraw.

Shipping **aperture**: six blades leaving a hexagonal opening. It is the only mark in the set whose _negative space_ does the work, which is what keeps it legible at 48px, and it reads as a lens on a life rather than a letter in a box. Verified by dumping the status-bar stencil's alpha map — the opening survives at 96px.

Three were discarded outright, because drawing them was the only way to find out: a ligature that read as a "6", a sunrise that came out a croissant, a leaf that came out an umbrella. `strata` nearly joined them — its nested squares rendered invisible until the hit test was reordered smallest-first, since the outer square returns on every point inside it.

Shipping **modules**: four life areas as unlike shapes, two of them recessed. It says "operating system" without leaning on a letter, and the mix of solid and receded forms is the design system's own premise ("depth comes from layered surfaces, never from neomorphic bevels"). Kept but not shipped: **pulse** (cleanest silhouette, reads as a health app), **bloom** (warmest, reads as a clover), **monogram** (carries the name, but a letter in a box is the safe answer). Discarded outright, because drawing them was the only way to find out: an orbit whose node collided with its own ring, an arc that resolved into nothing when scaled down, a leaf that came out an umbrella, a sunrise that came out a cloche.

Recessed layers are flattened for the Android status-bar stencil, which renders from the alpha channel alone and would otherwise fill them — giving exactly the solid white blob that icon exists to avoid. Rendered in code, not committed as opaque binaries, so the mark stays reviewable; PNG is only zlib + CRC32, so there's no image dependency. Centred on the ink's own bounding box rather than its geometry box, which is what stops it sitting visibly high-left. Colours are the same gradient the accent Button paints with.

Also fixed: the Android adaptive icon had a flat white backdrop (now the gradient); the splash used one white mark on a _light_ ground in light mode (now tinted per theme); and `AnimatedSplash` drew a generic Lucide **leaf**, so the launcher icon, the native splash and the in-app splash were three different marks. `components/ui/daykeep-mark.tsx` is now the single definition, geometry-matched to the generator.

**Global search.** Twelve modules, and no way to look through more than one — so anything written down was findable only if you already remembered which module you put it in, which is the memory the app exists to do for you. `searchEverything()` reads tasks, notes, habits, goals, journal, transactions, debts, subjects, songs, playlists and albums, each source isolated so one broken table costs only its own results. Ranked, not merely filtered: exact title → title prefix → word-boundary → substring → body, with recency used _only_ to break ties, so a good match never loses to a newer bad one. 14 tests pin the ranking. Reachable from Home and Hub.

**Streak grace.** A streak that resets to zero on one bad day is loss aversion: it punishes hardest exactly when somebody is ill, busy or travelling, and what they stop doing is opening the app. One missed day is now survived — not counted — and a second still breaks the run. `graceUsed` surfaces it in the UI as "1 day missed — streak held", because hiding it would be the app flattering a number at the user's expense. Writing the tests surfaced a real bug in the first attempt: the walk ran off the start of history and spent the grace day there, mislabelling healthy streaks and nearly letting two empty days extend a run. Fixed by stopping at the first-ever log.

---

## ✅ Split group lifecycle (2026-07-30, third)

`tsc` · `eslint` · 65 jest tests · 48 SQL tests · 8 migrations — all green.

**A member could be removed, and it silently lost money.** Removal set `deleted_at`, `listMembers` filtered those rows out, and balances are computed only over the members it returned — so everything a removed person had PAID left the ledger while everything they were OWED for stayed in it. Reproduced: a £100 dinner paid by Alice and split four ways left Bob, Carol and Dave owing £25 each, nobody owed anything, the nets summing to **−£75**, and `simplifyDebts` returning **no transfers at all** — "Settle up" declaring the group square over three live debts.

Removal is now a tombstone throughout. `listMembers` returns everyone who has ever been in the group; `useGroupDetail` exposes `activeMembers` alongside for the pickers; balances compute over the full set. Five tests in `split-math.test.ts` pin it, including one that keeps the old broken arithmetic as an executable description of why the filter must not come back.

**Groups could never be deleted.** `expense_groups.deleted_at` existed and every read filtered on it, but nothing set it — and the only alternative on offer, the `expense_groups_delete` policy, is a HARD delete that cascades away the whole ledger including other members' history.

**`0008_split_group_lifecycle.sql`**

- `delete_expense_group()` — owner-only, soft, and logs `group_deleted` _before_ marking the row (once deleted it is gone from every read, and the entry explaining why would have nowhere to be written from).
- `remove_group_member()` — owner removes, anyone may leave, the owner can never be removed (a group with no owner can never be administered again). Distinguishes `member_removed` from `member_left`, and writes the activity entry before the tombstone, since leaving revokes the membership the activity insert policy requires.
- A `before update` trigger on `expense_groups` guarding `deleted_at`. `expense_groups_update` is `using (is_expense_group_member(id))` — any member may write any column — so without this, every member could make the group vanish for everybody else. It has to be a trigger, not a policy: only OLD/NEW can see _which_ column changed.
- The activity action check constraint gains `group_deleted`, `group_renamed`, `member_removed`.

10 SQL tests cover it, including the one that matters most: a member cannot soft-delete the group by writing the column directly, bypassing the RPC.

**UI** — owners get "Delete group" in the header, everyone else "Leave group"; a members screen section for people no longer in the group showing whether they are settled or still owed; removal now warns with the outstanding amount rather than a bare "are you sure"; the expense form offers only current members, but keeps former ones visible and ticked on an expense they were actually part of, so editing an old dinner can't quietly move their share onto everyone else.

---

## ✅ Data-safety pass (2026-07-30, second)

Three field reports, three separate causes. `tsc` · `eslint` · 60 jest tests · 38 SQL tests all green.

**1. Sentry `42501` on `expense_group_activity`** — the failure 0007 fixes, from a build talking to a project that has not had 0007 applied. Migrations are applied by hand to the hosted database, so shipping the fix is not the same as deploying it. Added a client-side repair that works against _every_ deployed schema version: `ensureProfileRow()` upserts the caller's own `profiles` row (allowed by the existing `profiles_own` policy — no new SQL), called before `create_expense_group` and again on every `loadProfile`. Group creation now succeeds whether or not 0007 has been run.

**2. "Clear all data" left most of the data** — `clearAllData()` was a hand-written list of 23 `db.delete()` calls against a 38-table schema. Missing: `budget_transactions`, `budget_debts`, `savings_goals`, `budget_settings`, `goals`, `goal_milestones`, `goal_progress_logs`, `sleep_sessions`, `sleep_settings`, `study_subjects`, `study_sessions`, `study_settings`, `gallery_albums`, `gallery_photos`, `notification_log` — the finances, the sleep record and the photographs, i.e. the worst possible subset to leave on a device being handed on. Gallery media files were never deleted either, only the rows pointing at them.
Rewritten to enumerate `sqlite_master` at call time, so a table cannot be forgotten; runs in one transaction, `VACUUM`s afterwards, and removes the `songs`/`gallery`/`attachments` directories. `lib/data-coverage.test.ts` fails the build if the export drops a table or if a hardcoded delete list reappears.

**3. Local DB reset after installing a new APK** — Android clears an app's private storage when the replacing APK is signed with a different certificate (switching EAS build profile, or regenerated credentials), which takes SQLite and AsyncStorage with it. Environmental, not a code path — but two code-level risks in the same area were real and are fixed:

- `reconcileAccountOnSignIn()` read `lastUserId` from a store whose AsyncStorage rehydration nothing waited for, racing `onAuthStateChange`. Losing that race both **missed genuine account switches** (silently reinstating the cross-account bleed this function exists to prevent) and **clobbered the persisted sync cursors** via a pre-hydration persist write. `useSyncStore` now exposes `hydrated` and the reconcile defers until it flips; the wipe fails safe — it fires only when a _different_ prior account is positively identified, and a failed wipe now reports and rethrows instead of proceeding to push the previous user's rows under the new uid.
- The export had no counterpart, so it was a file you could produce and never use. `lib/data-import.ts` restores it: merge semantics via `INSERT OR REPLACE` (an older backup can never destroy newer work), columns intersected with `PRAGMA table_info` so a backup predating a schema change still restores, one transaction with rollback, and it counts and reports media files the JSON never contained rather than leaving them to surface as broken thumbnails. Wired into Settings → Data as "Restore from backup".

---

## ✅ UX pass + Split fix (2026-07-30)

Verified with `tsc --noEmit`, `eslint .`, `jest` (55 tests) and `npm run test:sql` (38 tests) — all green.

**The Split "connection error" was not a connection error.**
`create_expense_group` (0004) added the group owner with `INSERT … SELECT … FROM profiles WHERE id = auth.uid()`, which inserts nothing when the caller has no `profiles` row. The creator therefore wasn't a member, the following activity insert was refused by `expense_group_activity_insert`, the whole transaction rolled back, and the client rendered `split.saveFailed` — _"check your connection and try again"_ — for a 42501. Reproduced against real Postgres via PGlite before fixing.

- **`0007_split_group_creation_fix.sql`** — `ensure_profile()` (SECURITY DEFINER, self-scoped) self-heals the row from `auth.users`; the owner insert became `VALUES` with fallbacks so "no profile" can no longer mean "no member"; a post-insert assertion raises a named error rather than letting a regression masquerade as a network fault; existing accounts backfilled and member-less stranded groups cleared. 3 regression tests added.
- **`lib/supabase-error.ts`** — PostgREST/SQLSTATE codes now survive the throw (`SupabaseError`) and classify into `offline · not-configured · signed-out · backend-missing · permission · conflict · server · unknown`, each with its own copy in all 4 locales. `QueryError` derives its icon, message and whether Retry is even offered from the kind; `InlineError` puts form failures next to the button instead of taking the screen over.

**Split, feature-complete:** group cards now priced with your actual balance (batched ledger fetch, no N+1, same tested math as the detail screen), stacked member avatars, pull-to-refresh, unequal/exact splits with a live remaining-to-assign readout, back-dating an expense, RTL-correct settle arrows, one-sentence a11y labels, and a Supabase-not-configured gate. Success haptics moved from tap to `onSuccess` — four screens were confirming writes that hadn't happened yet.

**App-wide UX:**

- **Toast + undo layer** (`lib/toast-store.ts`, `components/ui/toast.tsx`) — the app had no transient-feedback channel at all; every confirmation, including purely informational ones, was a blocking `Alert`. Success alerts replaced; delete on tasks/notes is now immediate with a 6s undo (`restoreTask`/`restoreNote` clear the tombstone and bump `updatedAt` so the restore propagates through sync). Shared-ledger deletes keep their confirmation deliberately.
- **Contrast** — `readableOn()` derives a legible text form of any tint instead of hand-picking pairs that drift. Found and fixed: habit/water/fitness light tints failed even the 3:1 _graphics_ bar on a white card; **study and journal were the identical hex in dark mode** (`#a78bfa`), the exact failure the tokens file warns about; the journal streak label ran at 2.06:1. 17 tests now hold every module tint, category swatch and priority color to WCAG AA in both themes.
- **One palette** — `constants/theme.ts` (137 importers) now derives from `design-tokens.ts` (65 importers) instead of being a second hand-maintained copy that disagreed on background, card and border.
- **Reduced motion** — `useReducedMotion()`; the confetti burst, card entrances and empty-state pop are gated. The tokens file had required this since day one and nothing read it.
- **Accessibility** — `accessibilityRole` on 286 of 289 pressables (was 43/279); swipe-only archive/delete now reachable via `accessibilityActions` on habit, note and song rows (was task only); a11y labels moved off hardcoded English onto i18n keys.
- **Sync visibility** — `SyncStatusBridge` toasts a failed sync with Retry wherever the user is; previously only Settings → Sync ever showed it, so a silently-failing sync looked exactly like a working one.
- **Pull-to-refresh** on 6 screens (was 1) and `tintColor` set so the spinner is visible on dark.
- `React.memo` on task/habit/note/song rows; the expense form's setState-during-render seeding moved into an effect.

---

## 🔴 Critical

- 🔴 **[DATA] Soft-deletes never sync → deleted data resurrects.** _(verified)_ Nearly every repo delete does `.set({ deletedAt, syncStatus:'pending' })` but **not** `updatedAt` (e.g. `features/tasks/services/tasks-repository.ts:156`, `notes:98`, `journal:114`, `budget:95`, `sleep:156`, `goals:214`, `habits:142`). The sync push is `WHERE updated_at > cursor` (`features/sync/services/sync-engine.ts:30`) and pull LWW compares `updated_at` (`:66`) — so a delete of an already-synced row is invisible to both sides and never propagates. Only `habitRoutines` (`habits-repository.ts:288`) does it right. **Impact:** delete on one device, data stays alive on server + other devices; reinstall re-pulls "deleted" data. Correctness + GDPR "right to delete" failure. **Fix:** bump `updatedAt` on every delete; treat `deleted_at` as an always-propagated tombstone.
- 🔴 **[DATA/SECURITY] Account-switch data bleed on a shared device.** Local DB is permanently `user_id='local'`; `signOut()` (`features/auth/services/auth-store.ts`) clears only the Supabase session, never local rows or cursors. Next sign-in with a _different_ account uploads the previous user's rows under the new uid and merges pulls locally. `resetCursors()` exists (`features/sync/store/sync-store.ts:53`) but is **never called** (dead code). Onboarding/profile state also survives the switch (`features/profile/store/profile-store.ts`). **Fix:** on sign-out / uid change, wipe or namespace local data + call `resetCursors()`; confirm before first sync into a new account.
- 🔴 **[SECURITY] No encryption at rest; biometric lock is a UI-only overlay.** `openDatabaseSync('daykeep.db')` has no cipher key — journal free-text, **GPS lat/lng**, full financial ledger, debts/counterparties are plaintext SQLite. App-lock is a JS `absolute inset-0` overlay gated on a zustand boolean (`features/security/`), bypassable via ADB backup / rooted device / debugger. **Fix:** SQLCipher (op-sqlite / expo-sqlite encryption) with the key in `expo-secure-store` (Keychain/Keystore). Do this before any "Vault"/"Love Diary" launch.
- 🔴 **[LEGAL/STORE] No in-app account deletion + no privacy policy.** Settings → "Clear all data" wipes only local SQLite (`lib/data-management.ts`); a signed-in user's Supabase rows and auth user are never deleted. Apple 5.1.1(v) and Google both **require** in-app account deletion — this fails review. No privacy policy URL in-app or (needed) in the store listing. **Fix:** a server-side (edge function) account-delete that removes Supabase data + auth user, keep the local wipe; publish + link a privacy policy.
- 🔴 **[OBSERVABILITY] No production error monitoring and no React ErrorBoundary.** All error capture is `__DEV__`-gated: `lib/query-client.ts` `onError` returns early in prod, `DevErrorBanner` is dev-only. No `ErrorBoundary` anywhere — a single render throw white-screens the whole app (e.g. non-null assertions in `app/gallery/compare.tsx:62,146,185`). In production you have **zero** visibility into crashes or failed queries/syncs. **Fix:** add `@sentry/react-native` + a top-level ErrorBoundary with recovery UI; un-gate the reporting path (keep the visible banner dev-only).
- 🔴 **[TESTING] Zero automated tests.** No jest/testing-library/detox/maestro, no `test` or `typecheck` script, 0 test files over 344 source files. The highest-stakes logic is unverified: `features/budget/services/money.ts` (cents math), `features/sync/services/sync-engine.ts` (LWW/cursors/uid-swap), `features/habits/services/habit-streaks.ts` (streak edge cases), auth state machine. **Fix:** add `jest-expo` + testing-library; unit-test those pure modules first (highest value/hour); one Maestro smoke flow before submission.
- 🔴 **[DATA/ARCH] Schema is hand-maintained in 3 parallel places → drift = crash-loop.** `database/schema.ts` (1240 lines) holds drizzle objects **+** hand-written `TABLE_BOOTSTRAP_SQL` **+** `ADDITIVE_COLUMNS`, all kept consistent by hand. A missed column = `no such column` inside `getDb()` which breaks _every_ screen, or a silently-missing column on upgrade installs. **Fix:** move to drizzle-kit generated migrations, or at minimum a boot-time dev assertion reconciling `PRAGMA table_info` against drizzle metadata so drift fails loudly in dev, not on users' devices.

---

## 🟠 High

- 🟠 **[DATA] Synced parents without their children → structurally broken data on a 2nd device.** v1 syncs primary tables only (`features/sync/config/sync-tables.ts`): habits sync without `habit_logs`, notes without `note_tags`/links/attachments, goals without milestones/progress, journal without reflections. Device B shows parents with no history, broken streaks, zero progress — looks corrupt. Root cause: child tables lack `updated_at`/single-column ids. **Fix:** give them sync columns and include them, or block those modules from multi-device sync until children sync.
- 🟠 **[DATA] Fragile sync core — ms cursors + clock-trust.** Cursors are `max(updated_at)` in epoch-ms with strict `>` (`sync-engine.ts:30,52`); batch writes sharing one `Date.now()` ms can be excluded forever (TOCTOU). LWW trusts each device's wall clock, so a skewed/fast clock silently overwrites a peer's newer edit. `server_updated_at` columns exist but are echoed from the client, not set authoritatively by the server. **Fix:** monotonic per-row sequence or a change-log table; resolve conflicts on a server-set timestamp; re-scan `>=` with an id tiebreaker.
- 🟠 **[DATA/PERF] No indexes on the server sync tables.** `supabase/migrations/0001_init.sql` has zero `CREATE INDEX`; every pull `WHERE user_id=? AND updated_at>?` is a sequential scan. **Fix:** `create index on <table>(user_id, updated_at)` for every synced table.
- 🟠 **[ARCH/SECURITY] Weakly-typed sync ingest (string-built SQL + the only real unsafe cast).** `sync-engine.ts:71-74` builds `INSERT OR REPLACE INTO ${table} (${keys})` from **server-returned column names**, values cast `row[k] as never`. It's the highest-trust, weakest-typed code in the app — at the exact boundary where untrusted data enters the DB. **Fix:** route inserts through drizzle per-table (name→table map) so columns/types are schema-checked; kills the string SQL and the `as never`.
- 🟠 **[ARCH] Circular dependency: features ↔ widgets.** `features/widgets/services/widget-data.tsx` imports tasks/habits/water repositories, while those features import `syncTodayWidget` back from widgets (`use-task-mutations.ts:14`, `use-habit-mutations.ts:19`, `use-water-intake.ts:4`). Real cycle → fragile init order, poor tree-shaking. **Fix:** invert (widgets subscribe to a query-cache/event) or hoist `syncTodayWidget` to a neutral `lib/`.
- 🟠 **[ARCH] No feature barrels → pervasive deep cross-feature imports.** No `features/*/index.ts` public API anywhere; aggregators (`features/notifications/services/digest.ts`, dashboard) deep-import 5-8 other features' internals, so any signature change ripples. **Fix:** per-feature `index.ts` public surface + lint-ban deep cross-feature imports.
- 🟠 **[CI] No CI/CD, no pre-commit, no typecheck script.** No `.github/workflows`, no husky/lint-staged; `package.json` has only `lint`+`format` (no `tsc --noEmit`). Broken typecheck/lint can land on `main` unnoticed. **Fix:** GitHub Actions on push/PR running `tsc --noEmit` + `eslint` + `prettier --check` + `jest`; husky + lint-staged pre-commit; add `typecheck`/`format:check` scripts.
- 🟠 **[i18n/CORRECTNESS] Currency is wrong for many listed currencies.** `features/budget/services/money.ts` always divides minor units by 100 and hardcodes `toLocaleString('en-US')` symbol-prefix — but `currencies.ts` includes JPY/KRW/VND/IQD/ISK (0- or 3-decimal). Amounts _and_ formatting are incorrect for a large share of the catalog; also not locale-aware (`$1,200.50` vs `1.200,50 €`). **Fix:** `Intl.NumberFormat(locale,{style:'currency',currency})` (Hermes supports Intl — handles minor-unit digits + placement); add `expo-localization`.
- 🟠 **[PERF] Gallery renders the whole library unvirtualized with RN `Image`.** `features/gallery/components/photo-grid.tsx` mounts every tile in a ScrollView (`app/gallery/all.tsx`); `expo-image` isn't even a dep, so no downsampling/disk-cache/recycling — likely OOM/jank on mid-range Android. **Fix:** `FlashList numColumns={3} recycleItems` + migrate gallery to `expo-image` with `recyclingKey` and thumbnail sizing.
- 🟠 **[PERF] Unbounded transaction history is a non-virtualized ScrollView.** `app/budget/transactions.tsx:98-120` `.map`s all transactions; also missing an `isLoading` skeleton (unlike other list screens). **Fix:** `FlashList` with a flattened header|row model (pattern already in `app/(tabs)/tasks.tsx`).
- 🟠 **[UX] No error state on any screen.** `grep isError` = 0 hits; every screen treats query failure as empty data (`const { data = [] }`), indistinguishable from genuinely empty, and prod has no error surface. **Fix:** shared `<QueryBoundary>` / `isError` branch with retry on list screens.
- 🟠 **[LEGAL] Data export is incomplete (GDPR).** `lib/data-export.ts` omits budget, debts, goals, sleep, study, gallery, security — "export everything" doesn't; no cloud export/delete. **Fix:** generate export from the same table list as schema/sync so it can't drift.
- 🟠 **[BUILD] Release-config gaps.** Placeholder bundle id `com.daykeep.app` (unowned); **no iOS `PrivacyInfo.xcprivacy`** (now required — you use AsyncStorage/file-system/UserDefaults reason-APIs → rejection); **no `runtimeVersion` / `expo-updates`** (can't ship JS hotfixes); empty EAS `env` blocks + empty `submit.production`; notification status-bar icon still TODO. **Fix:** own bundle id, add privacy manifest, add `expo-updates` + `runtimeVersion` policy, populate EAS env/submit, wire the mono notification icon.

---

## 🟡 Medium

- 🟡 **[ARCH] Repository CRUD duplication across ~9 features.** `create/update/delete/…Category` in tasks/notes/habits/goals are near-identical; the `*_categories` tables are literally identical in `schema.ts`. **Fix:** `createRepository(table)` / shared `categoriesRepository(table)` + `withTimestamps`/`softDelete` helpers (removes hundreds of lines — and is the natural place to fix the delete bug once).
- 🟡 **[ARCH] Reminder services duplicated across 8 features.** `task/note/habit/sleep/debt/journal/water/calendar-reminders.ts` share one skeleton. **Fix:** one `syncReminder({existingId,when,enabled,payload,persistId})`; features supply only time + copy.
- 🟡 **[ARCH] Aggregators reach into other features' repositories** (`digest.ts`, dashboard). Depend on per-feature barrels (see High) instead.
- 🟡 **[ARCH/UX] Form validation inconsistent — only 2 of ~14 forms use zod.** Goals/habits use RHF+zod; auth/budget/sleep/study/notes/timeline are ad-hoc `useState` (sign-up only checks `!email.trim()`, no format). **Fix:** standardize RHF+zod (schemas exist to copy); also gives runtime validation at the sync-ingest boundary.
- 🟡 **[UX] No optimistic updates.** All 21 mutation modules only `invalidateQueries`; high-frequency toggles (task complete, habit done, favorite) wait a refetch, delaying the checkbox animation. **Fix:** `onMutate` `setQueryData` with rollback for those toggles. (Offline itself is fine — local SQLite.)
- 🟡 **[A11y] Baseline gaps on shared primitives (wide reach).** `components/ui/button.tsx` sets no `accessibilityRole="button"`/`accessibilityState`; `SwipeableRow` archive/delete are unreachable by screen readers (no `accessibilityActions`); only 18 of 45 `TextInput` files set `accessibilityLabel`; no `maxFontSizeMultiplier` anywhere → clipped rows at large OS type. **Fix:** fix the primitives once (Button, SwipeableRow, a labeled input wrapper, Text font-scale cap).
- 🟡 **[PERF] No memoization on list rows.** `React.memo` = 0 hits; `TaskRow`/`HabitRow`/`NoteCard`/`GoalCard` (with per-row Reanimated hooks) rebuild on unrelated parent renders (e.g. typing in search). **Fix:** `React.memo` rows + hoist stable callbacks.
- 🟡 **[UX] 7 modal forms lack keyboard handling.** `budget/transaction`, `sleep/log`, `study/log`, `budget/savings/new`, `budget/debts/new`, `music/playlist/new`, `routine/new` use neither `KeyboardAvoidingView` nor the existing `useKeyboardHeight`. **Fix:** apply the existing hook uniformly.
- 🟡 **[UX] `seeded`-during-render form hydration.** `budget/transaction.tsx:50-59` (and 6 others) call setStates in render body; won't re-seed on refetch, double-renders. **Fix:** seed via `useEffect`/RHF `reset()` on query result.
- 🟡 **[THEME] Hardcoded hex bypassing tokens.** 115 hex literals in `app/`; money red/green, `TYPE_TINT`, favorite red re-invent `success`/`destructive` tokens and don't adapt to dark. **Fix:** route semantic colors through `colors[scheme]`/tokens.
- 🟡 **[DATA] `sync_status` is dead metadata / pull clobbers it.** Pull `INSERT OR REPLACE` overwrites local `sync_status` + `server_updated_at`; the engine keys off cursors not `sync_status`, so repositories' `syncStatus:'pending'` writes are never read. **Fix:** either drive sync off `sync_status` or stop selecting/overwriting it.
- 🟡 **[AUTH/UX] Email-confirmation sign-up strands the user.** If confirmation is on, `signUp` returns no session, `isGuest` is cleared, gate bounces to login with no "check your email" message. **Fix:** propagate a pending-confirmation state from `signUp`.
- 🟡 **[i18n] No i18n framework; ~247 hardcoded English `<Text>` strings.** Defer full extraction unless multi-language is a launch goal — but pair with the currency fix above. **Fix:** `expo-localization` + i18next when scoped.
- 🟡 **[ARCH] Duration/time formatting reimplemented per feature.** Two different `formatDuration` (music ms→m:ss vs sleep min→`7h 45m`), `formatStudyDuration`, scattered `padStart`. **Fix:** consolidate into `lib/duration.ts` (dates/money already centralized).
- 🟡 **[DEPS] Dependency hygiene.** `npm audit` ~19 moderate (likely transitive/dev). **Fix:** `npx expo-doctor` + `expo install --check`; triage audit; add Dependabot/Renovate once CI exists.
- 🟡 **[DOCS] No README / LICENSE / CONTRIBUTING.** `AGENTS.md` is 3 lines; internal comments are excellent but there's no entry doc. **Fix:** README (stack, `.env` setup, run/build, architecture — liftable from file headers) + a LICENSE.

---

## 🟢 Low

- 🟢 **[DATA] Category deletes don't set `syncStatus` or `updatedAt`** (`task_categories`, `note_categories`, `savings_goals`, `study_subjects`) — worse variant of the delete bug; fix together.
- 🟢 **[DATA] Within-module push order lists child before parent** (`sync-tables.ts:45` transactions before savings_goals) — harmless today (no FKs), violates the stated contract.
- 🟢 **[DATA] `generateId()` uses `Math.random()`** — prefer `crypto.randomUUID()`/`expo-crypto`.
- 🟢 **[DATA] `profiles.email` never re-synced** after an auth email change (trigger sets it only on insert).
- 🟢 **[ARCH] Five near-identical `*-filter-store.ts`** → `createFilterStore` factory.
- 🟢 **[ARCH] `router.push(x as never)` repeated 8×** to work around typed routes → shared typed `navigate()` wrapper.
- 🟢 **[A11y] A few touch targets < 44px** (header chips 40px, icon actions ~20px) — mostly mitigated by `hitSlop`.
- 🟢 **[THEME] No AMOLED theme** (only light/dark; dark isn't true black) — if AMOLED parity is a goal.
- 🟢 **[UX] Dark-mode `RefreshControl` has no `tintColor`** (invisible spinner); pull-to-refresh only on dashboard.
- 🟢 **[UX] Notifications inbox rebuilds its own empty state** instead of shared `EmptyState`.
- 🟢 **[PERF] `shadow-e1` custom box-shadow** on 34 static cards adds Android overdraw (safe re: the NativeWind-nav gotcha).
- 🟢 **[ARCH] Broad try/swallow in digest builder** — sound intent, but log the swallowed error to telemetry once it exists.

---

## Recommended sequencing

1. **Stop active data harm first:** the delete-doesn't-sync bug and the account-switch bleed (both Critical/DATA) — small, high-value fixes; ideally land them while extracting the shared repository helper so the delete fix happens once.
2. **Make failures visible:** Sentry + ErrorBoundary + un-gate the query `onError`; add `isError` states. You're flying blind in prod until this exists.
3. **Stand up the safety net:** `jest-expo` + tests for money/sync/streaks; a CI workflow with `tsc --noEmit`; a `typecheck` script.
4. **Store/legal blockers before submission:** in-app account deletion (+ server delete), privacy policy, complete data export, PrivacyInfo.xcprivacy, real bundle id, `runtimeVersion`/`expo-updates`.
5. **Correctness & security edges:** currency (`Intl.NumberFormat`), at-rest encryption (SQLCipher) before any sensitive-module launch, sync child tables + server indexes + robust cursors before enabling multi-device sync broadly.
6. **Quality & scale:** gallery/transactions virtualization + `expo-image`, a11y primitives, optimistic toggles, feature barrels + break the widgets cycle, dedupe repositories/reminders.

## Strengths to preserve

Strict TypeScript with ~0 `any`/`@ts-ignore`; correct react-query (server/DB) vs zustand (UI/session) split; integer-cents money; lazy DB open avoiding boot crashes; the token/theme system + NativeWind-navigation-crash mitigation already baked into `Button`/`Fab`; robust auth init (finally + 4s watchdog); complete RLS on every server table; no secrets committed; consistent loading/empty handling on most screens; and exceptional in-code "why" comments.
