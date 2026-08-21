# Notifications overhaul — diagnosis and implementation plan

Status: **complete** on `fix/notification-duplicates`, with three deliberate
exceptions, all of which are "wait one release" rather than "not done":

- Phase 2 item 11 — deleting the now-redundant per-module id storage.
- The edge functions naming the new per-purpose push channels (§5).
- Verifying FCM credentials, which is an operator task and not a commit (§5) —
  **do this first; on Android it decides whether push works at all.**

Supersedes the open items at TODO.md:527 and TODO.md:533.

The reported symptom is four identical "Do not lose today" notifications firing at
the same instant, with four matching inbox rows. That is not a challenge-feature
bug that happens to be visible; it is the first place a structural gap in the
scheduling layer became load-bearing enough to be noticed. This document names
the root cause, the systemic gap behind it, and the work to close both.

---

## 1. Why four notifications fired

`features/challenge/services/challenge-reminders.ts` is the only reminder module
in the app that keeps its OS notification ids in **module-level memory**:

```ts
let scheduledId: string | null = null; // challenge-reminders.ts:64
let lastCallId: string | null = null; // challenge-reminders.ts:65
let winBackId: string | null = null; // challenge-reminders.ts:189
```

Every other module persists its ids durably — a DB column (`tasks`, `notes`,
`habits`, `debts`, `calendar_events`) or a persisted zustand store
(`goal-reminder-store`, `journal-reminder-store`, `study-reminder-store`,
`water-settings-store`). Challenge is the outlier, and it is the outlier on
three counts at once. Each produces duplicates on its own.

### 1a. The concurrency race — this is what produced the four

`syncChallengeReminder` is a cancel-then-schedule sequence with four `await`
points in it (`cancelNotification`, `requestNotificationPermission`,
`channelsSettled`, `scheduleNotificationAsync`). It has **no serialization**.

It is invoked fire-and-forget from a store subscription:

```ts
// features/challenge/hooks/use-challenge-tracking.ts:95
void syncChallengeReminder(outstandingModules(...));
```

…which re-fires on every change to `days`, `required`, or `liveRequired`
(use-challenge-tracking.ts:104-112). `flushChallenge()` runs on every foreground
transition and applies the server response through several separate `set()`
calls — `challenge-store.ts` has ten distinct set sites touching those keys.

So a single foreground can produce N overlapping invocations. All of them read
the same `scheduledId`, all no-op the cancel, all await, all schedule. Only the
last assignment sticks. **N − 1 notifications become orphans that nothing holds
a reference to and nothing can ever cancel.** They all carry the same 20:00
trigger, so they all fire in the same instant.

That is the screenshot: four copies at 20:00, four inbox rows (one per
`logScheduledNotification` call), differing read state because a tap marks only
the row whose `logId` rode in that particular payload.

### 1b. The cold-start leak

`scheduledId` is `null` after every process start. So the first sync of every
launch calls `cancelNotification(null)` — a no-op — and queues a _fresh_ 20:00
notification alongside whatever survived from the previous launch. Orphans
accumulate across launches, not just within one.

### 1c. Challenge is not in the resync

`resyncAllReminders()` rebuilds every module's reminders from durable state and
is the app's only self-healing mechanism. Challenge appears in it zero times and
does not register via `registerReminderStep`, unlike `insights` and `private`.

Worse, `runResync()` calls `cancelAllScheduled()`, which wipes **all** queued
notifications including challenge's — while the in-memory ids go on pointing at
them. Both run in independent effects on launch (`app/_layout.tsx:455` vs. the
challenge tracking effect), so which wins is nondeterministic. The observable
outcomes are "duplicates" and "the reminder silently vanished", from the same
race, on the same launch.

---

## 2. The systemic gap

The duplicate is a symptom. The cause is that **notification identity is a
convention, not a mechanism.**

`lib/notifications.ts` hands back an opaque OS id and asks every caller to
remember it, store it durably, and cancel it before scheduling again. Twenty-odd
call sites each get one chance to implement that correctly. Nineteen did.
Nothing in the type system, the tests, or the scheduler makes the twentieth
impossible — and nothing detects it afterwards, because there is no notion of
"this notification and that notification are the same reminder."

Related weaknesses that follow from the same gap:

| #   | Issue                                                                               | Location                       | Effect                                                                                                |
| --- | ----------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | No mutex on any per-entity sync (only `resyncAllReminders` has an `inFlight` guard) | all `sync*Reminder` fns        | any double-call duplicates                                                                            |
| 2   | Slot ledger is an in-process counter, reseeded only by a resync                     | `scheduling-budget.ts`         | duplicates inflate it; on iOS `hasHeadroom` then silently declines _real_ reminders                   |
| 3   | `applyDeliveryMode()` is not awaited and races `resyncAllReminders()`               | `app/_layout.tsx:448-455`      | cancels categories mid-rebuild                                                                        |
| 4   | Digest mode destroys reminders instead of deferring them                            | `delivery.ts` header           | switching back leaves them gone until each item is re-saved                                           |
| 5   | `recordMissedRepeatingDeliveries` must precede `cancelAllScheduled`                 | `reminder-scheduler.ts`        | correct today, guarded only by a comment                                                              |
| 6   | `SCHEDULE_EXACT_ALARM` declared                                                     | `app.json` android.permissions | Investigated and **kept** — see Phase 3 item 14; removing it degrades every timed reminder to inexact |
| 7   | Repeating deliveries only register while the process is alive                       | —                              | inbox/badge under-count, partially patched by `missed-occurrences.ts`                                 |

---

## 3. The fix: keyed scheduling

Replace "remember your id" with a **stable dedupe key carried in the payload**,
and make the OS queue the source of truth. The OS queue is the only store that
cannot disagree with what will actually fire — it survives process restarts, JS
reloads, and OTA updates.

### 3.1 Add a key to the payload

`features/notifications/types/notification.types.ts` — extend
`NotificationPayload` with `key?: string`. Keys are stable and derived, never
random:

```
challenge:at-risk      task:<id>          habit:<id>:<weekday>
challenge:last-call    note:<id>          water:<slotMinute>
challenge:win-back     goal:<id>          debt:<id>
digest:daily           review:weekly      cycle:<phase>
```

A new `features/notifications/services/notification-keys.ts` owns the
constructors so keys are never spelled by hand at a call site.

### 3.2 One keyed primitive

In `lib/notifications.ts`, wrap the three existing schedulers so that passing a
key changes what they do. (Built as `withKey`, an internal wrapper, rather than
the fourth public entry point this section originally imagined — see Phase 2
item 8 for why.) Per call:

1. **Serialize on the key.** A `Map<string, Promise<unknown>>` where each call
   chains onto the previous promise for that key. This is a real mutex, not a
   boolean flag, and it makes cancel→schedule atomic per key. §1a dies here.
2. **Cancel by key.** Read the queue, cancel _every_ entry whose
   `data.key` matches — not one remembered id, all of them. This reaps orphans
   left by previous versions of the bug, and makes §1b impossible: a cold start
   finds the previous notification because it looks in the queue, not in memory.
3. Schedule, spend a slot, write the inbox row (unchanged).

The existing `scheduleOneTimeNotification` / `scheduleDailyNotification` /
`scheduleWeeklyNotification` stay as the unkeyed path during migration, then
become internals.

**Cost control.** `getAllScheduledNotificationsAsync()` is a native round-trip
and the resync schedules dozens in a row. Keep a module-level snapshot of the
queue, invalidated on every schedule/cancel and rebuilt lazily. Because all
scheduling flows through this one module, the snapshot is authoritative; seed it
from the real queue in `runResync()` where `seedSlots` already does.

### 3.3 Sweep orphans on launch

In `runResync()`, after `cancelAllScheduled()`, nothing is queued — so add a
reconcile step that also runs on _foreground_ (not just launch): group the queue
by `data.key` and cancel all but the soonest of each group. This is the net that
catches any future regression rather than trusting every call site again, and it
retroactively cleans up devices already carrying duplicate 20:00 entries.

### 3.4 Make omission a test failure

The structural fix. Add a coverage test in the shape the repo already uses for
the `features/private` import guard: enumerate every module that calls a
`schedule*` primitive and assert each is reachable from `resyncAllReminders()`
(directly or via `registerReminderStep`). "Someone shipped a scheduler and forgot
the resync" becomes a red test, not a production incident.

---

## 4. Work items

### Phase 1 — stop the bleeding — **done**

1. ✅ Serialize `syncChallengeReminder` / `scheduleWinBack` /
   `cancelChallengeReminder` behind one per-module promise chain, plus
   trailing-collapse of queued resyncs.
2. ✅ ~~Persist the three challenge ids in a persisted zustand store~~ —
   **superseded, and the change is better for it.** A persisted store swaps one
   source of truth for another and still has to be right; worse, zustand
   hydrates asynchronously, so a sync racing hydration reads nulls and
   reintroduces the exact cold-start duplicate it was meant to fix. Pulling
   `key` + `cancelScheduledByKey` forward from Phase 2 removes the need to
   remember an id at all, and — unlike a store — it **reaps the duplicates
   already queued on users' devices**, because it reads the OS queue rather than
   app state. No migration, no hydration race, self-healing.
3. ✅ `registerReminderStep('challenge', …)` from a new
   `features/challenge/services/register-reminders.ts`, imported at module level
   in `app/_layout.tsx` alongside the existing two.
4. ✅ Debounce the store subscription in `use-challenge-tracking.ts` (250 ms
   trailing) so a burst of `set()` calls produces one sync.
5. ✅ `await applyDeliveryMode()` before `resyncAllReminders()` in
   `app/_layout.tsx`.
6. ✅ Regression suite — `challenge-reminder-identity.test.ts`, 11 cases
   covering all three failure modes. Verified non-vacuous: neutering the mutex
   fails the concurrency cases with exactly the reported four-notification
   symptom.

### Phase 2 — keyed scheduler — **done**

7. ✅ `key` on `NotificationPayload`; `notification-keys.ts`;
   `cancelScheduledByKey` in `lib/notifications.ts` — landed early with Phase 1.
8. ✅ Per-key mutex + queue snapshot in `lib/notifications.ts`. Implemented as
   `withKey`, wrapping the three **existing** schedulers rather than a fourth
   `scheduleKeyed` entry point — the twenty call sites already use those three
   with different trigger shapes, so a new signature would have meant rewriting
   every one of them in a single commit. As built, a key is opt-in: passing one
   makes the schedule idempotent, omitting one leaves behaviour untouched, and
   the modules migrated one at a time. Added `cancelScheduledByKeyPrefix` for
   the schedules that are a _set_.
9. ✅ All 14 scheduling modules migrated — tasks, notes, calendar, debts, sleep,
   journal, review, digest, habits, water, study, goals, together, cycle.
   Set-based ones (habits, water, study, goals) clear their prefix first, so a
   member the new set drops is reaped rather than orphaned.
10. ✅ Orphan sweep (`sweepDuplicateKeys`) at the end of every rebuild and on
    every foreground.
11. Delete the now-redundant per-module id columns/stores **last**, once every
    module is keyed and one release has shipped — the ids are still what cancels
    notifications queued by the previous build. **Deliberately not done here.**

**Found while migrating:** `together-reminders.ts` scheduled without ever
cancelling, and returned early — leaving the previous nudge queued — whenever
there was no hub, no milestone in range, or the milestone had passed. Survivable
only because its one caller is the rebuild, which clears the queue on the way
in. Now cancels by key first, unconditionally.

### Phase 3 — hardening — **done**

12. ✅ Slot ledger reseeded from the real queue on every foreground, alongside
    the queue-cache drop and the sweep.
13. ✅ Digest mode defers rather than destroys: leaving digest mode triggers a
    full rebuild, so the nudges come back instead of waiting to be re-saved
    item by item. (`delivery.ts` claimed the Settings screen warned users about
    the old behaviour. It never did — there is no such string in any locale, so
    the limitation was undocumented as well as unfixed. Nothing to update.)
14. ✅ Reconsidered — **and the answer is to keep it.** The concern was Play's
    restriction of `SCHEDULE_EXACT_ALARM` to alarm/calendar apps on Android
    14+. But the Expo SDK 54 docs are explicit that expo-notifications needs it
    on Android 12+ (API 31+) for a notification to fire at an exact time, and
    without it every timed reminder in the app silently degrades to whatever
    Doze allows — which for a task due-time is the difference between a
    reminder and a rumour. Daykeep's core function is reminders, so the
    declaration is defensible at review. The real work is the second half of
    the item: the app must read correctly when the grant is absent, which is
    what `openExactAlarmSettings()` already exists for. No manifest change.
15. ✅ Resync-coverage test — `resync-coverage.test.ts` walks the import graph
    from the rebuild's roots and fails if any module that calls a scheduling
    primitive is unreachable. Verified non-vacuous: removing the challenge
    registration reports `challenge-reminders.ts` as an orphan, which is
    precisely the bug that shipped.

---

## 5. Push notifications — what they can and cannot do here

### The premise needs correcting first

Push is not the answer to "what if the internet is off." It is the exact
opposite: **local notifications are the ones that work with no connectivity**,
because the OS holds the trigger on-device. A push requires a live FCM/APNs
path. Turning the internet off is the scenario local scheduling already handles
and push does not.

So the question worth answering is not "offline?" but "what can a device-local
trigger never know?" There are exactly three answers:

1. **Reaching someone who has stopped opening the app.** A local notification
   can only be scheduled while the process runs. `challenge-reminders.ts:180`
   already concedes this about the win-back nudge — it reaches people who came
   back, never the ones who left, which inverts its entire purpose.
2. **Server-computed content.** Season end, standing changes, leaderboard
   movement, another person's action. The device cannot compute these.
3. **Remotely correcting or cancelling a local reminder** — the "you already
   finished today, stand down" case that TODO.md:527 flags as the reason the
   streak category went unscheduled for so long.

Everything else in the app — every time-based reminder — should stay local.
Local is more reliable, works offline, costs nothing per send, and needs no
token lifecycle.

### What already exists

- `features/split/services/push-registration.ts` — Expo token registration via
  the `register_push_token` RPC
- `push_tokens` table, migration `0005_push_and_invites.sql`
- `supabase/functions/notify-group`, `supabase/functions/notify-album`
- `daykeep-general-v3` channel as the fixed remote-push target (`app.json`)

The backbone is there. It is used only for shared features.

### Gaps — all closed except one, which needs an operator not a commit

| Gap                                             | Status                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FCM credentials**                             | **STILL OPEN — and it is the one that decides whether any of the rest works.** No `android.googleServicesFile` anywhere in `app.json` / `app.config.js` / `eas.json`. Without FCM V1 credentials in the native build, remote push does not deliver on Android in a standalone build at all. Not fixable from the repo — see below. |
| **No receipt handling**                         | Closed. `_shared/expo-push.ts` reads Expo's per-message tickets; `check-push-receipts` fetches receipts on a cron against the `push_receipts` table (migration 0068).                                                                                                                                                              |
| **Dead tokens are never pruned**                | Closed. `DeviceNotRegistered` at ticket time or receipt time deletes the token. Narrow on purpose: never `MessageTooBig`/`MessageRateExceeded`, which are about the send and not the device.                                                                                                                                       |
| **`lastRegistered` is in-memory**               | Closed. Persisted to AsyncStorage, and `startPushTokenRotationWatch` re-registers when the service hands over a new token mid-session.                                                                                                                                                                                             |
| **`unregisterPushToken` early-returns on null** | Closed. Falls back to asking the OS for the token — the record is an optimisation, the device's token is the fact, and this is the path where being wrong is a disclosure on a shared phone.                                                                                                                                       |
| **No `collapseId` / `priority` / `ttl`**        | Closed. Supported by the sender; both notify functions set a per-group / per-album collapse id.                                                                                                                                                                                                                                    |
| **One channel for all pushes**                  | Half closed. `daykeep-groups-v3` and `daykeep-albums-v3` are created client-side; the edge functions deliberately still name `daykeep-general-v3`, because Android drops a notification naming a channel the device does not have. Switch one release after this ships.                                                            |

### The one thing a commit cannot fix

**Verify FCM credentials before believing any of this works on Android.**
Nothing in the repo provides `google-services.json`, and Expo's push service
needs an FCM V1 service-account key uploaded to EAS to reach Android devices at
all. If that was never set up, every Android push has been failing silently
since the feature shipped — the functions returned `sent: n` regardless, which
is exactly the reporting this branch replaced.

Check with `eas credentials` (Android → push notifications), or send one test
push to a real device. If it is missing, no amount of the work above matters on
Android; iOS is unaffected, since APNs credentials come from the Apple account
EAS already holds.

### Still to build: the senders

The mechanism is done; nothing sends a keyed push yet. That is deliberate — the
dedupe contract had to land first so whoever writes a sender inherits a system
where push and local cannot double-fire. The three cases worth sending, from
§5's opening:

1. **Win-back** — `challenge-reminders.ts:180` already concedes its local
   version reaches only people who came back, never the ones who left.
2. **Season end / standing changes** — server-computed, so the device cannot
   know them.
3. **"You already finished today, stand down"** — the case TODO.md:527 gave as
   the reason the streak category went unscheduled for so long. Send it with
   the `challenge:at-risk` key and the local reminder cancels itself.

Each needs a scheduled function and a rate-limit budget, in the shape
`check-push-receipts` now establishes.

---

## 6. What to do next

1. **Verify FCM credentials** (§5). Everything else on Android is moot until
   this is known, and it is a five-minute check.
2. **Run it on a device.** All of this is verified in CI, not on hardware. The
   thing that actually proves the original bug is fixed is one notification at
   20:00 tomorrow instead of four.
3. **After one release has shipped:** flip the edge functions to the
   per-purpose channels, and delete the per-module id columns and stores
   (Phase 2 item 11). Both are safe only once the install base carries this
   build.
4. **Then, if wanted:** the senders in §5. The mechanism is waiting for them.
