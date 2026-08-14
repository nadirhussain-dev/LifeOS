import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Where this device stands in its account's one-device roster (migration 0047).
 *
 * Persisted for the same reason `moderation-store` persists standing: the two
 * screens that read it — the takeover prompt and the "signed out from here"
 * notice — have to render on a cold start, before any round trip, and a blank
 * frame followed by a lockout screen reads as a crash. It is a cache of the
 * server's last answer and never the authority; RLS holds the actual rule.
 */

export type DeviceVerdict =
  /** Nothing has been checked yet on this launch. */
  | 'unknown'
  /** This device holds the account. */
  | 'active'
  /** Another device holds it; a one-time code will move it here. */
  | 'otp_required'
  /** Another device took it. This one is locked out and wipes itself. */
  | 'revoked';

/** The other device, as much of it as is worth showing a person. */
export type OtherDevice = {
  label: string | null;
  platform: string | null;
  lastSeenAt: string | null;
};

type DeviceSessionState = {
  verdict: DeviceVerdict;
  otherDevice: OtherDevice | null;
  /** Why this device lost the account — 'signed_in_elsewhere', 'signed_out',
   *  'account_deleted'. Drives which message the notice screen shows. */
  revokedReason: string | null;
  checkedAt: number | null;
  /**
   * Set while a takeover is being carried out, so the auth gate does not
   * bounce the user off the verification screen the instant the OTP swaps the
   * session (which fires `onAuthStateChange`, which re-runs the gate).
   */
  claiming: boolean;

  setVerdict: (verdict: DeviceVerdict, other?: OtherDevice | null, reason?: string | null) => void;
  setClaiming: (claiming: boolean) => void;
  clear: () => void;
};

export const useDeviceSessionStore = create<DeviceSessionState>()(
  persist(
    (set) => ({
      verdict: 'unknown',
      otherDevice: null,
      revokedReason: null,
      checkedAt: null,
      claiming: false,

      setVerdict: (verdict, otherDevice, revokedReason) =>
        set((s) => ({
          verdict,
          checkedAt: Date.now(),
          // `undefined` means "unchanged" and `null` means "cleared", which is
          // the distinction that lets a plain heartbeat refresh the verdict
          // without dropping the label the takeover screen is showing.
          otherDevice: otherDevice === undefined ? s.otherDevice : otherDevice,
          revokedReason: revokedReason === undefined ? s.revokedReason : revokedReason,
        })),
      setClaiming: (claiming) => set({ claiming }),
      clear: () =>
        set({
          verdict: 'unknown',
          otherDevice: null,
          revokedReason: null,
          checkedAt: null,
          claiming: false,
        }),
    }),
    {
      name: 'device-session-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        verdict: state.verdict,
        otherDevice: state.otherDevice,
        revokedReason: state.revokedReason,
        checkedAt: state.checkedAt,
      }),
    },
  ),
);
