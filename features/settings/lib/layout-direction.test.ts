import * as Updates from 'expo-updates';
import { DevSettings, I18nManager, Platform } from 'react-native';

import {
  RTL_LANGUAGES,
  applyLayoutDirection,
  isRTL,
  reloadForDirectionChange,
} from '@/features/settings/lib/layout-direction';

/**
 * Which way the app lays out, and the first test `features/settings` has had.
 *
 * `I18nManager.forceRTL` writes a *native* flag that the mounted view tree never
 * re-reads, so the return value of `applyLayoutDirection` is not informational —
 * it is what tells the caller a restart is required. Get it wrong in either
 * direction and the failure is quiet: return false on a real change and Arabic
 * gets translated strings inside an LTR skeleton; return true when nothing
 * changed and the app restarts itself for no reason, which on a settings screen
 * looks like a crash.
 */

jest.mock('react-native', () => ({
  I18nManager: { isRTL: false, allowRTL: jest.fn(), forceRTL: jest.fn() },
  DevSettings: { reload: jest.fn() },
  Platform: { OS: 'ios' },
}));

jest.mock('expo-updates', () => ({ reloadAsync: jest.fn() }));

const manager = I18nManager as unknown as {
  isRTL: boolean;
  allowRTL: jest.Mock;
  forceRTL: jest.Mock;
};
const platform = Platform as unknown as { OS: string };
const reloadAsync = Updates.reloadAsync as jest.Mock;
const devReload = DevSettings.reload as jest.Mock;

/** `__DEV__` is a global the bundler defines; the two reload paths fork on it. */
const dev = globalThis as unknown as { __DEV__: boolean };
const originalDev = dev.__DEV__;

beforeEach(() => {
  jest.clearAllMocks();
  manager.isRTL = false;
  platform.OS = 'ios';
  dev.__DEV__ = originalDev;
});

afterAll(() => {
  dev.__DEV__ = originalDev;
});

describe('isRTL', () => {
  it('is true for the two right-to-left languages and false for the rest', () => {
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('ur')).toBe(true);
    expect(isRTL('en')).toBe(false);
    expect(isRTL('hi')).toBe(false);
  });

  it('lists exactly the RTL languages the app ships', () => {
    // Urdu and Arabic are the two RTL locales in lib/i18n/locales. A language
    // added there and not here would be translated into an LTR layout.
    expect([...RTL_LANGUAGES].sort()).toEqual(['ar', 'ur']);
  });
});

describe('applyLayoutDirection', () => {
  it('reports a change and sets the native flags when flipping to RTL', () => {
    const changed = applyLayoutDirection('ar');

    expect(changed).toBe(true);
    expect(manager.allowRTL).toHaveBeenCalledWith(true);
    expect(manager.forceRTL).toHaveBeenCalledWith(true);
  });

  it('reports a change and clears the flags when flipping back to LTR', () => {
    manager.isRTL = true;

    const changed = applyLayoutDirection('en');

    expect(changed).toBe(true);
    expect(manager.allowRTL).toHaveBeenCalledWith(false);
    expect(manager.forceRTL).toHaveBeenCalledWith(false);
  });

  it('does nothing when the direction already matches', () => {
    // The important negative. `forceRTL` on every language change would have
    // the caller restart the app for Hindi → English, which shares a direction.
    const changed = applyLayoutDirection('en');

    expect(changed).toBe(false);
    expect(manager.forceRTL).not.toHaveBeenCalled();
    expect(manager.allowRTL).not.toHaveBeenCalled();
  });

  it('does nothing when an RTL language is already RTL', () => {
    manager.isRTL = true;

    // Arabic → Urdu: both RTL, so there is nothing to change and no reason to
    // restart in the middle of choosing a language.
    expect(applyLayoutDirection('ur')).toBe(false);
    expect(manager.forceRTL).not.toHaveBeenCalled();
  });

  it('is inert on web, where the document owns direction', () => {
    platform.OS = 'web';

    expect(applyLayoutDirection('ar')).toBe(false);
    expect(manager.forceRTL).not.toHaveBeenCalled();
  });

  it('sets allowRTL as well as forceRTL', () => {
    // `allowRTL` is what lets a device whose own locale is RTL through on a
    // fresh install; `forceRTL` alone leaves that case to the OS default.
    applyLayoutDirection('ur');

    expect(manager.allowRTL).toHaveBeenCalledTimes(1);
    expect(manager.forceRTL).toHaveBeenCalledTimes(1);
  });
});

describe('reloadForDirectionChange', () => {
  it('uses DevSettings in development', async () => {
    // `Updates.reloadAsync` throws against a dev server, so dev must not take
    // that path — it would report failure on every language change locally.
    dev.__DEV__ = true;

    await expect(reloadForDirectionChange()).resolves.toBe(true);
    expect(devReload).toHaveBeenCalled();
    expect(reloadAsync).not.toHaveBeenCalled();
  });

  it('uses expo-updates in a release build', async () => {
    dev.__DEV__ = false;
    reloadAsync.mockResolvedValue(undefined);

    await expect(reloadForDirectionChange()).resolves.toBe(true);
    expect(reloadAsync).toHaveBeenCalled();
    expect(devReload).not.toHaveBeenCalled();
  });

  it('resolves false rather than throwing when the reload fails', async () => {
    // The caller falls back to asking the person to reopen the app. An
    // exception here would instead surface as a crash on the settings screen,
    // immediately after a change that already needs explaining.
    dev.__DEV__ = false;
    reloadAsync.mockRejectedValue(new Error('no update controller'));

    await expect(reloadForDirectionChange()).resolves.toBe(false);
  });
});
