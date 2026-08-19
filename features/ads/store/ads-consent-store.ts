import { create } from 'zustand';

/**
 * What the UMP (User Messaging Platform) SDK has told us this launch.
 *
 * Deliberately **not** persisted, unlike `module-flags-store` next door. The
 * UMP SDK keeps its own consent record on the device and `gatherConsent()`
 * re-reads it in milliseconds on a cold start, so a second cache here could
 * only ever be the stale one — and stale in the dangerous direction, since
 * the value it would be caching is "we are allowed to request ads". Starting
 * every launch at `resolved: false` means the first ad request of a session
 * always waits for the real answer.
 */
type AdsConsentState = {
  /**
   * The UMP SDK's own verdict on whether an ad request may be made yet —
   * consent obtained, or not required in this jurisdiction. Never inferred
   * from the consent *status*: `canRequestAds` is the field Google documents
   * for exactly this decision, and it already accounts for the cases (no
   * form available, consent not required, form dismissed after a choice)
   * that reading the status by hand tends to get wrong.
   */
  canRequestAds: boolean;
  /** False until the consent flow has finished once this launch, however it
   *  finished. `AdSlot` renders nothing while this is false, so no ad request
   *  can precede the answer. */
  resolved: boolean;
  /**
   * Whether this user is entitled to reopen the consent form later — true
   * broadly for EEA/UK users, false elsewhere. Drives whether the Settings
   * row exists at all; showing it to someone whose `showPrivacyOptionsForm()`
   * would no-op is a dead end, not a feature.
   */
  privacyOptionsRequired: boolean;

  set: (next: Partial<Omit<AdsConsentState, 'set'>>) => void;
};

export const useAdsConsentStore = create<AdsConsentState>()((set) => ({
  canRequestAds: false,
  resolved: false,
  privacyOptionsRequired: false,

  set: (next) => set(next),
}));
