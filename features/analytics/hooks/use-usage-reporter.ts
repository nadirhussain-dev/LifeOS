import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { flushFunnel } from '@/features/analytics/services/funnel-reporter';
import { trackFunnel } from '@/features/analytics/store/funnel-store';
import { flushUsage } from '@/features/analytics/services/usage-reporter';
import { trackModuleOpen, useUsageStore } from '@/features/analytics/store/usage-store';
import { moduleForPath } from '@/features/hub/config/route-modules';

/**
 * Turns navigation into the "opens" half of the usage rollup.
 *
 * Deliberately derived from the route rather than instrumented per screen:
 * one file that no module has to remember to call, which also means deep links
 * and back-navigation are counted the same way a tap is. The path is mapped to
 * a module id (see route-modules.ts, shared with the module guard) and then
 * discarded — record ids, never routes, or the rollup starts carrying
 * `/journal/entry/<uuid>` and stops being a rollup.
 */

export function useUsageReporter() {
  const pathname = usePathname();
  const hydrated = useUsageStore((s) => s.hydrated);
  const lastModule = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const module = moduleForPath(pathname);
    // Moving between screens of the same module is one visit, not five.
    if (!module || module === lastModule.current) return;
    lastModule.current = module;
    trackModuleOpen(module);
  }, [pathname, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    // Both buffers ride the same trigger. They are separate stores with
    // separate consent rules but the same answer to "when is it cheapest to
    // send" — and a second AppState listener for the second one would only be
    // a second thing to keep in step with this.
    const flush = () => {
      void flushUsage();
      void flushFunnel();
    };

    /**
     * One `app_opened` per foreground session — the counter retention is
     * computed from (see migration 0077).
     *
     * Counted here rather than at the root because this is already the file
     * that owns "the app is being used": it holds the only AppState listener on
     * the analytics side and it already waits for `hydrated`, which is when
     * consent is known. Firing before that would either lose the count or
     * record it against an answer that had not been read yet.
     *
     * `active` alone is not a session boundary. iOS sends it after a passing
     * `inactive` — a notification banner, the app switcher, a permission sheet
     * — so counting every `active` would inflate a day's sessions several times
     * over and make the retention denominator meaningless. Only a return from
     * `background` counts, plus the mount itself for the cold start.
     */
    let wasBackgrounded = false;
    flush();
    trackFunnel('app_opened');

    const sub = AppState.addEventListener('change', (state) => {
      // On the way out: the buffer is at its fullest and the request is not
      // competing with anything the user is waiting for.
      if (state === 'background' || state === 'active') flush();

      if (state === 'background') wasBackgrounded = true;
      else if (state === 'active' && wasBackgrounded) {
        wasBackgrounded = false;
        trackFunnel('app_opened');
      }
    });
    return () => sub.remove();
  }, [hydrated]);
}
