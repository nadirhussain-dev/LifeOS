import { nextMilestone, onThisDay, todaysMilestone } from '@/features/private/services/together';
import type { AlbumMilestone, AlbumPhoto } from '@/features/private/types/shared-album.types';

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

  it('maxYearsLookback=1 only reaches the most recent anniversary, never a more distant one', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const match = onThisDay([photo('two-years', new Date('2024-08-10').getTime())], now, 1);
    expect(match).toBeNull();
  });

  it('maxYearsLookback=1 skips the oldest-photo fallback entirely', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const match = onThisDay([photo('oldest', new Date('2023-01-15').getTime())], now, 1);
    expect(match).toBeNull();
  });

  it('a wider maxYearsLookback still finds a two-year anniversary', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const match = onThisDay([photo('two-years', new Date('2024-08-10').getTime())], now, 15);
    expect(match?.yearsAgo).toBe(2);
  });
});

const milestone = (
  id: string,
  milestoneDate: string,
  recurring: boolean,
  albumId = 'alb-1',
): AlbumMilestone => ({
  id,
  albumId,
  titleCiphertext: `cipher:${id}`,
  milestoneDate,
  recurring,
  authorId: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});

describe('todaysMilestone', () => {
  it('matches a recurring milestone on its month/day regardless of the stored year', () => {
    const now = new Date(2026, 7, 10); // 10 Aug 2026, local
    const anniversary = milestone('anniv', '2019-08-10', true);
    expect(todaysMilestone([anniversary], now)?.id).toBe('anniv');
  });

  it('a non-recurring milestone only matches its exact date', () => {
    const now = new Date(2026, 7, 10);
    expect(todaysMilestone([milestone('once', '2026-08-10', false)], now)?.id).toBe('once');
    expect(todaysMilestone([milestone('once', '2025-08-10', false)], now)).toBeNull();
  });

  it('returns null when nothing matches today', () => {
    const now = new Date(2026, 7, 10);
    expect(todaysMilestone([milestone('later', '2026-12-25', true)], now)).toBeNull();
  });
});

describe('nextMilestone', () => {
  it('rolls a recurring milestone forward once this year’s date has passed', () => {
    const now = new Date(2026, 7, 10); // 10 Aug
    const anniversary = milestone('anniv', '2019-06-01', true); // 1 Jun already passed this year
    const result = nextMilestone([anniversary], now);
    expect(result?.milestone.id).toBe('anniv');
    // 1 Jun 2027 is 295 days from 10 Aug 2026.
    expect(result?.daysAway).toBe(295);
  });

  it('does not roll forward a recurring milestone still ahead this year', () => {
    const now = new Date(2026, 7, 10); // 10 Aug
    const anniversary = milestone('anniv', '2019-12-25', true);
    const result = nextMilestone([anniversary], now);
    expect(result?.daysAway).toBe(137); // 10 Aug -> 25 Dec 2026
  });

  it('today counts as 0 days away', () => {
    const now = new Date(2026, 7, 10);
    const result = nextMilestone([milestone('today', '2019-08-10', true)], now);
    expect(result?.daysAway).toBe(0);
  });

  it('a non-recurring milestone already in the past is skipped, not rolled forward', () => {
    const now = new Date(2026, 7, 10);
    const result = nextMilestone([milestone('past', '2020-01-01', false)], now);
    expect(result).toBeNull();
  });

  it('picks the nearest of several milestones', () => {
    const now = new Date(2026, 7, 10);
    const result = nextMilestone(
      [milestone('far', '2026-12-25', false), milestone('near', '2026-08-20', false)],
      now,
    );
    expect(result?.milestone.id).toBe('near');
  });

  it('returns null with nothing to show', () => {
    expect(nextMilestone([])).toBeNull();
  });
});
