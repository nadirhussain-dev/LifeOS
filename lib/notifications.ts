import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Linking, Platform } from 'react-native';

import {
  channelSoundFor,
  contentSoundFor,
  notificationSound,
  type NotificationSoundId,
} from '@/features/notifications/config/notification-sounds';
import {
  deleteLogByNotificationId,
  logScheduledNotification,
} from '@/features/notifications/services/notification-log-repository';
import { resolveNotificationContent } from '@/features/notifications/services/notification-visibility';
import {
  hasHeadroom,
  releaseSlot,
  spendSlot,
} from '@/features/notifications/services/scheduling-budget';
import {
  shiftDailyOutOfQuietHours,
  shiftTimestampOutOfQuietHours,
} from '@/features/notifications/services/quiet-hours';
import {
  isCategoryEnabled,
  useNotificationsStore,
} from '@/features/notifications/store/notifications-store';
import {
  CATEGORY_META,
  type NotificationCategory,
  type NotificationPayload,
} from '@/features/notifications/types/notification.types';
import {
  holdNotificationDuringFocus,
  isFocusModeActive,
} from '@/features/study/store/focus-mode-store';
import { generateId } from '@/lib/id';

/** Shared local-notification primitives — every module's reminder feature
 * (Water, Habits, Tasks, Notes, Calendar Events, Journal, Sleep, Budget)
 * schedules through these functions instead of each reimplementing permission
 * handling and trigger construction.
 *
 * These functions are the single choke point for the app-wide notification
 * policy: a `data` payload tagging the notification's {@link NotificationPayload}
 * category + deep-link route flows through every call, and when present the
 * primitives enforce the master/per-category switches and quiet hours, record
 * the reminder in the in-app inbox (notification_log), and embed the deep-link
 * so a tap lands on the right screen. Callers that pass no `data` get the
 * original raw behaviour (no gating, no logging) for backwards compatibility. */

/**
 * expo-notifications logs a hard ERROR the moment it's imported inside
 * Expo Go on Android (notification support was pulled from Expo Go in
 * SDK 53). The module is therefore loaded lazily and only outside that
 * environment — in Expo Go on Android every function here quietly no-ops
 * (returns null), and reminder settings screens can use this flag to tell
 * the user why. Everything works normally in a development build or
 * production app.
 */
export const notificationsAvailable = !(
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
);

type NotificationsModule = typeof import('expo-notifications');

let cachedModule: NotificationsModule | null = null;

function getNotifications(): NotificationsModule | null {
  if (!notificationsAvailable) return null;
  // require() (not a static import) is the whole point here — a static import
  // would initialize the module in Expo Go on Android and trigger the ERROR.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (!cachedModule) cachedModule = require('expo-notifications') as NotificationsModule;
  return cachedModule;
}

/** Registers the foreground-presentation handler — without one,
 * notifications delivered while the app is open are suppressed. Called once
 * from the root layout; safe to call anywhere (no-ops in Expo Go Android). */
export function configureNotificationHandler(): void {
  const Notifications = getNotifications();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      // The one exception to the shield below: the alert that says the focus
      // block is over. Swallowing it would mean the timer's own alarm is the
      // single notification the timer suppresses — and it would then be
      // re-announced afterwards as "1 reminder was held while you focused",
      // which is both wrong and too late to be useful.
      const isTimerAlert = notification.request.content.data?.timerAlert === true;

      // A study focus block must not be interrupted. The reminder is swallowed
      // rather than shown — it is already a row in the in-app inbox, and
      // features/study/services/focus-mode.ts re-announces everything held here
      // as one summary the moment the block ends, so nothing is lost.
      if (isFocusModeActive() && !isTimerAlert) {
        holdNotificationDuringFocus(notification.request.content.title ?? '');
        return {
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: false,
          shouldShowList: false,
        };
      }
      // The app is in the foreground here. An OS banner dropping over the
      // screen the user is already looking at is the crudest possible
      // presentation — it hides their content to tell them something the app
      // could show in context. So the banner is suppressed and an in-app one is
      // raised instead (see components/ui/notification-banner), while the
      // notification still lands in the shade so it isn't lost if it's missed.
      return {
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: true,
      };
    },
  });
}

/** Android notification channels. Android groups notifications by channel and
 * lets the user tune importance/sound per channel in system settings, so we
 * split by urgency: time-critical reminders, everyday nudges, and the morning
 * digest each get their own. iOS ignores channels.
 *
 * IMPORTANT — the version suffix is load-bearing. `createNotificationChannel` is
 * only a create: on a channel that already exists Android updates the name and
 * description and *silently discards* importance, sound, vibration and lights,
 * because those become user-owned settings the moment the channel appears. The
 * only way to ship a corrected importance is under a new channel id. The v1
 * channels were created at IMPORTANCE_DEFAULT, which posts to the shade
 * with a sound but never peeks — reminders made their noise and appeared to not
 * show up at all. Bump the version whenever a channel's fixed properties have to
 * change again; `pruneForeignChannels` below sweeps up whatever the bump orphans.
 *
 * v3 also folds the chosen tone into the id. Since a channel's sound cannot be
 * changed after creation, "let me pick the notification sound" is necessarily
 * "make a new channel and delete the old one" — see
 * features/notifications/config/notification-sounds.ts. */
const CHANNEL_VERSION = 3;

const URGENCIES = ['time-sensitive', 'reminders', 'digest'] as const;
type Urgency = (typeof URGENCIES)[number];

function channelIdFor(urgency: Urgency, soundId: NotificationSoundId): string {
  return `daykeep-${urgency}-v${CHANNEL_VERSION}-${soundId}`;
}

/**
 * The one channel whose id never moves.
 *
 * A remote push (a shared-expense group update) is composed on a server that
 * knows nothing about this device's tone, so it cannot name a tone-specific
 * channel — and app.json's `defaultChannel`, which is where such a push lands,
 * is a build-time constant that cannot track a runtime preference either. This
 * channel exists to be that fixed target. It keeps the system default sound;
 * the reminder tone applies to the reminders Daykeep schedules itself.
 */
const PUSH_CHANNEL_ID = `daykeep-general-v${CHANNEL_VERSION}`;

/**
 * The two kinds of shared update, separated so they can be silenced separately.
 *
 * Everything remote landed on `PUSH_CHANNEL_ID`, which meant a user who wanted
 * to mute a chatty album had to mute expense-group updates with it — Android
 * hands channel importance to the user, and one channel is one decision.
 *
 * Fixed ids, deliberately not tone-suffixed like the reminder channels: a
 * server composing a push knows nothing about this device's chosen tone, which
 * is the same reason `PUSH_CHANNEL_ID` is fixed.
 *
 * **These exist before anything sends to them.** Android drops a notification
 * naming a channel that does not exist, so the edge functions must keep using
 * `daykeep-general-v3` until a build carrying these has actually rolled out —
 * see the note in notify-group/notify-album. Creating them a release early is
 * what makes that switch safe rather than a coin toss on install base.
 */
const GROUPS_CHANNEL_ID = `daykeep-groups-v${CHANNEL_VERSION}`;
const ALBUMS_CHANNEL_ID = `daykeep-albums-v${CHANNEL_VERSION}`;

/** Every channel this app should own right now. Anything else of ours that
 *  Android is still holding is from an older version or an older tone. */
function currentChannelIds(soundId: NotificationSoundId): string[] {
  return [
    PUSH_CHANNEL_ID,
    GROUPS_CHANNEL_ID,
    ALBUMS_CHANNEL_ID,
    ...URGENCIES.map((urgency) => channelIdFor(urgency, soundId)),
  ];
}

function selectedSoundId(): NotificationSoundId {
  return notificationSound(useNotificationsStore.getState().soundId).id;
}

/** Maps a category to its channel: the digest to its own, time-critical
 * categories (bypassQuietHours) to the heads-up channel, everything else to the
 * default reminders channel. Untagged calls use the default channel. */
function channelForCategory(category?: NotificationCategory): string {
  const soundId = selectedSoundId();
  if (!category) return channelIdFor('reminders', soundId);
  if (category === 'digest') return channelIdFor('digest', soundId);
  return CATEGORY_META[category].bypassQuietHours
    ? channelIdFor('time-sensitive', soundId)
    : channelIdFor('reminders', soundId);
}

const ACCENT = '#6366f1';

/**
 * Deletes every `daykeep-` channel that is not one of `keep`.
 *
 * Covers both jobs at once — retiring a bumped version, and clearing away the
 * tone the user just switched off — because from Android's side they are the
 * same thing: an id we no longer post to. Enumerating beats a hardcoded list of
 * dead ids, which would have to grow by three entries for every tone ever
 * shipped and would silently miss any it forgot.
 *
 * Best-effort throughout: a channel that will not delete is clutter in system
 * settings, not a reason to leave the app without the channels it needs.
 */
async function pruneForeignChannels(keep: string[]): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  const existing = await Notifications.getNotificationChannelsAsync().catch(() => []);
  const kept = new Set(keep);
  await Promise.all(
    (existing ?? [])
      .filter((channel): channel is NonNullable<typeof channel> => !!channel)
      .filter((channel) => channel.id.startsWith('daykeep-') && !kept.has(channel.id))
      .map((channel) =>
        Notifications.deleteNotificationChannelAsync(channel.id).catch(() => undefined),
      ),
  );
}

async function createAndroidChannels(soundId: NotificationSoundId): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = getNotifications();
  if (!Notifications) return;

  // Every channel is HIGH so a reminder actually peeks over whatever is on
  // screen instead of landing silently in the shade. Android hands importance
  // to the user after creation, so anyone who finds a channel too loud can turn
  // that one down in system settings without losing the others.
  const shared = {
    importance: Notifications.AndroidImportance.HIGH,
    enableVibrate: true,
    enableLights: true,
    lightColor: ACCENT,
    showBadge: true,
    // Reminder text is the whole point of the notification — hiding it behind
    // "contents hidden" on the lock screen makes it useless.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  };
  // A bare filename, 'default', or null for a channel that posts silently.
  const sound = channelSoundFor(soundId);

  await Notifications.setNotificationChannelAsync(channelIdFor('time-sensitive', soundId), {
    ...shared,
    sound,
    name: 'Time-sensitive',
    description: 'Task due times, calendar events, bill due dates, bedtime.',
    vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync(channelIdFor('reminders', soundId), {
    ...shared,
    sound,
    name: 'Reminders & nudges',
    description: 'Habits, hydration, journal and goal reminders.',
  });
  await Notifications.setNotificationChannelAsync(channelIdFor('digest', soundId), {
    ...shared,
    sound,
    name: 'Daily digest',
    description: 'The one morning summary of what today holds.',
  });
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    ...shared,
    sound: 'default',
    name: 'Shared updates',
    description: 'Activity in expense groups and albums you share with others.',
  });
  await Notifications.setNotificationChannelAsync(GROUPS_CHANNEL_ID, {
    ...shared,
    sound: 'default',
    name: 'Expense groups',
    description: 'Expenses, settlements and members in groups you share.',
  });
  await Notifications.setNotificationChannelAsync(ALBUMS_CHANNEL_ID, {
    ...shared,
    sound: 'default',
    name: 'Shared albums',
    description: 'Messages and invitations in albums you share.',
  });

  await pruneForeignChannels(currentChannelIds(soundId));
}

let channelsReady: Promise<void> | null = null;
let channelsReadyFor: NotificationSoundId | null = null;

/** Creates the Android notification channels, once per process *per tone*.
 *
 * Returns the same promise on every call so the schedulers can `await` it
 * instead of racing it: a notification posted to a channel that doesn't exist
 * yet falls back to expo-notifications' own generic channel, which is how a
 * reminder ends up filed under "Miscellaneous" with settings we never chose.
 *
 * The cache is keyed on the selected tone rather than being a plain one-shot, so
 * changing the sound rebuilds the channels on the very next schedule instead of
 * needing the app to be restarted — the failure mode that would otherwise look
 * like the picker not working at all.
 *
 * Idempotent and safe on any platform (no-ops off Android / in Expo Go Android). */
export function configureAndroidChannels(): Promise<void> {
  const soundId = selectedSoundId();
  if (!channelsReady || channelsReadyFor !== soundId) {
    channelsReadyFor = soundId;
    // A rejection must not poison the cached promise forever — reset so the next
    // caller retries rather than every future schedule inheriting the failure.
    channelsReady = createAndroidChannels(soundId).catch((error) => {
      channelsReady = null;
      channelsReadyFor = null;
      throw error;
    });
  }
  return channelsReady;
}

/** Awaits channel setup without letting a failure block scheduling — a
 * reminder on the fallback channel still beats no reminder at all. */
async function channelsSettled(): Promise<void> {
  await configureAndroidChannels().catch(() => undefined);
}

export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return requested.granted;
}

export async function hasNotificationPermission(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  const existing = await Notifications.getPermissionsAsync();
  return existing.granted;
}

/**
 * What the OS is holding, cached for the length of a rebuild.
 *
 * `cancelScheduledByKey` has to read the queue before every keyed schedule, and
 * a rebuild schedules dozens in a row — hydration alone is fourteen. Asking the
 * native side each time turns one launch into ~40 round trips for an answer
 * that only this module changes.
 *
 * Kept truthful by mutation rather than invalidation: every schedule appends and
 * every cancel removes, so it stays warm across a whole resync. It is allowed to
 * drift in exactly one direction — a one-time notification that has since fired
 * leaves the OS queue but lingers here, and cancelling it is a no-op. The
 * reverse (something queued that this does not know about) is what would cause a
 * duplicate, and cannot happen while every keyed schedule goes through here.
 *
 * Dropped on foreground and before each rebuild anyway, so a long-lived process
 * cannot accumulate drift.
 */
/** `Partial`, because an untagged call (no `data`) queues an empty payload and
 *  only `key` and `category` are ever read back off it. */
type QueueEntry = { identifier: string; data: Partial<NotificationPayload> | undefined };

let queueCache: QueueEntry[] | null = null;

async function scheduledQueue(): Promise<QueueEntry[]> {
  if (queueCache) return queueCache;
  const Notifications = getNotifications();
  if (!Notifications) return [];
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  queueCache = (scheduled ?? []).map((request) => ({
    identifier: request.identifier,
    data: request.content.data as Partial<NotificationPayload> | undefined,
  }));
  return queueCache;
}

/** Forces the next queue read to come from the OS. Called on foreground and at
 *  the top of a rebuild — the two moments the app cannot vouch for the cache. */
export function invalidateScheduledQueueCache(): void {
  queueCache = null;
}

export async function cancelNotification(id: string | null | undefined): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications || !id) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  if (queueCache) queueCache = queueCache.filter((entry) => entry.identifier !== id);
  // Keep the inbox in lock-step with what's actually queued.
  deleteLogByNotificationId(id);
  releaseSlot();
}

export async function cancelNotifications(ids: (string | null | undefined)[]): Promise<void> {
  await Promise.all(ids.map((id) => cancelNotification(id)));
}

/**
 * One reminder can now need several OS notifications — a habit scheduled for
 * Mon/Wed/Fri is three weekly triggers, not one daily one. The owning row still
 * has a single TEXT column for the id, so several are packed into it as JSON.
 *
 * `unpack` accepts a bare id too, so rows written before this existed keep
 * working and get rewritten in the packed form on their next sync. Returning
 * null for an empty list keeps "no reminder" as NULL in the column rather than
 * as the string "[]".
 */
export function packNotificationIds(ids: (string | null | undefined)[]): string | null {
  const present = ids.filter((id): id is string => !!id);
  return present.length === 0 ? null : JSON.stringify(present);
}

export function unpackNotificationIds(value: string | null | undefined): string[] {
  if (!value) return [];
  if (!value.startsWith('[')) return [value];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function cancelPackedNotifications(value: string | null | undefined): Promise<void> {
  await cancelNotifications(unpackNotificationIds(value));
}

/** Guard shared by both schedulers. Skips scheduling when the master switch or
 * the notification's category is off, AND — in "smart digest" delivery mode —
 * when the category is a non-time-critical nudge that gets folded into the
 * morning digest instead of pinging on its own. Time-critical categories
 * (bypassQuietHours: due tasks, calendar events, money, bedtime) always fire.
 * The digest itself is exempt. Untagged calls (no payload) always pass. */
function passesCategoryGate(payload?: NotificationPayload): boolean {
  const category = payload?.category;
  if (!category) return true;
  if (!isCategoryEnabled(category)) return false;

  const { deliveryMode } = useNotificationsStore.getState();
  if (
    deliveryMode === 'digest' &&
    category !== 'digest' &&
    !CATEGORY_META[category].bypassQuietHours
  ) {
    return false;
  }
  return true;
}

/**
 * Second gate, on top of the category switches: what the *module* behind this
 * reminder currently allows to be said.
 *
 * Returns the text to schedule, or null to schedule nothing. Kept separate from
 * `passesCategoryGate` because it can do something that gate cannot — let the
 * reminder through with different words. See notification-visibility.ts for why
 * a privatised module is redacted rather than silenced.
 */
function resolveContent(params: {
  title: string;
  body: string;
  data?: NotificationPayload;
}): { title: string; body: string } | null {
  return resolveNotificationContent(params.data?.category, {
    title: params.title,
    body: params.body,
  });
}

/**
 * Makes a schedule idempotent for its key: one at a time, and replacing rather
 * than joining whatever is already queued under that key.
 *
 * This is the whole keyed-scheduling contract in five lines, and it is opt-in —
 * a call with no key gets exactly the behaviour it always had. That is what
 * lets the modules migrate one at a time instead of in a single commit that
 * touches every reminder in the app.
 *
 * Note the ordering: the cancel happens *inside* the lock, so a second caller
 * cannot read the queue between the first one's cancel and its schedule. That
 * gap is precisely where duplicates were born.
 */
function withKey<T>(key: string | undefined, work: () => Promise<T>): Promise<T> {
  if (!key) return work();
  return serializeOnKey(key, async () => {
    await cancelScheduledByKey(key);
    return work();
  });
}

function nextDailyOccurrence(hour: number, minute: number): number {
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** One-time reminder at an exact future timestamp — task due dates, note
 * reminders, calendar events. Returns null (schedules nothing) if the time
 * has already passed, the category is switched off, or permission was denied,
 * rather than throwing. */
export function scheduleOneTimeNotification(params: {
  title: string;
  body: string;
  date: number;
  data?: NotificationPayload;
}): Promise<string | null> {
  return withKey(params.data?.key, () => scheduleOneTime(params));
}

async function scheduleOneTime(params: {
  title: string;
  body: string;
  date: number;
  data?: NotificationPayload;
}): Promise<string | null> {
  const Notifications = getNotifications();
  if (!Notifications) return null;
  if (!passesCategoryGate(params.data)) return null;
  const content = resolveContent(params);
  if (!content) return null;

  const category = params.data?.category;
  let triggerAt = params.date;
  if (category && !CATEGORY_META[category].bypassQuietHours) {
    triggerAt = shiftTimestampOutOfQuietHours(triggerAt);
  }
  if (triggerAt <= Date.now()) return null;
  // Past the platform ceiling the OS accepts the call and silently discards
  // something — see scheduling-budget.ts. Declining is the honest outcome: it
  // leaves a null id the next resync retries, instead of a reminder the app
  // believes in and the platform has already thrown away.
  if (!hasHeadroom(SCHEDULING_BUDGET)) return null;

  const granted = await requestNotificationPermission();
  if (!granted) return null;
  await channelsSettled();

  // Generate the inbox row id up front so it can ride inside the payload — a
  // tap then marks exactly this row read. The row is written after scheduling
  // succeeds, once the OS notification id is known.
  const logId = params.data?.category ? generateId() : undefined;
  const data = params.data ? { ...params.data, ...(logId ? { logId } : {}) } : {};

  const scheduleId = await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data,
      sound: contentSoundFor(selectedSoundId()),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerAt,
      channelId: channelForCategory(category),
    },
  });
  spendSlot();
  if (queueCache) queueCache.push({ identifier: scheduleId, data });

  if (params.data?.category) {
    logScheduledNotification({
      id: logId,
      notificationId: scheduleId,
      // The inbox gets the same redaction. It is readable without unlocking
      // the vault, so logging the real text there would hand back exactly what
      // was just withheld from the lock screen.
      category: params.data.category,
      title: content.title,
      body: content.body,
      route: params.data.route,
      params: params.data.params,
      scheduledAt: triggerAt,
      repeats: 'none',
    });
  }
  return scheduleId;
}

/**
 * The end of a timer the user is running right now.
 *
 * Deliberately outside the reminder taxonomy, because it is an alarm rather
 * than a reminder and every part of that policy is wrong for it:
 *
 *  - **Quiet hours.** A reminder that lands at 22:30 is shifted to the morning,
 *    which is right for a hydration nudge and absurd for a pomodoro — the block
 *    ends when it ends, and an alert eight hours later is not a late alert, it
 *    is a wrong one.
 *  - **The category switch.** Turning off Study reminders means "stop nudging
 *    me about studying". It does not mean "start a 25-minute timer and then say
 *    nothing", which is a broken feature rather than a respected preference.
 *    The timer's own controls are where somebody turns the timer off.
 *  - **The inbox.** "Your break has started" is worthless ten minutes later;
 *    logging it would fill the inbox with rows nobody can act on.
 *
 * It keeps the two things that are right: the keyed-scheduling contract, so a
 * restart or a second call cannot leave two alarms queued, and the
 * time-sensitive channel, so it actually peeks instead of landing silently in
 * the shade.
 *
 * `timerAlert` in the payload is what lets it through the focus shield — see
 * `configureNotificationHandler`, which swallows everything else while a block
 * is running and would otherwise swallow the very alert that says the block is
 * over.
 */
export function scheduleTimerAlert(params: {
  title: string;
  body: string;
  date: number;
  /** Stable identity, so scheduling twice replaces rather than duplicates. */
  key: string;
  /** Deep link for a tap — the screen the timer is running on. */
  route?: string;
}): Promise<string | null> {
  return withKey(params.key, () => scheduleTimer(params));
}

async function scheduleTimer(params: {
  title: string;
  body: string;
  date: number;
  key: string;
  route?: string;
}): Promise<string | null> {
  const Notifications = getNotifications();
  if (!Notifications) return null;
  if (params.date <= Date.now()) return null;
  if (!hasHeadroom(SCHEDULING_BUDGET)) return null;

  const granted = await requestNotificationPermission();
  if (!granted) return null;
  await channelsSettled();

  const data = { key: params.key, route: params.route, timerAlert: true };
  const scheduleId = await Notifications.scheduleNotificationAsync({
    content: {
      title: params.title,
      body: params.body,
      data,
      sound: contentSoundFor(selectedSoundId()),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: params.date,
      channelId: channelIdFor('time-sensitive', selectedSoundId()),
    },
  });
  spendSlot();
  if (queueCache) queueCache.push({ identifier: scheduleId, data });
  return scheduleId;
}

/** Daily-repeating reminder at a fixed hour/minute — habits, hydration, the
 * journal nudge, bedtime. Shifts out of quiet hours unless the category is
 * exempt. */
export function scheduleDailyNotification(params: {
  title: string;
  body: string;
  hour: number;
  minute: number;
  data?: NotificationPayload;
}): Promise<string | null> {
  return withKey(params.data?.key, () => scheduleDaily(params));
}

async function scheduleDaily(params: {
  title: string;
  body: string;
  hour: number;
  minute: number;
  data?: NotificationPayload;
}): Promise<string | null> {
  const Notifications = getNotifications();
  if (!Notifications) return null;
  if (!passesCategoryGate(params.data)) return null;
  const content = resolveContent(params);
  if (!content) return null;

  const category = params.data?.category;
  let { hour, minute } = params;
  if (category && !CATEGORY_META[category].bypassQuietHours) {
    ({ hour, minute } = shiftDailyOutOfQuietHours(hour, minute));
  }
  if (!hasHeadroom(SCHEDULING_BUDGET)) return null;

  const granted = await requestNotificationPermission();
  if (!granted) return null;
  await channelsSettled();

  const scheduledAt = nextDailyOccurrence(hour, minute);
  const logId = params.data?.category ? generateId() : undefined;
  const data = params.data ? { ...params.data, ...(logId ? { logId } : {}) } : {};

  const scheduleId = await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data,
      sound: contentSoundFor(selectedSoundId()),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: channelForCategory(category),
    },
  });
  spendSlot();
  if (queueCache) queueCache.push({ identifier: scheduleId, data });

  if (params.data?.category) {
    logScheduledNotification({
      id: logId,
      notificationId: scheduleId,
      category: params.data.category,
      title: content.title,
      body: content.body,
      route: params.data.route,
      params: params.data.params,
      scheduledAt,
      repeats: 'daily',
    });
  }
  return scheduleId;
}

/**
 * Weekly-repeating reminder on one weekday.
 *
 * Exists because a habit scheduled for Mon/Wed/Fri was being given a DAILY
 * trigger — it nagged every day of the week, including the four it wasn't due.
 * expo-notifications' weekday is 1-based with Sunday = 1, while the app stores
 * `scheduleDays` 0-based with Sunday = 0 (see habit-streaks.isDueOn), so the
 * conversion happens here, once, rather than at each call site.
 */
export function scheduleWeeklyNotification(params: {
  title: string;
  body: string;
  /** 0 = Sunday, matching Habit.scheduleDays and Date#getDay. */
  weekday: number;
  hour: number;
  minute: number;
  data?: NotificationPayload;
}): Promise<string | null> {
  return withKey(params.data?.key, () => scheduleWeekly(params));
}

async function scheduleWeekly(params: {
  title: string;
  body: string;
  weekday: number;
  hour: number;
  minute: number;
  data?: NotificationPayload;
}): Promise<string | null> {
  const Notifications = getNotifications();
  if (!Notifications) return null;
  if (!passesCategoryGate(params.data)) return null;
  const content = resolveContent(params);
  if (!content) return null;

  const category = params.data?.category;
  let { hour, minute } = params;
  if (category && !CATEGORY_META[category].bypassQuietHours) {
    ({ hour, minute } = shiftDailyOutOfQuietHours(hour, minute));
  }

  if (!hasHeadroom(SCHEDULING_BUDGET)) return null;

  const granted = await requestNotificationPermission();
  if (!granted) return null;
  await channelsSettled();

  const logId = params.data?.category ? generateId() : undefined;
  const data = params.data ? { ...params.data, ...(logId ? { logId } : {}) } : {};

  const scheduleId = await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data,
      sound: contentSoundFor(selectedSoundId()),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: ((params.weekday % 7) + 7) % 7 === 0 ? 1 : (((params.weekday % 7) + 7) % 7) + 1,
      hour,
      minute,
      channelId: channelForCategory(category),
    },
  });
  spendSlot();
  if (queueCache) queueCache.push({ identifier: scheduleId, data });

  if (params.data?.category) {
    logScheduledNotification({
      id: logId,
      notificationId: scheduleId,
      category: params.data.category,
      title: content.title,
      body: content.body,
      route: params.data.route,
      params: params.data.params,
      scheduledAt: nextWeeklyOccurrence(params.weekday, hour, minute),
      repeats: 'weekly',
    });
  }
  return scheduleId;
}

function nextWeeklyOccurrence(weekday: number, hour: number, minute: number): number {
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  const target = ((weekday % 7) + 7) % 7;
  let delta = (target - next.getDay() + 7) % 7;
  if (delta === 0 && next.getTime() <= Date.now()) delta = 7;
  next.setDate(next.getDate() + delta);
  return next.getTime();
}

/** How many Daykeep notifications the OS currently holds. */
export async function getScheduledCount(): Promise<number> {
  const Notifications = getNotifications();
  if (!Notifications) return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  return scheduled.length;
}

/**
 * How many pending notifications the platform will actually keep.
 *
 * iOS holds **64** and silently discards everything beyond it — no error, no
 * callback, and the app does not get to choose which ones survive. That ceiling
 * is easy to hit here without noticing: water reminders every 30 minutes from
 * 08:00 to 21:00 are 27 on their own, and a habit with a Mon/Wed/Fri schedule
 * is 3 more. Android has no equivalent limit.
 */
export const SCHEDULING_BUDGET = Platform.OS === 'ios' ? 60 : Number.POSITIVE_INFINITY;

/** Cancels every Daykeep-scheduled notification and clears their inbox rows —
 * the true kill switch behind the master toggle, so turning notifications off
 * silences already-queued reminders too, not just future scheduling. No-ops in
 * Expo Go Android. */
export async function cancelAllScheduled(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  // Straight from the OS, not the cache: this is the app's "forget everything
  // and start again" path, so trusting a cache it may have drifted from is
  // exactly the wrong move. The cache is rebuilt empty afterwards, which is
  // true by construction and saves the next keyed schedule a round trip.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.map((n) => cancelNotification(n.identifier)));
  queueCache = [];
}

/** Subscribes to notification taps. Returns an unsubscribe fn (or a no-op in
 * Expo Go Android). The handler receives the {@link NotificationPayload}. */
export function addNotificationResponseListener(
  handler: (payload: NotificationPayload) => void,
): () => void {
  const Notifications = getNotifications();
  if (!Notifications) return () => undefined;
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    handler((response.notification.request.content.data ?? {}) as NotificationPayload);
  });
  return () => sub.remove();
}

/**
 * Subscribes to notifications ARRIVING (as distinct from being tapped).
 *
 * Nothing listened for this before, which is why the in-app notification
 * centre could not see most of what the app sent: repeating reminders never
 * crossed into "delivered", and shared-group pushes — which this device never
 * scheduled — had no row at all. Returns an unsubscribe fn.
 */
export function addNotificationReceivedListener(
  handler: (received: ReceivedNotification) => void,
): () => void {
  const Notifications = getNotifications();
  if (!Notifications) return () => undefined;
  const sub = Notifications.addNotificationReceivedListener((notification) => {
    const content = notification.request.content;
    handler({
      title: content.title ?? '',
      body: content.body ?? '',
      payload: (content.data ?? {}) as NotificationPayload,
      notificationId: notification.request.identifier,
      // Cast because the trigger union includes shapes with no `type` at all
      // (ChannelAwareTriggerInput), and a narrow on the union would have to
      // enumerate every member to ask one question of it.
      remote: (notification.request.trigger as { type?: string } | null)?.type === 'push',
    });
  });
  return () => sub.remove();
}

export type ReceivedNotification = {
  title: string;
  body: string;
  payload: NotificationPayload;
  notificationId: string | null;
  /**
   * True when this came from the server rather than from this device's own
   * queue.
   *
   * Load-bearing, not informational. A keyed push means "this supersedes the
   * local reminder under that key", and acting on it means cancelling that
   * reminder — but a *local* repeating reminder arrives through this same
   * listener carrying the same key, and cancelling on that would delete the
   * daily habit reminder the moment it first fired. The trigger type is the
   * only thing that tells the two apart.
   */
  remote: boolean;
};

/** Cancels every OS-queued notification belonging to a category (matched via
 * its data payload) and clears their inbox rows. Used when a category is
 * switched off, or when switching to digest delivery folds a nudge category
 * into the morning summary, so already-queued reminders stop firing without
 * waiting for each owning item to re-sync. No-ops in Expo Go Android. */
export async function cancelScheduledInCategory(category: NotificationCategory): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  const matches = (await scheduledQueue()).filter((entry) => entry.data?.category === category);
  await Promise.all(matches.map((entry) => cancelNotification(entry.identifier)));
}

/**
 * One in-flight operation per key.
 *
 * Scheduling a keyed reminder is cancel-then-schedule with several `await`
 * points in it, and the sync functions that do it are almost all called
 * fire-and-forget — from a store subscription, a save handler, a launch
 * rebuild. Two of them overlapping for the same key both find nothing to
 * cancel and both schedule, which is the duplicate this whole mechanism exists
 * to prevent; the key alone does not stop it, because the read and the write
 * are not atomic without a lock.
 *
 * Per key rather than global, so a slow habit rebuild does not hold up an
 * unrelated task reminder. A promise chain rather than a rejected second
 * caller: the later caller holds the newer state, so it waits its turn.
 *
 * The map entry is deleted once its tail settles with nothing behind it, so
 * long-lived processes do not accumulate one entry per task ever scheduled.
 */
const keyLocks = new Map<string, Promise<void>>();

function serializeOnKey<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  keyLocks.set(key, tail);
  void tail.then(() => {
    if (keyLocks.get(key) === tail) keyLocks.delete(key);
  });
  return run;
}

/**
 * Cancels every OS-queued notification whose key starts with `prefix`, and
 * clears their inbox rows. Returns how many were cancelled.
 *
 * For the schedules that are a *set* rather than one notification — hydration's
 * fourteen daily slots, a habit's weekday triggers, the goal deadlines. Each
 * member needs its own key or rescheduling the set would cancel its own
 * siblings, but that leaves nothing to reap a member the new set no longer
 * contains: drop hydration from hourly to every three hours and the ten slots
 * that went away have keys nothing will ever mention again.
 *
 * Cancelling the whole prefix before rebuilding the set makes the rebuild
 * wholesale, which is what these modules already intend — and unlike the packed
 * id columns they use today, it self-heals from a queue the app has lost track
 * of.
 */
export async function cancelScheduledByKeyPrefix(prefix: string): Promise<number> {
  const Notifications = getNotifications();
  if (!Notifications) return 0;
  const matches = (await scheduledQueue()).filter((entry) => entry.data?.key?.startsWith(prefix));
  await Promise.all(matches.map((entry) => cancelNotification(entry.identifier)));
  return matches.length;
}

/**
 * Cancels every OS-queued notification carrying `key`, and clears their inbox
 * rows. Returns how many were cancelled.
 *
 * The durable alternative to remembering an id. A caller that cancels by key
 * before scheduling cannot leave a duplicate behind, because it is not relying
 * on a variable that a process restart empties or a concurrent call overwrites
 * — it is asking the OS what is actually queued. See
 * `NotificationPayload['key']` for the full argument.
 *
 * Returning a count rather than void so a caller can tell "there was nothing"
 * from "there were four", which is the difference between a healthy queue and
 * one carrying orphans from an older build.
 */
export async function cancelScheduledByKey(key: string): Promise<number> {
  const Notifications = getNotifications();
  if (!Notifications) return 0;
  const matches = (await scheduledQueue()).filter((entry) => entry.data?.key === key);
  await Promise.all(matches.map((entry) => cancelNotification(entry.identifier)));
  return matches.length;
}

/**
 * Cancels every notification that shares a key with an earlier one, keeping one
 * of each. Returns how many it removed.
 *
 * The backstop under the whole mechanism. Cancel-by-key stops a *scheduler*
 * producing duplicates, but it only runs when something schedules — so a key
 * nothing touches this session (a habit the user has not edited, a device
 * carrying orphans from a build that predates keys) keeps whatever it has. This
 * runs on launch and on every foreground and settles it regardless.
 *
 * Which copy survives does not matter: entries sharing a key are the same
 * reminder by construction, and any that were not identical are about to be
 * replaced by their own scheduler anyway. Keeping the first avoids reading
 * trigger shapes, which differ per platform and per trigger type.
 */
export async function sweepDuplicateKeys(): Promise<number> {
  const Notifications = getNotifications();
  if (!Notifications) return 0;
  const seen = new Set<string>();
  const doomed: string[] = [];
  for (const entry of await scheduledQueue()) {
    const key = entry.data?.key;
    if (!key) continue;
    if (seen.has(key)) doomed.push(entry.identifier);
    else seen.add(key);
  }
  await Promise.all(doomed.map((id) => cancelNotification(id)));
  return doomed.length;
}

/** Posts a notification right now, bypassing the category gate, quiet hours and
 * the inbox log. Backs the "Send a test notification" button in Notification
 * Settings: when reminders aren't arriving, this separates "Daykeep never
 * scheduled it" from "Android is refusing to show it", which are otherwise
 * indistinguishable from the user's side.
 *
 * Scheduled ~2s out rather than presented immediately so it can be tested from
 * the background: the foreground handler is what decides whether an immediate
 * notification is drawn at all, and that's exactly the layer under suspicion. */
export async function sendTestNotification(params: {
  title: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; reason: 'unavailable' | 'denied' | 'error' }> {
  const Notifications = getNotifications();
  if (!Notifications) return { ok: false, reason: 'unavailable' };

  const granted = await requestNotificationPermission();
  if (!granted) return { ok: false, reason: 'denied' };
  await channelsSettled();

  try {
    // On the REMINDERS channel, not the time-sensitive one. Almost every real
    // reminder — habits, hydration, journal, notes, goals — goes to this
    // channel, and Android hands channel importance to the user (and to OEM
    // battery managers) the moment it exists. Testing the other channel meant a
    // passing test could sit alongside reminders that never appear, which
    // inverts the entire point of the button.
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        sound: contentSoundFor(selectedSoundId()),
        data: {},
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2,
        repeats: false,
        channelId: channelIdFor('reminders', selectedSoundId()),
      },
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** One notification summarising everything held back during a focus block, so
 * a suppressed reminder still surfaces the moment focus ends. Untagged (no
 * category) on purpose: it is a system message about the reminders, not a
 * reminder itself, so it must not be gated by, or logged as, any category. */
export async function announceHeldReminders(params: {
  title: string;
  body: string;
}): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  if (!(await hasNotificationPermission())) return;
  await channelsSettled();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: params.title,
      body: params.body,
      sound: contentSoundFor(selectedSoundId()),
      data: {},
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      repeats: false,
      channelId: channelIdFor('reminders', selectedSoundId()),
    },
  }).catch(() => undefined);
}

/**
 * Whether this device has an "Alarms & reminders" grant that affects when timed
 * reminders fire. Android 12 (API 31) introduced it; earlier versions always
 * allow exact alarms, and iOS has no equivalent.
 *
 * Background: expo-notifications calls `canScheduleExactAlarms()` and, when the
 * grant is missing, quietly falls back to an inexact alarm. Nothing fails and
 * nothing is logged — the reminder simply arrives whenever Doze next lets it
 * through, which can be a quarter of an hour after the time the user set. For a
 * "water at 3pm" nudge that's fine; for a task due-time it isn't.
 *
 * Apps targeting Android 14+ (which Expo SDK 54 does) start with this DENIED, so
 * it must be granted by hand — hence the shortcut below.
 */
export const exactAlarmSettingsAvailable =
  Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 31;

/**
 * Opens Android's "Alarms & reminders" special-access screen.
 *
 * There is deliberately no companion `canScheduleExactAlarms()` reader: expo-
 * notifications keeps that check on the native side and exposes nothing to JS,
 * so the app cannot honestly report whether the grant is currently on. The UI
 * therefore offers the route rather than claiming to know the state.
 *
 * Returns false if no settings screen could be opened, so the caller can say so
 * instead of appearing to do nothing.
 */
export async function openExactAlarmSettings(): Promise<boolean> {
  if (!exactAlarmSettingsAvailable) return false;
  try {
    // Sent without `package:` data (Linking.sendIntent cannot attach a data URI),
    // so this lands on the full app list rather than Daykeep's own toggle. The
    // fallback is the app's settings page, from which most OEM skins also reach
    // "Alarms & reminders".
    await Linking.sendIntent('android.settings.REQUEST_SCHEDULE_EXACT_ALARM');
    return true;
  } catch {
    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  }
}

export type NotificationDiagnostics = {
  /** False in Expo Go on Android, where the module can't be loaded at all. */
  available: boolean;
  permissionGranted: boolean;
  /** True once permission has been asked for and refused — the state that needs
   * a trip to system settings rather than another in-app prompt. */
  permissionBlocked: boolean;
  /** How many Daykeep notifications are queued with the OS right now. The number
   * users actually need: reminders can look configured in-app while nothing is
   * queued, which is the signature of a scheduling gate silently dropping them. */
  scheduledCount: number;
  /** Android channel importances, keyed by id — a channel the user (or an OEM
   * battery optimiser) turned down shows up here as importance 0-2. */
  channels: { id: string; name: string; importance: number }[];
};

/** Reads the real OS-level notification state. Everything here is queried from
 * the system rather than from app state, because the whole point is to catch
 * the cases where the two disagree. */
export async function getNotificationDiagnostics(): Promise<NotificationDiagnostics> {
  const Notifications = getNotifications();
  if (!Notifications) {
    return {
      available: false,
      permissionGranted: false,
      permissionBlocked: false,
      scheduledCount: 0,
      channels: [],
    };
  }

  const permissions = await Notifications.getPermissionsAsync().catch(() => null);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);

  let channels: NotificationDiagnostics['channels'] = [];
  if (Platform.OS === 'android') {
    const raw = await Notifications.getNotificationChannelsAsync().catch(() => []);
    channels = (raw ?? [])
      .filter((channel): channel is NonNullable<typeof channel> => !!channel)
      .filter((channel) => channel.id.startsWith('daykeep-'))
      .map((channel) => ({
        id: channel.id,
        name: channel.name ?? channel.id,
        importance: channel.importance as unknown as number,
      }));
  }

  return {
    available: true,
    permissionGranted: permissions?.granted ?? false,
    permissionBlocked: permissions ? !permissions.granted && !permissions.canAskAgain : false,
    scheduledCount: scheduled.length,
    channels,
  };
}

/** The tap that cold-started the app, if any — checked once on mount so a
 * notification opened from a killed state still deep-links. */
export async function getLastNotificationResponse(): Promise<NotificationPayload | null> {
  const Notifications = getNotifications();
  if (!Notifications) return null;
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return null;
  return (response.notification.request.content.data ?? {}) as NotificationPayload;
}
