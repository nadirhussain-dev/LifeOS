import {
  Droplets,
  Heart,
  HeartHandshake,
  Images,
  Lock,
  ShieldCheck,
  type LucideIcon,
} from '@/components/ui/icons';
import { moduleTints, type TintPair } from '@/constants/design-tokens';
import { PRIVATE_SPACE_MODULE_ID } from '@/features/hub/config/route-modules';
import type { Gender } from '@/features/profile/store/profile-store';

/**
 * The private modules.
 *
 * Three rules make these different from everything in the Hub registry, and all
 * three matter:
 *
 *  1. **They are absent, not locked.** A greyed-out "🔒 Cycle" card tells a
 *     snooping partner exactly what is being hidden, which is the thing the
 *     feature exists to prevent. Nothing here renders anywhere until the
 *     private space is unlocked.
 *  2. **`suggestFor` suggests; `hardGateByRole` decides who sees the module by
 *     default.** This used to be one rule ("suggest, never gate") until the
 *     product decision behind `visibleModules()` below: Cycle and Recovery are
 *     now hidden by default from accounts that didn't answer the matching
 *     gender question, because a body-specific tracker sitting in a shared
 *     module list is itself a disclosure. The one place this could go wrong —
 *     a non-binary, "prefer not to say", or simply mis-set account being
 *     unable to reach a module that fits their life — is why
 *     `showAllModules` (`private-store.ts`) exists: one explicit, opt-in
 *     switch in Private Settings that overrides the gate entirely. It is off
 *     by default and never inferred; nobody sees it flipped on without having
 *     chosen to.
 *  3. **Their content is stored encrypted**, as blobs (see
 *     private-repository.ts), and sync stays off unless explicitly enabled, at
 *     which point only ciphertext is uploaded. Note this is encryption at rest
 *     and in transit, NOT end-to-end: a build with an operator escrow key can
 *     open any private space (vault-escrow.ts, migration 0015).
 *
 * `recovery` is deliberately one module rather than a "quit masturbating"
 * tracker: the same urge/trigger/streak model serves porn, alcohol, smoking,
 * gambling and vaping, which is more useful code, a far larger audience, and
 * does not put a single embarrassing word in the module list.
 *
 * `shared-albums` breaks rule 3's "not end-to-end" half — it carries no
 * operator-escrow exception at all, by product decision (see
 * album-keys.ts) — but it ALSO breaks a rule the other four have never had to
 * follow: it is `requiresRealSpace: true`. Every module above is visible to
 * the server as nothing but an opaque row scoped to one uid; a shared album's
 * *membership* — who is in it, how many photos, when it was last touched — is
 * ordinary `auth.uid()`-scoped Postgres metadata, unrelated to which local key
 * unlocked this device. `visiblePrivateModules()` (private-store.ts) has to
 * hide anything marked `requiresRealSpace` from the decoy space for exactly
 * that reason: the decoy's whole guarantee is that real-space content
 * genuinely does not exist under its key, and that stops being true the
 * moment a feature's evidence lives somewhere the local key cannot reach.
 * `shared-albums` is also never role-gated — it's the one module built for
 * two people together, not one body.
 */
export type PrivateModuleId =
  'vault' | 'cycle' | 'recovery' | 'intimacy' | 'shared-albums' | 'together';

/**
 * The same ids as a runtime list.
 *
 * The union above is erased at compile time, and the gates need to *ask* at
 * runtime whether a given module id is one of these — see
 * `isBehindClosedPrivateSpace`. Derived from `PRIVATE_MODULES` would be
 * circular (that array is declared below and carries icons and tints), so it is
 * written out and pinned by a test asserting the two agree.
 */
export const PRIVATE_MODULE_IDS: readonly PrivateModuleId[] = [
  'vault',
  'cycle',
  'recovery',
  'intimacy',
  'shared-albums',
  'together',
] as const;

export type PrivateModule = {
  id: PrivateModuleId;
  titleKey: string;
  subtitleKey: string;
  icon: LucideIcon;
  /** Designed for both themes — resolve with `resolveTint(m.tint, scheme)`. */
  tint: TintPair;
  /** Whose setup list this is pre-ticked on. Never an access check. */
  suggestFor: Gender[];
  route: string;
  /**
   * Hidden from the decoy space even while unlocked, because this module's
   * existence is visible to the server independent of which local key opened
   * the app — see the header comment. Absent (falsy) for every module whose
   * only evidence lives inside ciphertext the decoy key genuinely cannot
   * open.
   */
  requiresRealSpace?: boolean;
  /**
   * Hidden by default from an account whose gender doesn't appear in
   * `suggestFor` — see the header comment. `visibleModules()` is the only
   * place that reads this; every other consumer (search, export, the decoy
   * filter) intentionally stays gender-blind.
   */
  hardGateByRole?: boolean;
};

export const PRIVATE_MODULES: PrivateModule[] = [
  {
    id: 'vault',
    titleKey: 'private.vaultTitle',
    subtitleKey: 'private.vaultSubtitle',
    icon: Lock,
    tint: moduleTints.vault,
    // The one everybody wants, whoever they are.
    suggestFor: ['female', 'male', 'non_binary', 'prefer_not_to_say'],
    route: '/private/vault',
  },
  {
    id: 'cycle',
    titleKey: 'private.cycleTitle',
    subtitleKey: 'private.cycleSubtitle',
    icon: Droplets,
    tint: moduleTints.cycle,
    suggestFor: ['female'],
    route: '/private/cycle',
    hardGateByRole: true,
  },
  {
    id: 'recovery',
    titleKey: 'private.recoveryTitle',
    subtitleKey: 'private.recoverySubtitle',
    icon: ShieldCheck,
    tint: moduleTints.recovery,
    suggestFor: ['male'],
    route: '/private/recovery',
    hardGateByRole: true,
  },
  {
    id: 'intimacy',
    titleKey: 'private.intimacyTitle',
    subtitleKey: 'private.intimacySubtitle',
    icon: HeartHandshake,
    tint: moduleTints.intimacy,
    suggestFor: ['female', 'male', 'non_binary'],
    route: '/private/intimacy',
  },
  {
    id: 'shared-albums',
    titleKey: 'private.sharedAlbumsTitle',
    subtitleKey: 'private.sharedAlbumsSubtitle',
    icon: Images,
    tint: moduleTints.albums,
    suggestFor: ['female', 'male', 'non_binary', 'prefer_not_to_say'],
    route: '/private/albums',
    requiresRealSpace: true,
  },
  {
    id: 'together',
    titleKey: 'private.togetherModuleTitle',
    subtitleKey: 'private.togetherModuleSubtitle',
    icon: Heart,
    // Shares shared-albums' tint deliberately: Together is built directly on
    // top of one designated shared album (see use-shared-albums.ts's
    // `useTogetherHub`), not a separate data model — the shared colour says
    // so. The wheel is otherwise full (see the header note above 'albums').
    tint: moduleTints.albums,
    suggestFor: ['female', 'male', 'non_binary', 'prefer_not_to_say'],
    route: '/private/together',
    // Same reasoning as shared-albums: its membership is ordinary
    // auth.uid()-scoped Postgres metadata, unrelated to which local key
    // unlocked this device, so it must stay out of the decoy space.
    requiresRealSpace: true,
  },
];

/**
 * The door, as the operator console has to list it.
 *
 * `module_flags` holds a row per room — vault, cycle, recovery, intimacy,
 * shared-albums, together — and one for the space itself, and only the last of
 * those decides whether the space exists at all: it is what the route guard
 * reads for every `/private/*` path and what the Settings entry point asks
 * before drawing itself. 0074 seeds it `false`, so the space ships closed.
 *
 * Both operator screens built their list as `HUB_SECTIONS + PRIVATE_MODULES`,
 * and `PRIVATE_MODULES` is the six rooms. The umbrella appeared in neither, so
 * the console could switch off every room while the door stayed exactly as the
 * seed left it — and, the direction that actually bit, an operator who wanted
 * to *open* the space had no switch to do it with. 0074's own closing note
 * describes flipping "the umbrella `private` row on its own"; this is the row
 * it was describing.
 *
 * Shaped as `{ id, titleKey }` because that is all either console list reads,
 * and kept out of `PRIVATE_MODULES` because every other consumer of that array
 * — setup, the decoy filter, `suggestedFor`, the Hub — means *rooms*. Adding a
 * seventh entry there to serve the console would put the space inside itself.
 */
export const PRIVATE_SPACE_SWITCH: { id: string; titleKey: string } = {
  id: PRIVATE_SPACE_MODULE_ID,
  titleKey: 'private.spaceTitle',
};

export function privateModule(id: PrivateModuleId): PrivateModule | undefined {
  return PRIVATE_MODULES.find((m) => m.id === id);
}

/** What to pre-tick on the setup screen. An unanswered gender question suggests
 * only the universal ones rather than guessing. */
export function suggestedFor(gender: Gender | null): PrivateModuleId[] {
  if (!gender) return ['vault'];
  return PRIVATE_MODULES.filter((m) => m.suggestFor.includes(gender)).map((m) => m.id);
}

/**
 * A list of module ids, filtered by role.
 *
 * `hardGateByRole` modules (Cycle, Recovery) are dropped unless `gender`
 * matches their `suggestFor` — or `showAll` is true, which is the one escape
 * hatch and is always an explicit choice (`showAllModules` in
 * `private-store.ts`), never inferred from the gender answer itself. Modules
 * without the flag pass through untouched regardless of `showAll`.
 *
 * Takes a list of ids rather than reading `PRIVATE_MODULES` directly so both
 * callers (the home screen's enabled modules, setup's full catalogue) can
 * reuse the same filter.
 */
export function filterByRole(
  ids: PrivateModuleId[],
  gender: Gender | null,
  showAll: boolean,
): PrivateModuleId[] {
  if (showAll) return ids;
  return ids.filter((id) => {
    const module = privateModule(id);
    if (!module?.hardGateByRole) return true;
    return gender !== null && module.suggestFor.includes(gender);
  });
}

/** Whether `filterByRole` would hide at least one of `ids` for this gender —
 *  the condition that decides whether the "show every module" row is worth
 *  rendering at all. */
export function roleGateHidesAny(ids: PrivateModuleId[], gender: Gender | null): boolean {
  return filterByRole(ids, gender, false).length < ids.length;
}
