import {
  decryptBytes,
  decryptString,
  deriveKek,
  encryptBytes,
  encryptString,
  fromBase64,
  generateMasterKey,
  randomBytes,
  toBase64,
  tryDecryptString,
} from '@/features/private/services/vault-crypto';

/**
 * The vault's guarantees are cryptographic, which means they are exactly as
 * good as this file says they are. Every test here corresponds to a promise
 * made to the user in PRIVACY.md.
 */

describe('base64', () => {
  it('round-trips arbitrary bytes, including the padding edges', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 31, 32, 33, 255]) {
      const bytes = randomBytes(length);
      expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('round-trips bytes that are not valid UTF-8', () => {
    // Encrypted payloads are uniformly random, so a base64 that only survives
    // text would corrupt roughly every blob.
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('encryption', () => {
  const key = generateMasterKey();

  it('round-trips a string', () => {
    const secret = 'period started, cramps 3/5 — do not show anyone';
    expect(decryptString(key, encryptString(key, secret))).toBe(secret);
  });

  it('round-trips non-Latin text', () => {
    const secret = 'یہ نجی ہے — गुप्त — سري 🔐';
    expect(decryptString(key, encryptString(key, secret))).toBe(secret);
  });

  it('round-trips binary of the size a photo actually is', () => {
    const bytes = randomBytes(64 * 1024);
    expect(Array.from(decryptBytes(key, encryptBytes(key, bytes)))).toEqual(Array.from(bytes));
  });

  it('never emits the same ciphertext twice for the same plaintext', () => {
    // A fixed nonce would make "did she log a period today, same as last month"
    // answerable from the database file alone, without any key.
    const a = encryptString(key, 'same text');
    const b = encryptString(key, 'same text');
    expect(a).not.toBe(b);
  });

  it('does not leak the plaintext into the ciphertext', () => {
    const payload = encryptString(key, 'relapsed on tuesday');
    expect(payload).not.toContain('relapsed');
    expect(payload).not.toContain('tuesday');
  });

  it('refuses a wrong key rather than returning garbage', () => {
    const payload = encryptString(key, 'secret');
    expect(() => decryptString(generateMasterKey(), payload)).toThrow();
  });

  it('refuses a tampered ciphertext', () => {
    // GCM authenticates: flipping a byte must fail, not silently decrypt to
    // something else.
    const payload = encryptString(key, 'balance: 400000');
    const bytes = fromBase64(payload);
    bytes[bytes.length - 5] ^= 0xff;
    expect(() => decryptString(key, toBase64(bytes))).toThrow();
  });

  it('reports an unopenable row as null rather than throwing', () => {
    // This is how the decoy space stays empty: real rows are present in the
    // table and simply refuse to open under the decoy key.
    expect(tryDecryptString(generateMasterKey(), encryptString(key, 'real'))).toBeNull();
    expect(tryDecryptString(key, encryptString(key, 'real'))).toBe('real');
  });
});

describe('key derivation', () => {
  // Each derivation is ~60k PBKDF2 rounds in pure JS and takes a second or
  // two, which is the point — the default 5s per-test budget is not enough for
  // two of them in one test.
  const SLOW = 30_000;

  it(
    'is deterministic for a PIN and salt',
    async () => {
      const salt = randomBytes(16);
      const a = await deriveKek('482193', salt);
      const b = await deriveKek('482193', salt);
      expect(Array.from(a)).toEqual(Array.from(b));
    },
    SLOW,
  );

  it(
    'gives a different key for a different PIN',
    async () => {
      const salt = randomBytes(16);
      const a = await deriveKek('482193', salt);
      const b = await deriveKek('482194', salt);
      expect(Array.from(a)).not.toEqual(Array.from(b));
    },
    SLOW,
  );

  it(
    'gives a different key for the same PIN under a different salt',
    async () => {
      // Without a per-install salt, one precomputed table would open every
      // LifeOS vault whose owner picked the same PIN.
      const a = await deriveKek('482193', randomBytes(16));
      const b = await deriveKek('482193', randomBytes(16));
      expect(Array.from(a)).not.toEqual(Array.from(b));
    },
    SLOW,
  );

  it(
    'normalises PINs so an accent typed two ways still opens the vault',
    async () => {
      // NFKC. A keyboard can emit precomposed U+00E9 where a paste gives
      // e + U+0301; without normalising, one of the two locks the owner out.
      const salt = randomBytes(16);
      const precomposed = 'caf\u00e9';
      const decomposed = 'cafe\u0301';
      expect(precomposed).not.toBe(decomposed);
      const a = await deriveKek(precomposed, salt);
      const b = await deriveKek(decomposed, salt);
      expect(Array.from(a)).toEqual(Array.from(b));
    },
    SLOW,
  );
});
