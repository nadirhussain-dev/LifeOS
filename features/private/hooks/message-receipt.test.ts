import { messageReceipt } from '@/features/private/hooks/use-shared-albums';

/**
 * Which tick a message gets.
 *
 * The rule that needs holding down is "everyone else", not "anyone else". In a
 * three-person album, marking a message read because one of the two others
 * opened it makes the strongest claim the UI can make on the weakest evidence
 * available — and it is the kind of thing that looks right in a two-person
 * test and is wrong in production, because couples' albums are the common case
 * and group albums are the one that catches it.
 */

const ME = 'me';
const A = 'a';
const B = 'b';

const message = (createdAt: number, over: Record<string, unknown> = {}) => ({
  createdAt,
  authorId: ME,
  ...over,
});

describe('messageReceipt', () => {
  it('is sent when nobody has any marker yet', () => {
    expect(messageReceipt(message(100), [], [], [A])).toBe('sent');
  });

  it('is sent in an album nobody else has joined', () => {
    // Nothing will ever deliver it, so anything past one tick would be a
    // promise the album cannot keep.
    expect(messageReceipt(message(100), [], [], [])).toBe('sent');
  });

  it('is delivered once every other member has received it', () => {
    expect(messageReceipt(message(100), [], [{ userId: A, deliveredThrough: 100 }], [A])).toBe(
      'delivered',
    );
  });

  it('is read once every other member has read it', () => {
    expect(
      messageReceipt(
        message(100),
        [{ userId: A, readThrough: 100 }],
        [{ userId: A, deliveredThrough: 100 }],
        [A],
      ),
    ).toBe('read');
  });

  it('stays delivered while one of two members has not read it', () => {
    expect(
      messageReceipt(
        message(100),
        [{ userId: A, readThrough: 100 }],
        [
          { userId: A, deliveredThrough: 100 },
          { userId: B, deliveredThrough: 100 },
        ],
        [A, B],
      ),
    ).toBe('delivered');
  });

  it('does not count a member who has no marker row at all', () => {
    // The bug this pins down: B has never opened the album, so B is absent
    // from the arrays rather than present-and-behind, and `every` over an
    // array B is missing from is trivially true. The first implementation
    // went blue here while B had not seen the message.
    expect(
      messageReceipt(
        message(100),
        [{ userId: A, readThrough: 100 }],
        [{ userId: A, deliveredThrough: 100 }],
        [A, B],
      ),
    ).toBe('sent');
  });

  it('reaches read only when the last member catches up', () => {
    expect(
      messageReceipt(
        message(100),
        [
          { userId: A, readThrough: 100 },
          { userId: B, readThrough: 100 },
        ],
        [
          { userId: A, deliveredThrough: 100 },
          { userId: B, deliveredThrough: 100 },
        ],
        [A, B],
      ),
    ).toBe('read');
  });

  it('ignores the author’s own markers', () => {
    // Your own device reports both markers for everything you send. Counting
    // them would make every message read the instant it was sent.
    expect(
      messageReceipt(
        message(100),
        [{ userId: ME, readThrough: 999 }],
        [{ userId: ME, deliveredThrough: 999 }],
        [A],
      ),
    ).toBe('sent');
  });

  it('does not count a marker that stops short of this message', () => {
    expect(messageReceipt(message(500), [], [{ userId: A, deliveredThrough: 499 }], [A])).toBe(
      'sent',
    );
  });

  it('counts a marker that has moved past this message', () => {
    // Markers are high-water marks, so "past" is the normal case for anything
    // but the newest message.
    expect(messageReceipt(message(100), [], [{ userId: A, deliveredThrough: 900 }], [A])).toBe(
      'delivered',
    );
  });

  it('is sending for a voice note whose recording has not landed', () => {
    // The row is written before the object exists, on purpose — so a voice
    // message with no path is mid-upload, not broken.
    expect(
      messageReceipt(
        message(100, { kind: 'voice', voicePath: null }),
        [],
        [{ userId: A, deliveredThrough: 100 }],
        [A],
      ),
    ).toBe('sending');
  });

  it('treats a voice note with its recording like any other message', () => {
    expect(
      messageReceipt(
        message(100, { kind: 'voice', voicePath: 'alb/voice/m.bin' }),
        [],
        [{ userId: A, deliveredThrough: 100 }],
        [A],
      ),
    ).toBe('delivered');
  });
});
