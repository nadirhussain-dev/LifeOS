import { useEffect } from 'react';
import { AppState } from 'react-native';

import { preloadInterstitial } from '@/features/ads/services/interstitial';
import { useAdSessionStore } from '@/features/ads/store/ad-session-store';

/**
 * Marks the boundaries of an ad session, and keeps one interstitial ready.
 *
 * Mounted once at the root, next to `useUsageReporter` and
 * `useChallengeTracking`, because "what counts as a session" has to have one
 * answer. A screen deciding for itself would give the session cap and the
 * launch guard two different ideas of when the session began, and those two
 * rules only work together.
 *
 * A session begins on every return to the foreground, not on cold start alone.
 * That is the definition the pacing rules assume: somebody who backgrounds the
 * app and comes back an hour later has started a new session, and carrying the
 * previous one's spent slots into it would mean a user who checks in five times
 * a day sees ads only in their first check-in.
 *
 * The preload rides the same event because it is the same moment — an ad
 * fetched now is the one that can be shown instantly at a breakpoint later, and
 * fetching it *at* the breakpoint is what produces an ad appearing after the
 * user has already moved on.
 */
export function useAdSession(): void {
  const hydrated = useAdSessionStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) return;

    const begin = () => {
      useAdSessionStore.getState().beginSession();
      preloadInterstitial();
    };
    begin();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') begin();
    });
    return () => sub.remove();
  }, [hydrated]);
}
