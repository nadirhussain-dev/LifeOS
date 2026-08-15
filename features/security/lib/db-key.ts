import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const DB_KEY_ID = 'daykeep.db.key';

/**
 * Returns the app's SQLite encryption key, generating a fresh 256-bit key in the
 * device's hardware-backed keystore (iOS Keychain / Android Keystore) on first
 * use. This is the key SQLCipher uses to encrypt daykeep.db at rest (see
 * docs/SQLCIPHER.md for wiring it into the DB engine).
 *
 * The key never leaves SecureStore and is only readable after first unlock, so
 * the database file is unreadable via ADB backup / file access / a rooted
 * device without the device passcode. Uninstalling the app discards the key
 * (and thus the data) — which is the intended security property.
 */
export async function getOrCreateDbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DB_KEY_ID);
  if (existing) return existing;

  const bytes = Crypto.getRandomBytes(32);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(DB_KEY_ID, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  return key;
}
