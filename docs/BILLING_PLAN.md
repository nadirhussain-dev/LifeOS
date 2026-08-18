# Plans & Coupons — implementation plan

Three tiers (Freemium / Standard / Premium), entitlements that are not just
storage, and a Safepay integration that is actually verified end to end.

---

## Part I — Where this stands

The schema and payment integration are built and coherent: `billing_plans`
(0034), `subscriptions` + `payment_events` (0047), `coupons` +
`coupon_redemptions` + `plan_coupon_variants` (0048), `checkout_intents`
(0049), `premium_grants` + `has_premium()` (0052), three Safepay edge
functions, an operator Pricing and Coupons screen, plan cards in
`app/settings/media.tsx`, all four locales complete.

Two things block what is being asked for now.

**The data model is binary and storage-shaped.** `billing_plans` carries
exactly one capability column, `storage_bytes`. Everything else that varies by
plan is hardcoded somewhere else: `free_album_limit()` returns a literal `1`,
`free_album_member_limit()` a literal `2`, `has_premium()` returns a boolean,
and the client asks `isPlus: planId !== 'free'`. A third tier has nowhere to
be expressed. "Standard gets 5 albums, Premium gets unlimited" cannot be said
in this schema at all.

**Entitlements are scattered across ten call sites** with no single definition
of what a tier includes. Inventory of every plan-dependent behaviour today:

| #   | Gate                 | Where                                  | Varies by                     |
| --- | -------------------- | -------------------------------------- | ----------------------------- |
| 1   | Storage quota        | `media_quota_bytes()` (0037)           | `billing_plans.storage_bytes` |
| 2   | Cloud media backup   | `enforce_media_quota()` (0035)         | paid / not                    |
| 3   | Shared album count   | `free_album_limit()` (0032)            | paid / not                    |
| 4   | Shared album members | `free_album_member_limit()` (0032)     | paid / not                    |
| 5   | Avatar upload        | `enforce_avatar_premium()` (0052)      | `has_premium()`               |
| 6   | Shared album media   | `enforce_album_media_premium()` (0052) | `has_premium()`               |
| 7   | Voice notes          | `enforce_album_media_premium()` (0054) | `has_premium()`               |
| 8   | Ads                  | `ad-slot.tsx:98`                       | `isPlus`                      |
| 9   | Private insights     | `app/private/insights.tsx:61`          | `isPlus`                      |
| 10  | On-this-day window   | `albums/[id].tsx:116` (15 vs 1)        | `isPlus`                      |

Four different mechanisms — a table column, two literal-returning SQL
functions, a boolean function, and a client-side string comparison — for one
concept. That is the thing to fix, and doing it is what makes this an
out-of-the-box feature rather than a storage upsell.

---

## Part II — The model

### II.1 Tier is not plan id

`plus_monthly` and `plus_yearly` are two rows for one product. With three
tiers that becomes five rows, and if entitlements hang off the plan row the
matrix is duplicated per billing period and will drift the first time someone
edits one and not the other.

So: add `billing_plans.tier`, and hang entitlements off the **tier**.

```sql
alter table public.billing_plans
  add column tier text not null default 'freemium'
    check (tier in ('freemium', 'standard', 'premium'));
```

Plan rows after seeding:

| id                 | tier     | period |
| ------------------ | -------- | ------ |
| `freemium`         | freemium | free   |
| `standard_monthly` | standard | month  |
| `standard_yearly`  | standard | year   |
| `premium_monthly`  | premium  | month  |
| `premium_yearly`   | premium  | year   |

Prices are deliberately absent — they move to `plan_prices` (II.4), two rows
per plan, one per currency.

Keep `free`, `plus_monthly` and `plus_yearly` as archived rows mapped to
`freemium` / `standard` — **decided: existing Plus subscribers map to
Standard**, no grandfathering. Do **not** rename or delete them:
`profiles.plan_id` is a foreign key into this table and existing subscribers
point at those ids. 0034's own "archive, never erase" discipline already
covers this — `active = false` hides them from the picker while they stay
valid for whoever holds one.

### II.2 One entitlements table

```sql
create table public.plan_entitlements (
  tier  text not null check (tier in ('freemium','standard','premium')),
  key   text not null,
  value jsonb not null,
  primary key (tier, key)
);
```

`jsonb` because the ten gates above are a mix of booleans and numbers, and a
future one will be neither. One table, readable by any signed-in account
(entitlements are reference data — the picker has to render them), writable
only through an audited admin RPC, exactly like `billing_plans`.

### II.3 Proposed matrix

Every one of these is editable from the operator console without a release —
that is the point of the table. These are a starting position, not a
commitment.

| key                  | freemium | standard | premium        |
| -------------------- | -------- | -------- | -------------- |
| `storage_bytes`      | 50 MB    | 15 GB    | 100 GB         |
| `media_backup`       | false    | true     | true           |
| `album_limit`        | 1        | 5        | -1 (unlimited) |
| `album_member_limit` | 2        | 10       | -1             |
| `avatar_upload`      | false    | true     | true           |
| `album_media_upload` | false    | true     | true           |
| `voice_notes`        | false    | false    | true           |
| `ads`                | true     | false    | false          |
| `insights`           | false    | true     | true           |
| `on_this_day_years`  | 1        | 5        | 15             |

`-1` for unlimited rather than `null`: a missing key must mean "not
configured, deny", and null and absent are too easy to confuse in a
comparison that decides whether someone can upload.

Standard vs Premium currently differentiates on storage, album headroom,
voice notes and lookback depth. If that is too thin to justify two paid
prices, the honest fix is a Premium-only capability rather than a bigger
number — worth deciding before pricing.

### II.4 Two currencies (PKR and USD)

A Safepay Plan object is fixed-price **and** fixed-currency. So one
`billing_plans` row cannot carry both prices, and `safepay_plan_id` cannot
live on the plan row — there has to be one Safepay Plan per (plan, currency).

The wrong fix is a row per currency (`standard_monthly_pkr`,
`standard_monthly_usd`): `profiles.plan_id` is a foreign key, so the user's
plan id would encode their currency, and every tier comparison would have to
strip a suffix. Normalize instead:

```sql
create table public.plan_prices (
  plan_id         text not null references public.billing_plans(id),
  currency        text not null check (currency in ('pkr', 'usd')),
  price_cents     integer not null,
  safepay_plan_id text,
  primary key (plan_id, currency)
);
```

`billing_plans.price_cents`, `.currency` and `.safepay_plan_id` move here and
are dropped from the plan row. Tier and entitlements stay currency-agnostic —
what you get never depends on what you pay in.

`plan_coupon_variants` needs `currency` in its primary key for the same
reason: a discounted Safepay Plan is also fixed-currency, so
`(base_plan_id, coupon_id)` is no longer unique enough.

**Choosing a currency.** Default from device region — `expo-localization` is
already a dependency — with an explicit override on the plan screen, because
region detection is wrong often enough that a Pakistani user abroad must not
be locked into USD. Persist the choice on `profiles.billing_currency`.

**Locking it.** Currency is fixed for the life of a subscription; Safepay has
no call to change it, the same constraint that makes a plan switch a
cancel-and-resubscribe (`media.tsx:136`'s long comment). So the picker is
disabled while a subscription is active, and changing currency follows the
same cancel → wait for webhook → resubscribe path as a tier change. Say this
in the UI rather than silently disabling the control.

**Zero-decimal.** Whether Safepay treats PKR as major units or paisa decides
`toSafepayAmount` (III.1). Verify per currency, not once — this is exactly
the assumption that makes the current `Math.round(cents / 100)` wrong.

**`formatPrice` needs replacing.** It hardcodes `$` for USD and falls back to
a `"PKR 4.99"` prefix that reads wrong in the launch market. Use
`Intl.NumberFormat` with the account's locale (Hermes ships full ICU on RN
0.81) so PKR renders as `Rs 1,200` and USD as `$4.99` without a hand-rolled
symbol table.

**Fixed-amount coupons become currency-specific.** `coupons.discount_value`
with `discount_type = 'fixed'` is a bare integer today — 500 means "$5" or
"Rs 5" depending on nothing. Two options, and this needs deciding before the
first fixed coupon is issued:

- add `coupons.currency`, so a fixed coupon applies to one currency only and
  `validate_coupon` refuses it against a plan priced in the other; or
- allow `percent` only for multi-currency codes, which is simpler and covers
  most campaigns.

Percent coupons are currency-safe either way and need no change.

### II.5 Effective tier, and grants

Grants (0052) currently hand out a boolean. With three tiers a grant must
name which tier it gives:

```sql
alter table public.premium_grants add column tier text not null default 'premium';
alter table public.profiles      add column granted_tier text;
```

Then one function every gate goes through:

```sql
create function public.my_tier() returns text ...
-- greatest of: the tier of profiles.plan_id, and
--              profiles.granted_tier where premium_until > now()
```

Ordering is `freemium < standard < premium`, so a Standard subscriber granted
Premium gets Premium, and the grant lapsing drops them back to Standard, not
to Freemium. That case is the entire reason to compute a maximum rather than
letting the grant overwrite.

Then:

```sql
create function public.my_entitlement(p_key text) returns jsonb ...   -- server gates
create function public.user_entitlement(p_user uuid, p_key text) ...  -- owner-of-album gates
create function public.my_billing_state() returns jsonb ...           -- client, one round trip
```

`my_billing_state()` returns `{ tier, premiumUntil, entitlements }` as a single
jsonb rather than `returns table`, because a RETURNS TABLE column named `tier`
collides with `plan_entitlements.tier` in the body and the `#variable_conflict`
workaround buys nothing.

`has_premium()` stays, but **must not** be narrowed to `my_tier() = 'premium'`
— it answers "does this account hold paid access" today, and three triggers
(avatar 0052, album media 0052, voice notes 0054) gate on it. Legacy Plus
backfills to Standard, so narrowing it strips all three from every existing
paying customer the moment the migration runs. Redefine it as
`tier_rank(my_tier()) >= tier_rank('standard')` — same question, same answer,
now derived from the ladder. The three gates move onto their own entitlement
keys one commit at a time, where the change is visible.

Note that `voice_notes` is Premium-only in the II.3 matrix while the current
trigger allows it for anyone paid, so converting _that_ gate is a takeaway
from existing Standard subscribers rather than a no-op. A product decision to
make deliberately at conversion time.

Gates 2, 3 and 4 move off their literals onto `my_entitlement(...)`.

### II.6 Client side

`my_billing_state()` returns tier, grant expiry and the whole map in one call.
Cache it in `billing-store.ts` beside `planId`, refreshed by the existing
`useBillingSync()` foreground hook.

```ts
export function useEntitlements(): Entitlements;
export function useEntitlement<K extends EntitlementKey>(key: K): EntitlementValue<K>;
export function useTier(): 'freemium' | 'standard' | 'premium';
```

Keep `usePlan().isPlus` as a deprecated alias for `useTier() !== 'freemium'`
so the ten call sites can migrate one at a time rather than in one commit.
Then convert them: `ad-slot.tsx` asks `useEntitlement('ads')`,
`albums/index.tsx` asks `album_limit`, `[id].tsx:116` asks
`on_this_day_years` instead of its hardcoded `15 : 1`.

Ship a typed `ENTITLEMENT_DEFAULTS` in `features/billing/config/` mirroring
the seed, as the offline fallback — same relationship `STORAGE_PLANS` already
has to `billing_plans`, and the same fail-safe posture. Defaults must be the
**freemium** row: a fallback that grants Premium on a flaky connection is a
free tier.

### II.7 Migration order

Two migrations, in this order:

**`0059_plan_tiers_and_entitlements.sql`** — one migration for tier plus
entitlements, because a client that sees `tier` but not `plan_entitlements`
has a tier it cannot resolve. Backfill `tier` from existing ids before adding
the constraint, and assert the seed covers every key × tier cell so a missing
cell fails at deploy rather than silently denying a paying customer.

**`0060_plan_prices_multi_currency.sql`** — `plan_prices`, the
`plan_coupon_variants` primary-key change, `profiles.billing_currency`, and
the drop of `billing_plans.price_cents` / `.currency` / `.safepay_plan_id`.

Split because the second one drops columns `safepay-checkout` reads live. The
edge function has to be deployed against the new shape **before** the drop
runs, or every checkout 500s in the window between them. Sequence: deploy a
checkout that reads `plan_prices` with a fallback to the old columns, run
0060, then remove the fallback.

Backfill `plan_prices` from the existing `billing_plans` values as USD rows,
and carry `safepay_plan_id` across — those Safepay Plan objects already exist
and must not be recreated, or subscribers end up on orphaned plans.

---

## Part III — Making Safepay actually work

The integration is written but has never been confirmed against a live
account. Its own source says so: `_shared/safepay.ts` vouches for exactly two
SDK signatures and flags `createSafepayPlan` as unverified;
`safepay-webhook`'s header says the payload field names are "documented but
not fully confirmed." Four API surfaces are in use and two are guesses.

### III.1 Amounts are rounded to whole currency units — must fix first

```ts
// supabase/functions/_shared/safepay.ts:76
amount: String(Math.round(input.amountCents / 100)),
```

$4.99 is sent as `"5"`. $39.99 as `"40"`. A 10% coupon on $4.99 computes
$4.49 and bills $4. `plan_coupon_variants.price_cents` caches the correct
figure, so the database and Safepay disagree permanently and no reconciliation
will ever line up.

Replace with an explicit `toSafepayAmount(cents, currency)` that names the
zero-decimal set in one place, and unit-test it per currency. With both PKR
and USD live (II.4) this is not one conversion but two, and getting PKR right
does not tell you USD is right — verify each against sandbox (III.2) before
writing the function, not after.

This must land before a single real charge.

### III.2 Verify all four call shapes against the live account

In sandbox, in this order, capturing the real request and response each time:

1. `POST /client/plans/v1/` — `createSafepayPlan`. Run it **twice, once per
   currency.** Confirm major vs minor units for each (III.1 depends on the
   answer), that the merchant account accepts USD at all — not a given for a
   Pakistani processor, and if it does not, II.4 collapses back to PKR-only —
   and which of `id` / `token` / `plan_id` actually comes back. The current
   code guesses all three with `??` fallbacks.
2. `safepay.checkout.createSubscription({...})` — confirm `reference`
   survives round-trip into the webhook. The entire user↔subscription
   attribution rests on it (0049).
3. `safepay.subscription.cancel(id)` — **not** one of the two signatures the
   file header vouches for. Verify it exists before relying on it; the Free
   plan card calls it.
4. `safepay.verify.webhook(request)` — verify against a real signed delivery.
   The raw-body handling is right; the concern is only whether the SDK's
   verifier matches the header Safepay sends.

Then capture one delivery of each of the four event types and check
`readEvent()`'s extraction against them. If field names differ, that one
function is the only thing that changes — which is a good design, but it
still has to be done.

### III.3 The callback route does not exist

`safepay-checkout` redirects to `daykeep://billing/callback?status=…`. There
is no `app/billing/` directory. Inside `openAuthSessionAsync` the redirect is
intercepted so the happy path hides it, but a 3DS step through a bank app —
routine in Pakistan — delivers that link cold to expo-router, which has no
match.

Add `app/billing/callback.tsx`: read `status`, invalidate
`['billing','subscription']`, show a "confirming your payment" state, route to
`/settings/media`. It must grant nothing — the webhook stays the only
authority. Also reconcile it with `Linking.createURL('/billing/callback')`
(`media.tsx:169`), which yields a different form in dev than in a release
build.

### III.4 The coupon endgame is a dead button

The flow coupons exist to produce. When `duration_cycles` runs out the webhook
sets `pending_renewal_confirmation` and `media.tsx:300` renders a reconfirm
button. It cannot work:

- it calls `choosePlan(plan)` with the subscriber's **current** plan;
- `choosePlan` returns immediately at `plan.id === planId` (`media.tsx:116`),
  because the webhook already wrote `profiles.plan_id`;
- past that guard, `if (isPlus)` (`media.tsx:147`) shows the switch-plan
  notice instead.

Fix as a `safepay-confirm-renewal` edge function, not a client path: it must
cancel the discounted subscription, wait for `subscription.cancelled`, and
check out at full price. Sequencing that client-side leaves an account on Free
if the app dies between the two calls.

### III.5 Reconciliation

Every state change arrives by webhook, and a webhook that is never delivered
is silent. There is no periodic check that this app's `subscriptions` agree
with Safepay's. Add a scheduled function that pulls active subscriptions and
repairs drift — logging what it repaired, since a repair is evidence a
delivery was lost.

### III.6 Store policy

`lib/store-compliance.test.ts` exists, so this is on the radar. Taking payment
for digital goods through a web checkout rather than StoreKit / Play Billing
needs resolving before review, not after. It may constrain what can be sold
in-app at all, which would reshape the tier matrix — so settle it early.

---

## Part IV — The rest of the last mile

### IV.1 Coupons are never validated before checkout

`validate_coupon(code, plan_id)` was written in 0048 for a client to call —
narrow return, one code at a time, a distinct user-facing message per refusal.
Its only caller is inside `safepay-checkout`, server-side.

Today: type a code into a bare `TextInput`, tap a plan, confirm a dialog, wait
for a browser, get a raw error toast if it was wrong. No feedback that the
field did anything.

Build `validateCoupon()` in `billing-repository.ts`, a debounced
`useValidateCouponMutation` (on blur or an Apply button, never per keystroke,
uppercased to match `upper(trim(code))`), and a `CouponField` with
idle/checking/applied/rejected states. Show the discount against the selected
plan and the honest duration — "for 3 months, then $X" — from the
`duration_cycles` that `validate_coupon` already returns and the UI currently
discards.

Move the discount arithmetic into a shared `discountedCents(plan, coupon)` so
the preview and the actual charge cannot drift.

Guard the zero case: a 100% coupon, or a fixed coupon at or above plan price,
creates a 0-amount recurring plan. Reject at issue time in
`admin_create_coupon`, not at checkout in front of a customer.

**With three tiers, `coupons.plan_ids` should gain a tier-level equivalent** —
"20% off Premium" should not need re-issuing when a new billing period is
added.

**With two currencies, `validate_coupon` gains a currency argument.** It
resolves a plan today; it now has to resolve a (plan, currency) price, and a
fixed-amount coupon has to be refused against the currency it was not issued
for — see the open question in II.4.

### IV.2 Granted entitlement is invisible to the client

0052 made entitlement `has_premium()`; the client still computes
`planId !== 'free'` (`use-billing.ts:79`). A granted user sees ads, is refused
backup, and is upsold, while the server would accept their uploads. Fixed
structurally by II.4 + II.5 — `my_tier()` accounts for grants, so every
converted call site inherits the fix.

### IV.3 Premium grants have no UI at all

`admin_grant_premium` / `admin_revoke_premium` have **zero callers** in `app/`
or `features/`. The migration's stated purpose — a support gesture, a beta
tester, a competition winner — is unreachable.

Add a grant action to `app/settings/operator/users.tsx`, owner-gated like the
Coupons row (`operator.tsx:147`): tier picker, duration presets plus custom
date, required reason, current grant with revoke. `premium_grants` has only a
read-own policy, so add `admin_list_premium_grants()` for history.

### IV.4 Coupons can only be created and archived

`admin_update_coupon` accepts `p_ends_at` and `p_max_redemptions`; the screen's
only call site passes both back unchanged. A live campaign cannot be extended
or capped without issuing a second code. An edit sheet over the existing RPC —
no migration needed.

### IV.5 Redemptions are a counter and nothing else

`coupon_redemptions` has no admin read path. Add
`admin_list_coupon_redemptions(p_coupon_id)` and a detail view.

### IV.6 The plan picker is a settings sub-screen

Three tiers deserve a real comparison surface, not a list of cards under
Settings → Media. Build `app/billing/plans.tsx` — a tier comparison driven by
`plan_entitlements`, so adding a key adds a row with no UI change — and point
every upsell at it. There are already six distinct upsell dialogs
(`billing.insightsUpsell*`, `albumLimit*`, `memberLimit*`, `media.backupUpsell*`)
that today say "the plan cards are on this screen, just below."

---

## Part V — Tests

No test file touches billing, coupons, plans or Safepay. For the one
subsystem that moves money, that is the largest single risk here.

- **SQL** (`npm run test:sql`, pglite harness exists): `my_tier()` across
  plan-only / grant-only / both / expired grant / grant below plan tier;
  `my_entitlement()` for every key × tier cell; the `validate_coupon` refusal
  matrix, one case per branch; `unique (coupon_id, user_id)` under concurrent
  redemption; `increment_coupon_redemption` refusing to exceed
  `max_redemptions`.
- **Unit**: `toSafepayAmount` per currency; `discountedCents` for percent and
  fixed including the floor at zero; `formatPrice` for a non-USD currency —
  it currently emits `"PKR 4.99"`, which will read wrong in the likely launch
  market.
- **Webhook**: `readEvent()` against captured sandbox payloads (III.2), and
  the replay path — the idempotency guard is well-reasoned and entirely
  unverified.
- **Entitlement fallback**: assert `ENTITLEMENT_DEFAULTS` equals the freemium
  seed row, so a network failure can never grant a paid capability.

---

## Sequencing

1. **III.2 (partial)** — verify `createSafepayPlan` against sandbox for
   _both_ PKR and USD. III.1 cannot be written correctly until you know
   whether either is zero-decimal.
2. **III.1** — `toSafepayAmount`, currency-aware and unit-tested. Nothing
   that charges money ships before this.
3. **0059** — tier + entitlements, `my_tier()`, `my_billing_state()`, client
   hooks, `isPlus` kept as an alias. No behaviour change yet.
4. **0060** — `plan_prices`, currency selection, `formatPrice` on
   `Intl.NumberFormat`. Follow the deploy sequence in II.7.
5. **Convert the ten gates.** One per commit, each with its SQL test.
6. **III.3–III.4** — callback route, renewal reconfirmation.
7. **IV.1** — coupon validation and preview, including the fixed-discount
   currency decision.
8. **IV.3–IV.6** — operator console, then the plan comparison screen.
9. **III.5** — reconciliation, once real subscriptions exist to reconcile.

Part V is written alongside each step, not after.

## Decisions taken

- **Both PKR and USD.** Drives `plan_prices` (II.4), the currency picker and
  its lock, `Intl.NumberFormat`, and per-currency verification in III.2.
- **Standard and Premium differ by degree.** Ship the II.3 matrix as-is; the
  values are console-editable, so adjust after seeing conversion rather than
  guessing now.
- **Legacy Plus maps to Standard.** No grandfathering grants.

## Still open

- **Fixed-amount coupons across two currencies** (II.4). `coupons.currency`,
  or percent-only for multi-currency codes. Needs deciding before the first
  fixed coupon is issued — after that it is a data migration.
- **Seed prices per currency.** The II.3 matrix has no numbers attached in
  either currency yet. Not a blocker for 0059; it is one for 0060.
- **Store policy** (III.6). May constrain what can be sold in-app at all,
  which would reshape the matrix. Worth resolving early for that reason.
