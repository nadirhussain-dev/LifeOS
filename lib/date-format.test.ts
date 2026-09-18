import {
  dateLocaleTag,
  formatDate,
  formatDateTime,
  formatDayOfMonth,
  formatMonth,
  formatTime,
  formatWeekday,
} from '@/lib/date-format';
import { useLanguageStore } from '@/features/settings/store/language-store';

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-GB', languageCode: 'en' }],
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

/** Saturday 14 March 2026, 15:45 local. */
const WHEN = new Date(2026, 2, 14, 15, 45);

function speak(language: 'en' | 'ur' | 'hi' | 'ar') {
  useLanguageStore.setState({ language });
}

describe('dates follow the language the app is set to', () => {
  afterEach(() => speak('en'));

  /**
   * The bug this file exists for: every date on screen came from a hardcoded
   * date-fns pattern with no locale, so all four languages rendered English.
   *
   * Asserted as "not English" plus "contains this language's own script"
   * rather than against an exact string. The exact wording belongs to the
   * platform's locale data and moves between ICU versions; what must never
   * come back is Latin month names inside Arabic, Urdu or Hindi UI.
   */
  it.each([
    ['ar', /[؀-ۿ]/],
    ['ur', /[؀-ۿ]/],
    ['hi', /[ऀ-ॿ]/],
  ] as const)('renders %s dates in its own script', (language, script) => {
    speak(language);
    expect(formatDate(WHEN, 'long')).toMatch(script);
    expect(formatWeekday(WHEN, 'long')).toMatch(script);
    expect(formatMonth(WHEN, 'long')).toMatch(script);
  });

  it('does not leave a Latin month name in a non-Latin language', () => {
    speak('ar');
    expect(formatDate(WHEN, 'medium')).not.toMatch(/Mar/);
    speak('hi');
    expect(formatDate(WHEN, 'medium')).not.toMatch(/Mar/);
  });

  it('switches when the language does, rather than serving a cached formatter', () => {
    // The formatter cache is keyed on the tag and cleared when it changes. A
    // cache that outlived a language switch would show the old language until
    // the next cold start, and only for the people who switched — the hardest
    // kind of report to act on.
    speak('en');
    const english = formatDate(WHEN, 'long');
    speak('ar');
    const arabic = formatDate(WHEN, 'long');
    expect(arabic).not.toBe(english);
    speak('en');
    expect(formatDate(WHEN, 'long')).toBe(english);
  });
});

describe('the locale tag', () => {
  afterEach(() => speak('en'));

  it("keeps the device's English variant so a British phone gets British order", () => {
    // `en` alone would impose American ordering. The mocked device is en-GB.
    speak('en');
    expect(dateLocaleTag()).toBe('en-GB');
    expect(formatDate(WHEN, 'medium')).toMatch(/14/);
    // Day before month is the whole point of honouring the variant.
    const medium = formatDate(WHEN, 'medium');
    expect(medium.indexOf('14')).toBeLessThan(medium.search(/[A-Za-z]/));
  });

  it('ignores the device for a language the user explicitly chose', () => {
    // The device says English. The user said Arabic on a screen, which is the
    // more recent and more deliberate of the two answers.
    speak('ar');
    expect(dateLocaleTag()).toBe('ar');
  });
});

describe('the styles say what they mean', () => {
  it('orders day, month and year by locale rather than by pattern', () => {
    // `'MMM d, yyyy'` and `'d MMM yyyy'` were both in the codebase, and each is
    // wrong in a language the app ships. Asking for the parts and letting the
    // locale order them is the only version right in both.
    speak('en');
    const us = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(WHEN);
    const gb = formatDate(WHEN, 'medium');
    expect(us).not.toBe(gb);
  });

  it('gives a narrow weekday a single character for heatmap columns', () => {
    speak('en');
    expect(formatWeekday(WHEN, 'narrow').length).toBeLessThanOrEqual(2);
  });

  it('carries the time only where it was asked for', () => {
    speak('en');
    expect(formatDate(WHEN, 'medium')).not.toMatch(/45/);
    expect(formatDateTime(WHEN, 'medium')).toMatch(/45/);
    expect(formatTime(WHEN)).toMatch(/45/);
  });

  it('formats a bare day for a calendar cell', () => {
    speak('en');
    expect(formatDayOfMonth(WHEN)).toBe('14');
  });
});
