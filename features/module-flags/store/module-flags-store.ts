import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { LOCALLY_DISABLED_MODULES } from '@/features/hub/config/module-availability';

/**
 * Cached remote module switches (0011's `module_flags`).
 *
 * Persisted so a cold start on a plane behaves like the last known good state
 * rather than briefly showing a module the operator has already pulled. But the
 * cache only ever holds *overrides* — a module with no entry is enabled, which
 * makes "we have never heard from the server" and "the server says everything
 * is fine" the same state, and that is the safe direction to collapse them in.
 */
export type ModuleFlag = { enabled: boolean; message: string | null };

/**
 * The build-time disables, in the shape the cache holds.
 *
 * Applied last on every write and on rehydration, so a module this build does
 * not ship stays off through a successful fetch that says it is on, a stale
 * cache from a build that did ship it, and `clear()` on sign-out alike. The
 * remote switch can still turn a shipped module *off*; it can never turn one
 * of these *on*, which is the asymmetry the whole file is built around.
 */
function withLocalDisables(flags: Record<string, ModuleFlag>): Record<string, ModuleFlag> {
  if (LOCALLY_DISABLED_MODULES.length === 0) return flags;
  const merged = { ...flags };
  for (const moduleId of LOCALLY_DISABLED_MODULES) {
    merged[moduleId] = { enabled: false, message: null };
  }
  return merged;
}

type ModuleFlagsState = {
  /** Module id → override. Absent means enabled. */
  flags: Record<string, ModuleFlag>;
  fetchedAt: number | null;

  setFlags: (flags: Record<string, ModuleFlag>) => void;
  clear: () => void;
};

export const useModuleFlagsStore = create<ModuleFlagsState>()(
  persist(
    (set) => ({
      flags: withLocalDisables({}),
      fetchedAt: null,

      setFlags: (flags) => set({ flags: withLocalDisables(flags), fetchedAt: Date.now() }),
      clear: () => set({ flags: withLocalDisables({}), fetchedAt: null }),
    }),
    {
      name: 'module-flags-store',
      storage: createJSONStorage(() => AsyncStorage),
      /**
       * Persisted state wins over the initial state for `flags` — that is the
       * point of the cache — so the build-time disables have to be re-applied
       * on the way out of storage as well. Without this an install that
       * cached a build where the module shipped would keep it.
       */
      merge: (persisted, current) => {
        const next = { ...current, ...(persisted as Partial<ModuleFlagsState>) };
        return { ...next, flags: withLocalDisables(next.flags ?? {}) };
      },
    },
  ),
);

/**
 * Whether a module may be shown. Callable outside React.
 *
 * Defaults to true for anything not explicitly switched off — an unreachable
 * server, an empty cache and a healthy module all have to look identical here,
 * or a network blip strips somebody's app down to nothing.
 */
export function isModuleEnabled(moduleId: string): boolean {
  return useModuleFlagsStore.getState().flags[moduleId]?.enabled !== false;
}

/** The operator's explanation, when there is one. */
export function moduleDisabledMessage(moduleId: string): string | null {
  const flag = useModuleFlagsStore.getState().flags[moduleId];
  return flag && !flag.enabled ? flag.message : null;
}
