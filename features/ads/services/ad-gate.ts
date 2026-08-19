import { getInstallAt } from '@/features/analytics/services/install-id';
import { trackFunnel } from '@/features/analytics/store/funnel-store';
import type { FunnelMetric } from '@/features/analytics/config/funnel-metrics';
import { ADS_MODULE_ID } from '@/features/ads/config';
import { mayShowFullScreenAd, type AdRefusal } from '@/features/ads/services/ad-pacing';
import { isAdFree } from '@/features/ads/store/ad-free-store';
import { useAdSessionStore } from '@/features/ads/store/ad-session-store';
import { useAdsConsentStore } from '@/features/ads/store/ads-consent-store';
import { useBillingStore } from '@/features/billing/store/billing-store';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';

/**
 * The runtime half of the pacing rules — everything `ad-pacing.ts` refuses to
 * know about.
 *
 * That file is pure on purpose: every rule in it is a function of arguments, so
 * the rules can be exhaustively tested without a store, a clock or a native
 * module. This is the seam where those arguments are gathered, and where the
 * three gates that are *not* pacing questions are applied — the `ads`
 * entitlement, UMP consent, and the operator's kill switch. A screen should
 * never assemble that list itself; there is one answer to "may I show a
 * full-screen ad" and it is here.
 *
 * ## Why the refusal is reported
 *
 * `ad-pacing.ts` names its refusals rather than returning a bare false, and
 * this is what that naming was for. Without it the only observable when revenue
 * comes in under model is that it came in under model, with nothing anywhere to
 * say which rule spent it — an over-tight cooldown and a broken breakpoint look
 * identical from the outside. Each reason maps to a funnel metric (0066), so
 * the answer is a query rather than an argument.
 *
 * The three non-pacing gates are deliberately *not* reported. An ad withheld
 * from a paying subscriber, or from somebody who declined consent, is the
 * system working — counting those would bury the refusals that mean something
 * under a much larger number that means nothing.
 */

const METRIC_FOR_REFUSAL: Record<AdRefusal, FunnelMetric> = {
  honeymoon: 'ad_refused_honeymoon',
  'first-session-of-day': 'ad_refused_first_session_of_day',
  'session-cap': 'ad_refused_session_cap',
  'too-soon': 'ad_refused_too_soon',
  'ad-free-route': 'ad_refused_ad_free_route',
  'not-a-breakpoint': 'ad_refused_not_a_breakpoint',
  launch: 'ad_refused_launch',
};

/**
 * Whether a full-screen ad may be shown right now.
 *
 * Async only because the install date lives in SecureStore. Everything else is
 * read synchronously from stores that are already in memory.
 *
 * Callers must pass the route segments they are actually on — `useSegments()`
 * from expo-router. Passing a stale or guessed value is how an ad ends up over
 * the private space, which is the one outcome `features/ads/config.ts` promises
 * cannot happen.
 */
export async function mayShowAdNow(input: {
  segments: string[];
  breakpoint: string;
}): Promise<boolean> {
  // Entitlement, consent and the kill switch, in that order. None is a pacing
  // question and none is reported: an ad withheld from a subscriber is the
  // system working.
  const entitlements = useBillingStore.getState().entitlements;
  if (!entitlements.ads) return false;
  // A window somebody bought with a rewarded view. Not reported for the same
  // reason the entitlement is not: an ad withheld because the user is owed a
  // quiet day is the system working.
  if (isAdFree()) return false;
  if (!useAdsConsentStore.getState().canRequestAds) return false;
  if (useModuleFlagsStore.getState().flags[ADS_MODULE_ID]?.enabled === false) return false;

  const session = useAdSessionStore.getState();
  if (!session.hydrated) return false;

  const now = Date.now();
  const installedAt = await getInstallAt();

  const result = mayShowFullScreenAd({
    segments: input.segments,
    breakpoint: input.breakpoint,
    installAgeMs: now - installedAt,
    shownThisSession: session.shownThisSession,
    lastShownAt: session.lastShownAt,
    firstSessionToday: session.firstSessionToday,
    sessionAgeMs: now - session.sessionStartedAt,
    now,
  });

  if (!result.allowed) {
    trackFunnel(METRIC_FOR_REFUSAL[result.reason]);
    return false;
  }
  return true;
}

/**
 * Records that a full-screen ad reached the screen.
 *
 * Called on the SDK's "opened" callback, never on a request or a load: an ad
 * that was fetched and never shown has cost the user nothing, and spending a
 * session slot on it would let a run of unfilled requests silently use up the
 * cap.
 */
export function recordAdShown(): void {
  useAdSessionStore.getState().recordShown();
  trackFunnel('ad_impression');
}
