import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Linking, Platform } from 'react-native';

import {
  deleteLogByNotificationId,
  logScheduledNotification,
} from '@/features/notifications/services/notification-log-repository';
import { resolveNotificationContent } from '@/features/notifications/services/notification-visibility';
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
      // A study focus block must not be interrupted. The reminder is swallowed
      // rather than shown — it is already a row in the in-app inbox, and
      // features/study/services/focus-mode.ts re-announces everything held here
      // as one summary the moment the block ends, so nothing is lost.
      if (isFocusModeActive()) {
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
 * IMPORTANT — the `-v2` suffix is load-bearing. `createNotificationChannel` is
 * only a create: on a channel that already exists Android updates the name and
 * description and *silently discards* importance, sound, vibration and lights,
 * because those become user-owned settings the moment the channel appears. The
 * only way to ship a corrected importance is under a new channel id. The v1
 * channels below were created at IMPORTANCE_DEFAULT, which posts to the shade
 * with a sound but never peeks — reminders made their noise and appeared to not
 * show up at all. Bump the version (and add the old ids to LEGACY_CHANNEL_IDS)
 * whenever a channel's importance or sound has to change again. */
const CHANNEL_VERSION = 2;
const CHANNELS = {
  timeSensitive: `lifeos-time-sensitive-v${CHANNEL_VERSION}`,
  reminders: `lifeos-reminders-v${CHANNEL_VERSION}`,
  digest: `lifeos-digest-v${CHANNEL_VERSION}`,
} as const;

/** Channel ids from previous versions, deleted on launch so the app's entry in
 * Android's notification settings doesn't accumulate dead duplicates. */
const LEGACY_CHANNEL_IDS = ['lifeos-time-sensitive', 'lifeos-reminders', 'lifeos-digest'];

/** Maps a category to its channel: the digest to its own, time-critical
 * categories (bypassQuietHours) to the heads-up channel, everything else to the
 * default reminders channel. Untagged calls use the default channel. */
function channelForCategory(category?: NotificationCategory): string {
  if (!category) return CHANNELS.reminders;
  if (category === 'digest') return CHANNELS.digest;
  return CATEGORY_META[category].bypassQuietHours ? CHANNELS.timeSensitive : CHANNELS.reminders;
}

const ACCENT = '#6366f1';

async function createAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = getNotifications();
  if (!Notifications) return;

  // Every channel is HIGH so a reminder actually peeks over whatever is on
  // screen instead of landing silently in the shade. Android hands importance
  // to the user after creation, so anyone who finds a channel too loud can turn
  // that one down in system settings without losing the others.
  const shared = {
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default' as const,
    enableVibrate: true,
    enableLights: true,
    lightColor: ACCENT,
    showBadge: true,
    // Reminder text is the whole point of the notification — hiding it behind
    // "contents hidden" on the lock screen makes it useless.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  };

  await Notifications.setNotificationChannelAsync(CHANNELS.timeSensitive, {
    ...shared,
    name: 'Time-sensitive',
    description: 'Task due times, calendar events, bill due dates, bedtime.',
    vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.reminders, {
    ...shared,
    name: 'Reminders & nudges',
    description: 'Habits, hydration, journal and goal reminders.',
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.digest, {
    ...shared,
    name: 'Daily digest',
    description: 'The one morning summary of what today holds.',
  });

  // Best-effort tidy-up of superseded channel ids.
  await Promise.all(
    LEGACY_CHANNEL_IDS.map((id) =>
      Notifications.deleteNotificationChannelAsync(id).catch(() => undefined),
    ),
  );
}

let channelsReady: Promise<void> | null = null;

/** Creates the Android notification channels, once per process.
 *
 * Returns the same promise on every call so the schedulers can `await` it
 * instead of racing it: a notification posted to a channel that doesn't exist
 * yet falls back to expo-notifications' own generic channel, which is how a
 * reminder ends up filed under "Miscellaneous" with settings we never chose.
 *
 * Idempotent and safe on any platform (no-ops off Android / in Expo Go Android). */
export function configureAndroidChannels(): Promise<void> {
  if (!channelsReady) {
    // A rejection must not poison the cached promise forever — reset so the next
    // caller retries rather than every future schedule inheriting the failure.
    channelsReady = createAndroidChannels().catch((error) => {
      channelsReady = null;
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

export async function cancelNotification(id: string | null | undefined): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications || !id) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  // Keep the inbox in lock-step with what's actually queued.
  deleteLogByNotificationId(id);
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
export async function scheduleOneTimeNotification(params: {
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

  const granted = await requestNotificationPermission();
  if (!granted) return null;
  await channelsSettled();

  // Generate the inbox row id up front so it can ride inside the payload — a
  // tap then marks exactly this row read. The row is written after scheduling
  // succeeds, once the OS notification id is known.
  const logId = params.data?.category ? generateId() : undefined;
  const data = params.data ? { ...params.data, ...(logId ? { logId } : {}) } : {};

  const scheduleId = await Notifications.scheduleNotificationAsync({
    content: { title: content.title, body: content.body, data, sound: 'default' },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerAt,
      channelId: channelForCategory(category),
    },
  });

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

/** Daily-repeating reminder at a fixed hour/minute — habits, hydration, the
 * journal nudge, bedtime. Shifts out of quiet hours unless the category is
 * exempt. */
export async function scheduleDailyNotification(params: {
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

  const granted = await requestNotificationPermission();
  if (!granted) return null;
  await channelsSettled();

  const scheduledAt = nextDailyOccurrence(hour, minute);
  const logId = params.data?.category ? generateId() : undefined;
  const data = params.data ? { ...params.data, ...(logId ? { logId } : {}) } : {};

  const scheduleId = await Notifications.scheduleNotificationAsync({
    content: { title: content.title, body: content.body, data, sound: 'default' },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: channelForCategory(category),
    },
  });

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
export async function scheduleWeeklyNotification(params: {
  title: string;
  body: string;
  /** 0 = Sunday, matching Habit.scheduleDays and Date#getDay. */
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

  const granted = await requestNotificationPermission();
  if (!granted) return null;
  await channelsSettled();

  const logId = params.data?.category ? generateId() : undefined;
  const data = params.data ? { ...params.data, ...(logId ? { logId } : {}) } : {};

  const scheduleId = await Notifications.scheduleNotificationAsync({
    content: { title: content.title, body: content.body, data, sound: 'default' },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: ((params.weekday % 7) + 7) % 7 === 0 ? 1 : (((params.weekday % 7) + 7) % 7) + 1,
      hour,
      minute,
      channelId: channelForCategory(category),
    },
  });

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

/** How many LifeOS notifications the OS currently holds. */
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

/** Cancels every LifeOS-scheduled notification and clears their inbox rows —
 * the true kill switch behind the master toggle, so turning notifications off
 * silences already-queued reminders too, not just future scheduling. No-ops in
 * Expo Go Android. */
export async function cancelAllScheduled(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.map((n) => cancelNotification(n.identifier)));
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
    });
  });
  return () => sub.remove();
}

export type ReceivedNotification = {
  title: string;
  body: string;
  payload: NotificationPayload;
  notificationId: string | null;
};

/** Cancels every OS-queued notification belonging to a category (matched via
 * its data payload) and clears their inbox rows. Used when a category is
 * switched off, or when switching to digest delivery folds a nudge category
 * into the morning summary, so already-queued reminders stop firing without
 * waiting for each owning item to re-sync. No-ops in Expo Go Android. */
export async function cancelScheduledInCategory(category: NotificationCategory): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as NotificationPayload | undefined)?.category === category)
      .map((n) => cancelNotification(n.identifier)),
  );
}

/** Posts a notification right now, bypassing the category gate, quiet hours and
 * the inbox log. Backs the "Send a test notification" button in Notification
 * Settings: when reminders aren't arriving, this separates "LifeOS never
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
      content: { title: params.title, body: params.body, sound: 'default', data: {} },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2,
        repeats: false,
        channelId: CHANNELS.reminders,
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
    content: { title: params.title, body: params.body, sound: 'default', data: {} },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      repeats: false,
      channelId: CHANNELS.reminders,
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
    // so this lands on the full app list rather than LifeOS's own toggle. The
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
  /** How many LifeOS notifications are queued with the OS right now. The number
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
      .filter((channel) => channel.id.startsWith('lifeos-'))
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
