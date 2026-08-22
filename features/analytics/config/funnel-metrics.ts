/**
 * The closed set of funnel metrics, mirroring `funnel_metrics()` in
 * supabase/migrations/0066_funnel_metrics.sql.
 *
 * Two copies of one list, held together by a test (`funnel-metrics.test.ts`)
 * that reads the migration and compares. The server's copy is the authority —
 * it silently skips anything it does not recognise — so a metric added here and
 * not there is a call site reporting into a void with nothing anywhere going
 * red. That is precisely the failure the test exists to make loud.
 *
 * A closed union rather than a string is what makes a typo a compile error
 * instead of a missing line on a chart six weeks later.
 */
export const FUNNEL_METRICS = [
  'onboarding_started',
  'onboarding_reached_account',
  'onboarding_reached_about',
  'onboarding_reached_focus',
  'onboarding_reached_shape',
  'onboarding_reached_learn',
  'onboarding_reached_lock',
  'onboarding_reached_ready',
  'onboarding_completed',

  'notif_prompt_shown',
  'notif_permission_granted',
  'notif_permission_denied',

  'ad_impression',
  'ad_refused_honeymoon',
  'ad_refused_first_session_of_day',
  'ad_refused_session_cap',
  'ad_refused_too_soon',
  'ad_refused_ad_free_route',
  'ad_refused_not_a_breakpoint',
  'ad_refused_launch',
  /** A challenge breakpoint fired for somebody not in a run, or in a module
   *  they did not commit to. Allowlisted server-side in 0072. */
  'ad_refused_not_enrolled',
] as const;

export type FunnelMetric = (typeof FUNNEL_METRICS)[number];

/**
 * The metrics allowed to accrue *before* the usage-consent card is answered —
 * and the reason this file has a second list at all.
 *
 * `usage-consent-card.tsx` deliberately waits for onboarding to finish: "a
 * first-run screen stack that opens on a data-collection question, before the
 * app has shown what it does, gets answered by somebody with no basis for
 * answering." That is right, and it means the entire onboarding funnel happens
 * before anybody has been asked.
 *
 * So these buffer locally while the question is outstanding, under three
 * conditions that are the whole justification:
 *
 *   - **Nothing is transmitted before consent.** The reporter refuses to send
 *     while the question is unanswered, so the buffer sits on the device.
 *   - **Declining erases them.** Clearing on a refusal mirrors what
 *     `usage-store` already does with its pending counters: a counter collected
 *     before consent was refused must not be sent, and must not be sitting
 *     there to flush the moment consent is later given.
 *   - **The window is minutes, not forever.** The card appears as soon as
 *     onboarding ends, so this holds at most one setup run's worth of counters.
 *
 * Everything not in this list follows the ordinary rule and is dropped outright
 * while consent is unresolved. Ads in particular: they start showing three days
 * after install, by which point the question has long been answered, so there
 * is nothing to buffer for and no reason to widen the exception.
 */
export const PRE_CONSENT_METRICS: readonly FunnelMetric[] = [
  'onboarding_started',
  'onboarding_reached_account',
  'onboarding_reached_about',
  'onboarding_reached_focus',
  'onboarding_reached_shape',
  'onboarding_reached_learn',
  'onboarding_reached_lock',
  'onboarding_reached_ready',
  'onboarding_completed',
  'notif_prompt_shown',
  'notif_permission_granted',
  'notif_permission_denied',
];
