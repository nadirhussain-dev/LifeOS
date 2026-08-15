# Go-to-market strategy — the Streak program

Companion to [REWARDS_PROGRAM.md](REWARDS_PROGRAM.md), which is the _how_. This
is the _whether, when, and in what order_ — the version I'd bet money on.

---

## 1. The reframe: three products, not one

Every revision so far has treated this as a single feature — "a year-long
challenge with a gift at the end." That framing is what creates all of its
problems: twelve months before the first winner exists, one launch moment ever,
and a promise whose credibility can't be tested until it's too late to change.

Split it into three layers. Each is justified by its own economics, and each can
be switched off without breaking the others.

| Layer                     | What it is                                                      | Justified by                      | Cadence     |
| ------------------------- | --------------------------------------------------------------- | --------------------------------- | ----------- |
| **1 · The Streak Engine** | Streaks, shields, the daily checklist, the chain, the rungs     | Retention alone — no prize needed | Always on   |
| **2 · Seasons**           | 90-day, capped-enrolment campaigns with a real physical prize   | Acquisition, PR, reactivation     | 4× a year   |
| **3 · Year One Club**     | Chain four consecutive seasons → the big box + permanent status | Prestige, near-zero marginal cost | Once a year |

**Your original intent survives intact.** A year-long journey, with the gift
earned by completing everything, is exactly Layer 3 — it just now sits on top of
three shorter proof points instead of twelve months of silence.

If the prize ever becomes unaffordable, you disable Layer 2 with the
`module_flags` switch and keep every retention benefit. That optionality is the
whole reason to split it.

---

## 2. Positioning

Every habit app has streaks. Almost none of them have **stakes**. That's the
wedge, and it's genuinely defensible because copying it costs real money — a
competitor can clone the UI in a week and cannot clone the shipping budget.

**The line:** _"The only life app that sends you something real for showing up."_

**Not** "win a prize." Prize language attracts prize-hunters, who farm, complain
and churn. Reward-for-consistency language attracts people who want to be
consistent — who are the people who stay, subscribe, and finish. The wording
choice at the top of the funnel decides which population you get.

---

## 3. Why 90-day seasons beat one 365-day program

|                              | One 365-day program                 | Four 90-day seasons                          |
| ---------------------------- | ----------------------------------- | -------------------------------------------- |
| Time to first visible winner | 12 months                           | **3 months**                                 |
| Launch moments per year      | 1, ever                             | **4**                                        |
| Motivational horizon         | Beyond what most people can hold    | Holdable                                     |
| Liability                    | One large unknown                   | Bounded and known each time                  |
| Credibility risk             | High — _"nobody actually gets it"_  | Low — winners are visible early and often    |
| Feedback loop                | 12 months before you learn anything | **Every quarter**                            |
| Reactivation hook            | None                                | Four legitimate reasons to push lapsed users |

The last row is the underrated one. A new season is a genuine reason to notify
everyone who stopped using the app — four times a year, without it being spam.
An always-on program can never do that.

---

## 4. The season is the marketing machine

The mechanic that actually drives installs is **capped, time-boxed enrolment**.

> _"Season 3 opens Monday. 1,000 places. Enrolment closes when they're gone."_

Scarcity plus a deadline is what converts a browser into an install. The program
itself doesn't generate urgency — the _enrolment window_ does. Put the countdown
on the Hub, in the store screenshots, and in the reactivation push.

Note this is also the safe structure legally: capping **entry** bounds your cost
without capping **winners**, so completion stays deterministic and there's no
element of chance (see REWARDS_PROGRAM.md §2.3).

---

## 5. What goes in the box

The box exists to be photographed. Everything else is secondary. Requirements:
flat, light, under **$15 landed**, and containing one thing nobody else can have.

- ★ **A printed card of their own chain.** Their exact 90 days, their name, the
  season mark. Personalised, un-copyable, costs cents — and it is the single
  reason the photo gets posted. This is the whole trick.
- An enamel pin or sticker sheet carrying the season name.
- A short, warm, human note. Not a form letter.
- Optional if budget allows: a branded hardcover notebook.

Skip anything heavy, fragile, liquid, or battery-powered — customs, breakage and
shipping cost will eat the entire budget.

---

## 6. Acquisition loops

Ranked by what actually returns:

1. **Unboxing content.** Ask every winner, with explicit consent, and reshare.
   This is the real return on the box, not the retention.
2. **The personalised chain card** — see §5. It exists to make loop 1 happen.
3. **Share cards at every rung.** Free, organic, and they make a private streak
   public, which also makes it harder to abandon.
4. **Referral paid in shields.** The currency already exists; no new economy, no
   cash cost, and it doubles as the free path that keeps the Plus perk clean.
5. **Cohort social proof.** _"412 people started with you — 78 are still
   climbing."_
6. **Season launch as a press and creator moment.** Four a year gives you four
   chances to be a story.

---

## 7. Monetisation alignment

- **Free tier** funded by the three ad formats (banner, interstitial, rewarded
  video). None of them ever touch the streak.
- **Plus** sells on: no ads, faster shield regeneration, storage. **Never on the
  prize** — that's the line that keeps this a conditional gift rather than paid
  entry.
- **The season is your strongest conversion window of the year.** Someone 40 days
  into a 90-day season has more reason to upgrade than at any other moment. Time
  your Plus offers to mid-season, not to install day.

---

## 8. The numbers, per season

Illustrative model at a 1,000-place cap. **These are assumptions to replace with
your own data, not forecasts.**

|                                                |                        |
| ---------------------------------------------- | ---------------------- |
| Enrolled                                       | 1,000                  |
| Still alive at day 30                          | ~350                   |
| Complete 90 days                               | **80 – 150**           |
| Box cost at $14 landed                         | **$1,120 – 2,100**     |
| Ad revenue (1,000 × ~45 active days × ~$0.012) | ~$540                  |
| Plus conversions (~4% × $30 net)               | ~$1,200                |
| **Net**                                        | **roughly break-even** |

The honest read: **a season is not a profit centre. It's a marketing spend that
nearly pays for itself**, and whose real return is the retention halo across
everyone who didn't finish, plus the content the winners produce.

Levers, in the order I'd pull them if the numbers go wrong: lower the cap, raise
the bar to four modules, cheapen the box, drop to three seasons a year.

---

## 9. The six numbers that decide everything

| Metric                                          | Green    | Amber    | Red               |
| ----------------------------------------------- | -------- | -------- | ----------------- |
| Enrolled D30 retention vs. non-enrolled control | ≥ 2×     | 1.5 – 2× | < 1.5×            |
| Season completion rate                          | 8 – 18%  | 5 – 8%   | < 5% **or > 25%** |
| Cost per completion, landed                     | < $18    | $18 – 30 | > $30             |
| Runs that spend at least one shield             | 40 – 70% | 20 – 40% | < 20% or > 85%    |
| Share of failed days caused by a single module  | < 30%    | 30 – 45% | > 45%             |
| Winners who post unboxing content               | ≥ 25%    | 10 – 25% | < 10%             |

Two of these are counter-intuitive and both matter:

- **A completion rate above 25% is red, not green.** It means the bar is too low,
  your cost scales with success, and the achievement stops being worth posting
  about.
- **A shield-spend rate below 20% is red.** It means shields are so abundant
  nobody notices them, and the mechanic is doing no motivational work. Between 40
  and 70% is where they're scarce enough to matter and common enough to save
  people.

---

## 10. Sequence and gates

Each gate has a go/no-go. Don't pass one on optimism.

**Gate A — Ship the Streak Engine. No prize at all.**
Phases 1–4 of the build order. Streaks, shields, checklist, chain, rungs, digital
rewards. Zero legal exposure, zero fulfilment, no liability.
**Go/no-go: enrolled D30 retention ≥ 2× the control group.** If the engine
doesn't move retention on its own, a prize will not save it — and you'll have
found that out for the cost of four weeks instead of a year and a pallet of
boxes.

**Gate B — Season Zero. 60 days, 300 places, existing active users only.**
Real physical prize, small blast radius. Worst case 300 boxes ≈ $4,200; realistic
~45 boxes ≈ $630. This is the calibration run: real completion rate, real shield
spend, real module-failure data, and a live test of your packing and shipping
before strangers are involved.
**Go/no-go: cost per completion under $30, and you can physically pack and post
the winners in one weekend.**

**Gate C — Season 1, public. 90 days, 1,000 places, countdown launch.**
The full machine: enrolment window, store screenshots, creator outreach, share
cards, referral shields. Run it three more times.
**Go/no-go: two of the six metrics in green, none in red.**

**Gate D — Year One Club opens.**
For anyone who chains four consecutive seasons. Your original vision, arriving
with three seasons of evidence behind it instead of a guess.

---

## 11. What not to do

- **Don't advertise the prize on the paywall**, in store metadata, or in upgrade
  copy. Ever.
- **Don't cap winners.** Cap entry.
- **Don't let any ad format touch a streak or a shield.**
- **Don't run two seasons at once.** Split attention halves both.
- **Don't ship to a country you haven't personally posted a test parcel to.**
- **Don't promise a delivery date.** Promise a dispatch window, then beat it.
- **Don't make Season 1 bigger than you can pack in a weekend.** The first
  fulfilment run always takes three times as long as you think.
- **Don't launch the prize and the engine together.** You'll never know which one
  moved the numbers.

---

## 12. Kill criteria

Decide these now, while it's cheap to be honest.

After two full seasons, if **any** of the following holds, disable Layer 2 with
the `rewards` flag and keep the Streak Engine running:

- Enrolled D30 retention lift below 1.5×
- Cost per completion above $40
- Fewer than 10% of winners producing shareable content
- Fulfilment consuming more than two days a month of your time

Nothing breaks when you do this. Users keep their streaks, their shields and
their rungs; the only thing that disappears is the box. That's precisely why the
three-layer split in §1 is worth the extra structure — **it makes stopping
survivable**, which is the difference between an experiment and a bet.
