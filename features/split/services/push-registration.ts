import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { notificationsAvailable } from '@/lib/notifications';

/**
 * Expo push-token registration.
 *
 * Only shared features need this: every other reminder in Daykeep is scheduled
 * locally on the device that owns it, and needs no server round-trip. A split
 * group is the first thing where somebody ELSE's action has to reach you, which
 * is the only reason a token has to leave the device at all.
 */

/** Cheap guard so re-registering on every foreground is a no-op. */
let lastRegistered: string | null = null;

/**
 * Fetches this device's Expo push token and stores it against the signed-in
 * user. Safe to call repeatedly; resolves null when push isn't possible
 * (simulator, permission refused, Expo Go on Android, no session).
 */
export async function registerPushToken(): Promise<string | null> {
  // Push needs real hardware — a simulator has no APNs/FCM registration.
  if (!notificationsAvailable || !Device.isDevice) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return null;

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted === true;
  if (!granted) return null;

  let token: string;
  try {
    // projectId comes from app config; without it this throws in bare/EAS builds.
    const result = await Notifications.getExpoPushTokenAsync();
    token = result.data;
  } catch {
    return null;
  }

  if (token === lastRegistered) return token;

  // Goes through an RPC, not a plain upsert: `push_tokens_own` evaluates its
  // USING clause against the EXISTING row on conflict, so a direct upsert is
  // refused the moment a device is handed to a different account — verified
  // against real Postgres in scripts/test-migrations.mjs.
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    p_now: Date.now(),
  });
  if (error) return null;

  lastRegistered = token;
  return token;
}

/** Drops this device's token — call on sign-out so a shared phone stops
 *  receiving a previous account's group notifications. */
export async function unregisterPushToken(): Promise<void> {
  if (!lastRegistered) return;
  await supabase.rpc('release_push_token', { p_token: lastRegistered });
  lastRegistered = null;
}

/**
 * Tells the other members of a group that something happened.
 *
 * Deliberately never throws: the write this accompanies has already succeeded,
 * and a bounced notification must not make the caller think the expense failed.
 */
export async function notifyGroup(input: {
  groupId: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    await supabase.functions.invoke('notify-group', { body: input });
  } catch {
    // Non-fatal by design.
  }
}
