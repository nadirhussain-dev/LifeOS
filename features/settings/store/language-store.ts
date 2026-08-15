import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { applyLayoutDirection } from '@/features/settings/lib/layout-direction';

export const LANGUAGES = ['en', 'ur', 'hi', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The device's language if Daykeep supports it, otherwise English. */
export function deviceLanguage(): Language {
  try {
    const code = getLocales()[0]?.languageCode ?? 'en';
    return (LANGUAGES as readonly string[]).includes(code) ? (code as Language) : 'en';
  } catch {
    return 'en';
  }
}

/**
 * The most recent persist write. Switching to or from Urdu/Arabic restarts the
 * app, and AsyncStorage writes are async — without awaiting this the restart
 * can outrun the write and the app comes back up in the *new* direction with
 * the *old* language, which reads as the setting silently failing.
 */
let pendingWrite: Promise<unknown> = Promise.resolve();

const languageStorage = createJSONStorage(() => ({
  getItem: (name: string) => AsyncStorage.getItem(name),
  setItem: (name: string, value: string) => {
    pendingWrite = AsyncStorage.setItem(name, value);
    return pendingWrite;
  },
  removeItem: (name: string) => AsyncStorage.removeItem(name),
}));

type LanguageState = {
  language: Language;
  hydrated: boolean;
  /**
   * Persists the choice and applies its layout direction. Resolves true when
   * the direction flipped, meaning the caller has to reload the app for the new
   * direction to actually render — see `reloadForDirectionChange`.
   */
  setLanguage: (language: Language) => Promise<boolean>;
};

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      language: deviceLanguage(),
      hydrated: false,
      setLanguage: async (language) => {
        set({ language });
        const directionChanged = applyLayoutDirection(language);
        // Flush to disk before the caller restarts us.
        await pendingWrite;
        return directionChanged;
      },
    }),
    {
      name: 'daykeep-language',
      storage: languageStorage,
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => (state) => {
        // Re-assert on every launch: the native flag and the stored language
        // can drift apart (a reinstall clears one but not the other, and Expo
        // Go resets RTL preferences when it returns to its launcher).
        if (state) applyLayoutDirection(state.language);
        useLanguageStore.setState({ hydrated: true });
      },
    },
  ),
);
