import { monthDay, onThisDay, preview, yearOf } from './on-this-day';
import type { JournalEntry } from '@/features/journal/types/journal.types';

const entry = (entryDate: string, body = 'x'): JournalEntry =>
  ({ id: entryDate, entryDate, body }) as JournalEntry;

describe('date keys', () => {
  it('reads the month-day and the year off the string', () => {
    expect(monthDay('2026-08-15')).toBe('08-15');
    expect(yearOf('2026-08-15')).toBe(2026);
  });
});

describe('onThisDay', () => {
  const history = [
    entry('2026-08-15'),
    entry('2025-08-15'),
    entry('2024-08-15'),
    entry('2023-08-14'),
    entry('2023-09-15'),
    entry('2022-08-15'),
  ];

  it('finds the same calendar date in earlier years, nearest first', () => {
    const found = onThisDay(history, '2026-08-15');
    expect(found.map((f) => f.entry.entryDate)).toEqual(['2025-08-15', '2024-08-15', '2022-08-15']);
    expect(found.map((f) => f.yearsAgo)).toEqual([1, 2, 4]);
  });

  it('excludes today — a memory of what you are writing now is a bug', () => {
    expect(onThisDay(history, '2026-08-15').some((f) => f.entry.entryDate === '2026-08-15')).toBe(
      false,
    );
  });

  it('does not match a neighbouring day or the same day in another month', () => {
    const found = onThisDay(history, '2026-08-15').map((f) => f.entry.entryDate);
    expect(found).not.toContain('2023-08-14');
    expect(found).not.toContain('2023-09-15');
  });

  it('ignores future-dated entries, which nothing stops a user creating', () => {
    expect(onThisDay([entry('2030-08-15')], '2026-08-15')).toEqual([]);
  });

  it('returns nothing on a date with no history', () => {
    expect(onThisDay(history, '2026-03-02')).toEqual([]);
  });

  it('surfaces a leap-day entry only on a leap day', () => {
    // The alternatives all show a February entry under a March heading, where
    // the date on the card contradicts the date in the entry.
    const leap = [entry('2024-02-29')];
    expect(onThisDay(leap, '2028-02-29').map((f) => f.yearsAgo)).toEqual([4]);
    expect(onThisDay(leap, '2026-03-01')).toEqual([]);
    expect(onThisDay(leap, '2026-02-28')).toEqual([]);
  });
});

describe('preview', () => {
  it('leaves a short entry alone', () => {
    expect(preview('A quiet day.')).toBe('A quiet day.');
  });

  it('collapses newlines, so a body starting blank is not an empty card', () => {
    expect(preview('\n\n  Two   lines\nhere ')).toBe('Two lines here');
  });

  it('cuts on a word boundary rather than mid-word', () => {
    const long = `${'word '.repeat(40)}end`;
    const out = preview(long, 30);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wo…$/);
  });

  it('falls back to a hard cut when one word runs past the limit', () => {
    const out = preview('a'.repeat(200), 20);
    expect(out).toHaveLength(21);
    expect(out.endsWith('…')).toBe(true);
  });
});
