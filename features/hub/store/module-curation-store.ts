import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Which Hub modules the user wants to see.
 *
 * Two layers, because "I never picked this" and "I don't want this" are not the
 * same statement and must not be stored as the same thing.
 *
 * `showAllModules` governs the *inferred* view: the Hub shows only modules
 * matching the focus areas picked during onboarding (see
 * features/hub/config/module-focus-map.ts) unless this is on. It is a guess the
 * app made on the user's behalf from a question answered once.
 *
 * `overrides` is the user's own answer, made module by module in the Hub's
 * module manager. An entry here always wins over the inferred view, in both
 * directions — turning something on that onboarding hid, and turning something
 * off that onboarding kept. Absent means "no opinion, follow the guess", which
 * is why this is a sparse map and not a full list of visible ids: a module
 * added in a later release inherits the guess rather than defaulting to hidden
 * because it wasn't in a list written before it existed.
 *
 * Both are preferences, never gates — same philosophy as the private-space
 * "suggest, don't restrict" stance in profile-store.ts. Nothing here deletes
 * data, and every module is one switch away from coming back.
 */
type ModuleCurationState = {
  showAllModules: boolean;
  /** Module id → the user's explicit choice. Absent = follow focus areas. */
  overrides: Record<string, boolean>;
  setShowAllModules: (value: boolean) => void;
  setModuleEnabled: (id: string, enabled: boolean) => void;
  /** Drops every explicit choice, handing the Hub back to the focus areas. */
  clearOverrides: () => void;
};

export const useModuleCurationStore = create<ModuleCurationState>()(
  persist(
    (set) => ({
      showAllModules: false,
      overrides: {},
      setShowAllModules: (showAllModules) => set({ showAllModules }),
      setModuleEnabled: (id, enabled) =>
        set((state) => ({ overrides: { ...state.overrides, [id]: enabled } })),
      clearOverrides: () => set({ overrides: {} }),
    }),
    {
      name: 'module-curation-store',
      storage: createJSONStorage(() => AsyncStorage),
      // `overrides` postdates the first release of this store, so persisted
      // state from an older build has no such key. zustand's default merge is
      // shallow-over-initial, which leaves the initializer's `{}` in place —
      // no migration needed, and an upgrading user keeps their existing
      // `showAllModules` choice.
    },
  ),
);
