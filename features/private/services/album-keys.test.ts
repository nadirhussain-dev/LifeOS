import * as SecureStore from 'expo-secure-store';

import {
  forgetAlbumKey,
  hasAlbumKey,
  storeAlbumKey,
  unwrapAlbumKey,
} from '@/features/private/services/album-keys';
import { generateMasterKey } from '@/features/private/services/vault-crypto';

/**
 * Custody of shared-album keys, tested the same way key-transfer.ts is: the
 * interesting assertions are the negative ones, because a wrong key that
 * "succeeds" is silent — see album-keys.ts's own header on why this blob must
 * never be synced or escrowed.
 */

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED: 'WHEN_UNLOCKED',
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

describe('album key custody', () => {
  it('round-trips a stored key under the vault key that wrapped it', async () => {
    const vaultKey = generateMasterKey();
    const albumKey = generateMasterKey();
    const albumId = 'alb-test-1';

    await storeAlbumKey(albumId, vaultKey, albumKey);
    const unwrapped = await unwrapAlbumKey(vaultKey, albumId);

    expect(unwrapped).not.toBeNull();
    expect(Array.from(unwrapped!)).toEqual(Array.from(albumKey));
  });

  it('returns null, not a throw, when unwrapped with the wrong vault key', async () => {
    // The wrong vault key is exactly what the decoy space holds — this must
    // read as "locked", never crash the screen that asked.
    const vaultKey = generateMasterKey();
    const wrongVaultKey = generateMasterKey();
    const albumKey = generateMasterKey();
    const albumId = 'alb-test-2';

    await storeAlbumKey(albumId, vaultKey, albumKey);
    const unwrapped = await unwrapAlbumKey(wrongVaultKey, albumId);

    expect(unwrapped).toBeNull();
  });

  it('returns null for an album this device never stored a key for', async () => {
    const vaultKey = generateMasterKey();
    const unwrapped = await unwrapAlbumKey(vaultKey, 'alb-never-seen');
    expect(unwrapped).toBeNull();
  });

  it('reports whether a key is held, independent of unwrapping it', async () => {
    const vaultKey = generateMasterKey();
    const albumKey = generateMasterKey();
    const albumId = 'alb-test-3';

    expect(await hasAlbumKey(albumId)).toBe(false);
    await storeAlbumKey(albumId, vaultKey, albumKey);
    expect(await hasAlbumKey(albumId)).toBe(true);
  });

  it('forgets a key on request, and it stays forgotten', async () => {
    const vaultKey = generateMasterKey();
    const albumKey = generateMasterKey();
    const albumId = 'alb-test-4';

    await storeAlbumKey(albumId, vaultKey, albumKey);
    await forgetAlbumKey(albumId);

    expect(await hasAlbumKey(albumId)).toBe(false);
    expect(await unwrapAlbumKey(vaultKey, albumId)).toBeNull();
  });

  it('never writes to escrow — this blob must live only in SecureStore', () => {
    // Reusing vault-escrow.ts's pattern here would silently degrade the
    // album's E2E promise to the vault's (which carries an operator-escrow
    // exception) — see album-keys.ts's header. A static import check is
    // cheap and durable against that regression.
    const source = jest.requireActual('fs').readFileSync(
      require.resolve('@/features/private/services/album-keys'),
      'utf8',
    );
    // Matches an actual import/require, not the header comment's prose
    // explaining why there must never be one.
    expect(source).not.toMatch(/(from|require\()\s*['"][^'"]*vault-escrow/);
  });

  it('keys each album under its own SecureStore item', async () => {
    const vaultKey = generateMasterKey();
    const keyA = generateMasterKey();
    const keyB = generateMasterKey();

    await storeAlbumKey('alb-a', vaultKey, keyA);
    await storeAlbumKey('alb-b', vaultKey, keyB);

    expect(Array.from((await unwrapAlbumKey(vaultKey, 'alb-a'))!)).toEqual(Array.from(keyA));
    expect(Array.from((await unwrapAlbumKey(vaultKey, 'alb-b'))!)).toEqual(Array.from(keyB));
  });

  it('sets WHEN_UNLOCKED accessibility, matching the vault’s own keys', async () => {
    const vaultKey = generateMasterKey();
    await storeAlbumKey('alb-accessibility', vaultKey, generateMasterKey());
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.stringContaining('alb-accessibility'),
      expect.any(String),
      expect.objectContaining({ keychainAccessible: 'WHEN_UNLOCKED' }),
    );
  });
});
