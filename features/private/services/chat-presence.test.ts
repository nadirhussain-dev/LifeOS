import {
  applyTypingPulse,
  clearTyping,
  onlineUserIds,
  pruneTyping,
  PULSE_INTERVAL_MS,
  shouldSendPulse,
  typingUserIds,
  TYPING_TTL_MS,
} from '@/features/private/services/chat-presence';

/**
 * The timing behind the typing bubble and the green dot.
 *
 * All of it is real-time behaviour, which is precisely why it lives in a file
 * with no socket in it: "the bubble stayed up after they stopped" and "we sent
 * a broadcast per keystroke" are both untestable against a live channel and
 * trivial here, by moving a number.
 */

const SELF = 'me';
const OTHER = 'them';

describe('typing expiry', () => {
  it('keeps a pulse that is still inside its window', () => {
    const now = 10_000;
    const registry = { [OTHER]: now - (TYPING_TTL_MS - 1) };
    expect(pruneTyping(registry, now)).toEqual(registry);
  });

  it('drops one that has aged out', () => {
    const now = 10_000;
    expect(pruneTyping({ [OTHER]: now - TYPING_TTL_MS }, now)).toEqual({});
  });

  it('returns the identical object when nothing expired', () => {
    // Not cosmetic: this runs on an interval, and a fresh object every tick
    // rerenders the whole chat once a second for as long as it is open.
    const now = 10_000;
    const registry = { [OTHER]: now };
    expect(pruneTyping(registry, now)).toBe(registry);
  });

  it('expires the stale without disturbing the live', () => {
    const now = 10_000;
    const pruned = pruneTyping({ a: now - TYPING_TTL_MS - 1, b: now - 100 }, now);
    expect(pruned).toEqual({ b: now - 100 });
  });
});

describe('recording a pulse', () => {
  it('records somebody else', () => {
    expect(applyTypingPulse({}, OTHER, 500, SELF)).toEqual({ [OTHER]: 500 });
  });

  it('refuses self', () => {
    // A broadcast echoes back to its own sender on some configurations, and
    // "you are typing" shown at yourself only reproduces with two devices.
    expect(applyTypingPulse({}, SELF, 500, SELF)).toEqual({});
  });

  it('moves an existing pulse forward rather than adding a second', () => {
    const next = applyTypingPulse({ [OTHER]: 100 }, OTHER, 900, SELF);
    expect(next).toEqual({ [OTHER]: 900 });
  });

  it('clears one immediately when they post', () => {
    // Otherwise the bubble lingers under their own message for the rest of
    // the TTL, which reads as them typing a second message.
    expect(clearTyping({ [OTHER]: 100 }, OTHER)).toEqual({});
  });

  it('leaves the registry alone when clearing somebody absent', () => {
    const registry = { [OTHER]: 100 };
    expect(clearTyping(registry, 'nobody')).toBe(registry);
  });
});

describe('outgoing pulse throttle', () => {
  it('sends the first one', () => {
    expect(shouldSendPulse(null, 0)).toBe(true);
  });

  it('holds one that is too soon', () => {
    // The composer calls this per keystroke. Without the floor, a sentence is
    // a broadcast per character.
    expect(shouldSendPulse(1000, 1000 + PULSE_INTERVAL_MS - 1)).toBe(false);
  });

  it('sends once the interval has passed', () => {
    expect(shouldSendPulse(1000, 1000 + PULSE_INTERVAL_MS)).toBe(true);
  });

  it('keeps sending while a long message is typed', () => {
    // The TTL must not outrun the pulse interval, or an uninterrupted typist
    // flickers. This is the assertion that pins the two constants together.
    expect(PULSE_INTERVAL_MS).toBeLessThan(TYPING_TTL_MS);
  });
});

describe('who is shown as typing', () => {
  it('excludes self and orders by oldest pulse', () => {
    expect(typingUserIds({ b: 200, [SELF]: 50, a: 100 }, SELF)).toEqual(['a', 'b']);
  });

  it('is empty when only self is typing', () => {
    expect(typingUserIds({ [SELF]: 1 }, SELF)).toEqual([]);
  });
});

describe('presence', () => {
  it('collapses one account joined from several devices', () => {
    // Supabase keys presence state by our chosen key and holds an array of
    // metas — two phones must not render as two people.
    const state = {
      them: [{ userId: OTHER }, { userId: OTHER }],
    };
    expect(onlineUserIds(state, SELF)).toEqual([OTHER]);
  });

  it('excludes self', () => {
    expect(onlineUserIds({ me: [{ userId: SELF }] }, SELF)).toEqual([]);
  });

  it('ignores entries with no usable id', () => {
    expect(onlineUserIds({ x: [{}, { userId: 42 }, { userId: OTHER }] } as never, SELF)).toEqual([
      OTHER,
    ]);
  });

  it('is empty for an empty channel', () => {
    expect(onlineUserIds({}, SELF)).toEqual([]);
  });
});
