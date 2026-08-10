# LifeOS Design System

> A calm, spatial operating system for a whole life. Not a trendy UI — a
> premium, trustworthy environment people reach for every day because it lowers
> cognitive load, shows progress honestly, and always answers one question:
> **what should I do next?**

**Interactive companion:** an interactive, theme-aware version of this document
(live contrast ratios, real Sora/Literata specimens, animated rings) is
published at
<https://claude.ai/code/artifact/35dc7583-c05a-4e74-875b-93a6e2401ccf>.

**Where the tokens live (source of truth):**

| Layer               | File                                                          | Use it for                                                               |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| CSS variables (HSL) | [`global.css`](../global.css)                                 | The values themselves, light + dark                                      |
| NativeWind classes  | [`tailwind.config.js`](../tailwind.config.js)                 | Screens — `bg-card`, `text-habit`, `shadow-e2`, `rounded-xl` …           |
| Native mirror (TS)  | [`constants/design-tokens.ts`](../constants/design-tokens.ts) | SVG, StatusBar, Reanimated, gradients — anywhere a className can't reach |
| Color helpers       | [`lib/color.ts`](../lib/color.ts)                             | Deriving gradients / glows / tints from a single module hex              |

**Reference implementation:** the dashboard hero
[`features/dashboard/components/today-focus-card.tsx`](../features/dashboard/components/today-focus-card.tsx)
puts the whole system to work in one screen.

Rule of thumb: **prefer the className.** Drop to the TS mirror only when a
className genuinely can't reach the surface.

The three layers have to agree, and `npm run check:tokens` fails the build when
they don't — it exists because `gallery` and `music` once lived only in the TS
file, so `text-gallery` compiled to nothing and rendered as no colour at all
rather than as an error. The colour tables in §4 are generated from that same
parser via `npm run docs:design`; **edit the token file, not the tables.**

---

## 1. Philosophy — a Spatial Design System

Depth comes from **layered surfaces, elevation, and whitespace** — never from
neomorphic bevels or skeuomorphic texture. The interface behaves like a quiet
room: content rests on surfaces, rises when you touch it, and settles back.

- **Layered, not decorated.** A three-tier stack — sunken `surface` → resting
  `card` → `raised` element. Hierarchy is read through elevation and contrast,
  not borders and ornament.
- **Calm by default.** Near-grayscale chrome with a whisper of emerald in the
  neutrals. The eye rests until color deliberately directs it.
- **One primary action.** Every screen has a single, obvious next step in the
  brand accent. Everything else recedes.

**What we avoid:** dopamine-baiting badges, autoplay confetti, red notification
bombs, infinite feeds. Reinforcement is gentle and tied to _meaningful_
completion.

The five words the product should always feel like: **Calm · Focused · Premium
· Human · Intelligent.**

---

## 2. UX Principles

Each screen is auditable against these. If a screen breaks one, the _screen_ is
wrong — not the rule.

1. **Reduce cognitive load before adding features.** Fewest things needed to
   decide. Summary first, detail on demand.
2. **One primary action per screen.** Exactly one accent CTA. Secondary actions
   are quiet; destructive actions ask twice.
3. **Always answer "what next?"** Empty, completed, and idle states each suggest
   a meaningful next step — never a dead end.
4. **Progress must be honest.** Rings and bars reflect real state. Trust is the
   retention strategy.
5. **Motion clarifies, never entertains.** Every animation explains a spatial
   relationship.
6. **Consistency is kindness.** The same gesture does the same thing everywhere.
7. **Respect the person, not the metric.** No manipulation, no guilt. Missing a
   day is fine and recoverable.

---

## 3. Psychology Rationale

Behavioral science applied to make good habits **easier**, not usage
**compulsive**. We reduce friction toward the user's own goals rather than
engineering cravings.

| Principle                    | How LifeOS uses it                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Progress principle**       | Small visible wins are the strongest daily motivator. Rings fill, streaks tick, the day's bar advances. |
| **Goal-gradient effect**     | Near-complete rings brighten with a subtle glow, nudging the last step without pressure.                |
| **Cognitive load theory**    | Whitespace, chunking, and one-action screens keep the UI under the working-memory threshold.            |
| **Peak-end + reinforcement** | A gentle haptic + soft ring bloom on meaningful completion — a calm reward, not a slot-machine payout.  |
| **Fresh-start effect**       | Mornings, Mondays, month turns framed as clean slates. Streaks reset kindly.                            |
| **Recognition over recall**  | Color-coded modules and consistent icons mean users recognize where to go.                              |

---

## 4. Color System

Spend color like currency: **one brand accent · one signature tint per module ·
a strictly separate semantic set.** Everything else is a near-grayscale neutral
with a faint emerald bias, so chrome reads _chosen_, not clinical.

- **Contrast:** primary text clears **WCAG AAA** on its ground in both themes;
  body text ≥ AA (4.5:1); large text / UI ≥ 3:1.
- **Never color alone:** priority, status and completion always carry an icon,
  label, or shape as well as hue (color-blind safe).

<!-- GENERATED:colors START -->

<!--
  Do not edit by hand — run `npm run docs:design`.
  Generated from constants/design-tokens.ts by scripts/gen-design-doc.mjs.
-->

### Core

| Token             | light     | RGB         | HSL         | dark      | RGB         | HSL         |
| ----------------- | --------- | ----------- | ----------- | --------- | ----------- | ----------- |
| `background`      | `#F8FBF9` | 248 251 249 | 140 27% 98% | `#0E1210` | 14 18 16    | 150 13% 6%  |
| `surface`         | `#EEF3F0` | 238 243 240 | 144 17% 94% | `#161C19` | 22 28 25    | 150 12% 10% |
| `card`            | `#FFFFFF` | 255 255 255 | 0 0% 100%   | `#1A201D` | 26 32 29    | 150 10% 11% |
| `foreground`      | `#161C19` | 22 28 25    | 150 12% 10% | `#EEF3F0` | 238 243 240 | 144 17% 94% |
| `mutedForeground` | `#6D7A74` | 109 122 116 | 152 6% 45%  | `#9AA8A1` | 154 168 161 | 150 7% 63%  |
| `border`          | `#E2E9E5` | 226 233 229 | 146 14% 90% | `#2B332E` | 43 51 46    | 143 9% 18%  |

### Semantic — state, never brand

| Token     | light     | dark      | Purpose                         |
| --------- | --------- | --------- | ------------------------------- |
| `success` | `#16A34A` | `#4ADE80` | Completion, confirmation        |
| `warning` | `#D97706` | `#FBBF24` | Caution, attention soon         |
| `error`   | `#DC2626` | `#F87171` | Destructive actions, validation |
| `info`    | `#2563EB` | `#60A5FA` | Neutral info, tips              |

### Module signature tints

Contrast is measured against that theme's card — the bar is **3:1**, because these are drawn as fills: rings, dots, chart series and icons. For a tint used as _text_ use `moduleTintText()`, which targets 4.5:1.

| Module   | light     | on light card | dark      | on dark card | Hue  |
| -------- | --------- | ------------- | --------- | ------------ | ---- |
| habit    | `#059669` | 3.77:1        | `#34D399` | 8.61:1       | 161° |
| calendar | `#3B82F6` | 3.68:1        | `#60A5FA` | 6.51:1       | 217° |
| water    | `#0891B2` | 3.68:1        | `#22D3EE` | 9.16:1       | 192° |
| sleep    | `#6366F1` | 4.47:1        | `#818CF8` | 5.55:1       | 239° |
| journal  | `#8B5CF6` | 4.23:1        | `#A78BFA` | 6.08:1       | 258° |
| fitness  | `#EA580C` | 3.56:1        | `#FB923C` | 7.32:1       | 21°  |
| goals    | `#F43F5E` | 3.67:1        | `#FB7185` | 6.15:1       | 350° |
| budget   | `#0D9488` | 3.74:1        | `#2DD4BF` | 8.90:1       | 175° |
| study    | `#6D28D9` | 7.10:1        | `#8B5CF6` | 3.91:1       | 263° |
| gallery  | `#A21CAF` | 6.32:1        | `#E879F9` | 6.73:1       | 295° |
| music    | `#4D7C0F` | 4.99:1        | `#A3E635` | 10.98:1      | 86°  |
| notes    | `#A48404` | 3.57:1        | `#EAB308` | 8.63:1       | 48°  |
| vault    | `#7C6CF0` | 3.99:1        | `#A99CF7` | 6.93:1       | 247° |
| cycle    | `#E0518A` | 3.68:1        | `#F08CB2` | 7.17:1       | 336° |
| recovery | `#2F9E73` | 3.36:1        | `#57C79A` | 7.92:1       | 157° |
| intimacy | `#D4653F` | 3.66:1        | `#E89370` | 6.97:1       | 15°  |

### Hue crowding

The system aims to keep module hues ~30° apart. With **16** tints that is arithmetically impossible — 360° / 30° allows twelve — so the following pairs sit closer, and those modules must be told apart by icon, shape and the data they carry rather than by colour alone.

| Pair               | Apart |
| ------------------ | ----- |
| habit ↔ recovery   | 5°    |
| journal ↔ study    | 5°    |
| fitness ↔ intimacy | 5°    |
| sleep ↔ vault      | 9°    |
| journal ↔ vault    | 11°   |
| habit ↔ budget     | 13°   |
| goals ↔ cycle      | 14°   |
| study ↔ vault      | 16°   |
| water ↔ budget     | 17°   |
| budget ↔ recovery  | 18°   |
| sleep ↔ journal    | 20°   |
| calendar ↔ sleep   | 22°   |
| sleep ↔ study      | 25°   |
| calendar ↔ water   | 26°   |
| goals ↔ intimacy   | 26°   |
| fitness ↔ notes    | 27°   |

<!-- GENERATED:colors END -->

Derive a module's full look from its one hex with [`lib/color.ts`](../lib/color.ts):
`tintGradient()` / `tintGradientTriple()` for washes, `glowShadow()` for the
colored elevation, `alpha()` for soft tinted fills.

### Categorical chart palette

Ordered so adjacent series stay distinct at a glance. Feed the row for the
active theme (`chartSeries.light` / `.dark` in the token file):
`emerald → blue → violet → orange → cyan → rose → indigo`. Give an area fill and
an emphasized endpoint the same care as the line.

**Content color-coding** (task categories, note folders) is a separate, small
curated palette in [`constants/theme.ts`](../constants/theme.ts) —
`categoryColorPalette`, `priorityColors` (blue → amber → red ladder), and
`habitDoneColor`.

---

## 5. Typography

**Sora** (geometric humanist sans) carries all chrome. **Literata**
(reading-optimized serif) is reserved for the one place writing should feel
literary: the Journal's own words. The contrast is the point.

| Role      | Size / line-height | Weight        | Tracking | Notes                         |
| --------- | ------------------ | ------------- | -------- | ----------------------------- |
| Display   | 40 / 44            | ExtraBold 800 | -0.8     | Splash / big moments          |
| H1        | 30 / 36            | ExtraBold 800 | -0.5     | Screen greeting               |
| H2        | 24 / 30            | Bold 700      | -0.4     | Section title                 |
| H3        | 20 / 26            | SemiBold 600  | -0.2     | Sub-section                   |
| Title     | 17 / 24            | SemiBold 600  | -0.1     | Card / list item title        |
| Body (lg) | 17 / 26            | Regular 400   | 0        | Comfortable reading           |
| Body      | 15 / 23            | Regular 400   | 0        | Default                       |
| Label     | 13 / 18            | SemiBold 600  | 0        | Form labels                   |
| Caption   | 12 / 16            | Regular 400   | +0.1     | Metadata                      |
| Micro     | 11 / 14            | Medium 500    | +0.4     | UPPERCASE eyebrows            |
| Stat      | 34                 | ExtraBold 800 | -1.0     | Numeric readouts, **tabular** |

- **Numbers** use `font-variant-numeric: tabular-nums` + tight tracking so stats
  align in columns and don't jitter as they animate.
- **RN caveat:** React Native doesn't synthesize bold from one font file — heavier
  weights need their own class (`font-sora-semibold`, `font-sora-extrabold`, …).
  See the `fontFamily` block in [`tailwind.config.js`](../tailwind.config.js).
- Map named steps to the `Text` component variants: `heading`, `subheading`,
  `muted`, `caption`, `micro` — see [`components/ui/text.tsx`](../components/ui/text.tsx).

---

## 6. Spacing — 8-point rhythm on a 4px base

Every gap, pad, and margin is a multiple of 4 — mostly 8. Consistent rhythm is
what makes a layout feel calm before you can say why.

| Key (× 4px) | px    | Common use                        |
| ----------- | ----- | --------------------------------- |
| `2`         | 8     | Icon ↔ label                      |
| `3`         | 12    | List row gap                      |
| `4`         | 16    | Card padding                      |
| `5`         | 20    | **Screen gutter**, hero padding   |
| `6`         | 24    | Section gap                       |
| `8`         | 32    | Major separation                  |
| `10`–`24`   | 40–96 | Empty-state / hero vertical space |

Named layout constants (`layout.*` in the token file): screen gutter **20**,
card padding **16**, section gap **24**, tab-bar height **64**, FAB **56**,
minimum touch target **44** (never smaller).

---

## 7. Shape & Depth

**Radius:** `sm 8 · md 12 · lg 16 · xl 20 · 2xl 28 · 3xl 32 · full 9999`.
`2xl` is **the** card radius — every resting card in the app. `3xl` exists only
because Tailwind's own default for it is 24px, which is _smaller_ than the
overridden `2xl`, so every `rounded-3xl` used to render tighter than the
`rounded-2xl` beside it; it is now 32 and reserved for large squares (80pt+
icon plinths, 160pt media tiles). Pill radius
(`full`) is reserved for buttons, chips, and the FAB — so "fully round" always
signals "tappable action." Cards use `lg`–`2xl`.

**Elevation ladder** (neutral shadows for chrome; swap for `glowShadow(tint)` on
colored surfaces):

| Level | Class       | Use                    |
| ----- | ----------- | ---------------------- |
| e0    | —           | Flat, on-ground        |
| e1    | `shadow-e1` | Resting card           |
| e2    | `shadow-e2` | Raised card, hero, FAB |
| e3    | `shadow-e3` | Bottom sheet           |
| e4    | `shadow-e4` | Modal / popover        |

Native shadow objects (with the matching Android `elevation`) are in
`elevation.e1…e4` in the token file. **On dark, elevation is expressed by
lighter surfaces** (`surface → card → raised`), not just heavier shadow.

---

## 8. Components

Every component ships with **resting, hover/press, focused, and disabled**
states plus a defined radius, elevation, and motion. Interactive things look
interactive; state is encoded in form as well as color.

| Component      | File                                                                      | Notes                                                                                                            |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Button         | [`components/ui/button.tsx`](../components/ui/button.tsx)                 | `primary · secondary · ghost · destructive · accent`. Accent paints a gradient + glow. Springs to 0.96 on press. |
| Card           | [`components/ui/card.tsx`](../components/ui/card.tsx)                     | `rounded-lg border bg-card` base surface                                                                         |
| Text           | [`components/ui/text.tsx`](../components/ui/text.tsx)                     | Type-scale variants                                                                                              |
| Progress ring  | [`components/ui/progress-ring.tsx`](../components/ui/progress-ring.tsx)   | Signature glowing arc — SVG + gradient, animated sweep                                                           |
| Stat tile      | [`components/ui/stat-tile.tsx`](../components/ui/stat-tile.tsx)           | Tinted icon chip + big value, staggered entrance                                                                 |
| Hero card      | [`components/ui/hero-card.tsx`](../components/ui/hero-card.tsx)           | Gradient wash + glow + decorative orbs                                                                           |
| FAB            | [`components/ui/fab.tsx`](../components/ui/fab.tsx)                       | Accent gradient, 56pt, scale-on-press                                                                            |
| Tab bar        | [`components/ui/tab-bar.tsx`](../components/ui/tab-bar.tsx)               | Bottom navigation                                                                                                |
| Section header | [`components/ui/section-header.tsx`](../components/ui/section-header.tsx) | Title + optional action link                                                                                     |
| Toast          | [`components/ui/toast.tsx`](../components/ui/toast.tsx)                   | Transient feedback; carries undo. Sits above the tab bar, never over it                                          |
| Dialog         | [`components/ui/dialog-host.tsx`](../components/ui/dialog-host.tsx)       | Confirm / notice / action menu. Bottom-anchored, scrim-dismissible                                               |

**States at a glance:** focus grows a 4px accent halo on inputs; disabled =
`opacity-40`; pressed = spring scale 0.96; destructive confirms before acting.

**Asking and telling.** These are different jobs and use different components.
A question — anything that needs a decision before it happens — is a dialog
(`confirm`, `notify`, `chooseAction` in [`lib/dialog-store.ts`](../lib/dialog-store.ts)).
A report of something that already happened is a toast, and if it can be taken
back, the toast carries the undo rather than a dialog asking first: a
confirmation is dismissed reflexively, an undo is not.

`Alert.alert` is not used anywhere and a test enforces that. The OS dialog
ignores the type scale, the tokens, the spacing and the layout direction —
which is not cosmetic in an app shipping Arabic and Urdu — renders differently
per platform, and drops buttons past the third on Android without saying so.
**Empty states** always offer the next step and a single accent CTA.
**Loading** uses shimmer skeletons that mirror the real layout — never a spinner
where content will land.

---

## 9. Motion — purpose before decoration

Motion explains space and change: where a sheet came from, how a card expanded,
that a tap registered. Durations stay short; springs feel physical.

| Token             | Value                      | Used for                         |
| ----------------- | -------------------------- | -------------------------------- |
| `instant`         | 100ms                      | State flips — checkbox, toggle   |
| `fast`            | 160ms                      | Press feedback, small fades      |
| `base`            | 220ms                      | Most enter/exit, card expand     |
| `slow`            | 320ms                      | Page transitions, sheet present  |
| `slower`          | 480ms                      | Ring sweeps, celebratory reveals |
| `spring.press`    | damping 16 · stiffness 400 | Snappy tap-down (scale 0.96)     |
| `spring.release`  | damping 12 · stiffness 300 | Soft settle back                 |
| `spring.gentle`   | damping 18 · stiffness 180 | Sheets, reorder                  |
| `spring.bouncy`   | damping 10 · stiffness 220 | Streak celebration **only**      |
| `easing.standard` | `cubic-bezier(.2,0,0,1)`   | Default enter + exit             |

Rings animate **from the last value**, never from zero, so change reads as
change. **All celebratory / non-essential motion is gated behind
`prefers-reduced-motion`** → reduced-motion sees a static checkmark instead of a
bloom.

---

## 10. Accessibility

- **Contrast:** AA for body, AAA for primary text on ground; live-verified in the
  interactive doc.
- **Touch targets:** nothing tappable smaller than 44×44pt, regardless of visual
  size.
- **Never color alone:** state carries icon/label/shape as well as hue.
- **Focus:** every focusable control has a visible 4px accent focus ring.
- **Motion:** respects `prefers-reduced-motion`.
- **Dynamic Type:** font scaling supported; layouts reflow rather than clip.

---

## 11. Dark Mode

Designed twice, not inverted. Grounds deepen to a green-biased near-black
(`#0E1210 → #161C19 → #1A201D → #202723`); module tints lift in lightness and
drop in saturation to stay vivid without glare; shadows do less work while the
raised-surface tier does more. Accent lifts `#188B61 → #47D19F` and pairs with a
dark `#0F241C` foreground so CTAs stay legible.

Driven by NativeWind's `dark:` class strategy (`darkMode: 'class'`) —
see [`hooks/use-color-scheme.ts`](../hooks/use-color-scheme.ts).

---

## 12. Tokens & Implementation

### Usage — NativeWind (preferred)

```tsx
// spatial stack + one accent CTA
<View className="bg-background">
  <View className="rounded-lg border border-border bg-card p-4 shadow-e1">
    <Text className="font-sora-semibold text-foreground">Today</Text>
    <Text className="text-sm text-muted-foreground">3 tasks left</Text>
  </View>
  <ProgressRing color={moduleTint('water', scheme)} gradient />
  <Button variant="accent" label="Log water" />
</View>
```

### Native mirror — `constants/design-tokens.ts`

```ts
const t = tokens('dark');
t.module('habit'); // '#34d399'
t.motion.spring.press; // { damping: 16, stiffness: 400 }
t.elevation.e2; // native shadow object (+ Android elevation)
t.typography.stat; // { size: 34, family: Sora ExtraBold, tracking: -1 }
```

### Recommendations for React Native · NativeWind · Reanimated

- **NativeWind:** keep raw hex out of screens — always go through tokens so a
  retune is one file. Use `dark:` variants; the class strategy is already wired.
- **Reanimated 4:** share the `spring.press` / `release` presets so every
  pressable feels identical. Gate `bouncy` celebrations behind a reduced-motion
  check.
- **react-native-svg rings:** feed `ProgressRing` a module tint + `gradient` —
  it already embodies the signature glowing arc via `tintGradient()`.
- **Android elevation:** pair each `shadow-*` with the matching `elevation`
  value from the token's native object; shadows render differently per platform.

---

_This system extends LifeOS's existing language (emerald accent, Sora/Literata,
gradient rings) rather than replacing it. Keep `global.css`,
`tailwind.config.js`, and `constants/design-tokens.ts` in sync when values
change._
