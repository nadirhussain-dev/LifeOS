/**
 * Consent gating (./consent.ts).
 *
 * What is worth testing here is not the UMP SDK — it is the direction each
 * failure falls in. Every path that cannot prove consent has to end at
 * `canRequestAds: false`, because the cost of getting that backwards is
 * serving an unconsented ad to a European user, which is a compliance
 * problem rather than a rendering one. The happy path is the easy half; the
 * throwing, missing and denied paths are the half that pays for this file.
 */

const REQUIRED = 'REQUIRED';
const NOT_REQUIRED = 'NOT_REQUIRED';

type ConsentInfo = {
  canRequestAds: boolean;
  privacyOptionsRequirementStatus: string;
};

type Options = {
  platform?: 'ios' | 'android';
  /** false simulates a runtime with no native module at all — Expo Go, web,
   *  or the New Architecture bug `loadAdsModule` exists to survive. */
  hasModule?: boolean;
  gatherConsent?: jest.Mock;
  showPrivacyOptionsForm?: jest.Mock;
  attAvailable?: boolean;
};

/** Order-sensitive log of the native calls made, so the UMP-before-ATT
 *  requirement can be asserted rather than assumed. */
let calls: string[] = [];

function load(options: Options = {}) {
  const {
    platform = 'ios',
    hasModule = true,
    gatherConsent = jest.fn(async (): Promise<ConsentInfo> => {
      calls.push('gatherConsent');
      return { canRequestAds: true, privacyOptionsRequirementStatus: NOT_REQUIRED };
    }),
    showPrivacyOptionsForm = jest.fn(async (): Promise<ConsentInfo> => ({
      canRequestAds: true,
      privacyOptionsRequirementStatus: REQUIRED,
    })),
    attAvailable = true,
  } = options;

  jest.resetModules();
  calls = [];

  // Minimal `react-native` — consent.ts uses nothing from it but `Platform`,
  // and the store beneath it uses none of it at all.
  jest.doMock('react-native', () => ({ Platform: { OS: platform } }));

  if (hasModule) {
    jest.doMock('react-native-google-mobile-ads', () => ({
      AdsConsent: { gatherConsent, showPrivacyOptionsForm },
      AdsConsentPrivacyOptionsRequirementStatus: { REQUIRED, NOT_REQUIRED },
    }));
  } else {
    jest.doMock('react-native-google-mobile-ads', () => {
      throw new Error('native module unavailable');
    });
  }

  const requestTrackingPermissionsAsync = jest.fn(async () => {
    calls.push('att');
    return { granted: true, status: 'granted' };
  });
  jest.doMock('expo-tracking-transparency', () => ({
    isAvailable: () => attAvailable,
    requestTrackingPermissionsAsync,
  }));

  // `require`, not `import`: these have to be resolved AFTER the `doMock`
  // calls above, and a static import is hoisted above them.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const consent = require('./consent') as typeof import('./consent');
  const store =
    require('../store/ads-consent-store') as typeof import('../store/ads-consent-store');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { consent, store, gatherConsent, showPrivacyOptionsForm, requestTrackingPermissionsAsync };
}

describe('gatherAdsConsent', () => {
  it('publishes the SDK verdict when consent is granted', async () => {
    const { consent, store } = load();

    await expect(consent.gatherAdsConsent()).resolves.toEqual({ canRequestAds: true });
    expect(store.useAdsConsentStore.getState()).toMatchObject({
      canRequestAds: true,
      resolved: true,
      privacyOptionsRequired: false,
    });
  });

  it('requests ATT only after the UMP form, never before it', async () => {
    const { consent } = load({ platform: 'ios' });

    await consent.gatherAdsConsent();

    // The whole reason for the ordering: the UMP message is where a publisher
    // is allowed to explain the iOS prompt that follows.
    expect(calls).toEqual(['gatherConsent', 'att']);
  });

  it('does not touch ATT on Android, where there is no such prompt', async () => {
    const { consent, requestTrackingPermissionsAsync } = load({ platform: 'android' });

    await consent.gatherAdsConsent();

    expect(requestTrackingPermissionsAsync).not.toHaveBeenCalled();
    expect(calls).toEqual(['gatherConsent']);
  });

  it('still reports consent when ATT is unavailable — a denied IDFA is not a denied ad', async () => {
    const { consent, store, requestTrackingPermissionsAsync } = load({ attAvailable: false });

    await consent.gatherAdsConsent();

    expect(requestTrackingPermissionsAsync).not.toHaveBeenCalled();
    // Non-personalised ads still serve. Conflating the two would cost every
    // iOS user who declines tracking, which is most of them.
    expect(store.useAdsConsentStore.getState().canRequestAds).toBe(true);
  });

  it('flags that the privacy form can be reopened when the SDK says so', async () => {
    const { consent, store } = load({
      gatherConsent: jest.fn(async () => ({
        canRequestAds: true,
        privacyOptionsRequirementStatus: REQUIRED,
      })),
    });

    await consent.gatherAdsConsent();

    expect(store.useAdsConsentStore.getState().privacyOptionsRequired).toBe(true);
  });

  it('refuses ads when the consent call throws', async () => {
    const { consent, store } = load({
      gatherConsent: jest.fn(async () => {
        throw new Error('form failed to load');
      }),
    });

    await expect(consent.gatherAdsConsent()).resolves.toEqual({ canRequestAds: false });
    // Resolved, so AdSlot stops waiting — but not allowed, so it shows nothing.
    expect(store.useAdsConsentStore.getState()).toMatchObject({
      canRequestAds: false,
      resolved: true,
    });
  });

  it('refuses ads, without throwing, when there is no native module', async () => {
    const { consent, store } = load({ hasModule: false });

    await expect(consent.gatherAdsConsent()).resolves.toEqual({ canRequestAds: false });
    expect(store.useAdsConsentStore.getState()).toMatchObject({
      canRequestAds: false,
      resolved: true,
    });
  });

  it('honours the SDK withholding consent even when nothing failed', async () => {
    const { consent, store } = load({
      gatherConsent: jest.fn(async () => ({
        canRequestAds: false,
        privacyOptionsRequirementStatus: REQUIRED,
      })),
    });

    await expect(consent.gatherAdsConsent()).resolves.toEqual({ canRequestAds: false });
    expect(store.useAdsConsentStore.getState().canRequestAds).toBe(false);
  });
});

describe('showAdPrivacyOptions', () => {
  it('reflects a mid-session withdrawal of consent', async () => {
    const { consent, store } = load({
      showPrivacyOptionsForm: jest.fn(async () => ({
        canRequestAds: false,
        privacyOptionsRequirementStatus: REQUIRED,
      })),
    });
    store.useAdsConsentStore.getState().set({ canRequestAds: true });

    await expect(consent.showAdPrivacyOptions()).resolves.toBe(true);

    // Withdrawal has to take effect now, not at the next launch — the user
    // just watched themselves turn it off.
    expect(store.useAdsConsentStore.getState().canRequestAds).toBe(false);
  });

  it('reports failure so the caller can say so, rather than looking inert', async () => {
    const { consent } = load({
      showPrivacyOptionsForm: jest.fn(async () => {
        throw new Error('could not present');
      }),
    });

    await expect(consent.showAdPrivacyOptions()).resolves.toBe(false);
  });

  it('reports failure when there is no native module', async () => {
    const { consent } = load({ hasModule: false });

    await expect(consent.showAdPrivacyOptions()).resolves.toBe(false);
  });
});
