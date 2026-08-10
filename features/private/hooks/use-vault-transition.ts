import { useCallback, useState } from 'react';

export type VaultTransitionMode = 'sealing' | 'opening';

/**
 * How long the seal/open animation stays on screen at minimum.
 *
 * The wait it is covering is real: PBKDF2 at 210k iterations
 * (vault-crypto.ts), a deliberate anti-brute-force cost this hook does not
 * touch. What it fixes is purely presentational — on a fast device the KDF
 * can resolve in well under a second, and an animation that flashes for
 * 80ms reads as a glitch, not a moment. This floor makes sure it's always
 * seen; it is never used to pad the wait *longer* than the real work.
 */
const MIN_VISIBLE_MS = 900;

/**
 * Wraps one real vault operation (unlock, setup, change-pin) with the seal/
 * open transition. `run` shows the overlay, awaits the actual async call,
 * and keeps the overlay up until MIN_VISIBLE_MS has elapsed since it
 * started — whichever finishes later.
 */
export function useVaultTransition() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<VaultTransitionMode>('opening');

  const run = useCallback(
    async <T>(nextMode: VaultTransitionMode, fn: () => Promise<T>): Promise<T> => {
      setMode(nextMode);
      setVisible(true);
      const startedAt = Date.now();
      try {
        return await fn();
      } finally {
        const remaining = MIN_VISIBLE_MS - (Date.now() - startedAt);
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
        setVisible(false);
      }
    },
    [],
  );

  return { visible, mode, run };
}
