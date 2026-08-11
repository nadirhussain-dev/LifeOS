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
      appLockEnabled: false,
      hydrated: false,

      setName: (name) => set({ name }),
      setGender: (gender) => set({ gender }),
      setFocusAreas: (focusAreas) => set({ focusAreas }),
      setAppLockEnabled: (appLockEnabled) => set({ appLockEnabled }),
      completeOnboarding: ({ name, gender, focusAreas, appLockEnabled }) =>
        set({ name: name.trim(), gender, focusAreas, appLockEnabled, onboardingComplete: true }),
      reset: () =>
        set({
          name: '',
          gender: null,
          focusAreas: [],
          onboardingComplete: false,
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
      name: 'lifeos-profile',
      storage: createJSONStorage(() => AsyncStorage),
      // Don't persist the runtime hydration flag.
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useProfileStore.setState({ hydrated: true });
      },
    },
  ),
);
