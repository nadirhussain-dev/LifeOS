import { REWARDS_MODULE_ID } from '@/features/challenge/config/rewards-flag';

/**
 * Modules this build does not ship, regardless of what the server says.
 *
 * The operator's `module_flags` switch already turns a module off everywhere
 * (see module-flags-store.ts), but it is a *remote* switch: it needs a row in
 * the database, it arrives after the first fetch, and a guest on a cold start
 * has the module for as long as that takes. This list is the same decision
 * taken at build time, for a module we are holding back rather than pulling in
 * an incident — it is true before the first frame and cannot be undone by a
 * successful fetch that says otherwise.
 *
 * It is applied by merging into the flag cache rather than checked at each
 * call site, so every gate that already honours the operator's switch honours
 * this one too: the Hub grid, the route guard, global search, the home-screen
 * widget, the reminder scheduler and the insight engine. Adding a check to
 * each of those instead is how one of them gets forgotten, and the forgotten
 * one is a deep link into a module that is supposed to be gone.
 *
 * Deliberately *not* surfaced as "unavailable" on the Hub the way an operator
 * disable is — see the `disabled` list in app/(tabs)/hub.tsx. That list exists
 * to explain a module that was there yesterday and is not today. A module this
 * build never shipped has nothing to explain.
 *
 * To ship Challenge again, empty this array. Nothing else is stubbed out: the
 * screens, the store, the season maths and their tests are all still here and
 * still run in CI.
 */
export const LOCALLY_DISABLED_MODULES: readonly string[] = [REWARDS_MODULE_ID];

export function isLocallyDisabled(moduleId: string): boolean {
  return LOCALLY_DISABLED_MODULES.includes(moduleId);
}
