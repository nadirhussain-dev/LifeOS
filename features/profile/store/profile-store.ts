import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Local, device-side profile — deliberately separate from the Supabase auth
 * profile so it works for guest users too (who have no account). Holds the
 * onboarding answers, the "seen onboarding" flag that gates the first-run flow,
 * and the app-lock preference. Persisted via AsyncStorage.
 */
export type FocusArea =
  'habits' | 'tasks' | 'journal' | 'water' | 'sleep' | 'fitness' | 'goals' | 'budget' | 'study';

/**
 * Asked once during onboarding, and used for exactly one thing: which private
 * modules to offer first. It is a *suggestion input*, never a gate — a trans
 * man tracking a cycle and a woman tracking urges are both real people, and
 * every private module stays reachable regardless of the answer.
 *
 * Deliberately never synced and never sent anywhere. It buys nothing on the
 * server and is a liability if it leaks.
 */
export type Gender = 'female' | 'male' | 'non_binary' | 'prefer_not_to_say';

type ProfileState = {
  name: string;
  gender: Gender | null;
  focusAreas: FocusArea[];
  onboardingComplete: boolean;
  /**
   * Accounts that have finished onboarding **on this device**.
   *
   * The fix for the flag above being device-scoped: a boolean cannot tell
   * "this account finished and we cannot reach the server" from "somebody
   * else's account finished on this phone", and those want opposite answers.
   * See `features/onboarding/services/onboarding-scope.ts` for the decision
   * this feeds and why every one-line version of it was a worse bug.
   *
   * Absent from an install that predates this field, which reads as an empty
   * list — handled deliberately as the ambiguous case in that file rather than
   * by a store migration, because the answer depends on who signs in next.
   */
  onboardedUserIds: string[];
  appLockEnabled: boolean;
  /** True once AsyncStorage has rehydrated — boot waits for this so returning
   * users never flash the onboarding flow before their saved state loads. */
  hydrated: boolean;

  setName: (name: string) => void;
  setGender: (gender: Gender | null) => void;
  setFocusAreas: (areas: FocusArea[]) => void;
  setAppLockEnabled: (enabled: boolean) => void;
  completeOnboarding: (data: {
    name: string;
    gender: Gender | null;
    focusAreas: FocusArea[];
    appLockEnabled: boolean;
  }) => void;
  /** Marks onboarding done WITHOUT the answers `completeOnboarding` bundles
   *  — for `useAuthGate` recognising an account that finished onboarding on
   *  a different device (migration 0042's `onboarding_completed_at`). This
   *  device never asked the questions, so it has no name/gender/focus areas
   *  to stamp; onboarding simply never runs here at all. */
  setOnboardingComplete: (complete: boolean) => void;
  /** Records that `userId` has been through onboarding on this device. */
  markAccountOnboarded: (userId: string) => void;
  reset: () => void;
  /** Clears the onboarding *answers* but leaves `onboardingComplete` as-is.
   * For an account switch on an already-onboarded device: the device doesn't
   * need to relearn what onboarding is, it just shouldn't keep showing the
   * previous account's name/gender/focus areas. Use `reset()` instead when
   * onboarding itself should run again (e.g. destroying the device's data
   * entirely). */
  resetAnswers: () => void;
};

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      name: '',
      gender: null,
      focusAreas: [],
      onboardingComplete: false,
      onboardedUserIds: [],
      appLockEnabled: false,
      hydrated: false,

      setName: (name) => set({ name }),
      setGender: (gender) => set({ gender }),
      setFocusAreas: (focusAreas) => set({ focusAreas }),
      setAppLockEnabled: (appLockEnabled) => set({ appLockEnabled }),
      completeOnboarding: ({ name, gender, focusAreas, appLockEnabled }) =>
        set({ name: name.trim(), gender, focusAreas, appLockEnabled, onboardingComplete: true }),
      setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
      markAccountOnboarded: (userId) =>
        set((s) =>
          s.onboardedUserIds.includes(userId)
            ? s
            : // The device flag is set alongside, so a later sign-out still
              // reads as onboarded — signing out is not un-onboarding.
              { onboardedUserIds: [...s.onboardedUserIds, userId], onboardingComplete: true },
        ),
      reset: () =>
        set({
          name: '',
          gender: null,
          focusAreas: [],
          onboardingComplete: false,
          // Cleared here and deliberately NOT in `resetAnswers` below: this is
          // the device forgetting everything, which is the one case where the
          // next account really should be asked again.
          onboardedUserIds: [],
          appLockEnabled: false,
        }),
      resetAnswers: () =>
        set({
          name: '',
          gender: null,
          focusAreas: [],
          appLockEnabled: false,
        }),
    }),
    {
      name: 'daykeep-profile',
      storage: createJSONStorage(() => AsyncStorage),
      // Don't persist the runtime hydration flag.
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useProfileStore.setState({ hydrated: true });
      },
    },
  ),
);
