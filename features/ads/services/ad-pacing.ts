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
  // The streak. An ad on top of somebody's daily commitment is the app
  // interrupting the one thing it asked them to do.
  'challenge',
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

/**
 * The cap for a free account inside a run.
 *
 * ## Why an enrolled user carries more, and why that is not a punishment
 *
 * The streak programme is free, it pays out cosmetics and bounded Premium
 * windows, and — at Gate B — a physical box. Somebody has to fund it, and the
 * options are the people who benefit or the people who do not. REWARDS_PROGRAM
 * §2.2's own conclusion is that ad revenue never closes the gap on a box; what
 * it can do is stop the programme being a straight loss against the free tier
 * it is recruiting from.
 *
 * Enrolled free users are also, by construction, the most engaged population in
 * the app: they open it every day, deliberately, and they have a reason to come
 * back that is not the ad. That is exactly the cohort an extra impression costs
 * the least retention on — and the one where a *badly placed* impression costs
 * the most, which is why the placement rules below get stricter rather than
 * looser at the same time.
 *
 * Three, not five. The gap, the honeymoon, the first-session exemption and the
 * breakpoint allowlist all still apply, so this is a ceiling on a number that
 * rarely reaches two.
 *
 * **Plus subscribers are unaffected**, because `mayShowAdNow` never reaches
 * this file for them — the `ads` entitlement is checked first and is false.
 */
export const ENROLLED_SESSION_CAP = 3;

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
] as const;

/**
 * The extra breakpoints an enrolled free user carries, and the module each one
 * belongs to.
 *
 * ## The rule these obey that the ones above do not
 *
 * Every one of these fires **after the write has committed and after the day
 * has been credited**, never before and never as a condition of either. That
 * is not politeness, it is REWARDS_PROGRAM §0.1: an ad may never be part of how
 * a day or a shield is earned. An interstitial sitting between the Save button
 * and the saved row would be an ad on the path that earns progress toward a
 * prize, which is the shape a regulator calls paid entry and AdMob calls
 * incentivised traffic — the same placement, refused for two independent
 * reasons.
 *
 * So the call sites are all *after* `mutate()` and after the navigation away,
 * exactly like the two above, and nothing awaits the result.
 *
 * ## Why they are keyed to a module
 *
 * These only fire inside the modules somebody actually committed to. Two
 * reasons, and the second is the one that decided it:
 *
 *  - It keeps the extra load proportional to the thing being funded. The
 *    programme is what added the impression, so the programme's own surfaces
 *    are where it lands.
 *  - It keeps the surface small and predictable. "Every save in the app" would
 *    be a placement nobody chose, spread across forty screens; three to five
 *    committed modules is a set the user picked themselves and can change.
 *
 * A module the user did not commit to behaves exactly as it does for somebody
 * who never enrolled — no extra breakpoint at all.
 */
export const CHALLENGE_BREAKPOINTS: Record<string, string> = {
  /** A task was composed and added, and the sheet closed behind it. */
  'task-saved': 'tasks',
  /** A note was composed and added, same shape. */
  'note-saved': 'notes',
  /** Progress was logged against a goal from the log sheet. */
  'goal-logged': 'goals',
};

/*
 * Two committed modules deliberately have no breakpoint, and the reasons are
 * different enough to be worth writing down — both are the kind of omission a
 * later edit "fixes" without knowing why it was there.
 *
 *  - **Habits.** Logging a habit is a tap on the tab screen, and the header of
 *    this file already names that loop as the thing an ad must never sit in
 *    front of: "open, tick a habit, close", often from a reminder. It is the
 *    app's best habit and the highest-frequency action in it. An interstitial
 *    there would be the most lucrative placement in the app and the one most
 *    certain to cost more retained days than it earns.
 *  - **Journal.** The editor autosaves, so there is no moment at which somebody
 *    has *finished*. A breakpoint needs a boundary, and inventing one — on
 *    blur, on back — would be an ad fired by navigation rather than by
 *    completion, which is precisely what the allowlist exists to prevent.
 *
 * The three above are all the same shape as the two base breakpoints: composed
 * something, committed it, and navigated away.
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
  | 'launch'
  /** A challenge breakpoint fired for somebody who is not in a run, or in a
   *  module they did not commit to. Named separately from `not-a-breakpoint`
   *  because it is the one refusal that is about *who* rather than *where*, and
   *  conflating the two would hide how much of the extra surface is actually
   *  reachable. */
  | 'not-enrolled';

export type AdPacingInput = {
  /** Expo Router segments for the screen the user is on right now. */
  segments: string[];
  breakpoint: string;
  /** Whether there is a live run on this account. */
  challengeEnrolled: boolean;
  /** The modules committed to in that run. Empty when not enrolled. */
  committedModules: string[];
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
  /*
   * Two allowlists, checked in order of who they apply to.
   *
   * A base breakpoint fires for everybody who reaches this file. A challenge
   * breakpoint fires only inside a live run, and only for a module that run
   * actually committed to — so somebody who never enrolled sees exactly the
   * placements they saw before this existed, and an enrolled user sees nothing
   * extra in a module they did not pick.
   */
  const base = (AD_BREAKPOINTS as readonly string[]).includes(input.breakpoint);
  const committedTo = CHALLENGE_BREAKPOINTS[input.breakpoint];
  if (!base && committedTo === undefined) {
    return { allowed: false, reason: 'not-a-breakpoint' };
  }
  if (
    !base &&
    (!input.challengeEnrolled || !input.committedModules.includes(committedTo as string))
  ) {
    return { allowed: false, reason: 'not-enrolled' };
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
  // The higher ceiling applies to the whole session once somebody is in a run,
  // not only to the challenge breakpoints — it is a property of the account,
  // not of the placement, and splitting it per breakpoint would make the third
  // ad of a session depend on which screen happened to ask for it.
  const cap = input.challengeEnrolled ? ENROLLED_SESSION_CAP : SESSION_CAP;
  if (input.shownThisSession >= cap) {
    return { allowed: false, reason: 'session-cap' };
  }
  if (input.lastShownAt !== null && input.now - input.lastShownAt < MIN_GAP_SECONDS * 1000) {
    return { allowed: false, reason: 'too-soon' };
  }
  return { allowed: true };
}
