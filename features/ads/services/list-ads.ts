/**
 * Ads woven into a long list, rather than bolted to the bottom of a screen.
 *
 * ## The problem with the inventory this app had
 *
 * Every placement was one anchored banner at the foot of a screen. That is one
 * impression per screen visit however long somebody stays — so inventory scaled
 * with *navigation*, and the only way to grow it was to put ads in front of
 * more screens or interrupt more often. Both of those buy revenue with
 * attention the user did not offer.
 *
 * An ad inside a list scales with *scrolling*. Somebody with four tasks sees
 * nothing extra; somebody who scrolls two hundred notes passes a few. The
 * people who generate the most inventory are the ones getting the most out of
 * the app, which is the only version of "maximum revenue" that does not trade
 * against retention.
 *
 * ## The four rules, and what each one is preventing
 *
 * **Nothing before `firstAfter` rows.** A list short enough to see the end of
 * is a list where an ad is a proportion of the content rather than a break in
 * it. Four tasks and an ad is an ad screen.
 *
 * **Never directly under a section header.** An ad as the first row beneath
 * "Today" reads as something due today. That is not a layout nit — ad policy
 * is explicit that an ad must not be presentable as app content, and the
 * position immediately under a heading is exactly where it would be.
 *
 * **Never the last row.** These screens already carry an anchored banner below
 * the list. An ad in the final rows puts two banners within a screen height of
 * each other, which looks like the app trying it on and, on some layouts,
 * stacks two requests into one viewport.
 *
 * **A hard cap per list.** Without it a five-hundred-row list is an ad every
 * eight rows forever. The cap is what keeps the ratio falling as the list grows
 * rather than holding constant.
 *
 * Pure and parameterised so the rules are testable without a list, a screen or
 * an ad SDK — the failure mode being guarded against is a ratio nobody notices
 * until a review mentions it.
 */

/** A row standing in for an ad. Callers render it however their list does. */
export type ListAdRow = { type: 'ad'; key: string };

export const LIST_AD_FIRST_AFTER = 8;
export const LIST_AD_EVERY = 8;
export const LIST_AD_MAX = 3;
/** Rows at the end of the list that may never hold one — see rule three. */
export const LIST_AD_TAIL_GUARD = 3;

export type ListAdOptions<T> = {
  /** True for a row an ad must not be placed directly beneath. */
  isHeader?: (row: T) => boolean;
  firstAfter?: number;
  every?: number;
  max?: number;
  tailGuard?: number;
};

export function insertListAds<T>(rows: T[], options: ListAdOptions<T> = {}): (T | ListAdRow)[] {
  const {
    isHeader,
    firstAfter = LIST_AD_FIRST_AFTER,
    every = LIST_AD_EVERY,
    max = LIST_AD_MAX,
    tailGuard = LIST_AD_TAIL_GUARD,
  } = options;

  if (max <= 0 || every <= 0) return [...rows];
  // Nothing to interleave into: the list has to be long enough to carry the
  // first ad AND still have rows after it, or the "ad" is just the footer.
  if (rows.length < firstAfter + tailGuard + 1) return [...rows];

  const out: (T | ListAdRow)[] = [];
  let placed = 0;
  let sinceLast = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    out.push(row);
    sinceLast += 1;

    if (placed >= max) continue;
    if (index + 1 < firstAfter) continue;
    // Counted from the last ad rather than from the top, so a header that
    // pushes one placement down does not compress the next gap.
    if (sinceLast < every) continue;
    if (index >= rows.length - 1 - tailGuard) continue;
    // The *next* row is what an ad here would sit above; if this row is a
    // header the ad would be its first child. Wait one row.
    if (isHeader?.(row)) continue;

    out.push({ type: 'ad', key: `list-ad-${placed}` });
    placed += 1;
    sinceLast = 0;
  }

  return out;
}

/** How many ad rows a list of this length will carry. Exported for tests and
 *  for anyone reasoning about the ratio without running a render. */
export function listAdCount(length: number, options: ListAdOptions<never> = {}): number {
  return insertListAds(
    Array.from({ length }, (_, i) => i),
    options as ListAdOptions<number>,
  ).filter((row) => typeof row === 'object' && row !== null && (row as ListAdRow).type === 'ad')
    .length;
}
