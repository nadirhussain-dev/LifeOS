# Ads, streaks, and the first sixty seconds

A plan for four things you asked for — an AdMob strategy that actually earns, a
streak challenge that demands a live daily write, a first run that teaches the
modules before the dashboard, and reminders on by default everywhere — plus the
areas next to them that are worth fixing while we are in there.

Written against the code as it stands on `feat/challenge-season-console`
(f3f528f). Every file path below is real; every "already built" claim was read,
not assumed.

> **Superseded in part.** The streak challenge has since been removed from the
> app entirely — schema, screens, reminders and ad coupling — to be rebuilt from
> scratch. Its three specification documents (`REWARDS_PROGRAM.md`,
> `REWARDS_STRATEGY.md`, `STREAK_IMPLEMENTATION.md`) went with it; they are in
> git history if the numbers are wanted. Every section below that reasons _from_
> the streak — the enrolled ad surface, the funding argument, the shield gates —
> is therefore history rather than plan. The ad strategy is being rewritten
> separately, and the subscription tier those revenue comparisons assume is also
> being removed, so the modelling here should not be used as-is.

---

## 0. The three decisions, and what they settled

These were open when this plan was written. All three are now answered, and the
answers are built. Kept here rather than deleted because each one rules out an
approach that will otherwise look attractive again in six months.

### 0.1 "On live" means online at the moment of the write — with no grace

**Decided: the strictest reading, and stricter than this plan originally
proposed.**

The behaviour to defeat was named precisely: work offline, finish the whole
checklist in a couple of minutes, close the app, then turn the connection back
on. That day must be worth nothing.

The first draft of §2.2 allowed a 30-minute reconnect queue for the
tunnel-and-lift case. **That was cut, and cutting it was right** — a queue is
exactly the loophole. Failed attestations flushed on reconnect would arrive
stamped with the server's `now()` at flush time, so the cheat above would pass
with a tidier request pattern than before. There is no queue, no retry, and no
`live_grace_minutes` column. An attestation that does not land is gone.

Shipped as migration `0065_challenge_live_writes.sql` and
`features/challenge/services/live-writes.ts`. See §2.2.

### 0.2 No ad may ever touch a streak or a shield

**Decided: the firewall holds. Rewarded video buys something else.**

Three separate places in this repo already forbade it and all three were right:
`0048_streak_challenge.sql`'s "what is not here, on purpose" section, the
removed `REWARDS_STRATEGY.md` §11, and Google's own policy on incentivised traffic
— which is the one that can cost the AdMob account rather than just the design.

The product reason outlives the policy one: a shield you can buy with thirty
seconds of attention is not scarce, and a streak that cannot break does not
motivate anybody. §2 only works because the punishment is real.

§1.3 lists what rewarded video may buy instead. Four of the five are already
typed entitlement keys.

### 0.3 Module knowledge is delivered in three layers, not one wall

**Decided: the layered design in §3.2.**

Daykeep has thirteen Hub modules on top of the four tab drivers and the private
space — eighteen surfaces. Nobody meets a module cold, and nobody meets all
eighteen before they have used the app once. §3.4 still records what the literal
mandatory version would cost, in case that trade ever looks worth making.

---

## 1. Ads — the revenue plan

### 1.1 What is built now

Everything in the original §1.1, plus all five blockers that used to sit here,
plus the full-screen formats. What is left is native in-feed ads and a device
build to confirm any of it.

| Piece                       | Where                                     | State                                                      |
| --------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| SDK init, crash-safe        | `lib/ads-init.ts`                         | Lazy `require` in try/catch, survives the New Arch bug     |
| Module loader, shared       | `features/ads/services/ads-module.ts`     | One cached `require` for init, consent and every slot      |
| UMP consent + ATT           | `features/ads/services/consent.ts`        | UMP first, ATT second — the order Google documents         |
| Consent state               | `features/ads/store/ads-consent-store.ts` | Unpersisted on purpose; stale "may serve" is the bad cache |
| Content rating              | `AD_MAX_CONTENT_RATING` in `config.ts`    | `T`, set before `initialize()`                             |
| Banner, adaptive            | `features/ads/components/ad-slot.tsx`     | `ANCHORED_ADAPTIVE_BANNER`, chrome waits for `onAdLoaded`  |
| Tier gate                   | `useEntitlement('ads')`                   | Reads `plan_entitlements.ads` — the operator lever is live |
| Operator kill switch        | `module_flags` under id `ads`             | Fail-open                                                  |
| Env-driven unit ids         | `app.config.js`, `lib/env.ts`             | Going live is config, not code                             |
| Full-screen pacing rules    | `features/ads/services/ad-pacing.ts`      | Pure, 15 tests; the rules only, no runtime state           |
| Runtime ad gate             | `features/ads/services/ad-gate.ts`        | Composes pacing + entitlement + consent + kill switch      |
| Ad session bookkeeping      | `features/ads/store/ad-session-store.ts`  | Persists the cooldown, deliberately not the session cap    |
| Interstitial                | `features/ads/services/interstitial.ts`   | Preloaded on foreground, two allowlisted breakpoints       |
| Rewarded video              | `features/ads/services/rewarded.ts`       | Buys 24h ad-free; granted only on `EARNED_REWARD`          |
| Ad-free window              | `features/ads/store/ad-free-store.ts`     | Local, non-stacking; respected by the banner and the gate  |
| Impression + refusal counts | `funnel_daily` (0066)                     | Every pacing refusal is named and counted                  |

### 1.2 What each of the five blockers turned into

Recorded rather than deleted, because three of them are the kind of thing that
silently regresses.

**1. Consent.** `gatherAdsConsent()` runs UMP, then ATT on iOS, before the SDK
is initialised at all — and `initAds()` stops short of `initialize()` when
`canRequestAds` comes back false, so "no consent" means no ad request rather
than an unrendered one. `AdSlot` refuses to render until the store resolves, so
the first paint of a cold start cannot beat the consent form onto the wire.
The consent _messages_ are authored in the AdMob console, not here — until
that is published, EEA traffic earns nothing and that is a console task.

**2. ATT.** `expo-tracking-transparency`, requested after UMP. Denying it drops
ads to non-personalised rather than removing them.

**3. Content rating.** `T`, not the SDK's default `MA`. `MA` admits gambling
and alcohol, and the surfaces ads appear on include Budget — a debt tracker
serving betting ads to somebody reading their own overdraft is the single most
obviously wrong ad this app could show, whatever it pays.

**4. The `ads` entitlement.** `ad-slot.tsx` now reads `useEntitlement('ads')`
instead of `usePlan().isPlus`, so `plan_entitlements.ads` is a live pricing
lever rather than a dead column. Its fallback is the freemium row, which is the
deliberate direction: a cache miss shows an ad to somebody who may have paid,
and one refresh corrects it — the reverse hands a paid capability to anyone
whose network dropped.

**5. Adaptive banner.** `ANCHORED_ADAPTIVE_BANNER` fills the device width and
picks its own height. The fixed 320×50 unit was leaving fill and price on the
table on every screen wider than a 2016 phone.

### 1.3 The format ladder, and where it landed

**Anchored adaptive banner — done.** Eight placements is already the sensible
ceiling for a banner-only app; none were added.

**Interstitial — done, narrowly.** Two breakpoints, both a _completed_ flow:
a saved study session and a saved sleep entry. Not on app launch, not on tab
switches, and never after a journal entry — an interstitial on top of somebody
who has just written something private is the fastest way to earn an uninstall.

A third candidate, "returning to the Hub", was considered and dropped: arriving
somewhere is not the same as having finished something, and it would have needed
a navigation observer — a second route by which an ad could fire without a flow
completing.

**Rewarded video — done, and it does not touch the streak.** Per §0.2 it cannot
buy a shield or a day. It buys **24 hours without ads**, which is honestly the
app's to give and costs nobody anything: it trades one impression for the eight
or so it suppresses, which is a bad deal on paper and a good one in practice —
the people who take it were never going to subscribe and were going to resent
the banners either way.

The window deliberately **does not stack**. Four views in a row buy one day, not
four. A reward that accumulates is a currency, a currency gets farmed, and a
farmed reward is incentivised traffic whatever the app calls it.

The other four candidates from the original list are still available and still
better long-term sells, and four of the five are already typed entitlement keys
(`album_limit`, `insights`, `on_this_day_years`, plus a cosmetic): the plumbing
is "grant this entitlement for N hours", which is a `premium_grants`-shaped
problem this repo has already solved once.

**Native ads in the feed — still the biggest unclaimed win, still not built.**
`NativeAd` / `NativeAdView` ship in v16, and Daykeep's long lists (Tasks,
Habits, Notes, Gallery) are exactly where a native unit beats a banner because
it can be styled to the design system instead of sitting under it in a box. It
is a per-screen design job rather than a service, though — each list needs the
unit laid out to match its own row — and a generic version would look precisely
like the boxed banner it exists to replace. Rules when it is built: one per
screen, never above the fold, never in the first eight rows, always labelled.

**App-open ads — still no.** They fire on every foreground, and Daykeep's core
loop is "open, tick a habit, close", often from a reminder. An ad in front of
every one of those turns the app's best habit into its most annoying.

### 1.4 The pacing rules that decide whether this works

Ad revenue is impressions × eCPM × retained days. The third term is the one that
ad strategies usually destroy. Four rules:

- **No ads for the first three days after install.** Day-one ads suppress the
  activation this whole plan is trying to buy. Free money later is worth more
  than free money now.
- **No ads in the first session of any day.** The first open is the one that
  earns the retention; the third is the one that earns the revenue.
- **Session cap on interstitials: two.** Plus a 180-second floor between any
  two full-screen ads of any kind.
- **Never inside `/private/*`, and never on `/challenge`.** Both are already
  respected by convention. §1.5 is about making that survive interstitials.

**Built: `features/ads/services/ad-pacing.ts`.** Every rule above is a pure
function with a test, plus two the policy floor requires rather than taste: a
breakpoint _allowlist_ (`AD_BREAKPOINTS`), so a new placement is a deliberate
edit rather than a new string at a call site, and a launch guard — a breakpoint
reached in the first ten seconds of a session is a cold start that happened to
land on one, and an ad in front of a cold start is exactly the unexpected-ad
violation. Refusals are named (`honeymoon`, `session-cap`, `too-soon`,
`ad-free-route`, …) so the reason an ad did not show is observable; without
that the only symptom is revenue quietly under model.

No ad format calls it yet. It exists first on purpose — the rules are the
product, and interstitials shipped without them are the reliable way to trade a
retained user for a fraction of a cent.

### 1.5 The `/private/*` firewall has to stop being a convention

`features/ads/config.ts` is explicit that ads never go near the private space,
and equally explicit that this is _"enforced by convention... because the honest
fix is to never write the call site."_ For banners, that is a defensible call —
a banner only appears where somebody typed `<AdSlot>`.

**Interstitials break that argument completely.** An interstitial is triggered by
a navigation event, not by a call site, so "don't write the call site" stops
being available as an enforcement mechanism. The moment interstitials land, the
route check the current design deliberately declined becomes necessary.

**Built.** `isAdFreeRoute()` in `ad-pacing.ts` refuses anything under
`private`, `challenge`, the auth stack and first run. It matches on route
_segments_ rather than a path prefix, because Expo Router's group segments
(`(auth)`, `(onboarding)`) never appear in the pathname and a prefix check would
silently miss them — the sort of bug whose only symptom is an ad appearing over
a sign-in screen.

### 1.6 Operational setup (yours, not code)

- Create real ad units in AdMob for each format; set
  `EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_ANDROID`/`_IOS` and the new per-format vars
  via `eas env:set`. The code path for this is already built and documented in
  `features/ads/config.ts`.
- Set `ADMOB_ANDROID_APP_ID` / `ADMOB_IOS_APP_ID` to replace the test app ids
  currently in `app.json`.
- Configure the UMP message in the AdMob console — the consent form is authored
  there, not in the app.
- Turn on mediation only after you have four weeks of single-network baseline.
  Mediation without a baseline is a change you cannot evaluate.
- `PRIVACY.md` needs a section on advertising identifiers and the consent
  choices before any of this ships.

---

## 2. The streak challenge — the live-write rule and the punishment

### 2.1 What the rule is today

The engine is substantially built and it is good work. `0048_streak_challenge.sql`
is server-authoritative, replay-proof by composite primary key, and already
implements the punishment ladder you are asking for:

- A miss with a shield in hand → `shielded`. Costs the shield and the perfect
  run, not the progress.
- A miss with no shield → `missed`. `qualified_days` falls to the rung below,
  or two rungs on a second miss inside the window, floored by
  `max_demotion_days` (45) so a miss on day 364 costs 45 days rather than 65.
- Shields regenerate at one per `shield_earn_days` (30) clean days, capped at 3.

**The gap you are pointing at is real.** `record_challenge_day` accepts a
submission for **yesterday or today**. `challenge-reporter.ts` retries on every
foreground. So the current behaviour is: work offline all day, open the app
tomorrow morning with a connection, and yesterday is credited in full. Nothing
anywhere checks that the user was online when the work happened.

There is a second, smaller inconsistency worth fixing at the same time.
`challenge-reporter.ts`'s catch block says _"An offline week should show up as a
catch-up when the phone reconnects, not as a week that never happened."_ It
cannot. `RETAINED_DAYS = 2` in `challenge-store.ts` prunes to the two most recent
days, and the server refuses anything older than yesterday. The comment promises
something the code cannot do. Under the new rule this becomes moot, but the
comment should go rather than sit there being wrong.

### 2.2 What was built: live attestation, with no way back in

Shipped as `supabase/migrations/0065_challenge_live_writes.sql` plus
`features/challenge/services/live-writes.ts`. The rule is off by default and
turns on per season.

**The server witnesses the write.** `attest_challenge_write(p_module)` takes a
module and nothing else — no day, no timestamp, no count. Every one of those
would be a value the caller could choose, and the entire worth of the resulting
row is that it contains no such value. It records `now()` into
`challenge_live_writes`, keyed `(user, season, day, module)`.

**`record_challenge_day` reads that table instead of the client's map** when the
season sets `require_live_writes`. The client's `p_module_writes` is kept in the
signature — dropping the parameter would break every installed client the
instant the migration applied — and is simply not consulted.

**The client does not queue.** This is the part that matters most and the part
most likely to be "fixed" by a future contributor. A retry buffer flushed on
reconnect would arrive stamped with a fresh `now()`, so the offline-then-connect
cheat would pass with a tidier request pattern than before. So a failed
attestation is dead: the module is marked as not counting, the user is told
immediately, and nothing is replayed. `live-writes.ts`'s header says so at
length, and says what to do instead when somebody loses a day unfairly — widen
`day_grace_hours`, or turn the rule off for that season. Never a queue.

**Three things the gate refuses, all tested** (`live-writes.test.ts`):

- **Background writes.** A widget tap routes through drizzle and is deliberately
  observed, but must not earn a day without the app being opened. "Live on the
  app" is checked as `AppState.currentState === 'active'` at call time.
- **Sync pulls.** Already impossible, and load-bearing: the sync engine writes
  through `getRawDb()`, never drizzle, so the write observer never sees it.
  Without that boundary, signing in on a new phone would attest every module
  from a thousand rows of downloaded history.
- **Uncommitted modules.** Refused rather than stored, so the table cannot be
  grown by activity that could never affect a day.

**Turning it on is a season switch, not a deploy.** `require_live_writes`
defaults to false, is settable from the operator console's season screen, and
must not be turned on until the client that implements attestation has actually
shipped. Turning it on with older clients in the field stops every one of them
qualifying, and the first anybody hears of it is a support ticket about a lost
run. The operator toggle is a `Switch` rather than a number field precisely
because turning it _off_ is the emergency lever.

**The user is told in three places**, because a rule this strict is only
defensible if the app is honest about it in real time — otherwise somebody works
all evening on a train, watches every line go green, and loses the day at
midnight:

- **The checklist row** has three states now, not two: untouched, worked-on-but-
  offline (a filled warning tile with a `CloudOff` mark), and counted. `counts`,
  never `done`, drives every visual.
- **The card's status line** names the offline modules specifically.
- **The join screen** states the rule before anybody commits to a season under
  it, next to the module lock — the same reasoning that put the lock there.

The 20:00 at-risk reminder also now keys off `counts`, so it names work that was
done offline instead of falling silent on a locally-complete day that is not
going to count.

**Eleven SQL tests** cover it in `scripts/test-migrations.mjs` ("the live-write
rule (0065)"), including the headline one — a full client map with no
attestations does not qualify — and its mirror, an _empty_ client map with three
attestations that does.

### 2.3 The punishment, and the one piece missing

You asked for a "not count" rule that behaves like a punishment. §2.1 shows the
ladder is built. What is missing is that **the punishment is currently invisible
until after it has happened.**

`challenge-reminders.ts` fires one at-risk notification at 20:00 naming the
outstanding modules — good, and better than most implementations. But there is no
moment where a user is told what a miss will _cost_ them before they miss it.
`challenge-math.ts` already exports `demotionTarget()`, which computes exactly
that number and is currently only used for a warning string.

Add, in order of value:

1. **A cost-of-miss line on the at-risk reminder.** Not "your streak is at
   risk" — "Journal and Water not logged. Missing today drops you from 84 days
   to 60." `demotionTarget()` already returns the 60.
2. **A second, later nudge at 22:00** for users with zero shields, since they are
   the ones with something real to lose. Respects `bypassQuietHours` the same way
   the 20:00 one does.
3. **A day-after settlement screen.** When `challenge_events` carries a
   `demoted` row the user has not seen, show it once — what happened, what it
   cost, what the shield situation is now. `demotion-sheet.tsx` exists; wire it
   to the event feed. A punishment nobody is told about is just a bug.
4. **A win-back path.** A broken run is the highest-churn moment in the whole
   program, and right now nothing happens at it. One notification, 48 hours
   later, framed as the next rung rather than the lost one.

### 2.4 Season settings I would change

Reading the defaults in `challenge_seasons` against what §2.2 adds:

- `min_active_seconds` is 30. With live attestation as the anti-bot floor, this
  is now redundant belt-and-braces — harmless, leave it.
- `day_grace_hours` is 0, the strict rule. **Raise it to 3.** People who journal
  at 12:30am are the most engaged users you have, and the current setting files
  their work against tomorrow and breaks their streak for being awake. The
  column exists precisely so this can change without a release.
- `module_lock_days` at 30 with 2 swaps is right. Leave it.

---

## 3. First run — module knowledge before the dashboard

### 3.1 Where the flow stands

`app/(onboarding)/index.tsx` runs seven steps: welcome → account → about you →
focus → shape → lock → ready. It is genuinely well built — the focus answers
seed real habits and real settings, and `ready-step.tsx` reads back what was
actually created rather than what was requested.

Three gaps against what you asked for:

1. **No module education anywhere in the app.** I grepped for coach marks,
   spotlights, tours, tooltips, "what's new" — there is nothing. A user reaches
   the Hub and meets thirteen tiles with a title and a subtitle each.
2. **Notification permission is never requested during onboarding.**
   `requestNotificationPermission()` in `lib/notifications.ts` has exactly two
   callers outside its own file: the settings screen, and the scheduling
   functions that request it inline at the moment they need it. That means the
   first time most users see the iOS permission dialog is at some arbitrary
   later moment with no context — which is how you get a permanent denial. This
   is a §4 problem as much as a §3 one.
3. ~~**The onboarding flag is per device, not per account.**~~ **Fixed** —
   `features/onboarding/services/onboarding-scope.ts`. The device now records
   _which accounts_ finished onboarding on it, which separates the two cases the
   old boolean conflated: "this account finished and we cannot reach the server"
   (onboarded, no network involved) from "somebody else's account finished on
   this phone" (not onboarded). All four screens that route on it — `index.tsx`,
   the auth gate, the OAuth callback and create-password — ask the same
   function, and a test asserts they keep doing so.

### 3.2 The design — three layers, not one wall

**Layer 1 — a "how Daykeep works" step, in onboarding, before the dashboard.**
Four cards, not eighteen. It teaches the _shape_ of the app, which is the part
that is genuinely non-obvious:

- Four tabs are the daily drivers; everything else lives in the Hub.
- Everything is local first and works offline; sync is opt-in with an account.
- The private space is separate and locked, and nothing in it syncs plainly.
- Reminders are how the app reaches you, and here is the one permission ask.

Roughly 30 seconds. Personalised by the focus answers already collected on the
previous step — someone who picked Money and Sleep gets those two named in the
examples.

**Layer 2 — a personalised module shortlist, in the same step.** The user picked
focus areas one screen earlier and `features/hub/config/module-focus-map.ts`
already maps focus areas to modules. Show the three-to-five modules their answers
imply, each with one line on what it does and what it is for. Ticking one adds it
to a "start here" row on the dashboard. This is where "complete module knowledge"
actually gets delivered — for the modules they will plausibly use, at the moment
they care.

**Layer 3 — first-visit module cards, just in time.** The first time a user opens
any module, a dismissible card at the top: what it does, the one thing to try
first, and the setting most worth knowing about. Persisted per module id in a new
`features/onboarding/store/module-intro-store.ts`, so it appears once and never
again. Thirteen small pieces of copy, written once, delivered at the only moment
each one is relevant.

Together these mean nobody meets a module cold, without putting an eighteen-screen
tutorial in front of an app they have not used.

### 3.3 Where the Hub fits

Add a "What is this?" affordance to `module-card.tsx` — the same copy as layer 3,
reachable on demand. That is the difference between an app that taught you once
and an app you can ask.

### 3.4 If you want the mandatory full tour anyway

It is your product and this is a legitimate call to make — some apps do want the
committed-user filter that a long onboarding creates. If so:

- Put it **after** `ready-step`, not before. Never between a user and the
  evidence that the app did something for them.
- Make it skippable-with-friction rather than unskippable. A hard wall gets
  uninstalled; a "skip, I'll explore" link gets clicked by the 20% who would
  have bounced.
- Instrument it per card so you can see exactly which card people quit on, and
  put a real number on what it costs. `features/analytics/` is already wired for
  this.

---

## 4. Reminders on by default for every module

### 4.1 The gap

The global layer is already what you want. `notifications-store.ts` ships
`masterEnabled: true` and every category enabled, with quiet hours 22:00–07:00
and `deliveryMode: 'individual'` — and the comment explaining why digest is not
the default is exactly right.

**The per-item layer is the opposite.** Every module defaults its reminder off:

- `database/schema.ts:44` — tasks, `reminder_enabled` default `false`
- `database/schema.ts:586` — sleep, `reminder_enabled` default `false`
- `tasks-repository.ts:99` — `reminderEnabled: input.reminderEnabled ?? false`
- `sleep-repository.ts:43` — `reminderEnabled: false`
- habits — `reminderTime` is nullable and starts null

So "reminders are on" is true at the switchboard and false at every socket.

### 4.2 The constraint that shapes the whole solution

**iOS keeps 64 pending local notifications and silently discards the rest.**
`features/notifications/services/scheduling-budget.ts` already documents this in
detail, including the non-obvious part: iOS keeps the 64 that fire _soonest_, not
the 64 registered first, so scheduling order cannot protect anything.

This matters enormously here. Turning reminders on for every item in every module
does not give a user more reminders — past 64 pending, it gives them _fewer and
worse_ ones, because hydration nudges every 30 minutes will crowd out the task
due tomorrow. A naive "default everything on" makes the notification system worse
for the exact power users it is aimed at.

### 4.3 What was built

**Default on per module, not per item**, seeded from the focus answers —
`features/onboarding/services/reminder-defaults.ts`. Somebody who picked Money
and Sleep is not reminded to log a study session; that is the notification that
gets a whole category switched off, and switching a category off costs the
reminders they did want.

**The times are not invented.** Every module already ships a default schedule
chosen by whoever built it. This flips `enabled`; there is not a single time in
the file.

| Module  | Default                            | Now on when focus includes |
| ------- | ---------------------------------- | -------------------------- |
| Journal | 21:00 daily                        | Journal                    |
| Study   | 19:00, Mon–Fri                     | Study                      |
| Water   | hourly, 08:00–21:00                | Water                      |
| Goals   | 3 days before each deadline, 09:00 | Goals                      |

**Four of the plan's eight were dropped, and the reasons are in the file.**

- **Sleep** needs a target bedtime and onboarding never asks for one.
  `syncBedtimeReminder` returns early without it, so the switch would schedule
  nothing — and inventing a bedtime produces a nightly alarm at an hour the user
  never chose, which is worse than silence.
- **Habits** are reminded per habit at a per-habit time. The starter habits have
  no time attached, and one blanket hour fires "evening stretch" at 9am.
- **Tasks** are reminded relative to a due date. Nothing to schedule until a
  dated task exists.
- **Budget** has per-debt reminders only. A weekly review nudge is a feature
  that does not exist, not a default that is off.

Turning on a switch that schedules nothing would leave a settings screen
claiming a reminder the user will never receive — the exact failure this area
already had.

**Goals is the honest edge case.** It is genuinely switched on, and it queues
nothing until the user sets a goal with a date. A test pins that
(`module-reminders.test.ts`) so the next person reading "goal reminders do not
work" lands on the explanation rather than the bug.

**The permission ask moved into onboarding**, in the new Learn step, immediately
after the sentence explaining what it is for. Before this it had two callers:
the settings screen, and the scheduling functions requesting it inline at
whatever moment they happened to need it — so most people met the iOS dialog
with no context, which is how it gets permanently denied. It is a button rather
than an automatic prompt on mount: iOS gives one chance per install, and
spending it on somebody who is still reading spends it badly.

**The receipt names it.** `ready-step` reads what actually landed and says
"Reminders on for Journal, Water" plus where to change them. Turning reminders
on for somebody who did not ask for each one is something the app should say out
loud.

**The ceiling is tested under the load this creates.** Three new tests in
`module-reminders.test.ts` run a full resync with all four defaults on and a
hundred dated tasks, and assert the queue never exceeds `SCHEDULING_BUDGET`,
that tasks win the budget over hydration, and that the defaults still land for a
user with nothing competing. That ordering matters more than it looks: hydration
fires hourly, so it is _soonest_ far more often than a task due tomorrow —
meaning the reminders iOS would keep on its own are the least consequential
ones. Stopping short of the limit is what makes the rebuild's intent real.

---

## 5. Other areas worth improving

You asked what else could be better. These are things I found while reading, in
rough order of value.

**5.1 The `ads` entitlement disconnect (§1.2.4).** Repeated here because it is a
one-line fix that turns a dead database column into a live pricing lever, and it
is the cheapest item in this entire document.

**5.2 Account-scoped onboarding.** Already in `TODO.md` with the correct analysis
of why the naive fix strands offline users. It blocks §3. The shape of the real
fix: store _which user id_ completed onboarding on this device, treat "a
different account finished it" as not-onboarded, and keep "this account did, we
just cannot reach the server" as onboarded. Three call sites want the same
treatment — `use-auth-gate.ts`, `app/auth/callback.tsx`,
`app/(auth)/create-password.tsx`.

**5.3 Every new surface here costs four locales.** `lib/i18n/locales/` holds
`en`, `ar`, `hi`, `ur`, and `npm run check:i18n` fails the build on a key that
any locale is missing. Two of those four are RTL. The module intro copy in §3.2
alone is thirteen modules × three lines × four languages. Budget for it, and check
the RTL layouts — `components/ui/directional-icon.tsx` exists because this has
bitten before.

**5.4 The analytics to evaluate any of this — DONE.** Migration 0066 adds
`funnel_daily`: the onboarding funnel step by step, the notification permission
grant/deny split, ad impressions, and a named counter for every pacing refusal.
`admin_challenge_retention()` answers Gate A's D30 question from tables that
already held the data.

Two design calls worth knowing about. It is **counters, not an event log** — the
same shape `usage_daily` uses, because nothing here needs to know the order two
things happened in and an event log gives up the "incapable of answering
anything about content" property for questions nobody asked. And it is keyed to
an **install, never an account**, because onboarding largely happens before
there is one — a metric requiring `auth.uid()` would report a completion rate
computed only over people who completed the account step.

The consent timing needed a narrow, explicit compromise: `usage-consent-card`
deliberately waits for onboarding to end, so the onboarding funnel necessarily
accrues before anybody has been asked. Those specific metrics — listed by name
in `PRE_CONSENT_METRICS`, ads excluded — buffer locally, nothing is transmitted
until the question has an answer, and refusing erases the buffer. **This is a
judgement call and worth overruling if you disagree**: the alternative is
accepting that onboarding drop-off is permanently unmeasurable.

**5.5 The challenge reporter's offline comment is wrong** (§2.1). Small, but it
is the kind of comment that makes a future reader trust the wrong thing.

**5.6 The removed `REWARDS_STRATEGY.md` modelled ad revenue at ~$540 per
1,000-user season against ~$1,200 from Plus conversions.** That is worth
re-reading before committing heavily to §1: the strategy you already wrote says
subscriptions are the larger line, and the season is your best conversion window.
The ad work in §1 is still worth doing — a 2× eCPM improvement on a fixed base is
free money — but the framing should be "make the existing ad surface earn
properly," not "ads become the business."

**5.7 Interstitials will break the private-space guarantee** (§1.5). Flagged
again because it is the one item here that turns a documented promise into a
false one.

---

## 6. Build order

Six phases. Each has a gate; do not pass one on optimism. **Phases 1, 2 and 4
are done** — what follows records what shipped and what is still ahead.

### Phase 1 — Ad revenue, cheap wins — DONE

`useEntitlement('ads')`, `ANCHORED_ADAPTIVE_BANNER`, `setRequestConfiguration`
with `maxAdContentRating: 'T'` and both COPPA flags stated explicitly.

_Still yours: create the real ad units in AdMob and set the env vars. The code
path is built and documented in `features/ads/config.ts`._

_Gate: measure banner eCPM and fill for one week as the baseline everything else
is judged against._

### Phase 2 — Compliance — DONE

UMP via `AdsConsent.gatherConsent()` before the SDK initialises, ATT after it on
iOS, `showPrivacyOptionsForm()` available from Settings.

_Still yours: publish the GDPR message in the AdMob console — until then
`canRequestAds` stays false in the EEA and that traffic earns nothing. And
`PRIVACY.md` needs its advertising-identifier section before this ships._

_Gate: consent form verified on a real EEA-geo device; ATT opt-in rate recorded._

### Phase 4 — The live-write rule — DONE

Migration 0065, `live-writes.ts`, the three-state checklist, the join-screen
notice, the operator toggle, 11 SQL tests and 8 unit tests. See §2.2.

_Still yours: the switch is off. Ship a build carrying `live-writes.ts` to
everybody in the current season, then turn `require_live_writes` on from the
operator console. Turning it on first breaks every client in the field._

_Gate: no rise in support contacts about lost days, and the share of days
failing purely for lack of attestation under 5%. Above that, `day_grace_hours`
is the knob — not a retry queue._

### Phase 3 — First run and reminders (about 1 week) — NEXT

- Account-scoped onboarding flag (§5.2) — blocker, do it first
- Layer-1 knowledge step with the notification permission prime
- Layer-2 personalised module shortlist
- Module-level reminder defaults, seeded from focus answers
- The scheduling-budget test

_Gate: onboarding completion rate has not dropped, and notification permission
grant rate is above 60%. If completion drops, the knowledge step is too long —
cut cards, do not cut the permission ask._

### Phase 5 — Punishment made visible — DONE

Migration 0067 sends the three values `demotionTarget()` needed and never had.
The 20:00 reminder now prices the miss; a 22:00 last call goes only to runs with
no shields left; the win-back fires 48 hours after a fall, framed as the next
rung, and cancels itself the moment another day completes.

The settlement screen needed nothing — `DemotionSheet` has been wired to
`challenge_events` since it shipped. Arming the win-back hangs off the same
unseen event, so it fires exactly once per fall.

`costOfMissToday` returns null rather than a plausible zero whenever a number
would mislead (a shield is held, the ladder has not arrived, nothing to lose
yet) and the copy branches instead of interpolating — this lands on a lock
screen, and a notification cannot be corrected.

_Gate: the share of runs that spend at least one shield lands in the 40–70% band
the removed `REWARDS_STRATEGY.md` §9 called green. Moot while there are no runs._

### Phase 6 — New ad formats — MOSTLY DONE

**Built:** the runtime gate (`ad-gate.ts`) composing the pure pacing rules with
entitlement, consent, the operator switch and the rewarded ad-free window;
session bookkeeping (`ad-session-store.ts`) that persists the cooldown but not
the session cap, so force-quitting cannot reset the floor between two ads;
interstitials preloaded at foreground and shown at two allowlisted breakpoints;
rewarded video buying 24 hours ad-free.

**Three shapes that are policy rather than taste.** The rewarded ad is only ever
triggered by a button somebody pressed, discloses the reward before playing, and
grants only on `EARNED_REWARD` — never on close, never on anything
click-derived. The offer lives in Settings rather than beside a banner, because
stacking a control next to an ad creative is what the placement policies exist
to prevent. And the ad-free window **does not stack**: four views in a row buy
one day, not four, because a reward that accumulates is a currency and a
currency gets farmed.

**`hub-return` was dropped from the breakpoint allowlist.** Arriving somewhere is
not the same as having finished something, and wiring it needs a navigation
observer — a second way for an ad to be triggered by something other than a
completed flow. An allowlist entry with no call site also rots: it reads as
supported, and the first person to use it inherits a placement nobody chose.

**Not built: native in-feed ads.** They are the highest-value new format for
this app and they are a per-screen design job, not a service — `NativeAdView`
has to be laid out inside Tasks, Habits, Notes and Gallery to match each list's
own row, and a generic one would look exactly like the boxed banner it is meant
to replace. Worth doing next; not worth faking now.

**None of this has run on a device.** Everything above typechecks and the pure
layers are tested, but interstitial fill, rewarded playback and the ad-free
window's effect on a live banner can only be confirmed in a dev-client build.

_Gate: ARPDAU up, and day-7 retention flat or better. Both are now measurable —
`ad_impression` and the refusal counters land in `funnel_daily`. If retention
moves down, the pacing constants were too loose; tighten before adding a
format._

Layer-3 module intro cards and the Hub "What is this?" affordance are copy work
that can run in parallel with any phase.

---

## 7. What to measure

Ad revenue and retention pull against each other, and the only way to run this
plan honestly is to watch both.

|                                       | Green      | Red                |
| ------------------------------------- | ---------- | ------------------ |
| Onboarding completion                 | ≥ 75%      | < 60%              |
| Notification permission grant         | ≥ 65%      | < 45%              |
| Day-7 retention, post-ads vs. pre     | flat or up | down > 5%          |
| Challenge days lost to no attestation | < 5%       | > 15%              |
| Runs spending ≥ 1 shield              | 40–70%     | < 20% or > 85%     |
| ARPDAU                                | up         | flat after phase 6 |

The pairing matters more than any single row. A rise in ARPDAU next to a fall in
day-7 retention is not a win — it is borrowing from next quarter, and this app's
whole value proposition is the streak that only exists if people come back.
