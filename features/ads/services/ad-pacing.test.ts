import {
  ENROLLED_SESSION_CAP,
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
  // Not in a run, which is the majority case and the one every rule below was
  // written against. The enrolled surface has its own block at the foot of this
  // file, and the point of defaulting to false here is that adding it changed
  // nothing for anybody who never joined.
  challengeEnrolled: false,
  committedModules: [],
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

describe('the surface an enrolled run carries', () => {
  /**
   * A free account inside a run, committed to three modules. The programme is
   * what added these placements, so the programme's own modules are where they
   * land — see `CHALLENGE_BREAKPOINTS`.
   */
  const enrolled: Partial<AdPacingInput> = {
    challengeEnrolled: true,
    committedModules: ['notes', 'water', 'goals'],
  };

  it('changes nothing at all for somebody who never joined', () => {
    /*
     * The single most important assertion in this block. Adding a monetisation
     * surface for enrolled users is only defensible if it is invisible to
     * everybody else, and "invisible" has to mean the extra breakpoints do not
     * merely fail to fire — they must not fire *for a different reason* that
     * some later edit could relax.
     */
    expect(refusal({ breakpoint: 'note-saved' })).toBe('not-enrolled');
    expect(refusal({ breakpoint: 'goal-logged' })).toBe('not-enrolled');
    expect(refusal({ shownThisSession: SESSION_CAP })).toBe('session-cap');
  });

  it('opens the extra breakpoints inside a committed module', () => {
    expect(refusal({ ...enrolled, breakpoint: 'note-saved' })).toBe(null);
    expect(refusal({ ...enrolled, breakpoint: 'goal-logged' })).toBe(null);
  });

  it('leaves a module they did not commit to exactly as it was', () => {
    // Tasks is a real breakpoint and this run did not pick it. Somebody who
    // committed to notes, water and goals sees nothing new in Tasks — the extra
    // load stays proportional to the thing being funded.
    expect(refusal({ ...enrolled, breakpoint: 'task-saved' })).toBe('not-enrolled');
  });

  it('never opens one inside the habit loop or the journal editor', () => {
    /*
     * Both are deliberate omissions from `CHALLENGE_BREAKPOINTS` and both are
     * the kind a later edit "fixes" without knowing why. Ticking a habit is the
     * highest-frequency action in the app and the loop the header of that file
     * names as the one an ad must never sit in front of; the journal autosaves,
     * so there is no moment at which anybody has finished.
     *
     * Asserted with a run that committed to both, which is the only
     * configuration where the omission is what refuses rather than eligibility.
     */
    const committed = { challengeEnrolled: true, committedModules: ['habits', 'journal'] };
    expect(refusal({ ...committed, breakpoint: 'habit-logged' })).toBe('not-a-breakpoint');
    expect(refusal({ ...committed, breakpoint: 'journal-saved' })).toBe('not-a-breakpoint');
  });

  it('still refuses a breakpoint nobody defined', () => {
    // `not-a-breakpoint`, not `not-enrolled`: the two count different things
    // and only one of them is a bug. See 0072.
    expect(refusal({ ...enrolled, breakpoint: 'hub-return' })).toBe('not-a-breakpoint');
  });

  it('raises the ceiling by exactly one', () => {
    expect(refusal({ ...enrolled, shownThisSession: SESSION_CAP })).toBe(null);
    expect(refusal({ ...enrolled, shownThisSession: ENROLLED_SESSION_CAP })).toBe('session-cap');
  });

  it('never opens the challenge screen itself, at any cap', () => {
    // §0.1, and the strongest form of it: the one screen where the reward is
    // being looked at is the one screen an ad must never appear beside.
    expect(refusal({ ...enrolled, breakpoint: 'note-saved', segments: ['challenge'] })).toBe(
      'ad-free-route',
    );
  });

  it('keeps every other rule intact for an enrolled user', () => {
    // The higher ceiling is not a licence. The honeymoon, the first session of
    // the day and the gap are what stop three-per-session ever being reached.
    expect(refusal({ ...enrolled, breakpoint: 'note-saved', installAgeMs: 0 })).toBe('honeymoon');
    expect(refusal({ ...enrolled, breakpoint: 'note-saved', firstSessionToday: true })).toBe(
      'first-session-of-day',
    );
    expect(refusal({ ...enrolled, breakpoint: 'note-saved', sessionAgeMs: 2_000 })).toBe('launch');
    expect(
      refusal({
        ...enrolled,
        breakpoint: 'note-saved',
        lastShownAt: base.now - (MIN_GAP_SECONDS - 1) * 1000,
      }),
    ).toBe('too-soon');
  });
});
