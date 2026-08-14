import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * This install's identity, as far as the account roster is concerned.
 *
 * Generated once and kept in the OS keystore, so it survives app updates and a
 * local data wipe but not a reinstall — which is the right lifetime. A
 * reinstall genuinely is a fresh device from the account's point of view, and
 * treating it as the same one would let a phone that was wiped and handed on
 * silently keep the account it used to hold.
 *
 * ## Why it is not derived from anything
 *
 * `Device.osBuildId`, the Android ID, the iOS `identifierForVendor` — every
 * hardware-derived identifier is either unstable across OS updates, shared
 * between apps from the same vendor, or restricted by the platforms' privacy
 * rules. A random value we generate is stable, tells us nothing about the
 * person, and is exactly as useful for the one question being asked: "is this
 * the same install as last time?"
 *
 * ## Why it is not a secret
 *
 * It travels in a header on every request (see lib/supabase.ts) and the account
 * owner can read and forge their own. Migration 0047 says why that is
 * acceptable: this enforces session hygiene for a cooperating client, and the
 * threat it addresses — an old phone still holding a live session and a full
 * local copy of the data — is not one the owner is motivated to mount against
 * themselves.
 */

const KEY = 'lifeos.device-id';

/** SecureStore has no web implementation; degrade rather than fail to boot.
 *  Same decision, for the same reason, as lib/secure-session-storage.ts. */
const usingSecureStore = Platform.OS !== 'web';

/** Resolved once. Callers on the hot path (the fetch wrapper) await this
 *  promise rather than re-reading the keystore per request. */
let cached: Promise<string> | null = null;

async function read(): Promise<string | null> {
  if (!usingSecureStore) return AsyncStorage.getItem(KEY);
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    // A keystore that cannot be read (a broken native module, a device in a
    // state where the keychain is locked) must not stop the app starting.
    return null;
  }
}

async function write(value: string): Promise<void> {
  if (!usingSecureStore) return AsyncStorage.setItem(KEY, value);
  try {
    await SecureStore.setItemAsync(KEY, value);
  } catch {
    // Unwritable keystore: the id below is still returned and used for this
    // process, so the session works. The next launch generates a new one and
    // reads as a new device — degraded, but functional, which beats refusing
    // to sign in.
  }
}

/**
 * This device's id, creating it on first call.
 *
 * Deliberately serialised through a single cached promise: two callers racing
 * on first launch would otherwise generate two ids, write both, and leave the
 * account with a device id that changes between requests.
 */
export function getDeviceId(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      const existing = await read();
      if (existing && existing.length >= 16) return existing;
      const fresh = Crypto.randomUUID();
      await write(fresh);
      return fresh;
    })();
  }
  return cached;
}

/**
 * A name for this device that means something to the person reading it on
 * another phone — "you're signed in on Pixel 7 · Android 14".
 *
 * `modelName` rather than `deviceName`: the latter is often the owner's real
 * name ("Sara's iPhone"), and this string is stored server-side and shown on a
 * screen a takeover attempt reaches. The model is enough to tell two of your
 * own devices apart, which is all it is for.
 */
export function deviceLabel(): string {
  const model = Device.modelName?.trim();
  const os = [Device.osName, Device.osVersion].filter(Boolean).join(' ').trim();
  if (model && os) return `${model} · ${os}`;
  return model || os || Platform.OS;
}

/** Coarse platform tag, for the roster. */
export function devicePlatform(): string {
  return Platform.OS;
}

/** Forgets the cached id so the next read hits storage again. Tests only —
 *  the id itself is deliberately NOT cleared on sign-out or on a wipe, because
 *  a device that changed identity every sign-out could never be recognised as
 *  "the one already signed in", which is the whole point of the roster. */
export function resetDeviceIdCache(): void {
  cached = null;
}
