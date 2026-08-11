import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  filterByRole,
  PRIVATE_MODULES,
  type PrivateModuleId,
} from '@/features/private/config/private-modules';
import type { VaultSpace } from '@/features/private/services/vault-keys';
import { useProfileStore } from '@/features/profile/store/profile-store';

/**
 * Two kinds of state, deliberately kept apart.
 *
 * The **master key and the unlocked space are runtime-only**. They live in this
 * store because everything needs them, and they are excluded from `partialize`
 * so they can never reach AsyncStorage — a key written to a plaintext file
 * would undo the entire scheme, and this is the one line where that mistake
 * would be made.
 *
 * The **preferences** persist: which private modules the user turned on, and
 * how long the space stays unlocked. Note what is *not* recorded anywhere
 * outside the encrypted rows themselves — nothing here says which modules hold
 * data, only which are switched on.
 */

/** Locking on background is the whole point; the grace period exists so that
 * picking a photo (which backgrounds the app) does not lock the vault behind
 * the user mid-task. */
export const AUTO_LOCK_GRACE_MS = 20_000;

type PrivateState = {
  // --- runtime only ---
  /** The unwrapped master key. Present exactly while the space is unlocked. */
  key: Uint8Array | null;
  space: VaultSpace | null;
  /** When the app last went to background, for the grace-period check. */
  backgroundedAt: number | null;

  // --- persisted ---
  enabledModules: PrivateModuleId[];
  /**
   * Ordinary Hub modules the user has moved behind the vault.
   *
   * Distinct from `enabledModules`, and the difference is where the data lives.
   * A private module's rows are encrypted blobs in `private_entries`. A
   * *privatised* module keeps its own ordinary tables — moving it here hides it
   * from the Hub, gates its routes behind the PIN, and takes it out of search,
   * export and notifications, but does not re-encrypt anything. The settings
   * screen says exactly that, because the difference matters and the word
   * "private" invites people to assume the stronger one.
   */
  privatised: string[];
  /**
   * Takes the private-space row out of the Settings screen entirely.
   *
   * Until now the row's *existence* was treated as acceptable to disclose — the
   * contents are the secret, and hiding the only way back in is worse than an
   * onlooker knowing the feature is there. That reasoning holds right up to the
   * point where somebody is scrolling through your Settings with you watching,
   * and it is the one place the app still says "this person has something to
   * hide".
   *
   * So the row can be removed, but only once there is another way in: a
   * long-press on the version number in Settings → About. The gesture works
   * whether or not the row is hidden, so it can become habit before it becomes
   * the only route, and the confirmation that turns this on spells it out.
   */
  hiddenFromSettings: boolean;
  /** Set once the user finishes the private-space setup flow. */
  setUpComplete: boolean;
  /**
   * The override for `filterByRole()` (private-modules.ts). Off by default —
   * flipping it on is always a deliberate act in Private Settings, never a
   * side effect of the gender answer or anything else, because it is the one
   * thing standing between a hard-gated module and an account it doesn't
   * recognise as female or male.
   */
  showAllModules: boolean;
  hydrated: boolean;

  unlock: (key: Uint8Array, space: VaultSpace) => void;
  lock: () => void;
  markBackgrounded: () => void;
  clearBackgrounded: () => void;
  setEnabledModules: (ids: PrivateModuleId[]) => void;
  toggleModule: (id: PrivateModuleId) => void;
  setPrivatised: (ids: string[]) => void;
  togglePrivatised: (id: string) => void;
  setHiddenFromSettings: (hidden: boolean) => void;
  setSetUpComplete: (complete: boolean) => void;
  setShowAllModules: (show: boolean) => void;
  /** Forgets the preferences too — used when the space is destroyed. */
  reset: () => void;
};

export const usePrivateStore = create<PrivateState>()(
  persist(
    (set, get) => ({
      key: null,
      space: null,
      backgroundedAt: null,
      enabledModules: [],
      privatised: [],
      hiddenFromSettings: false,
      setUpComplete: false,
      showAllModules: false,
      hydrated: false,

      unlock: (key, space) => set({ key, space, backgroundedAt: null }),
      lock: () => set({ key: null, space: null, backgroundedAt: null }),
      markBackgrounded: () => set({ backgroundedAt: Date.now() }),
      clearBackgrounded: () => set({ backgroundedAt: null }),

      setEnabledModules: (enabledModules) => set({ enabledModules }),
      toggleModule: (id) =>
        set((s) => ({
          enabledModules: s.enabledModules.includes(id)
            ? s.enabledModules.filter((m) => m !== id)
            : [...s.enabledModules, id],
        })),
      setPrivatised: (privatised) => set({ privatised }),
      togglePrivatised: (id) =>
        set((s) => ({
          privatised: s.privatised.includes(id)
            ? s.privatised.filter((m) => m !== id)
            : [...s.privatised, id],
        })),
      setHiddenFromSettings: (hiddenFromSettings) => set({ hiddenFromSettings }),
      setSetUpComplete: (setUpComplete) => set({ setUpComplete }),
      setShowAllModules: (showAllModules) => set({ showAllModules }),

      reset: () =>
        set({
          key: null,
          space: null,
          backgroundedAt: null,
          enabledModules: [],
          privatised: [],
          // Deliberately cleared. Destroying the space and leaving the row
          // hidden would take the feature out of Settings for somebody who no
          // longer has a vault to get back into.
          hiddenFromSettings: false,
          setUpComplete: false,
          showAllModules: false,
        }),
    }),
    {
      name: 'private-store',
      storage: createJSONStorage(() => AsyncStorage),
      // The key, the space and the background timestamp are runtime-only. If
      // you add a field here, ask whether it would tell somebody reading the
      // file what is inside the vault.
      partialize: (s) => ({
        enabledModules: s.enabledModules,
        privatised: s.privatised,
        hiddenFromSettings: s.hiddenFromSettings,
        setUpComplete: s.setUpComplete,
        showAllModules: s.showAllModules,
      }),
      onRehydrateStorage: () => () => {
        usePrivateStore.setState({ hydrated: true });
      },
    },
  ),
);

/** The master key, or null when locked. Callable outside React — the
 * repository needs it on every read. */
export function vaultKey(): Uint8Array | null {
  return usePrivateStore.getState().key;
}

export function isUnlocked(): boolean {
  return usePrivateStore.getState().key !== null;
}

/**
 * Whether an ordinary Hub module has been moved behind the vault and is
 * currently locked. Callable outside React — search and export both need it,
 * and neither runs in a component.
 */
export function isPrivatisedAndLocked(moduleId: string): boolean {
  const state = usePrivateStore.getState();
  return state.privatised.includes(moduleId) && state.key === null;
}

/** Every privatised module id, regardless of lock state. Export uses this: a
 * module the user has chosen to keep private stays out of the plaintext backup
 * whether or not the vault happens to be open at the time. */
export function privatisedModules(): string[] {
  return usePrivateStore.getState().privatised;
}

/** Every enabled module id that is `requiresRealSpace` — computed once so
 *  `visiblePrivateModules()` doesn't re-derive it on every call. */
const REAL_SPACE_ONLY_MODULES = new Set(
  PRIVATE_MODULES.filter((m) => m.requiresRealSpace).map((m) => m.id),
);

/**
 * Modules to show, which is the intersection of "switched on" and "unlocked".
 * Locked returns nothing at all, so no caller can accidentally render a hint
 * that a module exists.
 *
 * The decoy space also unlocks with a non-null key, and for every module up
 * to this one that was enough: real-space content is encrypted under a key
 * the decoy genuinely does not have, so there was nothing to hide beyond the
 * card itself. Shared albums broke that assumption — their membership is
 * ordinary server-side metadata, unrelated to which local key unlocked this
 * device — so anything marked `requiresRealSpace` is filtered out here
 * whenever `space !== 'real'`, on top of the card being hidden. This is the
 * fix for that gap; see private-modules.ts's header for the full reasoning.
 *
 * Also re-applies `filterByRole()` rather than trusting `enabledModules` on
 * its own — that list can hold a hard-gated module (e.g. Cycle) from a time
 * `showAllModules` was briefly turned on, since toggling it back off never
 * removes anything already enabled. Without this, a stale entry would keep
 * resurfacing here even though the home grid stopped showing its card.
 */
export function visiblePrivateModules(): PrivateModuleId[] {
  const state = usePrivateStore.getState();
  if (!state.key) return [];
  const gender = useProfileStore.getState().gender;
  const roleVisible = filterByRole(state.enabledModules, gender, state.showAllModules);
  if (state.space === 'real') return roleVisible;
  return roleVisible.filter((id) => !REAL_SPACE_ONLY_MODULES.has(id));
}
