import type { DailyQuoteData } from '@/features/dashboard/types/dashboard.types';

/**
 * The dashboard's daily quote — real, shipped content, not a stand-in.
 *
 * This file was `dashboard-mock-data.ts`, and the name was doing real damage:
 * the pool below is curated content that ships with the app, but it sat behind
 * a `delay(300)` imitating a network round trip. Nothing is fetched, so that
 * delay bought nothing except a skeleton on the most-viewed card in the app,
 * on every cold open. Both are gone.
 *
 * **Known gap, left visible rather than papered over:** these strings are
 * English and do not go through i18n, so an Arabic, Urdu or Hindi user reads
 * them in English on their home screen. Translating attributed quotations is
 * content work rather than a code change, and `check:i18n` requires all four
 * locales to land together — so this needs 90 translations decided by a human,
 * not a plausible-looking guess. Until then the gap is documented here and in
 * the audit rather than hidden behind a helper that looks localized.
 */

const QUOTES: readonly DailyQuoteData[] = [
  { quote: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { quote: 'Do the hard things first.', author: 'Unknown' },
  { quote: 'Small steps every day.', author: 'Unknown' },
  {
    quote: 'You do not rise to the level of your goals. You fall to the level of your systems.',
    author: 'James Clear',
  },
  {
    quote: 'What you do every day matters more than what you do once in a while.',
    author: 'Gretchen Rubin',
  },
  {
    quote: 'Discipline is choosing between what you want now and what you want most.',
    author: 'Abraham Lincoln',
  },
  { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { quote: 'Well begun is half done.', author: 'Aristotle' },
  {
    quote: 'Amateurs sit and wait for inspiration. The rest of us just get up and go to work.',
    author: 'Stephen King',
  },
  { quote: 'Focus on being productive instead of busy.', author: 'Tim Ferriss' },
  {
    quote: 'Almost everything will work again if you unplug it for a few minutes, including you.',
    author: 'Anne Lamott',
  },
  { quote: 'The days are long, but the years are short.', author: 'Gretchen Rubin' },
  {
    quote: 'How we spend our days is, of course, how we spend our lives.',
    author: 'Annie Dillard',
  },
  { quote: 'Slow is smooth, and smooth is fast.', author: 'Unknown' },
  { quote: 'Progress, not perfection.', author: 'Unknown' },
  { quote: 'You cannot pour from an empty cup.', author: 'Unknown' },
  { quote: 'Rest is not idleness.', author: 'John Lubbock' },
  { quote: 'What gets measured gets managed.', author: 'Peter Drucker' },
  {
    quote: 'The best time to plant a tree was 20 years ago. The second best time is now.',
    author: 'Chinese Proverb',
  },
  { quote: 'A year from now you may wish you had started today.', author: 'Karen Lamb' },
  { quote: 'Done is better than perfect.', author: 'Sheryl Sandberg' },
  {
    quote: 'Motivation is what gets you started. Habit is what keeps you going.',
    author: 'Jim Ryun',
  },
  {
    quote: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.',
    author: 'Will Durant',
  },
  { quote: 'Either you run the day, or the day runs you.', author: 'Jim Rohn' },
  { quote: 'Clarity comes from engagement, not thought.', author: 'Marie Forleo' },
  { quote: 'You do not need more time. You need to decide.', author: 'Seth Godin' },
  { quote: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin' },
  { quote: 'Nothing is particularly hard if you divide it into small jobs.', author: 'Henry Ford' },
  {
    quote: 'Take care of the minutes, and the hours will take care of themselves.',
    author: 'Lord Chesterfield',
  },
  { quote: 'A little progress each day adds up to big results.', author: 'Satya Nani' },
];

/** The pool and its size, exported for the rotation test — which checks that
 *  consecutive days land on consecutive entries, and so needs to know where an
 *  entry sits rather than only what it says. */
export const QUOTE_POOL: readonly DailyQuoteData[] = QUOTES;
export const QUOTE_COUNT = QUOTES.length;

/**
 * The quote for a given local calendar day.
 *
 * Takes the date instead of reading the clock so the rotation can be tested at
 * a year boundary and across a DST transition — it is off-by-one-prone and had
 * no test.
 *
 * The day index is computed from the *local* Y/M/D re-projected onto UTC. The
 * previous version subtracted local-midnight-of-Dec-31 from `Date.now()` and
 * floored the result: across a DST transition that difference stops being a
 * whole number of days, so for part of one day a year the dashboard showed
 * yesterday's quote. Normalising both ends to UTC removes the clock arithmetic
 * from the question entirely.
 */
export function quoteForDate(date: Date): DailyQuoteData {
  const startOfYear = Date.UTC(date.getFullYear(), 0, 1);
  const thisDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfYear = Math.round((thisDay - startOfYear) / 86_400_000);
  return QUOTES[dayOfYear % QUOTES.length];
}

/** Query function for `useDailyQuote`. Synchronous: there is nothing to await. */
export function fetchDailyQuote(): DailyQuoteData {
  return quoteForDate(new Date());
}
