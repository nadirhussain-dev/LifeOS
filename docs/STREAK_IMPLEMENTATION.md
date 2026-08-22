# Streak Engine — implementation plan

Mechanics: [REWARDS_PROGRAM.md](REWARDS_PROGRAM.md). Strategy and gates:
[REWARDS_STRATEGY.md](REWARDS_STRATEGY.md). This is the build.

**Scope: Gate A only — the engine, with no physical prize.** Streaks, shields,
the module contract, the checklist, the ladder, digital rewards. No claims
table, no addresses, no fulfilment, no terms, no legal exposure. Gates B–D are
sketched in §4 but deliberately not planned in detail, because they depend on
decisions and accounts that don't exist yet.

"Digital rewards" was in that scope line from the first draft and went unbuilt
for five waves — the ladder shipped as prose. **Wave 6 is what makes it true**,
and it is worth noticing that the gap survived a plan, a review and four waves
of verification because nothing in the scope line said what a reward _was_.

Same split as [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), for the same
reason: **Part A** is what can be written and verified from here, **Part B** is
what only you can do. Verification commands are the real ones in `package.json`.

One structural note before the waves: **the `'streak'` notification category
already exists** in `features/notifications/types/notification.types.ts` and has
never had a scheduler — TODO.md leaves it unchecked "by design". Wave 4 is what
finally gives it one, so no new category has to be invented.

---

## Part A — I implement

### Wave 1 — server and pure logic

Nothing here needs a device, a Supabase project, or a design asset. All of it is
verifiable in CI today, and it is where every expensive mistake lives.

**A1. `supabase/migrations/0048_streak_challenge.sql` — tables and RLS.** ✅ done.
Seven tables, in this order, because `check-migrations.mjs` enforces that a
`LANGUAGE SQL` body cannot reference a table defined below it. (The plan
originally said eight: a `challenge_audit` table turned out to be redundant,
because `admin_audit_log` from 0010 already exists and every admin function
below writes to it — so operator actions on a streak read in the same timeline
as operator actions on anything else.)

| Table                          | Key                               | Notes                                                                                                  |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `challenge_seasons`            | `id`                              | every knob; readable by all, written only by admin RPC                                                 |
| `challenge_tiers`              | `(season_id, day_threshold)`      | the ladder; `reward_kind` present from day one even though Gate A ships only `'digital'` rows          |
| `challenge_modules`            | `(season_id, module_id)`          | eligibility + `est_daily_seconds`; `module_id` untyped text, matching `module_flags` and `usage_daily` |
| `challenge_enrollments`        | `(user_id, season_id)`            | the four counters, frozen tz, resolved `shield_earn_days`, `plan_at_enrolment`                         |
| `challenge_enrollment_modules` | `(user_id, season_id, module_id)` | `role`, `added_on`, `removed_on` — closed, never deleted                                               |
| `challenge_days`               | `(user_id, season_id, local_day)` | `outcome`, `modules_hit text[]`, server-stamped                                                        |
| `challenge_events`             | `id`                              | the readable history                                                                                   |

RLS on all seven. Owner rows are `select` only — **no client-side insert or
update policy exists anywhere in this migration**, which is the single most
important line in it. Seasons, tiers and modules are world-readable like
`module_flags`, because they describe the program rather than a person.
_Verify:_ `npm run check:migrations`, `npm run test:sql`.

**A2. `0048` — functions.** ✅ done. `enroll_in_challenge`,
`record_challenge_day`, `challenge_today`, `challenge_settle_missed_day` +
`settle_stale_runs`, `swap_challenge_module`, and the admin set
(`admin_upsert_challenge_season`, `admin_upsert_challenge_tier`,
`admin_set_challenge_module`, `admin_grant_challenge_shield`,
`admin_restore_challenge_days`). All `SECURITY DEFINER` with
`set search_path = public` — the checker fails the build without it. Admin ones
gated on `is_admin()` so 0014's origin allowlist and 0018's audit trail apply
unchanged.

The two that carry the mechanic are specified step-by-step in
REWARDS_PROGRAM.md §4.2. The one thing to get right here and nowhere else: the
server derives the local day from `now()` and the **frozen** `tz_offset_minutes`,
and rejects anything outside `[today-1, today]`.
_Verify:_ `npm run check:migrations`, `npm run test:sql`.

**A3. SQL tests for the settlement state machine.** The reason this is its own
item and not a line in A2: under the old reset-to-zero rule the miss logic was
one comparison; it is now a state machine that decides whether somebody keeps a
year of progress, and a bug in it is both expensive and silent.

`scripts/sql-harness.mjs` already boots a real WASM Postgres and has `asUser()`
for RLS assertions, so this needs no new tooling. Table-driven cases:

- perfect run; shield earned exactly at `shield_earn_days`
- a shield **not** granted while already holding three
- one miss with a shield → progress unchanged, `perfect_run` zeroed
- one miss without → demotion to the previous rung
- second miss inside the window → one rung deeper
- demotion cap: a miss at day 364 costs 45 days, not 65
- miss ageing: `recent_misses` clears after a clean run
- contract: two of three modules hit → no ledger row, correct outstanding list
- contract: an _extra_ module missing → the day still qualifies
- a swap taking effect at midnight, and failing to rescue yesterday
- `shield_floor_days` clamp when the extras perk and the annual perk stack
- **RLS: a signed-in user cannot `update` their own `challenge_enrollments` row**

_Verify:_ `npm run test:sql`.

**A4. `features/challenge/services/challenge-math.ts` + test.** The client needs
to render "next shield in 12 days" and "48 to the next rung" without a round
trip. Pure functions, mirroring the server, with `habit-streaks.ts` /
`habit-streaks.test.ts` as the exact precedent for shape and coverage.

Written second, on purpose: the server is the authority, and this file exists to
agree with it. A comment at the top saying so, plus a test asserting the same
fixtures the SQL tests use, is what stops the two drifting.
_Verify:_ `npm test`, `npm run typecheck`.

---

### Wave 2 — client tracking, no UI

Everything here is testable without a screen existing.

**A5. `features/challenge/store/challenge-store.ts`.** Zustand + AsyncStorage
persist. Holds today's local day, foreground seconds (an `AppState` listener),
and a **per-module write map** — `{ habits: 2, water: 5 }` — not a single
counter. Resets on local-day rollover. `features/analytics/store/usage-store.ts`
is the closest existing shape; follow its `drain()` / `restore()` split so a
failed flush cannot lose a day.
_Verify:_ `npm test` (store logic + rollover), `npm run typecheck`.

**A6. `features/challenge/services/challenge-reporter.ts`.** Single in-flight
promise, never throws, restores the buffer on failure — modelled line for line
on `features/analytics/services/usage-reporter.ts`. Fires on foreground, on
background, and on reconnect. Sends the map; the server decides.
_Verify:_ `npm test`, `npm run typecheck`.

**A7. Attribute writes at the database, not in the mutation hooks.** ✅ done —
**and not as planned.** The plan said "every place that calls
`syncTodayWidget()` inside an `invalidate()`". That was written from a stale
note: `syncTodayWidget()` is now called from exactly one place,
`app/_layout.tsx`, because widget refresh was moved onto a query-cache
subscription to break a dependency cycle. There were no per-module call sites
left to hook.

Annotating fifty `useMutation` calls was the obvious fallback and a poor one —
the failure mode is a refactor silently dropping the annotation, which is the
exact thing the wiring test was there to catch. Drizzle already funnels every
statement through one method (`opSqliteClient.prepareSync`), so attribution
hangs off that instead, in `database/write-observer.ts`, with a table→module map
derived from the sync registry. A module cannot be refactored out of being
observed, because being observed is a property of writing to the database.

The decisive argument is a boundary that already existed: **the sync engine, the
media cache and import/restore all write through `getRawDb()`, never through
drizzle.** So a pull from another device is structurally invisible to this
observer and cannot fabricate a day. Had it been visible, signing in on a new
phone would have silently ticked every module in the challenge. Widget taps do
arrive through drizzle, and should — somebody logging water from the home screen
used the app.

The wiring test survives, aimed at what can still break: the table→module map,
the settings-table exclusion (otherwise a streak could be held by toggling a
reminder switch), and the observer being connected at all.
_Verify:_ `npm test`, `npm run typecheck`.

**A8. `features/challenge/hooks/use-challenge.ts`.** React-query over the
enrolment, the ladder, the committed modules, the day ledger and the event
timeline. Plus `use-challenge-today.ts`, which merges the local buffer with the
server's answer for the checklist — local for instant feedback, server for
truth, and never the other way round.
_Verify:_ `npm run typecheck`, `npm test`.

---

### Wave 3 — the screens

Four locales for every string (`en`, `ur`, `hi`, `ar`), enforced by
`npm run check:i18n`. Design tokens only, enforced by `npm run check:tokens`.
And the NativeWind gotcha still applies: **no `shadow-*`, `opacity-*` or
slash-opacity classNames near navigation** — inline style instead.

**A9. Enrolment and the module picker — `app/challenge/join.tsx`.** Pick from the
eligible list, minimum `required_modules`, with a live "≈ 2 minutes a day"
estimate summed from `est_daily_seconds`. Defaults pre-ticked from what the user
already uses, so it reads as _keep doing what you're doing_ rather than _take on
three new habits_ — that framing is worth real enrolment numbers. States the
30-day lock plainly before the commit, not after.

**A10. The challenge screen — `app/challenge/index.tsx`.** ✅ done, all six. In
priority order, because if the wave runs long this is the order to cut from the
bottom — in the event nothing had to be cut, and the share card went in with
them:

1. **Today's checklist** with an explicit day-complete state. Per
   REWARDS_PROGRAM.md §1.2.4 this is the control that decides whether the module
   rule costs completions; it gets built first and reviewed hardest.
2. Shield slots (three, filled or empty, "next shield in N days").
3. The ladder, climbed rungs lit, next rung named.
4. The chain, three dot states, rendered from `modules_hit`.
5. Ring, counter, rank line.
6. Per-module mini-chains.

**No `AdSlot` on this screen, ever** — REWARDS_PROGRAM.md §0.1. Worth a comment
at the call-site level so a future edit doesn't casually add one.

**A11. `app/challenge/timeline.tsx`, `swap.tsx`, and the demotion sheet.** ✅ done.
The demotion presentation matters more than its size suggests: what happened,
what it cost, what the next rung needs, one **Keep going** button.

The sheet finds the fall by walking `challenge_events` for a `demoted` row newer
than a locally-held watermark, rather than by comparing counters — counters only
say where somebody is now, and the log is the only thing that says they used to
be somewhere else and by how much. The watermark lives on the device: a "seen"
column would mean writing to the ledger every time a screen opened, and a second
device showing the notice twice is a far smaller problem than that.

The swap screen states both rules that can refuse it — the 30-day lock and the
swap budget — before somebody spends a minute choosing. `challenge_today()`
gained `swapsLeft` and `swapsUnlockDay` for exactly that; the server enforces
both regardless, but a rule you discover by being refused was documented too
late.

**A12. Registration and plumbing.** ✅ done. Routes in `app/_layout.tsx`, a Hub
tile in `features/hub/config/modules.ts` on `moduleTints.habit`, and the
route→module mapping so `useModuleAccess` gates `/challenge` under the `rewards`
id.

**The seed was the one real gap in this whole build.** Three separate places
said "seeded disabled" and nothing seeded it, so — because `module_flags` treats
an absent row as _enabled_ (0011's rule 1) — the programme would have switched
itself on for every account the moment these migrations were applied. That is
precisely the failure the comments were warning about. Fixed by a row in
`0050_challenge_rank_and_seed.sql` and a test that asserts it, rather than by a
fourth comment.
_Verify (A9–A12):_ `npm run typecheck`, `npm run check:i18n`,
`npm run check:tokens`, `npm run lint`, `npx expo export --platform ios`.

---

### Wave 4 — notifications and the operator console

**A13. Give the `'streak'` category its scheduler.** ✅ done, and it took two
changes to `notification.types.ts` that are worth calling out, because both
reverse a decision that was correct when it was made:

- **`bypassQuietHours` false → true.** The reminder is a last call at 20:00. Left
  non-bypassing, "smart digest" mode folds it into the _following morning's_
  brief — arriving the day after the streak it was warning about was lost, which
  is worse than silence.
- **`streak` added to `CONFIGURABLE_CATEGORIES`.** It was excluded, with a
  comment explaining that a local notification carries text fixed at scheduling
  time and so would nag people who had already finished, concluding "that needs
  server push". It did not. It needed a cheaper trigger rather than a smarter
  one — see below.

The scheduler itself is
`features/challenge/services/challenge-reminders.ts` on the pattern of
`features/budget/services/debt-reminders.ts`: schedule through the central choke
point in `lib/notifications.ts` so the master switch, per-category toggle, quiet
hours and inbox logging all apply for free.

The important detail — **at-risk reminders are rescheduled on every write**, not
scheduled once. A local notification cannot evaluate state at fire time, which is
exactly why the streak push was deferred in the first place. But the app knows
the checklist state whenever it changes, so each mutation re-syncs the pending
notification with current text (_"Journal not logged — 2h 14m left"_) and cancels
it outright when the day completes. Same shape as `syncDebtReminder`.

Set `bypassQuietHours: true` for this category: a 22:30 warning is precisely what
quiet hours must not eat.

**A14. Operator console — `app/settings/operator/rewards.tsx`.** ✅ done. The
master switch plus four read-outs: runs split free vs paying, shield telemetry,
**which module causes the most failed days** from `modules_hit`, and the Gate A
retention comparison.

All four read through new RPCs in **`0049_challenge_operator_views.sql`**, which
the plan did not anticipate needing: 0048's tables are owner-read-only, quite
correctly, so the console had no way to see anything at all. Every function
there returns aggregates, none takes a user id, and none can be coaxed into
naming anybody — the same line 0010 drew for usage.

**A14b. Season console — `app/settings/operator/seasons.tsx` and `season.tsx`.**
✅ done, and the deferral above is what made it necessary.

"A form over three RPCs is worth building once the first season's shape has
settled, not before" was a reasonable call and it cost weeks. Seeding by hand in
the SQL editor produced a staging season that was `enabled`, inside its window,
and had no rows in `challenge_modules` — enrolment impossible by construction.
The console reported **Open** (it checked `enabled` and the dates); the app
reported **"No season is open right now"** (it checked whether there was
anything to pick from). Both were correct, and nothing on either screen could
show the other's answer, so the state was only findable by reading two files.

Two things came out of it, both in **`0055_challenge_season_console.sql`**:

- **One derivation of "what is this season doing"**, in SQL, quoted by the app,
  the console and `challenge_today()` alike — see REWARDS_PROGRAM.md §4.1. The
  lesson generalises: two screens deriving the same fact from different columns
  will eventually disagree, and neither can see it.
- **The editor**, covering the season switch, both dates (extend and shorten,
  with the resulting date shown before it commits), every rule and shield knob,
  eligible modules, and the ladder — plus a one-tap "add the default set" for
  the empty-season state, and a preview of the exact sentence users are being
  shown right now, rendered with the app's own component.

Deleting a season is refused by the server once anybody has joined; closing it
is the reversible equivalent and is one tap away.
_Verify (A13–A14):_ `npm run typecheck`, `npm test`, `npm run check:i18n`,
`npx expo export`. Notification _delivery_ is unverifiable from here — see B5.

---

### Wave 5 — the measurement that Gate A turns on

**A15. Cohort retention read-out.** ✅ done — as the cheap, biased version, which
was the recommendation. `admin_challenge_retention` (0049) compares the two
cohorts and returns `controlIsConsentingOnly: true` **in its own payload**, so
the caveat travels with the number to wherever it ends up being quoted rather
than living only in a comment nobody reads. The original framing of the problem
follows, because the decision in B4 still stands.

Gate A's go/no-go is _enrolled D30 retention ≥ 2× a non-enrolled control_, and
**that number cannot be computed cleanly**, which is worth surfacing before the
work rather than after.

`challenge_days` gives a clean signal for enrolled users. The control group's
activity lives only in `usage_daily`, which is **opt-in and off by default** for
GDPR reasons. So the comparison is available only across consenting users, and
consent may itself correlate with engagement — a biased denominator.

Two honest ways out, and this is a B-item decision (B4):

- **Accept the bias.** Compute the ratio within the consenting population only,
  and state the caveat wherever the number is shown. Cheapest, and probably good
  enough for a 2× threshold — you are looking for a large effect, not a precise
  one.
- **Add an aggregate-only retention counter.** Not user-keyed: a daily count of
  distinct actives bucketed by install cohort week, with no row that identifies
  anybody. Defensible under legitimate interest, and it makes the denominator
  honest. More work, and it needs a privacy-policy line.

_Verify:_ `npm run test:sql` for whichever lands.

---

### Wave 6 — the ladder pays out (0071–0072)

Not in the original plan, and it should have been. Waves 1–5 built an engine
that could measure a year of somebody's discipline to the day and then had
nothing to give them for it: `challenge_tiers.reward_title` was prose, and
reaching Ember on day thirty raised a toast. Every rung above Spark was a
promise the engine had no mechanism to keep, and the longer somebody climbed the
more obviously so.

**A16. `0071_challenge_rewards.sql` — the payout.** ✅ done. Rung payouts become
data (`challenge_tiers.rewards`, a jsonb array of effects: badge, theme, chain,
frame, icon, shield, premium). `user_rewards` is the shelf, owner-read with no
insert policy anywhere — a cosmetic the client could award itself is worth
nothing.

The one rule the whole file rests on: **insert into the ledger first, apply the
side effect second**, with `unique (user_id, slug)` doing the arbitration. It is
what makes the granter safe to call more than once, and it will be called more
than once — `current_tier_day` _decreases_ on a demotion, so re-climbing fires
`tier_reached` again, and on the top rung that is the difference between one
payout and ninety days of Premium every time somebody falls.

Cosmetics key by what they are (`badge:spark`); consumables key by where they
were earned (`premium:<season>:<rung>`). Premium goes through `premium_grants`
exactly as an owner's gesture does, with `granted_by` null meaning the engine —
and `admin_grant_premium`'s merge logic moved into a shared
`grant_premium_window()` rather than being copied.

Two decisions that reversed what was already written, both recorded in
REWARDS_PROGRAM §1.5: **bounded Premium windows** join the high rungs (rev 3 had
excluded free Plus, and that reasoning covers permanent Plus rather than a
seven-day trial at ninety qualified days), and the **seeded ladder stops
promising things that do not exist** — the finishers wall, the storage bump, the
film and the app icon were all copy with nothing behind them.
_Verify:_ `npm run check:migrations`, `npm run test:sql`.

**A17. SQL tests for the payout.** ✅ done, eighteen of them, and the same
reasoning as A3 applies: the expensive failure here is silent and it is measured
in money. The cases that earn their place — a re-climb after a fall paying
nothing, a premium window that cannot be farmed, a short rung not shortening a
longer window already held, the shield cap surviving a rung that grants one,
arrears paid on the next qualified day, and a rename from the console not wiping
the payout it did not mention.
_Verify:_ `npm run test:sql`.

**A18. `features/rewards/` — the catalog and the shelf.** ✅ done. The server
decides who owns what; the catalog decides what it looks like, which is what lets
an operator move a cosmetic between rungs without a build. `catalog.test.ts`
reads the seed out of the migration and fails if a granted slug has no art —
the same relationship `entitlements.ts` has to 0059, and for the same reason.

`equippedOwned` is the only way a screen may read the equip store: the store is
local and survives a sign-out, so the raw value can name a cosmetic the person
now holding the phone never earned. Validating at the point of use cannot be
forgotten the way a reset hook can.
_Verify:_ `npm test`, `npm run typecheck`.

**A19. The trophy case and the milestone sheet.** ✅ done.
`app/challenge/rewards.tsx` draws locked rungs as silhouettes rather than hiding
them, and reconciles on open. `reward_granted` now **halts** the celebration walk
the way `demoted` always has — which is what makes the payout durable rather
than a toast that vanishes in three seconds while somebody is looking at their
checklist. `celebrationsFor` reports the event it stopped at, so a fall and a
payout both unseen resolve to one sheet instead of two racing for the surface.

Cosmetics land on the share card first, because that is the one surface other
people see. **The braid deliberately keeps its module tints**: its strands are
how you tell which commitment broke, and trading the only diagnostic in the
feature for a nicer palette would be a bad swap.
_Verify:_ `npm run typecheck`, `npm run check:i18n`, `npm run check:tokens`.

**A20. Reminder copy that survives a year.** ✅ done. The 20:00 nudge fires on
every unfinished evening of a run that can last 365 days and produced one
identical string every time. `reminder-copy.ts` rotates the framing off the local
day — stable within a day, because the reminder is cancelled and rescheduled on
every write — while the facts never rotate. A rung within three days becomes the
headline, which is the only line here that offers a reason to act rather than a
consequence of not acting.
_Verify:_ `npm test`.

**A21. The programme's ad surface (0072).** ✅ done, and see REWARDS_PROGRAM §2.1
for the placement argument. An enrolled free account carries one extra slot per
session and three extra breakpoints, each inside a committed module and each
firing **after** the write and after the credit. Habits and Journal are left out
on purpose and both omissions are pinned by a test, because they are exactly the
kind a later edit "fixes" without knowing why.
_Verify:_ `npm test`, `npm run check:migrations`.

---

## Part B — only you can do

**B1. Confirm the eligible module list and `required_modules`.** Proposed:
Habits, Tasks, Journal, Water, Sleep, Study, Goals, Notes eligible; Budget,
Gallery, Music, Timeline not; minimum three. All admin-editable afterwards, so
this is a starting point rather than a commitment.

**B2. Digital reward assets.** The ladder's rungs need real things people want —
gradient themes, alternate app icons, profile frames, chain colours. Ties to the
point in the strategy doc: cosmetics only carry value where **other people see
them**, so bias them toward the surfaces that already have an audience (shared
albums, expense groups, Together). Needs design work, not code.

**B3. Season and ladder content.** Names, day thresholds, copy, images. Seeded
through the console once A14 lands, not hardcoded.

**B4. The measurement decision from A15.** Biased-but-cheap, or aggregate
counter. My recommendation: start with the cheap one; if Gate A comes out near
the 2× line rather than clearly over it, build the counter before betting on a
prize.

**B5. Apply 0048 and test on hardware.** `npm run migrate:staging`, then
production. Then an EAS dev build — notifications and the widget have never been
observed running on a device from this machine, and this box has no Android
toolchain and no Mac.

**B6. Gate A's decision itself.** Four weeks of data, then the go/no-go.

---

## Later gates — outlined, not planned

Each of these is a separate branch of work that should not start until the gate
before it has passed.

- **Gate B (Season Zero):** `challenge_claims` table, address flow, the operator
  claims queue, the terms and privacy copy, sourcing the box, a test parcel to
  each shipping country, and the personalised chain print.
- **Gate C (public seasons):** the enrolment window and cap, countdown UI, store
  screenshots, `reward-notify` on Resend, the referral shield, cohort rooms.
- **Gate D (Year One Club):** chaining four seasons, permanent status, the big
  box.

---

## Sequencing, branches, and risk

**Branches.** One PR per wave, stacked. Per the repo's own hard-won note:
retarget a child PR to `main` _before_ merging its parent — GitHub closes a PR
whose base branch is deleted, and a force-push seals it permanently.

**The three places this goes wrong**, in order of how much they'd cost:

1. **The settlement state machine.** Mitigated entirely by A3, which is why it is
   its own item and sits in wave 1.
2. **A module quietly stopping reporting writes** after a refactor — silent, and
   it costs people days they actually earned. Mitigated by A7's wiring test.
3. **The checklist being merely adequate.** No test catches this one. It is the
   difference between the module rule costing nothing and it halving completion,
   so it gets the first slot in A10 and a real design pass rather than the
   leftover time at the end of the wave.

**What ships if you stop early.** Waves 1–3 alone are a complete, useful feature:
a user can enrol, commit to modules, keep a streak, earn and spend shields, and
climb a ladder of digital rewards. Wave 4 makes it stick, wave 5 makes it
measurable. Nothing before Gate B creates a legal obligation or a parcel to post.
