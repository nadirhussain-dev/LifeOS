import AsyncStorage from '@react-native-async-storage/async-storage';
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
 * is the only reason a token has to leave the device at all. Shared albums use
 * it too now, which is why this reads more general than its folder suggests.
 */

/**
 * The last token this device successfully registered.
 *
 * Persisted rather than held in a module variable, and the reason is the same
 * one that produced four identical streak notifications: module state is empty
 * after every process start, so the "cheap guard" it backed guarded nothing
 * across launches. Every cold start re-sent an RPC that had already been sent.
 *
 * It matters more on the way out. `unregisterPushToken` returned early when the
 * variable was null, which is its state on every fresh process — so signing out
 * of an account you had not signed into *in that same session* left the token
 * attached to it, and the next person to use the phone kept receiving that
 * account's group and album notifications. On a shared device that is a real
 * disclosure, not a tidiness problem.
 */
const LAST_TOKEN_KEY = 'daykeep.push.lastToken';

async function readLastToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function writeLastToken(token: string | null): Promise<void> {
  try {
    if (token === null) await AsyncStorage.removeItem(LAST_TOKEN_KEY);
    else await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
  } catch {
    // A token we cannot remember costs a redundant RPC next launch, which is
    // strictly better than failing the registration over it.
  }
}

/** This device's Expo token, or null if push is not possible here. */
async function currentToken(): Promise<string | null> {
  try {
    // projectId comes from app config; without it this throws in bare/EAS builds.
    const result = await Notifications.getExpoPushTokenAsync();
    return result.data;
  } catch {
    return null;
  }
}

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

  const token = await currentToken();
  if (!token) return null;

  if (token === (await readLastToken())) return token;

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

  await writeLastToken(token);
  return token;
}

/**
 * Drops this device's token — call on sign-out so a shared phone stops
 * receiving a previous account's group and album notifications.
 *
 * Asks the OS for the token when nothing is remembered, rather than giving up.
 * The remembered value is an optimisation; the device's actual token is the
 * fact, and this is the one path where being wrong has a privacy cost.
 */
export async function unregisterPushToken(): Promise<void> {
  if (!notificationsAvailable) return;

  const token = (await readLastToken()) ?? (await currentToken());
  if (!token) return;

  await supabase.rpc('release_push_token', { p_token: token });
  await writeLastToken(null);
}

/**
 * Watches for the push service handing this device a new token mid-session.
 *
 * Rare but real — Expo's own docs say a token "may be changed by the push
 * notification service while the app is running", and until it is re-registered
 * every notification sent to this device goes to an address that no longer
 * exists. Nothing noticed before: registration ran once per sign-in, so a
 * rotation was invisible until the next cold start, and silent even then
 * because the stale token still looked like a successful registration.
 *
 * The listener hands over the *device* token (FCM/APNs), not the Expo one, so
 * this cannot forward it directly — it is a signal to go and ask for the
 * current Expo token, which `registerPushToken` does. It also no-ops when the
 * token has not really changed, so a spurious event costs nothing.
 *
 * Returns an unsubscribe function, or a no-op where push is unavailable.
 */
export function startPushTokenRotationWatch(): () => void {
  if (!notificationsAvailable) return () => undefined;

  const subscription = Notifications.addPushTokenListener(() => {
    void registerPushToken();
  });
  return () => subscription.remove();
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
