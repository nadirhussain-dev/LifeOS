import {
  LIST_AD_EVERY,
  LIST_AD_FIRST_AFTER,
  LIST_AD_MAX,
  insertListAds,
  listAdCount,
  type ListAdRow,
} from '@/features/ads/services/list-ads';

const isAd = (row: unknown): row is ListAdRow =>
  typeof row === 'object' && row !== null && (row as ListAdRow).type === 'ad';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

/**
 * The placement rules, asserted directly.
 *
 * Each of these is a rule whose violation is invisible in the number it moves:
 * an ad one row too early raises impressions today and shows up a month later
 * as a review about "ads everywhere", and a cap one too tight shows up as
 * revenue under model with no error anywhere. Neither is observable from the
 * outside, so both directions are pinned.
 */
describe('a list too short to hide an ad in', () => {
  it('carries none at all', () => {
    // Four tasks and an ad is an ad screen. The list has to be long enough that
    // an ad is a break in the content rather than a proportion of it.
    for (const length of [0, 1, 5, LIST_AD_FIRST_AFTER]) {
      expect([length, listAdCount(length)]).toEqual([length, 0]);
    }
  });

  it('starts carrying one once there is room after it as well', () => {
    // Not merely "longer than firstAfter": an ad with nothing below it is the
    // footer banner again, which these screens already have.
    expect(listAdCount(LIST_AD_FIRST_AFTER + 1)).toBe(0);
    expect(listAdCount(40)).toBeGreaterThan(0);
  });
});

describe('spacing', () => {
  it('leaves at least `every` rows between two ads', () => {
    const out = insertListAds(rows(200));
    const positions = out.map((row, index) => (isAd(row) ? index : -1)).filter((i) => i >= 0);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i] - positions[i - 1]).toBeGreaterThan(LIST_AD_EVERY);
    }
  });

  it('never places one in the first screenful', () => {
    const out = insertListAds(rows(200));
    const first = out.findIndex(isAd);
    expect(first).toBeGreaterThanOrEqual(LIST_AD_FIRST_AFTER);
  });

  it('never places one in the last rows', () => {
    // The screen's own anchored banner sits below the list. An ad in the tail
    // puts two within a screen height of each other.
    const out = insertListAds(rows(60));
    const last = out.map(isAd).lastIndexOf(true);
    expect(last).toBeLessThan(out.length - 1);
    expect(out.length - 1 - last).toBeGreaterThan(3);
  });
});

describe('the cap', () => {
  it('holds however long the list gets', () => {
    for (const length of [60, 200, 1000, 5000]) {
      expect([length, listAdCount(length)]).toEqual([length, LIST_AD_MAX]);
    }
  });

  it('means the ratio falls as the list grows rather than holding constant', () => {
    // The property the cap exists for. Without it, one in nine rows is an ad at
    // every length — which is the shape people describe as "ads everywhere".
    const short = listAdCount(60) / 60;
    const long = listAdCount(1000) / 1000;
    expect(long).toBeLessThan(short / 10);
  });
});

describe('section headers', () => {
  const headerEvery = (n: number, step: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i, header: i % step === 0 }));

  it('never puts an ad directly beneath one', () => {
    /*
     * An ad as the first row under "Today" reads as something due today. Ad
     * policy is explicit that an ad must not be presentable as app content, and
     * immediately under a heading is exactly where it would be.
     */
    const data = headerEvery(200, 9);
    const out = insertListAds(data, { isHeader: (row) => row.header });
    out.forEach((row, index) => {
      if (!isAd(row)) return;
      const previous = out[index - 1];
      expect(isAd(previous)).toBe(false);
      expect((previous as { header?: boolean }).header ?? false).toBe(false);
    });
  });

  it('still places its full quota when headers keep getting in the way', () => {
    // A header on every candidate row must postpone an ad, not cancel it —
    // otherwise a sectioned list silently carries no inventory at all.
    const data = headerEvery(300, LIST_AD_EVERY);
    const out = insertListAds(data, { isHeader: (row) => row.header });
    expect(out.filter(isAd).length).toBe(LIST_AD_MAX);
  });
});

describe('the rows themselves', () => {
  it('keeps every original row, in order', () => {
    // The list is the product. An interleave that dropped or reordered a task
    // would be a data-loss bug wearing an ad's clothes.
    const data = rows(200);
    const out = insertListAds(data);
    expect(out.filter((row) => !isAd(row))).toEqual(data);
  });

  it('does not mutate the array it was given', () => {
    const data = rows(200);
    insertListAds(data);
    expect(data).toHaveLength(200);
  });

  it('gives every ad row a distinct key', () => {
    // FlashList recycles on key. Two ad rows sharing one is a recycled view
    // showing the wrong creative, which is an impression nobody saw.
    const out = insertListAds(rows(200));
    const keys = out.filter(isAd).map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
