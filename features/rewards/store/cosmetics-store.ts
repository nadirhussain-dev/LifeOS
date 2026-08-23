import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CosmeticKind } from '@/features/rewards/types/rewards.types';

/**
 * Which of the cosmetics somebody owns are actually switched on.
 *
 * ## Local, and correct that it is local
 *
 * Ownership is the server's business and is not stored here — only the choice
 * of what to wear. That split is what makes the store safe on a shared or
 * re-signed-in device: the equipped name is a *preference*, and a preference
 * for something the current account does not own resolves to nothing. See
 * `equippedOwned` below, which is the only function any screen should call.
 *
 * The alternative — clearing this on sign-out — was rejected for the reason the
 * audit found the last time: a reset hook is a thing somebody has to remember
 * to wire, and the failure when they do not is silent and wearing somebody
 * else's badge. Validating at the point of use cannot be forgotten, because
 * forgetting it means reading a field that does not exist.
 *
 * ## One slot per kind
 *
 * A theme, a chain and a frame can be worn at once; two chains cannot. Modelled
 * as a map from kind to the single chosen name rather than a list, so the
 * "only one" rule has nowhere to be violated.
 */
type CosmeticsState = {
  /** Kind -> the bare catalog name, e.g. `{ chain: 'ember-glow' }`. */
  equipped: Partial<Record<CosmeticKind, string>>;
  hydrated: boolean;

  equip: (kind: CosmeticKind, name: string | null) => void;
};

export const useCosmeticsStore = create<CosmeticsState>()(
  persist(
    (set) => ({
      equipped: {},
      hydrated: false,

      equip: (kind, name) =>
        set((state) => {
          const next = { ...state.equipped };
          if (name === null) delete next[kind];
          else next[kind] = name;
          return { equipped: next };
        }),
    }),
    {
      name: 'cosmetics-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useCosmeticsStore.setState({ hydrated: true });
      },
    },
  ),
);

/**
 * What is equipped for a kind, **only if this account owns it**.
 *
 * The one entry point. Reading `equipped[kind]` directly is the bug this
 * function exists to make impossible: the store outlives a sign-out, so the
 * raw value can name a cosmetic the person now holding the phone never earned.
 *
 * Pure and takes the owned list as an argument rather than reaching for the
 * query itself, so it is testable without a network, a session or a store —
 * and so the caller cannot accidentally validate against a stale cache it
 * happened to have lying around.
 */
export function equippedOwned(
  equipped: Partial<Record<CosmeticKind, string>>,
  kind: CosmeticKind,
  owned: string[],
): string | null {
  const chosen = equipped[kind];
  if (!chosen) return null;
  return owned.includes(chosen) ? chosen : null;
}
