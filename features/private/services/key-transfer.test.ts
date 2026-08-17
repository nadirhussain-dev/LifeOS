import {
  createTransfer,
  createVaultTransfer,
  generateTransferCode,
  normaliseTransferCode,
  redeemTransfer,
} from '@/features/private/services/key-transfer';
import { generateMasterKey } from '@/features/private/services/vault-crypto';

/**
 * Moving a vault key between two devices is the one operation in this app where
 * getting it subtly wrong is silent: a transfer that "succeeds" with the wrong
 * key produces a vault that opens, syncs, and shows nothing but failed decrypts
 * forever. So the interesting assertions are the negative ones.
 */

describe('the transfer code', () => {
  it('avoids characters people mishear', () => {
    // The code is meant to be read down a phone line. I/L/O/U/0/1 are the pairs
    // that get transcribed wrong, so they are not in the alphabet at all —
    // which means nothing downstream has to guess what was meant.
    const code = generateTransferCode();
    expect(code).not.toMatch(/[ILOU01]/);
  });

  it('is grouped, and long enough to be worth nothing to a guesser', () => {
    const code = generateTransferCode();
    expect(code).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    expect(normaliseTransferCode(code)).toHaveLength(24);
  });

  it('is different every time', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateTransferCode()));
    expect(codes.size).toBe(50);
  });

  it('forgives however it was typed', () => {
    // Somebody copying a code from one screen to another should not be defeated
    // by having used spaces instead of dashes.
    const code = generateTransferCode();
    const messy = code.toLowerCase().replace(/-/g, ' ');
    expect(normaliseTransferCode(messy)).toBe(normaliseTransferCode(code));
  });
});

describe('a transfer', () => {
  it('round-trips the exact key', async () => {
    const key = generateMasterKey();
    const { code, payload } = await createTransfer(key);

    const result = await redeemTransfer(payload, code);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.from(result.masterKey)).toEqual(Array.from(key));
  });

  it('round-trips a code typed carelessly', async () => {
    const key = generateMasterKey();
    const { code, payload } = await createTransfer(key);

    const result = await redeemTransfer(payload, `  ${code.toLowerCase().replace(/-/g, '')}  `);
    expect(result.ok).toBe(true);
  });

  it('refuses the wrong code', async () => {
    const { payload } = await createTransfer(generateMasterKey());
    const result = await redeemTransfer(payload, generateTransferCode());
    expect(result).toEqual({ ok: false, reason: 'wrong-code' });
  });

  it('gives a captured payload nothing to work with', async () => {
    // The whole point of the two channels. Somebody who intercepts the payload
    // — a message, a photo of a screen — has an AES-GCM blob and no key.
    const { payload } = await createTransfer(generateMasterKey());
    expect(payload).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/);

    for (let i = 0; i < 5; i += 1) {
      expect((await redeemTransfer(payload, generateTransferCode())).ok).toBe(false);
    }
  });

  it('produces an unrelated payload each time, for the same key', async () => {
    // A fresh salt per transfer, so a payload captured from an earlier transfer
    // cannot be opened with a later code.
    const key = generateMasterKey();
    const first = await createTransfer(key);
    const second = await createTransfer(key);

    expect(first.payload).not.toBe(second.payload);
    expect((await redeemTransfer(first.payload, second.code)).ok).toBe(false);
    expect((await redeemTransfer(second.payload, first.code)).ok).toBe(false);
  });

  it('rejects a mangled payload rather than half-decoding it', async () => {
    const { code } = await createTransfer(generateMasterKey());
    for (const bad of ['', 'nonsense', '1.only-two', '9.AAAA.BBBB']) {
      const result = await redeemTransfer(bad, code);
      expect(result.ok).toBe(false);
    }
  });

  it('names an unsupported version instead of failing as a bad decrypt', async () => {
    const { code, payload } = await createTransfer(generateMasterKey());
    // 3, not 2: version 2 is the album-carrying format and is understood. A
    // version this build has never heard of is the case under test.
    const future = payload.replace(/^1\./, '3.');
    expect(await redeemTransfer(future, code)).toEqual({
      ok: false,
      reason: 'unsupported-version',
    });
  });

  it('refuses a payload whose plaintext is not a key', async () => {
    // Guards the case where a decrypt happens to succeed on something that was
    // never 32 bytes — the shape check is what stops a "working" vault being
    // built around nonsense.
    const key = generateMasterKey();
    const { code, payload } = await createTransfer(key.subarray(0, 16));
    const result = await redeemTransfer(payload, code);
    expect(result).toEqual({ ok: false, reason: 'wrong-code' });
  });

  /** A v1 payload carries no albums, and must keep working forever: it is what
   *  `album-invite.ts` mints to hand one album key to a co-member. */
  it('reports no albums for a plain key transfer', async () => {
    const { code, payload } = await createTransfer(generateMasterKey());
    const result = await redeemTransfer(payload, code);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.albumKeys).toEqual({});
  });
});

/**
 * Moving the vault used to move the vault alone, which left somebody on a new
 * phone with every shared album synced down from the server and permanently
 * shut — the ciphertext arrived and the key to it did not. These cover the
 * format that carries both.
 */
describe('a transfer that carries shared albums', () => {
  const albumKey = (byte: number) => new Uint8Array(32).fill(byte);

  it('round-trips the vault key and every album key', async () => {
    const key = generateMasterKey();
    const albums = { 'album-a': albumKey(7), 'album-b': albumKey(9) };

    const { code, payload } = await createVaultTransfer(key, albums);
    const result = await redeemTransfer(payload, code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.masterKey)).toEqual(Array.from(key));
    expect(Object.keys(result.albumKeys).sort()).toEqual(['album-a', 'album-b']);
    expect(Array.from(result.albumKeys['album-a'])).toEqual(Array.from(albums['album-a']));
    expect(Array.from(result.albumKeys['album-b'])).toEqual(Array.from(albums['album-b']));
  });

  it('carries a vault with no albums at all', async () => {
    const key = generateMasterKey();
    const { code, payload } = await createVaultTransfer(key, {});
    const result = await redeemTransfer(payload, code);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.albumKeys).toEqual({});
  });

  /** The album keys are inside the same sealed blob, under the same code — so
   *  a captured payload gives up the albums exactly as readily as it gives up
   *  the vault, which is to say not at all. */
  it('gives a captured payload nothing, albums included', async () => {
    const { payload } = await createVaultTransfer(generateMasterKey(), {
      'album-a': albumKey(3),
    });
    expect(payload).not.toContain('album-a');
    expect((await redeemTransfer(payload, generateTransferCode())).ok).toBe(false);
  });

  /**
   * One unreadable album must not cost somebody the vault and the other nine.
   * A device that arrives without one album key is in exactly the position of a
   * device that never had it — a co-member can re-share.
   */
  it('drops a malformed album entry rather than failing the transfer', async () => {
    const key = generateMasterKey();
    const albums = {
      good: albumKey(1),
      short: new Uint8Array(16).fill(2),
    };
    const { code, payload } = await createVaultTransfer(key, albums);
    const result = await redeemTransfer(payload, code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.masterKey)).toEqual(Array.from(key));
    expect(Object.keys(result.albumKeys)).toEqual(['good']);
  });

  it('still refuses the wrong code', async () => {
    const { payload } = await createVaultTransfer(generateMasterKey(), {
      'album-a': albumKey(5),
    });
    expect(await redeemTransfer(payload, generateTransferCode())).toEqual({
      ok: false,
      reason: 'wrong-code',
    });
  });
});
