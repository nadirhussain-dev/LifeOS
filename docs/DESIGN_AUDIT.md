# Daykeep — Senior Design & Flow Audit (2026-08-22)

A design-side review of the whole app: 129 screens, 5 tabs, 25 modules, 4
locales (2 of them RTL), light + dark.

`AUDIT.md` at the repo root is the earlier engineering audit — data, sync,
security, store readiness. This is deliberately not that. This one asks the
questions a designer asks: does the app hold one visual language end to end,
can a flow lose the user's work, and does it behave when things go wrong.

## The short version

The system underneath this app is genuinely strong, and most of the usual
audit findings simply are not here. Token layers are drift-checked by a script
(`check:tokens`); i18n has no missing keys across four locales and a checker to
keep it that way; `useReducedMotion` is wired into 26 animated surfaces rather
than existing as good intentions; RTL is handled at the layout engine _and_ at
the icon glyph; confirmations are the app's own dialogs rather than
`Alert.alert`, explicitly because the native one ignores the app's direction;
`accessibilityRole` is present in 214 files and only three `Pressable` files
lack it; there is a documented spatial elevation stack, and a `Text` primitive
that already caps dynamic type at 1.4×.

So the findings below are not "this app needs a design system". They are the
places where the system it has is not being followed, and — the one that
matters most — the one flow that can destroy something the user made.

| #                                        | Finding                                               | Severity | Reach                | Status |
| ---------------------------------------- | ----------------------------------------------------- | -------- | -------------------- | ------ |
| [1](#1-forms-can-lose-work-silently)     | Forms discard typed work with no prompt               | 🔴 High  | 18 screens           | Fixed  |
| [2](#2-the-note-editor-drops-its-last-e) | Note editor drops the last ~500ms of typing           | 🔴 High  | 1 screen, high-value | Fixed  |
| [3](#3-one-type-role-two-treatments)     | One type role rendered two ways, 65 copy-pasted sites | 🟠 Med   | 47 files             | Fixed  |
| [4](#4-gutter-and-bottom-inset-drift)    | Screen gutter and scroll bottom inset drifted         | 🟠 Med   | 8 screens            | Fixed  |
| [5](#5-four-screens-that-lie-when-they)  | 4 screens report failure as emptiness                 | 🟠 Med   | 4 screens            | Fixed  |
| [6](#6-one-untranslated-string-in-a-sh)  | `Fab`'s default a11y label was hardcoded English      | 🟡 Low   | every unlabelled FAB | Fixed  |
| [7](#7-residual-rtl-edges)               | A handful of physical margins and one progress fill   | 🟡 Low   | 4 files              | Open   |
| [8](#8-list-rows-that-rebuild-for-no-r)  | Low-traffic list rows unmemoized                      | 🟢 Nit   | ~20 components       | Open   |
| [9](#9-dead-config-on-the-dashboard)     | Dashboard section labels declared and never read      | 🟢 Nit   | 1 file               | Open   |

---

## 1. Forms can lose work silently

**Severity: high. The only flow in the app that can destroy something the user
made.**

Eighteen create/edit screens — `task/new`, `note/new`, `budget/transaction`,
`sleep/log`, `study/log`, `timeline/event/new`, and the rest — are presented
modals whose only exit was an unconditional `router.back()`. Three different
gestures reach it, and all three threw the form away without asking:

- the ✕ chip in `SheetHeader`, which calls `router.back()` directly;
- Android's hardware back button, which no screen intercepted (`BackHandler`
  appears exactly once in the app, in the study timer);
- the iOS swipe-down dismiss, which a hand-rolled `onClose` never even sees.

`task/new` is the sharp case. Its title field is `autoFocus`ed, so people start
typing the moment it opens — and the date picker, the priority chips and the
category picker are all a swipe away from the edge. A mis-swipe on the way to
one of them costs the whole entry, with no undo and no toast.

**Evidence at audit time:** `grep -rn "beforeRemove\|usePreventRemove\|isDirty"
app features` → zero hits across the entire codebase.

**Fixed** — [`hooks/use-unsaved-changes.ts`](../hooks/use-unsaved-changes.ts),
wired into all 18 screens.

The guard sits on the navigator via React Navigation 7's `usePreventRemove`,
not on each close button, because that is the only level that catches all three
gestures — v7 added the hook precisely because `beforeRemove` could not stop a
native-stack modal being dismissed. Screens whose form state lives in a shared
component (`HabitForm`, `GoalForm`) carry the guard in the component, keyed off
react-hook-form's `isDirty`, since that is where the answer actually is.

Saving is not abandoning, so the hook returns a `release()` that the save path
calls before navigating. It flips a ref rather than state — `release()` and
`router.back()` run in the same tick, and a `setState` would not have
re-rendered in time, so the prompt would still have appeared on every
successful save. That failure mode is worse than no guard at all: it trains
people to dismiss the question without reading it.

The prompt is a `confirm()` from the app's own dialog store, in all four
locales, destructive-toned.

Regression-guarded by
[`hooks/use-unsaved-changes.test.ts`](../hooks/use-unsaved-changes.test.ts),
which enumerates the form screens — a new one that forgets the hook fails the
suite, because nothing at runtime notices a missing hook.

## 2. The note editor drops its last edit

**Severity: high, and silent.**

`app/note/[id].tsx` autosaves on a 500ms debounce, and both autosave effects
`clearTimeout` on unmount. That is correct for a re-render and quietly
destructive on a close: leave the note within 500ms of the last keystroke —
which is exactly how a short note ends, dismiss keyboard, tap back — and that
half-second of typing was never written anywhere.

A small window, but the end of a sentence lands in it more often than anything
else does, and the loss is invisible: the note list shows the note, just
missing its last few words.

**Fixed** — a flush-on-unmount effect that writes whatever the debounce is
still holding. It reads from a ref refreshed each render, so the effect itself
never re-runs on a keystroke while still seeing the last values typed. The
write is idempotent against the last-known saved values, so a flush racing an
already-fired debounce costs nothing.

## 3. One type role, two treatments

**Severity: medium. The most widespread visual inconsistency in the app.**

Section labels — the uppercase line above a group of rows — were being rendered
two different ways:

- `variant="micro"` (11px, Medium, muted) — **125 uses**
- `variant="caption" className="font-sora-semibold uppercase tracking-wide"`
  (12px, SemiBold) — **65 uses across 47 files**, of which 57 were
  byte-identical copies of the same class string

The second one was never a design decision anybody made twice; it was a design
decision somebody made once and everyone else pasted. It had no name, so it
could not be reasoned about, changed centrally, or kept from drifting into a
third variant — and two variants had in fact already appeared (`px-1`-prefixed,
and an explicit-`fontSize: 12`-in-`style` version on tinted hero cards).

The part that makes it structural rather than cosmetic: **`ListSectionHeader`,
a shared primitive, used the unnamed one.** So every list screen and every
dashboard zone disagreed about section labels by construction, no matter how
carefully an individual screen was built.

**Fixed** — added a named `sectionLabel` variant to `Text` and rewrote all 65
call sites to it. Rendering is unchanged; what changed is that the role now has
a name, a documented distinction from `micro` (eyebrow vs. divider — see
[the design system doc](design-system.md#5-typography)), and one place to
change.

## 4. Gutter and bottom-inset drift

**Severity: medium. Individually invisible, collectively what "unpolished"
means.**

`layout.screenPaddingX` is declared as 20 and described in the token file as
_the_ screen gutter. Four root scroll containers set `px-4` instead:

- **`app/(tabs)/hub.tsx`** — the worst one, because Hub is a tab. Swapping
  between Home and More shifted every edge on screen by 4px.
- **`app/budget/debts/index.tsx`** — 16, while its sibling `budget/index.tsx`
  is 20. Same module, adjacent screens.
- **`app/gallery/compare.tsx`** — content at 16 under a `ScreenHeader` at 20,
  so the back chip does not line up with the cards beneath it.
- `app/music.tsx` — a **horizontal carousel's** inner padding, not a screen
  gutter. Correct as written; left alone.

Separately, the bottom padding that keeps the last list row clear of the tab
bar and FAB had settled on two values with no rule behind them: `pb-28` (112)
on eight screens and `paddingBottom: 120` on five, with FAB-bearing screens in
both groups.

**Fixed** — the three real gutter deviations moved to 20, and
`layout.scrollBottomInset` added to the token file as a derived value (the FAB
covers the bottom 76pt, so 112 is what leaves the last row looking finished)
and applied to the five screens that were on 120. Music's larger inset stays —
it has a docked mini-player and says so locally.

## 5. Four screens that lie when they fail

**Severity: medium.**

The app has good failure UI — `QueryError` for screens, `WidgetError` for
dashboard cards, both deriving copy and icon from `lib/supabase-error` so one
failure is never described two ways. Coverage is high: only 5 of the screens
running a query lacked an error branch, and one of those (the dashboard) is
covered at the widget level instead.

The remaining four all fail the same way — and it is the failure mode
`WidgetError`'s own header comment was written about, still present elsewhere:
a failed query settles at `isLoading: false` with `data: undefined`, so the
screen renders its **empty** state. The app says "you have no coupons", "no
accounts", "nothing to swap" when what actually happened is that the request
never landed.

- `app/settings/operator/coupons.tsx`, `roster.tsx` — empty list, no message
- `app/settings/operator/users.tsx` — falls through to "no accounts"
- `app/challenge/swap.tsx` — two empty columns, and the confirm button still
  live

**Fixed** — `QueryError` with retry on all four. `challenge/swap` gets one
screen-level error rather than one per list, because a swap is a single
decision made across both columns; offering half of it invites a choice the
server will refuse.

## 6. One untranslated string in a shared primitive

`components/ui/fab.tsx` defaulted `accessibilityLabel` to the literal
`'Quick actions'`. Every FAB that passes no label — the dashboard's, which is
the app's most-used one — announced English to an Arabic or Urdu screen reader,
from inside an app whose i18n is otherwise airtight (2621 keys, four locales,
zero missing, and a checker in CI).

It was the **only** hardcoded user-facing string left in the app: a sweep for
literal `accessibilityLabel="…"`, literal `accessibilityHint`, and plain
English `<Text>` children returned zero hits each.

**Fixed** — defaults to `t('dashboard.quickActions')`, a key that already
existed.

## 7. Residual RTL edges — open

RTL is handled properly at both levels that matter: `I18nManager` with a
restart on direction change, and `directional-icon.ts` mirroring chevrons and
arrows (with a documented exception for media transport, which follows the tape
rather than the script). Logical properties (`ms-`/`me-`/`ps-`/`pe-`) are used
in 13 places; almost every absolute `left`/`right` is a symmetric `left: 0,
right: 0` pair, which is direction-agnostic.

What is left is small and real:

- `features/music/components/mini-player-bar.tsx:119` — the progress fill is
  `{ left: 0, width: barW }`, so in RTL it grows from the physical left instead
  of from the start edge. The one functional RTL bug found.
- `app/private/albums/[id]/chat.tsx:300`, `features/private/components/message-ticks.tsx:35`
  — `ml-1` on message ticks; should be `ms-1`.
- `features/insights/components/insight-hero-card.tsx:66` — `-ml-2.5` on a
  stacked avatar overlap; reverses the stacking direction in RTL.
- `features/private/components/on-this-day-card.tsx:58` — `pr-3`.

Numeric fields using `text-right` (`category-cap-editor`, `operator/season`,
`challenge-ladder`) are a judgement call rather than a bug — arguably they want
`text-end`, but right-aligned numerals are also a legitimate convention.

## 8. List rows that rebuild for no reason — open

The high-traffic rows are already memoized: `TaskRow`, `HabitRow`, `NoteCard`.
Around twenty lower-frequency row/card components are not — `TransactionRow`,
`DebtCard`, `SleepSessionCard`, `StudySessionCard`, `GoalCard`, `PatternCard`
and similar. They rebuild on any parent render, including one triggered by
typing in a search field on the same screen.

Worth doing for `TransactionRow` first, since the transactions list is the one
unbounded list in the app. The rest are short lists where the win is
theoretical.

## 9. Dead config on the dashboard — open

`app/(tabs)/index.tsx`'s `FULL_SECTIONS` declares `label: 'Today'` and
`label: 'For you'`, but the render passes `t('dashboard.today')` and
`t('dashboard.forYou')` instead — so those two English strings are never read.
Harmless today; the risk is somebody later "fixing" the untranslated-looking
strings in the config and expecting the screen to change.

---

## What was verified, and found healthy

Recorded so the next audit does not re-derive it:

- **Token layers agree.** `npm run check:tokens` passes across 17 module tints
  in both themes, with a WCAG 3:1 graphics floor enforced per tint per theme.
- **i18n is complete.** 2621 keys × 4 locales, zero missing, 5 unused (warning
  only). No hardcoded user-facing English anywhere except finding 6.
- **Reduced motion is respected.** `useReducedMotion` is consumed by 26
  surfaces, including all six looping animations and every celebratory overlay.
- **Dynamic type is capped.** The `Text` primitive sets
  `maxFontSizeMultiplier={1.4}`, and only two files in the app import RN's
  `Text` directly (one of them being that primitive).
- **Dialogs are the app's own.** `Alert.alert` appears zero times outside two
  explanatory comments; `confirm`/`notify`/`chooseAction` handle Android back
  and a11y focus by rendering in a real `Modal`.
- **Interaction affordances are labelled.** 214 files set `accessibilityRole`;
  of 213 files using `Pressable`/`TouchableOpacity`, three lack one.
- **Screens have loading and empty states.** `EmptyState` in 37 files,
  `ListSkeleton`/`Skeleton` widely; error coverage as described in finding 5.
- **The FAB is honest.** Tap opens the sheet, long-press fans the same actions
  under the thumb — the gesture is a shortcut, never the only way in.

## Suggested order for what remains

1. **Finding 7's mini-player progress fill** — the only remaining functional
   bug, and it only reproduces in Arabic/Urdu, which is where it will go
   unnoticed longest.
2. **Finding 7's four physical margins** — mechanical, five minutes.
3. **Finding 8, `TransactionRow` only** — measurable; skip the rest until a
   list gets long enough to justify it.
4. **Finding 9** — delete the two dead keys.
