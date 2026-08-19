import {
  HONEYMOON_DAYS,
  MIN_GAP_SECONDS,
  SESSION_CAP,
  isAdFreeRoute,
  mayShowFullScreenAd,
  type AdPacingInput,
} from '@/features/ads/services/ad-pacing';

/**
 * The pacing rules, asserted directly.
 *
 * Every one of these is a rule whose violation is invisible in the metric it
 * would move. Showing an ad one rule too eagerly raises impressions today and
 * costs retained days that nobody attributes to it; refusing one rule too often
 * shows up as revenue quietly under model with no error anywhere. Neither is
 * observable from the outside, so both directions are pinned here.
 */

const DAY = 24 * 60 * 60 * 1000;

const base: AdPacingInput = {
  segments: ['(tabs)', 'hub'],
  breakpoint: 'study-session-end',
  installAgeMs: 30 * DAY,
  shownThisSession: 0,
  lastShownAt: null,
  firstSessionToday: false,
  sessionAgeMs: 60_000,
  now: 1_000_000_000,
};

const refusal = (over: Partial<AdPacingInput>) => {
  const result = mayShowFullScreenAd({ ...base, ...over });
  return result.allowed ? null : result.reason;
};

describe('the ad-free route firewall', () => {
  it('refuses everywhere under the private space', () => {
    // The one guarantee in features/ads/config.ts that a full-screen format
    // would otherwise quietly break: an interstitial fires on navigation, so
    // "never write the call site" stops being an available enforcement.
    expect(isAdFreeRoute(['private', 'cycle'])).toBe(true);
    expect(isAdFreeRoute(['private', 'vault'])).toBe(true);
  });

  it('refuses on the challenge, the auth stack and first run', () => {
    expect(isAdFreeRoute(['challenge', 'index'])).toBe(true);
    // Group segments never appear in the pathname, which is why this matches on
    // segments rather than a path prefix.
    expect(isAdFreeRoute(['(auth)', 'login'])).toBe(true);
    expect(isAdFreeRoute(['(onboarding)', 'index'])).toBe(true);
  });

  it('allows an ordinary tab screen', () => {
    expect(isAdFreeRoute(['(tabs)', 'hub'])).toBe(false);
    expect(isAdFreeRoute(['budget', 'index'])).toBe(false);
  });
});

describe('mayShowFullScreenAd', () => {
  it('allows a real breakpoint on an ordinary screen, well into the install', () => {
    expect(mayShowFullScreenAd(base)).toEqual({ allowed: true });
  });

  it('shows nothing during the honeymoon', () => {
    expect(refusal({ installAgeMs: (HONEYMOON_DAYS - 1) * DAY })).toBe('honeymoon');
  });

  it('opens up the moment the honeymoon ends', () => {
    expect(refusal({ installAgeMs: HONEYMOON_DAYS * DAY })).toBe(null);
  });

  it('skips the first session of the day', () => {
    expect(refusal({ firstSessionToday: true })).toBe('first-session-of-day');
  });

  it('refuses a breakpoint nobody put on the allowlist', () => {
    // The allowlist is the point: a new placement has to be a deliberate edit
    // to the list, not a new string passed at a call site.
    expect(refusal({ breakpoint: 'journal-entry-saved' })).toBe('not-a-breakpoint');
  });

  it('refuses inside the private space even at a valid breakpoint', () => {
    expect(refusal({ segments: ['private', 'insights'] })).toBe('ad-free-route');
  });

  it('treats a breakpoint reached seconds into a session as a launch', () => {
    // A reminder deep-linking straight into the study timer is a cold start,
    // and an ad in front of a cold start is what the placement policy exists to
    // prevent — whatever the breakpoint is called.
    expect(refusal({ sessionAgeMs: 3_000 })).toBe('launch');
  });

  it('refuses a breakpoint that was removed from the allowlist', () => {
    // 'hub-return' was considered and dropped: arriving somewhere is not the
    // same as having finished something. A stale call site must fail closed.
    expect(refusal({ breakpoint: 'hub-return' })).toBe('not-a-breakpoint');
  });

  it('stops at the session cap', () => {
    expect(refusal({ shownThisSession: SESSION_CAP })).toBe('session-cap');
    expect(refusal({ shownThisSession: SESSION_CAP - 1 })).toBe(null);
  });

  it('keeps a floor between two full-screen ads', () => {
    expect(refusal({ lastShownAt: base.now - (MIN_GAP_SECONDS - 1) * 1000 })).toBe('too-soon');
    expect(refusal({ lastShownAt: base.now - MIN_GAP_SECONDS * 1000 })).toBe(null);
  });

  it('reports the most fundamental reason when several rules refuse at once', () => {
    // A brand-new user, in the private space, at a non-breakpoint. The useful
    // answer is the one that would still refuse them on the Hub tomorrow.
    expect(
      refusal({
        installAgeMs: 0,
        segments: ['private', 'vault'],
        breakpoint: 'nonsense',
      }),
    ).toBe('honeymoon');
  });
});
