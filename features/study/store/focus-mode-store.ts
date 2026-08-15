import { create } from 'zustand';

/**
 * Whether a study focus block is currently shielding the user from
 * interruptions, and what got held back while it was.
 *
 * This lives in its own store, deliberately importing nothing, because
 * lib/notifications reads it from inside the foreground notification handler.
 * Putting the flag on features/study/services/focus-mode.ts (which orchestrates
 * the player, keep-awake and the schedulers) would make that a cycle.
 */
type FocusModeState = {
  active: boolean;
  startedAt: number | null;
  /** Titles of Daykeep reminders swallowed during this block, in arrival order.
   * They are already rows in the in-app inbox — this is only so the timer screen
   * can say how many are waiting and the end-of-session summary can name them. */
  heldTitles: string[];

  activate: () => void;
  deactivate: () => void;
  hold: (title: string) => void;
};

export const useFocusModeStore = create<FocusModeState>((set) => ({
  active: false,
  startedAt: null,
  heldTitles: [],

  activate: () => set({ active: true, startedAt: Date.now(), heldTitles: [] }),
  deactivate: () => set({ active: false, startedAt: null }),
  hold: (title) => set((state) => ({ heldTitles: [...state.heldTitles, title] })),
}));

/** Callable outside React — used by the notification handler. */
export function isFocusModeActive(): boolean {
  return useFocusModeStore.getState().active;
}

/** Records a reminder that was suppressed so focus wasn't broken. */
export function holdNotificationDuringFocus(title: string): void {
  useFocusModeStore.getState().hold(title);
}
