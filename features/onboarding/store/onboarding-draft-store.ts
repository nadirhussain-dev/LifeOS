import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { FocusArea, Gender } from '@/features/profile/store/profile-store';

/**
 * Answers-so-far for the first-run flow, persisted.
 *
 * Onboarding used to hold everything in `useState`, which was fine while it was
 * a self-contained questionnaire and stops being fine the moment it can send you
 * somewhere else. Choosing "use email instead" on the account step navigates
 * into the auth stack, and coming back with a shiny new account used to mean
 * starting from screen one — the app's first impression being that it forgets
 * things.
 *
 * The same persistence covers the app being killed mid-setup, which is not rare:
 * onboarding is exactly when somebody is interrupted, because they have not
 * invested anything yet.
 *
 * Cleared on completion. Nothing here is worth keeping once the answers have
 * been written to the real profile, and a stale draft is a bug waiting for the
 * next person who resets the app.
 */
export type ShapeChoices = {
  /** Ids from STARTER_HABITS the user ticked. */
  starterHabits: string[];
  /** Null until the user reaches the step or skips it. */
  waterGoalMl: number | null;
  currencyCode: string | null;
};

const EMPTY_SHAPE: ShapeChoices = { starterHabits: [], waterGoalMl: null, currencyCode: null };

type OnboardingDraftState = {
  step: number;
  name: string;
  gender: Gender | null;
  focusAreas: FocusArea[];
  shape: ShapeChoices;
  hydrated: boolean;

  setStep: (step: number) => void;
  setName: (name: string) => void;
  setGender: (gender: Gender | null) => void;
  toggleFocus: (area: FocusArea) => void;
  toggleStarterHabit: (id: string) => void;
  setWaterGoal: (ml: number | null) => void;
  setCurrencyCode: (code: string | null) => void;
  reset: () => void;
};

export const useOnboardingDraftStore = create<OnboardingDraftState>()(
  persist(
    (set) => ({
      step: 0,
      name: '',
      gender: null,
      focusAreas: [],
      shape: EMPTY_SHAPE,
      hydrated: false,

      setStep: (step) => set({ step }),
      setName: (name) => set({ name }),
      setGender: (gender) => set({ gender }),
      toggleFocus: (area) =>
        set((s) => ({
          focusAreas: s.focusAreas.includes(area)
            ? s.focusAreas.filter((a) => a !== area)
            : // Appended rather than sorted, because the order people pick in is
              // the order they care in — and the "make it yours" step shows
              // suggestions in that order.
              [...s.focusAreas, area],
        })),
      toggleStarterHabit: (id) =>
        set((s) => ({
          shape: {
            ...s.shape,
            starterHabits: s.shape.starterHabits.includes(id)
              ? s.shape.starterHabits.filter((h) => h !== id)
              : [...s.shape.starterHabits, id],
          },
        })),
      setWaterGoal: (waterGoalMl) => set((s) => ({ shape: { ...s.shape, waterGoalMl } })),
      setCurrencyCode: (currencyCode) => set((s) => ({ shape: { ...s.shape, currencyCode } })),

      reset: () => set({ step: 0, name: '', gender: null, focusAreas: [], shape: EMPTY_SHAPE }),
    }),
    {
      name: 'onboarding-draft',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useOnboardingDraftStore.setState({ hydrated: true });
      },
    },
  ),
);
