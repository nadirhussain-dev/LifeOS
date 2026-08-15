import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const INSTALL_ID_KEY = 'daykeep.install.id';

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
