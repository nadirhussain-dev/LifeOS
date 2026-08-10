import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Whether this account backs its files up, and what that is currently costing.
 *
 * **Off by default, and that is the decision rather than an oversight.** Photos
 * and audio are the only thing in this app whose storage cost is unbounded per
 * user, and the difference between opt-in and opt-out here is the difference
 * between a bill that tracks engagement and one that tracks installs. It is also
 * the honest default for the data involved: uploading somebody's photo library
 * is not something to start doing because they did not find a switch.
 *
 * `wifiOnly` defaults on for the same class of reason — a background upload of
 * four gigabytes of video over cellular is somebody's month.
 */
export type MediaUsage = {
  usedBytes: number;
  quotaBytes: number;
  /** When the figures were last read from the server. */
  checkedAt: number;
};

type MediaSyncState = {
  enabled: boolean;
  wifiOnly: boolean;
  usage: MediaUsage | null;
  /** Transient: how many files are waiting, for the settings screen. */
  pending: number;
  /** Last failure worth showing, e.g. hitting the quota. */
  lastError: string | null;

  setEnabled: (enabled: boolean) => void;
  setWifiOnly: (wifiOnly: boolean) => void;
  setUsage: (usage: MediaUsage | null) => void;
  setPending: (pending: number) => void;
  setLastError: (error: string | null) => void;
};

export const useMediaSyncStore = create<MediaSyncState>()(
  persist(
    (set) => ({
      enabled: false,
      wifiOnly: true,
      usage: null,
      pending: 0,
      lastError: null,

      setEnabled: (enabled) => set({ enabled, lastError: null }),
      setWifiOnly: (wifiOnly) => set({ wifiOnly }),
      setUsage: (usage) => set({ usage }),
      setPending: (pending) => set({ pending }),
      setLastError: (lastError) => set({ lastError }),
    }),
    {
      name: 'media-sync-store',
      storage: createJSONStorage(() => AsyncStorage),
      // `pending` and `lastError` describe this run, not this account.
      partialize: ({ pending: _p, lastError: _e, ...rest }) => rest,
    },
  ),
);

/** Callable outside React — the uploader is not a component. */
export function mediaSyncEnabled(): boolean {
  return useMediaSyncStore.getState().enabled;
}
