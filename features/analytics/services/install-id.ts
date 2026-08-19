import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const INSTALL_ID_KEY = 'daykeep.install.id';
const INSTALL_AT_KEY = 'daykeep.install.at';

/**
 * A random id for this installation, and nothing else.
 *
 * It exists for one question: how many people are using Daykeep. Guest mode is a
 * supported way to use the app, so counting only signed-in accounts would
 * under-report by however many people never make one — and the honest fix is a
 * number that is joinable to no account, no device identifier and no content.
 * A v4 UUID minted here satisfies that: it is meaningless off this device.
 *
 * In SecureStore rather than AsyncStorage so it does not travel in a device
 * backup, and cached in memory because the reporter asks for it on every
 * foreground.
 */
let cached: string | null = null;

export async function getInstallId(): Promise<string> {
  if (cached) return cached;

  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
  if (existing) {
    cached = existing;
    return existing;
  }

  // Lowercase hex v4 — record_anon_activity() checks the shape, which is the
  // only brake available on an endpoint that must accept unauthenticated calls.
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALL_ID_KEY, id, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  cached = id;
  return id;
}

/**
 * When this install first ran, in epoch milliseconds.
 *
 * Stamped beside the id, on the same first run, because the ad pacing rules
 * need an install age and there was nowhere honest to get one: the app store
 * knows when the app was downloaded and the app does not, `expo-application`'s
 * install time is unavailable on iOS, and a first-launch flag in AsyncStorage
 * would reset with a data clear while the id — in SecureStore — would not, so
 * the two would disagree about the same install.
 *
 * Falls back to *now* when the value is missing or unreadable, which is the
 * safe direction: an unknown install reads as brand new, so the ad-free
 * honeymoon applies rather than being skipped. Getting this wrong the other way
 * would show ads on day one to exactly the people the honeymoon exists for.
 */
let cachedAt: number | null = null;

export async function getInstallAt(): Promise<number> {
  if (cachedAt !== null) return cachedAt;

  try {
    const existing = await SecureStore.getItemAsync(INSTALL_AT_KEY);
    const parsed = existing === null ? NaN : Number(existing);
    if (Number.isFinite(parsed) && parsed > 0) {
      cachedAt = parsed;
      return parsed;
    }

    const now = Date.now();
    await SecureStore.setItemAsync(INSTALL_AT_KEY, String(now), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
    cachedAt = now;
    return now;
  } catch {
    // Unreadable keychain. Treat it as a fresh install for this session rather
    // than as an old one — see above for why that direction is the safe one.
    cachedAt = Date.now();
    return cachedAt;
  }
}
