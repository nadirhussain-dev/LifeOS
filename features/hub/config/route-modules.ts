/**
 * Maps a route's first path segment to the module that owns it.
 *
 * Two features need this and must agree: usage reporting (which module was
 * opened) and the module guard (may this be opened at all). Keeping one map
 * means a module cannot be counted under one identity and gated under another
 * — and, more importantly, that adding a module to one list and forgetting the
 * other is not possible.
 *
 * Matching on the first segment is deliberate: it covers every sub-route a
 * module has, so `/budget/transactions/x` is gated by the same rule as
 * `/budget`. A per-screen guard would have to be remembered on each of them,
 * and the one that gets forgotten is the deep link somebody actually follows.
 */
export const SEGMENT_TO_MODULE: Record<string, string> = {
  '': 'dashboard',
  index: 'dashboard',
  tasks: 'tasks',
  task: 'tasks',
  habits: 'habits',
  habit: 'habits',
  routine: 'habits',
  journal: 'journal',
  hub: 'hub',
  // The operator's switch for the whole streak program. Named `rewards` rather
  // than `challenge` because that is the id `module_flags` is seeded with, and
  // this map is what makes the flag actually gate the routes.
  challenge: 'rewards',
  goals: 'goals',
  insights: 'insights',
  study: 'study',
  notes: 'notes',
  note: 'notes',
  timeline: 'timeline',
  sleep: 'sleep',
  'water-intake': 'water',
  budget: 'budget',
  split: 'split',
  gallery: 'gallery',
  music: 'music',
  settings: 'settings',
  search: 'search',
  notifications: 'notifications',
};

/** The module a path belongs to, or null for routes that belong to none
 * (auth, onboarding, the private space's own screens — see
 * `privateModuleForPath` below for those). */
export function moduleForPath(pathname: string): string | null {
  // Route groups are dropped before the first segment is taken. `usePathname()`
  // has already resolved them away, so this changes nothing for the guard — but
  // the hrefs held in registries have not, and `/(tabs)/habits` would otherwise
  // answer `null` and read as "belongs to no module". That is the safe-looking
  // wrong answer: it means "never gated".
  const segment =
    pathname
      .split('?')[0]
      .split('/')
      .filter((part) => part.length > 0 && !part.startsWith('('))[0] ?? '';
  return SEGMENT_TO_MODULE[segment] ?? null;
}

/**
 * The private module (private-modules.ts's `PrivateModuleId`) a `/private/*`
 * path belongs to, or null for the private space's own non-module screens
 * (home, settings, unlock, insights, transfer/receive).
 *
 * A second, private-specific map rather than folding these into
 * `SEGMENT_TO_MODULE`: that map keys on the route's first segment alone, and
 * every private route's first segment is `"private"` — a second segment is
 * needed to tell `cycle` from `vault` from `recovery` apart.
 */
const PRIVATE_SEGMENT_TO_MODULE: Record<string, string> = {
  cycle: 'cycle',
  recovery: 'recovery',
  intimacy: 'intimacy',
  vault: 'vault',
  albums: 'shared-albums',
};

export function privateModuleForPath(pathname: string): string | null {
  const segments = pathname.split('?')[0].split('/').filter(Boolean);
  if (segments[0] !== 'private') return null;
  return PRIVATE_SEGMENT_TO_MODULE[segments[1] ?? ''] ?? null;
}
