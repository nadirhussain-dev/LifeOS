# The Streak Challenge — mechanics

Strategy and gates: [REWARDS_STRATEGY.md](REWARDS_STRATEGY.md). The build:
[STREAK_IMPLEMENTATION.md](STREAK_IMPLEMENTATION.md).

This is the specification the engine was built from. Everything in §0–§5 is
implemented and shipped in migrations 0048–0050 unless marked otherwise; §6–§9
describe the parts that arrive with a physical prize and are deliberately not
built.

> **The offer, as the user sees it:** pick at least three parts of Daykeep you
> will keep alive every day. Keep all of them going, online, and climb a ladder
> of rewards. Miss a day and a **shield** absorbs it, if you have one — you can
> hold three. Run out, and you fall back down the ladder.

---

## 0. The two rules that don't bend

### 0.1 Ads may never be part of how a day or a shield is earned

The rule the whole programme rests on.

Rewarded video is a **sanctioned** AdMob format — rewarding somebody for opting
into a video is exactly what it exists for. What is not sanctioned is
incentivising clicks, or manufacturing impressions the advertiser got no value
from. So video is fine. What matters is what the video is allowed to buy.

| Reward for watching a video                                   | Verdict  |
| ------------------------------------------------------------- | -------- |
| A cosmetic, a temporary theme, extra storage, a report export | ✅ Fine  |
| **A shield**                                                  | ❌ Never |
| **A qualified day, or any progress toward a prize**           | ❌ Never |

Three reasons, any one sufficient:

1. **Policy.** A path from ad impressions to a physical prize is the shape of
   incentivised traffic, whatever the intermediate steps are called.
2. **Law.** Watching ads is non-monetary consideration in several jurisdictions.
   Making it a route to a prize turns a gift into something a regulator can call
   paid entry.
3. **Design.** A shield you can farm from a video is not scarce, and a shield
   that isn't scarce does no motivational work — the mechanic collapses into
   "watch three ads whenever you're lazy".

**Enforcement is an absence:** there is no RPC in 0048 that grants a shield or a
day from an ad callback, and there must never be one.

**The challenge screen carries no ads at all.** Not a banner, not a native unit.
It is the emotional core of the programme, and an ad rendered beside a streak
creates exactly the appearance this section exists to prevent. Ads stay on the
ordinary module screens they already live on.

### 0.2 Nothing about paying may change the finish condition

Everyone needs the same number of qualified days. Subscription buys
**forgiveness, never progress** — see §2.3.

---

## 1. The mechanic

### 1.1 Three layers

**Layer 1 — a perfect day.** Every committed module was used, online, and the
server agreed (§1.2). Progress advances, rungs unlock, and every
`shield_earn_days` clean days earns a shield.

**Layer 2 — a miss with a shield.** Spent automatically. The run survives; the
day never counted, so **the finish date moves one day later**. You lose no
ground — you take longer.

**Layer 3 — a miss with no shields.** Progress falls back to the last rung you
passed, and a further unshielded miss before the run recovers drops another rung.
Two corrections keep this humane:

- **A demotion cap** (`max_demotion_days`, default 45). You fall to the previous
  rung _or_ 45 days back, whichever is kinder. Without it the penalty inverts: a
  miss on day 8 costs one day and a miss on day 364 costs 65, punishing hardest
  the people who have invested most, at exactly the moment quitting is likeliest.
- **Misses age out.** The escalation counter clears after a clean run. Being in
  the programme longer must not make somebody permanently more fragile.

**Two things are never taken back:** a badge already unlocked, and a prize
already shipped. Only progress toward the _next_ rung resets.

**Every demotion is explained.** A silent drop reads as theft — see the demotion
sheet in §5.

### 1.2 The module contract

A day counts when **every module the user committed to** got real activity, while
online, confirmed by the server. Minimum three. More if they want.

#### 1.2.1 Which modules are eligible

Not every module suits a daily promise. Budget has days with no transaction, the
gallery is naturally weekly, music is not a thing you _do_. Committing to those
sets somebody up to fail for reasons unrelated to discipline.

Eligibility is **admin-curated per season** in `challenge_modules`, not
hardcoded. Proposed starting set, all naturally daily:

**Habits · Tasks · Journal · Water · Sleep · Study · Goals · Notes**

Module ids are the **sync registry's keys** (`features/sync/config/sync-tables.ts`),
because that is what the write-attribution map is derived from.

#### 1.2.2 Choosing, locking, swapping

- **Locked for the first 30 days.** Otherwise the picker becomes the exploit:
  swap out whichever module you forgot today.
- **Two swaps per season** after that, effective from _tomorrow_, never
  backdated, both logged.
- **Extras can be added or dropped freely** — they were never the contract.
- A swap does not reset progress. The contract changes going forward.

#### 1.2.3 Extras — what tracking more buys

| Modules committed | Shield regenerates every |
| ----------------- | ------------------------ |
| 3 (the minimum)   | 30 clean days            |
| 4                 | 27 days                  |
| 5+                | 25 days                  |

**More effort buys more forgiveness, never faster progress.** Nobody can shorten
the run; they can only make it more survivable, and only by doing more work.
Extras are _harder_, not easier — a sixth module is a sixth thing that can kill
the day — and the faster regeneration is the compensation.

**Stacking:** the extras perk and the annual-plan perk (§2.3) both reduce the
interval, with a **floor of 20 days**. Resolved once at enrolment and stored on
the run, so a lapsing subscription never silently changes the rules underneath
somebody two hundred days in.

#### 1.2.4 What this costs, and the one thing that must be true

If three modules failed independently at 3% a day, a perfect day would be
0.97³ ≈ 91% — about 32 missed days a year against roughly twelve shields.

They don't fail independently: the dominant failure is "didn't open the app",
which takes out all three at once. But this rule creates a **second** failure
mode, entirely self-inflicted: opened the app, did two of three, went to bed.

> **The committed modules must render as a single unmissable checklist** with an
> explicit day-complete state, plus a reminder naming exactly what is missing.
> Get this right and the module rule costs almost nothing in completions; get it
> wrong and it halves the finishing rate.

### 1.3 Shields — hard cap of three

`shield_cap = 3`, for everyone, permanently. No fourth slot at any rung, no
purchase, no video, no exception. The cap is what makes the third one feel like
the last.

**The cap is on the buffer, not the total.** Over a long run somebody earns many
shields as they regenerate; they can never bank more than three at a time.

Shields are **earned only** — never sold, never granted for watching anything,
and never awarded by support except through the audited
`admin_grant_challenge_shield` path with a written reason.

### 1.4 Four counters, kept separate

| Counter          | Meaning                                       | Drives                               |
| ---------------- | --------------------------------------------- | ------------------------------------ |
| `qualified_days` | Qualified days in the current run             | Rung progress — the number on screen |
| `perfect_run`    | Consecutive days with **no** miss of any kind | Earning shields, ageing out misses   |
| `shields`        | Shields held, 0–3                             | The layer-2 buffer                   |
| `recent_misses`  | Unshielded misses since the last clean run    | How deep the next demotion goes      |

`qualified_days` is a count, not a calendar span — so a shielded day is a gap in
the calendar but not a break in the chain.

### 1.5 The ladder

Rungs are data (`challenge_tiers`), not constants. The reference ladder:

| Day     | Rung         | Reward                                      | Kind         |
| ------- | ------------ | ------------------------------------------- | ------------ |
| 7       | Spark        | Badge + exclusive gradient theme            | Digital      |
| 30      | Ember        | Exclusive app icon, first shield            | Digital      |
| 60      | Flame        | Shareable "your 60 days" stats card         | Digital      |
| 90      | Blaze        | Name on the finishers wall, opt-in          | Digital      |
| 120     | Keystone     | The gift box becomes visible and named      | Digital      |
| 180     | Half Year    | Prestige badge, profile frame, storage bump | Digital      |
| 240     | Forge        | Custom chain colours, animated badge        | Digital      |
| 300     | Summit       | Personalised "year so far" film             | Digital      |
| **365** | **Year One** | **The physical gift box, claimable**        | **Physical** |

**Deliberately not a reward at any rung: free Plus.** It switches off the ad
revenue the free tier exists to generate, and it muddies the free/paid separation
§2.3 depends on.

---

## 2. Money

### 2.1 Three ad formats

| Format                         | Where                           | Rules                                                                                           |
| ------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Banner** (shipped)           | Bottom of eight module screens  | Unchanged                                                                                       |
| **Interstitial** (not built)   | Natural session boundaries only | Never mid-task, never on a save, never on the challenge screen. Min 4 minutes apart, max ~6/day |
| **Rewarded video** (not built) | Opt-in, user-initiated          | Cosmetics, themes, storage, exports. **Never a shield, never a day**                            |
| **Native** (later)             | Gallery feed                    | Labelled; must not mimic a post's own actions                                                   |

All inherit the existing rules: nothing inside `/private/*`, nothing for Plus
subscribers, and the operator's `ads` kill switch turns the lot off.

### 2.2 Rough economics

Per free user per year, in this app's markets (`en · ur · hi · ar`), where eCPMs
run well below US rates:

| Source                  | Per user / year |
| ----------------------- | --------------- |
| Banner                  | $0.70 – 7       |
| Interstitial            | $0.50 – 4       |
| Rewarded video          | $0.30 – 3       |
| **Total, free user**    | **$1.50 – 14**  |
| `plus_monthly` $4.99/mo | ~$42 – 51 net   |
| `plus_yearly` $39.99/yr | ~$28 – 34 net   |

**Validate every figure against your own AdMob console before ordering
anything** — these are industry-shaped estimates, not measurements.

Two conclusions: video roughly doubles free-tier revenue without closing the gap
on a box; and **collecting a full year before any prize ships is worth more than
any ad optimisation**, because the large majority who never finish still pay in.

### 2.3 Subscribers are eligible — and how to say so

A subscriber is worth roughly 6–60× a free user, and a completed box is covered
by about a year of subscription. Excluding your most valuable users from your
best retention mechanic would be self-harm.

**The framing is load-bearing:**

| Rule                                      | Detail                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Identical finish condition                | Same day count, free or paying. Subscription buys forgiveness, never progress.                                        |
| The cap stays 3 for everyone              | An annual subscriber never holds a fourth shield.                                                                     |
| The edge is regeneration and a head start | One shield pre-loaded, and a shorter interval.                                                                        |
| There is always a free path to it         | The same head start must be reachable by referral or by finishing a prior season **before any physical prize ships**. |
| The paywall never mentions the prize      | It may list "challenge shields" among Plus perks. It may not show, name or picture a box.                             |

The reason is precise: the moment a prize reads as a benefit _of paying_, the
subscription becomes consideration — paid entry to a prize. That is the lottery
problem in most jurisdictions and a store-policy violation in both stores, at
once. Eligible **because they're users**, not because they paid.

> **Gate B blocker.** The plan-based shield perk is implemented in
> `enroll_in_challenge` and is safe only while there is nothing to win. The free
> path is not built. It must exist before a physical prize ships — there is a
> comment saying so in the migration.

---

## 3. Keeping it deterministic

Everyone who completes gets the reward. **No draw, no winner cap, no "first N
finishers."** That absence of chance is what keeps this a conditional gift rather
than a regulated promotion, and it is worth protecting above everything else.

**Cap entry, not prizes.** `max_enrollments` bounds liability before anybody
starts, without making completion a race between participants.

---

## 4. Server design (0048–0055)

Seven tables, all with RLS, and **no client-side insert or update policy
anywhere**. A streak the client can `UPDATE` is a streak anyone can `UPDATE` with
an anon key and one `curl`.

| Table                          | What it holds                                                      |
| ------------------------------ | ------------------------------------------------------------------ |
| `challenge_seasons`            | Every knob. Nothing about the programme is a code constant.        |
| `challenge_tiers`              | The ladder, one row per rung.                                      |
| `challenge_modules`            | Which modules may be committed to, and their estimated daily cost. |
| `challenge_enrollments`        | The run: four counters, frozen timezone, resolved shield interval. |
| `challenge_enrollment_modules` | The contract, with rows **closed rather than deleted**.            |
| `challenge_days`               | Append-only ledger: outcome + `modules_hit`, server-stamped.       |
| `challenge_events`             | The readable history the timeline and notices quote.               |

Operator actions write to the existing `admin_audit_log` (0010) rather than a
private audit table, so they read in the same timeline as every other operator
action.

### 4.1 One season state, quoted everywhere (0055)

`challenge_season_state(season)` returns exactly one of seven words, and every
surface reads it rather than deriving its own:

| State      | Meaning                                                     |
| ---------- | ----------------------------------------------------------- |
| `none`     | No season a user has any business hearing about.            |
| `closed`   | Exists, switched off. No joins, and running streaks paused. |
| `upcoming` | Switched on, before its start date.                         |
| `ended`    | Switched on, past its end date.                             |
| `notReady` | In window, with fewer eligible modules than it asks for.    |
| `full`     | Joinable, but `max_enrollments` is met.                     |
| `open`     | Joinable now.                                               |

It is checked in that order, and the first failure wins — a season that is both
closed and empty needs switching on before its modules matter.

**This exists because the two consoles disagreed.** The operator screen called a
season open when it was `enabled` inside its dates; the app called it open when
`challenge_modules` had rows to pick from. Both were right. Staging sat from
2026-08-16 with an enabled, in-window season and an empty module table, showing
_Open_ to staff and _"No season is open right now"_ to every user, and no screen
anywhere could show both facts at once. Two derivations of the same fact will
always eventually disagree, and the disagreement is invisible from either side.

`notReady` is `eligible < required_modules`, not `eligible = 0`: a season asking
for three commitments with two eligible modules is exactly as unjoinable, the
picker just fails further along.

Three readers, one derivation:

- `challenge_season_status()` — the app's single read, public like the tables it
  covers, carrying the state, the dates, the seats left, the modules and the
  ladder. It replaced three round trips **and** the client-side inference that
  threw the reason away.
- `admin_challenge_seasons()` — the console, with the counts that explain the
  word (`eligibleModules` against `requiredModules`, rungs, runs).
- `challenge_today()` — extended to carry `seasonState`, so somebody already in
  a run learns the programme was paused instead of watching `record_challenge_day`
  refuse with `season paused` into a checklist with no field for a reason.

The client maps the word onto sentences in
`features/challenge/services/season-state.ts`, and the operator console renders
the user's sentence with the app's own component — so an operator never has to
take the console's word for what users can see.

### 4.2 The console writes (0055)

| Function                             | Why it is separate                                                  |
| ------------------------------------ | ------------------------------------------------------------------- |
| `admin_set_challenge_season_enabled` | The switch reached for under pressure. Cannot change anything else. |
| `admin_update_challenge_season`      | Patches only the keys present in its jsonb.                         |
| `admin_seed_challenge_season`        | Fills an empty season with the default modules and ladder.          |
| `admin_delete_challenge_tier`        | 0048 could add a rung and never take one back.                      |
| `admin_delete_challenge_season`      | Refused once anybody has joined — close it instead.                 |

The patch shape is the important one. 0048's `admin_upsert_challenge_season`
takes the whole settings object and coalesces every absent key to its factory
default, so a console calling it to move an end date would silently reset
`shield_cap`, `min_writes` and nine other knobs for a season people are two
hundred days into. An absent key in the patch means "leave it"; an explicit null
means "clear it" — a distinction jsonb can make and eighteen nullable arguments
cannot.

Seeding only ever fills gaps: a season with one curated module keeps exactly
that one module. The operator pressing the button is usually not the person who
made the curation.

**The maths is split from the clock.** `challenge_credit_day` and
`challenge_settle_missed_day` take the day as an argument and never ask what time
it is; the public entry points work out the day and then call them. That is what
lets the state machine be tested exhaustively without time travel, and both are
revoked from `authenticated`.

**The server decides everything the client could lie about**: what day it is
(from `now()` and the frozen offset, rejecting anything outside yesterday-or-
today), what the contract was _on that day_, and whether it was met.

---

## 5. Client design

- **Writes are attributed at the database**, not in mutation hooks — see
  `database/write-observer.ts`. Sync pulls, the media cache and import/restore
  all write through `getRawDb()` and are therefore structurally invisible to it,
  which is what stops a sync from fabricating days.
- **The buffer accrues offline** under the device's local date and submits on
  reconnect. Nothing is drained: `record_challenge_day` is idempotent, so
  re-sending is free and a lost response never costs a day.
- **Local is for feedback, never for verdicts.** The checklist ticks instantly
  from the buffer; only the server's answer marks a day qualified.
- **The at-risk reminder is re-queued on every write**, so a local notification
  carries text that is true when it fires and is cancelled outright once the day
  is done.
- **The demotion sheet** finds the fall by walking `challenge_events`, not by
  comparing counters — counters only say where somebody is now.

---

## 6. Anti-abuse

1. The server clock is the only clock.
2. Timezone frozen at enrolment.
3. Composite primary key on the ledger — kills replay.
4. The module contract itself: three real writes in three modules is a far higher
   bar to automate than one.
5. Writes must be real writes, and `*_settings` tables never count — otherwise a
   streak could be held by toggling a reminder switch each evening.
6. **No ad-to-reward path at all**, which also closes the farm-shields-with-a-
   video-farm vector before it exists.
7. One active run per device, on top of `single_device_sessions` (0047).
8. One claim per postal address per season — Gate B.
9. Manual verification of every physical winner before shipping — Gate B.

---

## 7. Legal — required before any physical prize

Not needed for the engine as shipped; required before Gate B.

- **Terms**, linked from enrolment: eligibility and age, shippable countries,
  what counts as a day, how shields and demotion work, that enrolment can close,
  prizes non-transferable and non-cash, duties on the winner, fraud voidable.
- **Keep it deterministic** (§3).
- **The subscription separation** (§2.3) is part of the structure, not a
  marketing preference.
- **Rewarded video needs its own disclosure**: what it grants, and explicitly
  what it does not.
- **`PRIVACY.md`** for the day ledger and, later, the postal address.

---

## 8. Not built, by design

`challenge_claims`, addresses, shipping, the operator claims queue, the terms
copy, `reward-notify` and the email set, the referral shield, and the season and
ladder **editor** — its admin RPCs exist, so seeding a season is a SQL-editor job
until the first season's shape has settled.

---

## 9. Revision history

- **rev 1** — 120 days, reset to zero on a miss, gift box at the end.
- **rev 2** — shields replace the wipe; a 365-day ladder replaces the single
  target; subscribers become eligible.
- **rev 3** — the physical gift moves to the final rung only; three ad formats;
  shields hard-capped at three; the annual-subscriber perk restructured.
- **rev 4** — a day requires **all** committed modules, minimum three, with
  extras buying faster shield regeneration.
- **as built** — this document, reconciled against migrations 0048–0050 and the
  shipped client.
- **rev 5 (0055)** — one server-side season state that both consoles quote; a
  season console covering dates, rules, eligible modules and the ladder; the app
  says which season and why rather than "no season is open".
