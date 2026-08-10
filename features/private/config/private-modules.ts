import {
  Droplets,
  HeartHandshake,
  Images,
  Lock,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react-native';

import { moduleTints, type TintPair } from '@/constants/design-tokens';
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
 *  2. **`suggestFor` suggests.** It pre-ticks the setup list for somebody who
 *     answered the gender question; it never gates. Every module stays
 *     reachable from "Show everything" regardless of the answer, because the
 *     alternative is an app that tells people their own life doesn't fit.
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
 */
export type PrivateModuleId = 'vault' | 'cycle' | 'recovery' | 'intimacy' | 'shared-albums';

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
  },
  {
    id: 'recovery',
    titleKey: 'private.recoveryTitle',
    subtitleKey: 'private.recoverySubtitle',
    icon: ShieldCheck,
    tint: moduleTints.recovery,
    suggestFor: ['male'],
    route: '/private/recovery',
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
];

export function privateModule(id: PrivateModuleId): PrivateModule | undefined {
  return PRIVATE_MODULES.find((m) => m.id === id);
}

/** What to pre-tick on the setup screen. An unanswered gender question suggests
 * only the universal ones rather than guessing. */
export function suggestedFor(gender: Gender | null): PrivateModuleId[] {
  if (!gender) return ['vault'];
  return PRIVATE_MODULES.filter((m) => m.suggestFor.includes(gender)).map((m) => m.id);
}
