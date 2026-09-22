/**
 * Modules this build does not ship, regardless of what the server says.
 *
 * The operator's `module_flags` switch already turns a module off everywhere
 * (see module-flags-store.ts), but it is a *remote* switch: it needs a row in
 * the database, it arrives after the first fetch, and a guest on a cold start
 * has the module for as long as that takes. This list is the same decision
 * taken at build time, for a module being held back rather than pulled in an
 * incident — it is true before the first frame and cannot be undone by a
 * successful fetch that says otherwise.
 *
 * It is applied by merging into the flag cache rather than checked at each call
 * site, so every gate that already honours the operator's switch honours this
 * one too: the Hub grid, the route guard, global search, the home-screen
 * widget, the reminder scheduler and the insight engine. Adding a check to each
 * of those instead is how one of them gets forgotten, and the forgotten one is
 * a deep link into a module that is supposed to be gone.
 *
 * Deliberately *not* surfaced as "unavailable" on the Hub the way an operator
 * disable is — see the `disabled` list in app/(tabs)/hub.tsx. That list exists
 * to explain a module that was there yesterday and is not today. A module this
 * build never shipped has nothing to explain.
 *
 * **Empty is the normal state**, and it is empty now. It held `rewards` while
 * the streak programme was being withheld; that module has since been removed
 * outright rather than hidden, so there is nothing to hold back. The mechanism
 * stays because the next module that needs withholding should not have to
 * rediscover that a remote switch cannot do it — `module-availability.test.ts`
 * drives it with a synthetic id so it is proven to work while the list is
 * empty.
 */
export const LOCALLY_DISABLED_MODULES: readonly string[] = [];

export function isLocallyDisabled(moduleId: string): boolean {
  return LOCALLY_DISABLED_MODULES.includes(moduleId);
}
