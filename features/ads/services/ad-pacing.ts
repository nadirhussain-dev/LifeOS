/**
 * When a full-screen ad may be shown — the one place that decision is made.
 *
 * ## Why this exists before the ad formats do
 *
 * A banner appears where somebody wrote `<AdSlot>`. A full-screen ad appears
 * because a *rule* fired, and the rule is the product. Interstitials shipped
 * without one are the single most reliable way to trade a retained user for
 * a fraction of a cent, and the damage does not show up in ad revenue — which
 * goes up — but in a retention curve nobody attributes to it a month later.
 *
 * So the rules live here, pure and tested, before anything can show an ad. The
 * caller composes this with the two gates that already exist and are not
 * pacing questions: the `ads` entitlement (`useEntitlement('ads')`) and UMP
 * consent (`useAdsConsentStore`). Neither belongs in this file; both must be
 * true before it is even asked.
 *
 * ## The policy floor, and why it is in code rather than in a doc
 *
 * Several of the rules below are not taste — they are the Google AdMob
 * policies on ad placement and accidental clicks, and breaking them risks the
 * account rather than the metric:
 *
 *  - **Never on app launch.** An interstitial in front of a cold start is the
 *    canonical "unexpected ad" violation. That is what the app-open format
 *    exists for, and Daykeep deliberately does not use it (see
 *    docs/GROWTH_PLAN.md §1.3): the core loop is "open, tick a habit, close",
 *    often from a reminder, and an ad in front of every one of those ruins the
 *    app's best habit.
 *  - **Never two in a row.** `MIN_GAP_SECONDS` is the floor between any two
 *    full-screen ads of any format.
 *  - **Only at a genuine break.** An ad has to interrupt *nothing* — the end of
 *    a finished flow, not the middle of one. The caller names the breakpoint;
 *    this file refuses everything that is not one.
 *
 * ## And the two rules that are pure product judgement
 *
 * The honeymoon and the first-session exemption are not policy. They are the
 * position argued in the plan: ad revenue is impressions x eCPM x *retained
 * days*, and the third term is the one an ad strategy usually destroys. A user
 * who has not yet decided whether they like this app is worth more later than
 * they are worth now.
 */

/** Routes no full-screen ad may ever appear over. */
export const AD_FREE_SEGMENTS = [
  // Cycle, recovery, intimacy, the vault. `features/ads/config.ts` states the
  // rule for banners and enforces it by never writing the call site, which is
  // the honest fix while a call site is the only way an ad appears. A
  // full-screen ad fires on a *navigation*, so that argument stops being
  // available and this list has to be real.
  'private',
  // Sign-in, sign-up, password reset. An interstitial over an auth flow reads
  // as a phishing screen.
  '(auth)',
  'auth',
  // First run. The honeymoon below already covers this by install age; the
  // segment is listed so the guarantee does not depend on a clock.
  '(onboarding)',
] as const;

/**
 * Days after install before any full-screen ad is shown.
 *
 * Three, not zero. Day-one ads suppress exactly the activation this app spends
 * its whole first run buying, and an install that churns on day two earns one
 * impression instead of the hundreds a retained one earns.
 */
export const HONEYMOON_DAYS = 3;

/** Full-screen ads allowed in one app session. */
export const SESSION_CAP = 2;

/** Floor between any two full-screen ads, whatever their format. */
export const MIN_GAP_SECONDS = 180;

/**
 * The breakpoints a full-screen ad is allowed to fire at.
 *
 * An allowlist rather than a flag, so adding a new one is a deliberate edit to
 * this file with the list of the others in front of you — which is the moment
 * to ask whether it really is a break. Each of these is a point where the user
 * has *finished* something and is not mid-thought.
 */
export const AD_BREAKPOINTS = [
  /** A study timer ran to completion and the session was saved. */
  'study-session-end',
  /** A sleep entry was saved from the log screen. */
  'sleep-log-saved',
  /** A task was composed and added, and the sheet closed behind it. */
  'task-saved',
  /** A note was composed and added, same shape. */
  'note-saved',
  /** Progress was logged against a goal from the log sheet. */
  'goal-logged',
] as const;

/*
 * The last three were the streak programme's, available only to somebody
 * enrolled in a run and only inside a module that run had committed to. The
 * programme is gone; their call sites are not — `task/new.tsx`,
 * `note/new.tsx` and `goals/[id]/log.tsx` all still call `showInterstitial`,
 * and every one of those calls has been refused as `not-a-breakpoint` since.
 * Three live call sites that could never fire.
 *
 * ## Why adding them does not mean more ads
 *
 * This is the part worth being precise about, because "more breakpoints" reads
 * like "more interruptions" and is not.
 *
 * `SESSION_CAP` and `MIN_GAP_SECONDS` bound how many full-screen ads a person
 * can be shown. Breakpoints do not add to that ceiling — they decide *where*
 * the bounded slots may be filled. With two breakpoints, the ceiling of two was
 * reached only by somebody who finished a study session and logged their sleep
 * in the same session, which is a small fraction of use; everybody else saw
 * fewer ads than the policy allows, not because the policy protected them but
 * because the app ran out of places to offer one. That is revenue given up for
 * no goodwill in return.
 *
 * Five breakpoints fill the same two slots more often, at moments that are all
 * the same shape: composed something, committed it, navigated away. The cap,
 * the three-minute gap, the honeymoon and the first-session-of-day exemption
 * are untouched, which means the worst case for any one person is exactly what
 * it was yesterday.
 *
 * ## Habits and Journal stay out
 *
 * Both exclusions predate the programme and outlive it. Logging a habit is a
 * tap on a tab screen and is the loop this file's header names as the one an ad
 * must never sit in front of — it would be the most lucrative placement in the
 * app and the one most certain to cost more retained days than it earns. The
 * journal editor autosaves, so there is no moment at which anybody has
 * *finished*; inventing one on blur or on back would be an ad fired by
 * navigation rather than by completion, which is what the allowlist exists to
 * prevent.
 */

// "Returning to the Hub from a module" was the obvious third and is
// deliberately absent. It is a weaker break than the two above — arriving
// somewhere is not the same as having finished something — and wiring it needs
// a navigation observer, which is a second way for an ad to be triggered by
// something other than a completed flow. An allowlist entry with no call site
// is also the kind of thing that rots: it reads as supported, and the first
// person to use it inherits a placement nobody chose.

export type AdBreakpoint = (typeof AD_BREAKPOINTS)[number];

/** Why an ad was not shown. Worth naming: without it the only observable is
 *  "revenue is lower than modelled" and no way to find out which rule did it. */
export type AdRefusal =
  | 'honeymoon'
  | 'first-session-of-day'
  | 'session-cap'
  | 'too-soon'
  | 'ad-free-route'
  | 'not-a-breakpoint'
  | 'launch';

export type AdPacingInput = {
  /** Expo Router segments for the screen the user is on right now. */
  segments: string[];
  breakpoint: string;
  /** Milliseconds since the install was first recorded. */
  installAgeMs: number;
  /** Full-screen ads already shown in this app session. */
  shownThisSession: number;
  /** When the last full-screen ad of any format was shown, or null. */
  lastShownAt: number | null;
  /** Whether this is the user's first foreground session today. */
  firstSessionToday: boolean;
  /** How long the app has been in the foreground this session, in ms. */
  sessionAgeMs: number;
  now: number;
};

export type AdPacingResult = { allowed: true } | { allowed: false; reason: AdRefusal };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the current route forbids ads outright.
 *
 * Matches on segment membership rather than a path prefix, because Expo
 * Router's group segments (`(auth)`, `(onboarding)`) do not appear in the URL
 * and a prefix check on the pathname would silently miss them.
 */
export function isAdFreeRoute(segments: string[]): boolean {
  return segments.some((s) => (AD_FREE_SEGMENTS as readonly string[]).includes(s));
}

/**
 * The whole decision, as one pure function.
 *
 * Order matters only for which reason is reported, and the order is chosen so
 * the reported reason is the most *fundamental* one: a user inside the private
 * space during their honeymoon should read as `honeymoon`, because that is the
 * rule that would still refuse them on the Hub tomorrow.
 */
export function mayShowFullScreenAd(input: AdPacingInput): AdPacingResult {
  if (input.installAgeMs < HONEYMOON_DAYS * DAY_MS) {
    return { allowed: false, reason: 'honeymoon' };
  }
  if (input.firstSessionToday) {
    // The first open of the day is the one that earns the retention. The third
    // is the one that earns the revenue.
    return { allowed: false, reason: 'first-session-of-day' };
  }
  // One allowlist, applying to everybody who reaches this file. It was two
  // while the streak programme carried extra placements for the people it was
  // funding itself from; with the programme gone there is a single population
  // and a single list.
  if (!(AD_BREAKPOINTS as readonly string[]).includes(input.breakpoint)) {
    return { allowed: false, reason: 'not-a-breakpoint' };
  }
  if (isAdFreeRoute(input.segments)) {
    return { allowed: false, reason: 'ad-free-route' };
  }
  // A "breakpoint" reached in the first seconds of a session is a cold start
  // that happened to land on one — a deep link from a reminder into the study
  // timer, say. That is a launch, and an ad in front of it is the placement
  // policy exists to prevent.
  if (input.sessionAgeMs < 10_000) {
    return { allowed: false, reason: 'launch' };
  }
  if (input.shownThisSession >= SESSION_CAP) {
    return { allowed: false, reason: 'session-cap' };
  }
  if (input.lastShownAt !== null && input.now - input.lastShownAt < MIN_GAP_SECONDS * 1000) {
    return { allowed: false, reason: 'too-soon' };
  }
  return { allowed: true };
}
