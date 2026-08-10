import { onThisDay } from '@/features/private/services/together';
import type { AlbumPhoto } from '@/features/private/types/shared-album.types';

const photo = (id: string, createdAt: number, remotePath: string | null = 'p.bin'): AlbumPhoto => ({
  id,
  albumId: 'alb-1',
  remotePath,
  captionCiphertext: null,
  mimeType: 'image/jpeg',
  width: null,
  height: null,
  byteLength: null,
  addedBy: null,
  position: 0,
  createdAt,
  updatedAt: createdAt,
});

describe('onThisDay', () => {
  it('returns null with no uploaded photos', () => {
    expect(onThisDay([])).toBeNull();
    expect(onThisDay([photo('a', Date.now(), null)])).toBeNull();
  });

  it('finds a photo from exactly one year ago today', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const match = onThisDay(
      [
        photo('a', new Date('2025-08-10T09:00:00Z').getTime()),
        photo('b', new Date('2025-06-01').getTime()),
      ],
      now,
    );
    expect(match?.photo.id).toBe('a');
    expect(match?.yearsAgo).toBe(1);
  });

  it('prefers the nearest anniversary over a more distant one', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const match = onThisDay(
      [
        photo('two-years', new Date('2024-08-10').getTime()),
        photo('one-year', new Date('2025-08-10').getTime()),
      ],
      now,
    );
    expect(match?.photo.id).toBe('one-year');
    expect(match?.yearsAgo).toBe(1);
  });

  it('falls back to the oldest photo once the album is at least a year old', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const match = onThisDay(
      [
        photo('oldest', new Date('2025-01-15').getTime()),
        photo('newer', new Date('2025-06-01').getTime()),
      ],
      now,
    );
    expect(match?.photo.id).toBe('oldest');
  });

  it('shows nothing for an album younger than a year with no anniversary', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const match = onThisDay([photo('recent', new Date('2026-05-01').getTime())], now);
    expect(match).toBeNull();
  });
});
