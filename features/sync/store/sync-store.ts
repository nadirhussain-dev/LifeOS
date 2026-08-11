import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { defaultModuleFlags, type SyncModule } from '@/features/sync/config/sync-tables';

export type SyncStatus = 'idle' | 'syncing' | 'error';

/** Stamped into `lastUserId` by `continueAsGuest()` when no prior real account
 * is known on this device. Lets account-reconcile.ts tell "unidentified guest
 * data" apart from "genuinely nobody's data yet" — see its header comment. */
export const GUEST_SENTINEL = '__guest__';

/**
 * A position in one table's `(updated_at, key)` order — see the header comment
 * in ../services/sync-engine.ts for why a bare timestamp is not enough.
 */
export type SyncCursor = { at: number; key: string };

/** Namespaced so push and pull positions for a table share one map. */
export function cursorKey(kind: 'push' | 'pull', table: string): string {
  return `${kind}:${table}`;
}

/**
 * Reads a stored cursor, tolerating the shape used before cursors became pairs.
 * A legacy numeric cursor names a timestamp with no tie-break, so it is read as
 * "the very start of that millisecond" — the engine may re-send a handful of
 * rows it already sent, which the upsert absorbs. The opposite rounding would
 * skip them.
 */
export function parseCursor(value: unknown): SyncCursor {
  if (typeof value === 'number') return { at: value, key: '' };
  if (value && typeof value === 'object' && 'at' in value) {
    const cursor = value as SyncCursor;
    return { at: Number(cursor.at) || 0, key: String(cursor.key ?? '') };
  }
  return { at: 0, key: '' };
}

/** The pre-pair cursor shape, kept only so an upgrading device does not start
 * from zero and re-download an entire account. */
type LegacyCursors = {
  pushCursors?: Record<string, number>;
  pullCursors?: Record<string, number>;
};

function migrateCursors(saved: LegacyCursors | undefined): Record<string, SyncCursor> {
  const out: Record<string, SyncCursor> = {};
  for (const [table, at] of Object.entries(saved?.pushCursors ?? {})) {
    out[cursorKey('push', table)] = parseCursor(at);
  }
  for (const [table, at] of Object.entries(saved?.pullCursors ?? {})) {
    out[cursorKey('pull', table)] = parseCursor(at);
  }
  return out;
}

type SyncState = {
  /** Master switch for background sync (manual "Sync now" still works). */
  autoSync: boolean;
  /** Per-module allow-sync consent. */
  modules: Record<SyncModule, boolean>;
  /** Per-table high-water marks, keyed by `cursorKey()`, so each sync only
   * moves the delta. */
  cursors: Record<string, SyncCursor>;
  lastSyncedAt: number | null;
  /** Set after a failure; automatic syncs are skipped until it passes. Manual
   * "Sync now" ignores it. */
  nextAttemptAt: number | null;
  consecutiveFailures: number;
  /** The uid whose data currently lives in the local ('local') DB. Used to
   * detect an account switch on a shared device and wipe before the new
   * account's first sync, so one user's data never bleeds into another's. */
  lastUserId: string | null;

  // Transient (not persisted):
  status: SyncStatus;
  lastError: string | null;
  /** True once AsyncStorage has rehydrated. Nothing read this before, so
   *  `lastUserId` was consulted while it was still the initial `null` — see
   *  account-reconcile.ts for why that mattered. */
  hydrated: boolean;

  setAutoSync: (on: boolean) => void;
  setModuleEnabled: (module: SyncModule, on: boolean) => void;
  /** Writes a whole run's cursors in one update — see the CursorBatch comment
   * in the engine for why this is not per-table. */
  commitCursors: (cursors: Map<string, SyncCursor>) => void;
  setLastSyncedAt: (ts: number) => void;
  setStatus: (status: SyncStatus, error?: string | null) => void;
  setNextAttemptAt: (at: number | null) => void;
  setLastUserId: (uid: string | null) => void;
  /** Wipes cursors — used on account switch so the next sync is a full pull. */
  resetCursors: () => void;
};

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      autoSync: true,
      modules: defaultModuleFlags(),
      cursors: {},
      lastSyncedAt: null,
      nextAttemptAt: null,
      consecutiveFailures: 0,
      lastUserId: null,
      status: 'idle',
      lastError: null,
      hydrated: false,

      setAutoSync: (autoSync) => set({ autoSync }),
      setModuleEnabled: (module, on) => set((s) => ({ modules: { ...s.modules, [module]: on } })),
      commitCursors: (cursors) =>
        set((s) => ({ cursors: { ...s.cursors, ...Object.fromEntries(cursors) } })),
      setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
      setStatus: (status, lastError = null) =>
        set((s) => ({
          status,
          lastError,
          // The failure counter drives the backoff, so it has to move with the
          // status rather than alongside it — a run that succeeds clears the
          // debt of every run that failed before it.
          consecutiveFailures:
            status === 'error'
              ? s.consecutiveFailures + 1
              : status === 'idle'
                ? 0
                : s.consecutiveFailures,
        })),
      setNextAttemptAt: (nextAttemptAt) => set({ nextAttemptAt }),
      setLastUserId: (lastUserId) => set({ lastUserId }),
      resetCursors: () => set({ cursors: {}, nextAttemptAt: null, consecutiveFailures: 0 }),
    }),
    {
      name: 'sync-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Persist settings + cursors; status/lastError/hydrated are runtime-only.
      partialize: (s) => ({
        autoSync: s.autoSync,
        modules: s.modules,
        cursors: s.cursors,
        lastSyncedAt: s.lastSyncedAt,
        nextAttemptAt: s.nextAttemptAt,
        consecutiveFailures: s.consecutiveFailures,
        lastUserId: s.lastUserId,
      }),
      onRehydrateStorage: () => () => {
        useSyncStore.setState({ hydrated: true });
      },
      merge: (persisted, current) => {
        const saved = persisted as (Partial<SyncState> & LegacyCursors) | undefined;
        return {
          ...current,
          ...saved,
          // Backfill any module added in a later release.
          modules: { ...defaultModuleFlags(), ...(saved?.modules ?? {}) },
          cursors: { ...migrateCursors(saved), ...(saved?.cursors ?? {}) },
        };
      },
    },
  ),
);

export function isModuleSyncEnabled(module: SyncModule): boolean {
  return useSyncStore.getState().modules[module] ?? false;
}
