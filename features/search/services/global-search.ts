import type { ModuleName } from '@/constants/design-tokens';

/**
 * One search across every module.
 *
 * The app has twelve of them and no way to look through more than one at a
 * time, so anything you wrote down is findable only if you already remember
 * which module you put it in. That is precisely the memory the app was supposed
 * to be doing for you.
 *
 * Scoring, not just filtering. A plain `includes` orders results by whatever
 * the database happened to return, which for a query like "gym" means a
 * three-month-old transaction can outrank the habit you use daily. The ranking
 * below is deliberately simple and explainable — exact title, then title
 * prefix, then title substring, then body — with recency only ever used to
 * break ties, so a good match never loses to a newer bad one.
 */

export type SearchResultKind =
  | 'task'
  | 'note'
  | 'habit'
  | 'goal'
  | 'journal'
  | 'transaction'
  | 'debt'
  | 'subject'
  | 'song'
  | 'playlist'
  | 'album';

export type SearchResult = {
  id: string;
  kind: SearchResultKind;
  /** Which module's tint and icon this result wears. */
  module: ModuleName;
  title: string;
  /** Second line — a snippet, an amount, a date. */
  subtitle: string | null;
  route: string;
  params?: Record<string, string>;
  /** Sort key. Higher is a better match. */
  score: number;
  /** Tie-break only, never a substitute for relevance. */
  updatedAt: number;
};

/** Normalises for comparison: case, accents and surrounding space. */
export function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const SCORE = {
  exactTitle: 1000,
  titlePrefix: 700,
  titleWord: 500,
  titleSubstring: 300,
  bodySubstring: 100,
} as const;

/**
 * How well `query` matches a record. Returns 0 for no match at all, so callers
 * can filter on the score alone.
 */
export function scoreMatch(query: string, title: string, body?: string | null): number {
  const q = normalize(query);
  if (!q) return 0;

  const t = normalize(title);
  if (t === q) return SCORE.exactTitle;
  if (t.startsWith(q)) return SCORE.titlePrefix;
  // A match at a word boundary is worth more than one buried mid-word:
  // "run" should rank "Morning run" above "Prune the hedge".
  if (t.split(/\s+/).some((word) => word.startsWith(q))) return SCORE.titleWord;
  if (t.includes(q)) return SCORE.titleSubstring;
  if (body && normalize(body).includes(q)) return SCORE.bodySubstring;
  return 0;
}

/** Relevance first; recency only to separate equals. */
export function compareResults(a: SearchResult, b: SearchResult): number {
  if (b.score !== a.score) return b.score - a.score;
  return b.updatedAt - a.updatedAt;
}

/** A short, readable excerpt centred on the match, for the result's second line. */
export function snippet(
  body: string | null | undefined,
  query: string,
  length = 90,
): string | null {
  if (!body) return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return null;

  const index = normalize(flat).indexOf(normalize(query));
  if (index < 0) return flat.slice(0, length) + (flat.length > length ? '…' : '');

  // Show a little of what came before the match so it reads as a sentence
  // rather than starting abruptly on the search term.
  const start = Math.max(0, index - 24);
  const end = Math.min(flat.length, start + length);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}
