# Daykeep — rename, positioning, and the road to best-in-class

A plan. Nothing here is built yet.

Four pieces of work, in dependency order: the rename, the store listing, the
braid, and the module quality bar. The first three are days. The fourth is the
real work and is sequenced rather than attempted at once.

---

## 0. What "best in market" has to mean

The competitor ([LifeOS: Focus and Habit Tracker](https://www.lifeoshq.com/)) is
good, has a head start on polish, and owns a strong visual idea. **Matching its
feature list produces parity, and parity loses to the incumbent.** So the bar is
not "more features". It is three specific things:

1. **Win a market they are not contesting.** Urdu, Hindi and Arabic with real
   RTL is work Western indie developers don't do, and you have already done it.
   #1 for "habit tracker" in Pakistan is reachable. #5 globally is not, and is
   worth less.
2. **Be famous for one thing.** Fourteen modules is a positioning problem. The
   challenge — three streaks, one year, something real in the post — is the
   one-sentence hook. Everything else is depth revealed later.
3. **Compete on trust.** Encrypted-at-rest database, a private vault,
   offline-first. A cloud-first competitor would have to rebuild to match it.

**Explicitly not doing:** an AI coach (they have one; it is table stakes and
undifferentiated), social feeds, or a mortality calendar. The last one is theirs
and copying it would read as exactly what it was.

**A standard worth holding, and worth saying out loud in the listing:** the app
does not manipulate. Streaks show missed days honestly rather than hiding them.
Notifications name what is outstanding instead of manufacturing anxiety. No
social comparison, no infinite scroll, no engagement bait. This is both the right
thing and a real differentiator — it is very hard for a competitor to adopt after
the fact.

---

## 1. The rename

### 1.1 The one rule: rename the brand, never the storage keys

**A global find-and-replace of `lifeos` → `daykeep` would permanently destroy
every existing user's data.** Twelve storage keys carry the old name, and four of
them are load-bearing:

| Key                                        | What happens if it changes                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `daykeep.db`                               | The SQLCipher database file. Renamed = the app opens an empty database                           |
| `daykeep.db.key`                           | The encryption key in SecureStore. Renamed = **the existing database is permanently unreadable** |
| `daykeep.vault.wrapped` / `.alt` / `.salt` | The private vault's wrapped keys. Renamed = **the vault is permanently unrecoverable**           |
| `daykeep.device-id`, `daykeep.install.id`  | Identity resets; 0047 treats the device as new and demands a fresh OTP                           |
| `daykeep.widget.today.v1`, `.actions.v1`   | Widget snapshot and queued taps are lost                                                         |

These are **not** brand surfaces. Nobody sees them. They stay as they are,
forever, and the plan adds a test that fails if any of them changes — because
this is precisely the kind of edit that looks like tidying up.

The zustand persist keys (`auth-store`, `challenge-store`, …) are already
brand-free and also stay.

### 1.2 What actually changes

| Surface                                    | From → to                                                                                                   | Note                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `app.json` `name` / `slug`                 | `Daykeep` → `Daykeep`                                                                                       |                                                                                            |
| `scheme`                                   | `lifeos` → `daykeep`                                                                                        | Every deep link changes with it                                                            |
| `ios.bundleIdentifier` / `android.package` | `com.daykeep.app` → `com.daykeep.app`                                                                       | **Last chance.** Permanent after first store publish                                       |
| Android widget names                       | `DaykeepToday` / `DaykeepHabits`                                                                            | Must match the plugin config _and_ the task-handler map or widgets silently stop rendering |
| `WIDGET_LINKS`                             | `daykeep:///tasks` → `daykeep:///tasks`                                                                     | Triple slash preserved                                                                     |
| Locale strings                             | **43 occurrences × 4 locales = 172**                                                                        | Includes the share card's "Tracked with Daykeep"                                           |
| Source files                               | ~25 files reference the name                                                                                | Mostly copy and comments                                                                   |
| Elsewhere                                  | `package.json`, README, brand assets (`npm run assets`), EAS project, Sentry project, Supabase redirect URL |                                                                                            |

### 1.3 Verification

`npm run check:i18n` catches a missed locale. A new
`lib/storage-keys.test.ts` asserts the twelve keys verbatim. Then the usual:
typecheck, tests, `expo export`.

---

## 2. The store listing

### 2.1 Your title does not fit

`Daykeep — Habits, Journal & Money` is **33 characters**. Google Play's limit is
**30**. Options that fit, with counts:

| Title                            | Chars | Comment                                  |
| -------------------------------- | ----- | ---------------------------------------- |
| `Daykeep: Habits & Journal`      | 25    | Cleanest. Money is discoverable inside   |
| `Daykeep — Habit & Life Tracker` | 30    | Exactly at the limit; strongest keywords |
| `Daykeep: Habits, Notes & Money` | 30    | Keeps money, drops journal               |
| `Daykeep — Keep Your Days`       | 24    | Brand-led; weakest for search            |

**Recommended: `Daykeep — Habit & Life Tracker`.** "Habit tracker" is the term
people actually type; "life tracker" catches the broader intent. The brand does
the remembering, the keywords do the finding.

### 2.2 Short description — 80 characters, the highest-leverage text in the listing

It appears in search results and above the fold. Draft:

> `Three daily habits. One year. A real gift in the post if you never miss.` (71)

That is the whole product in one line, it is unlike anything else in the
category, and it makes somebody curious enough to open the listing.

### 2.3 Full description — challenge first, modules last

Structure, in order:

1. **The promise** (2 lines). Pick three parts of your life. Keep them all alive
   every day. We send you something real.
2. **How it works** (4 lines). The contract, the shields, the ladder, the honest
   reset. Say the rules plainly — the rules _are_ the marketing.
3. **Why it is different** (3 bullets). Three streaks, not one. A real reward.
   Your data encrypted on your phone.
4. **What is inside** (the module list — but _here_, not at the top).
5. **Private by design.** Encrypted at rest, works offline, no social feed, no
   ads in your diary.
6. **Languages.** English, اردو, हिन्दी, العربية.

### 2.4 Screenshots — the first two decide the install

1. **The braid**, mid-run, with the day count. The signature image.
2. **Today's checklist** with one item left — the daily reality of using it.
3. The ladder with the prize visible.
4. The private vault.
5. Money / split.
6. Language shot in Urdu or Arabic — invisible to competitors, decisive locally.

### 2.5 The locale advantage

Write all four listings properly, not machine-translated. The Urdu, Hindi and
Arabic listings are close to uncontested — this is the cheapest ranking available
to you and the competitor is not going to do it.

---

## 3. The braid

Replaces `day-chain.tsx` and `module-chains.tsx`, which currently read as a
version of the competitor's grid.

**What it encodes.** One strand per committed module, woven day by day. A day
where everything held is a clean weave. A missed module leaves a visible gap in
_that strand_. A shielded day shows as a repair — the strand is spliced, not
broken. A fall is where the braid thins.

The point: the picture and the mechanic are the same object. Nobody else has the
three-module contract, so nobody else can have this image.

**Spec**

- `react-native-svg` only — the repo has no chart library and should not gain one.
- Horizontal, scrollable, newest on the right; the last ~30 days at a glance.
- Three (or more) sine-offset paths, phase-shifted so they cross; stroke uses the
  module's tint.
- A gap is a stroke break with a hairline ghost path underneath, so a missing day
  reads as absence rather than as nothing having been drawn.
- A shield renders as a short capped splice in a neutral tone.
- Today's segment is the only animated element: a slow draw-on. Everything else
  is static — motion everywhere is what makes an app feel cheap.
- `prefers-reduced-motion` disables the draw-on.

**Where it appears:** the challenge screen hero, the share card, and later the
Android widget.

---

## 4. Making the seven modules iconic

You cannot make seven modules excellent simultaneously. What follows is a bar
that applies to all of them, one signature moment each, and an order.

### 4.1 The bar — six tests, per module

1. **Ten seconds.** Cold start to a logged item, one hand, no typing where a tap
   will do.
2. **One signature moment.** The thing screenshotted. Defined per module below.
3. **Empty states teach.** No blank screen with an icon; show what the module
   looks like in use.
4. **Motion where it means something.** The tick landing, the rung unlocking.
   Nowhere else.
5. **It survives the plane.** Every module fully usable offline — you already
   have this architecturally and are not yet claiming it.
6. **It leaves the app.** A widget entry, a share card, or a notification action.

### 4.2 The signature moment, module by module

| Module      | The one thing it is remembered for                             | Already built                            | Missing                                                                                               |
| ----------- | -------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Habits**  | The braid, and the streak wall                                 | Streaks, heatmap, routines               | The braid; the celebration                                                                            |
| **Journal** | **"On this day"** — your entry from a year ago, surfaced today | Entries, prompts, reflections, streak    | The resurfacing loop. This is the strongest emotional hook in the whole app and it does not exist yet |
| **Tasks**   | Capture in under three seconds from anywhere                   | Tasks, categories, due dates, widget     | Quick-capture; natural-language dates                                                                 |
| **Notes**   | **Backlinks** — every note that mentions this one              | `entry_links` wiki-links exist           | The backlink panel. The data is already there                                                         |
| **Goals**   | The pace verdict: ahead / on track / behind                    | `goal-timeline.ts`, expected-pace line   | Almost nothing — it needs surfacing, not building                                                     |
| **Study**   | **"Your best hour"** — and scheduling into it                  | `computeStudyInsights`, best time of day | Acting on the insight rather than displaying it                                                       |
| **Sleep**   | Time in bed vs actually asleep, and the week's debt            | `fellAsleepMinutes`, `asleepMinutes`     | The debt number; the link to next-day focus                                                           |

Two things stand out from that table. **Journal and Notes have the highest
ratio of impact to work** — the Notes backlink panel is a view over data that
already exists, and "On this day" is a query plus a card. Goals, Study and Sleep
are mostly surfacing work that was already done and then buried.

### 4.3 Order

1. **Habits** (the braid ships with the rebrand — it is the signature image).
2. **Journal** ("On this day" — the emotional hook, and the reason people come
   back daily rather than dutifully).
3. **Notes** (backlinks — cheapest real differentiator on the list).
4. **Tasks** (quick capture — the most-used module, so the ten-second test
   matters most here).
5. **Goals, Study, Sleep** (surface what exists; smallest gaps).

---

## 5. Order of work

| #   | Work                              | Depends on                           |
| --- | --------------------------------- | ------------------------------------ |
| 1   | Rename, with the storage-key test | Your sign-off on the title           |
| 2   | The braid                         | Nothing                              |
| 3   | Store listing, four locales       | 1 and 2 (screenshots need the braid) |
| 4   | Journal "On this day"             | —                                    |
| 5   | Notes backlinks                   | —                                    |
| 6   | Tasks quick capture               | —                                    |
| 7   | Goals / Study / Sleep surfacing   | —                                    |

1–3 are the launch package. 4–7 are what make it stay at the top once it is
there.

---

## 6. What I need from you

- **The title.** My recommendation is `Daykeep — Habit & Life Tracker`; your
  original is three characters over Play's limit.
- **The bundle id.** `com.daykeep.app` unless you want something else — this is
  the last moment it can change.
- **The gift.** The listing's strongest line promises something real in the post.
  That has to be true before the listing goes live, and it is Gate B work that is
  not built.
