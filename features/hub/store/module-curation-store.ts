import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Whether the Hub shows every module or only the ones matching the focus
 * areas picked during onboarding (see features/hub/config/module-focus-map.ts).
 *
 * A preference, never a gate — same philosophy as the private-space "suggest,
 * don't restrict" stance in profile-store.ts: every module a user didn't pick
 * is one tap away in the Hub's "N more modules" prompt or this same switch in
 * Settings, not permanently hidden.
 */
type ModuleCurationState = {
  showAllModules: boolean;
  setShowAllModules: (value: boolean) => void;
};

export const useModuleCurationStore = create<ModuleCurationState>()(
  persist(
    (set) => ({
      showAllModules: false,
      setShowAllModules: (showAllModules) => set({ showAllModules }),
    }),
    { name: 'module-curation-store', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
