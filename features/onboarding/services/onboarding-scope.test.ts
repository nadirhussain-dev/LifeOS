import { onboardingScope } from '@/features/onboarding/services/onboarding-scope';

/**
 * Both directions of the account-scoped onboarding flag.
 *
 * Worth testing exhaustively rather than by sampling, because the two failures
 * are opposite, both severe, and each one is the "obvious fix" for the other:
 * too loose and a stranger's account skips onboarding onto somebody else's
 * phone; too strict and anybody who finished onboarding offline is trapped in
 * the wizard forever. TODO.md carried this bug for months precisely because
 * every one-line fix traded one for the other.
 */

const A = 'user-a';
const B = 'user-b';

describe('onboardingScope', () => {
  describe('with nobody signed in', () => {
    it('trusts the device flag for a guest who finished onboarding', () => {
      expect(
        onboardingScope({
          userId: null,
          onboardedUserIds: [],
          deviceOnboarded: true,
          accountOnboardedAt: null,
        }),
      ).toEqual({ onboarded: true, adopt: false });
    });

    it('sends a fresh install to onboarding', () => {
      expect(
        onboardingScope({
          userId: null,
          onboardedUserIds: [],
          deviceOnboarded: false,
          accountOnboardedAt: null,
        }),
      ).toEqual({ onboarded: false, adopt: false });
    });
  });

  describe('the bug this was written for', () => {
    it('sends a new account signing in on somebody else’s onboarded phone to onboarding', () => {
      // Confirmed on a real device: a Google sign-up landed straight on the
      // profile screen with an empty display name and no username.
      expect(
        onboardingScope({
          userId: B,
          onboardedUserIds: [A],
          deviceOnboarded: true,
          accountOnboardedAt: null,
        }),
      ).toEqual({ onboarded: false, adopt: false });
    });

    it('still lets the device’s own account straight in', () => {
      expect(
        onboardingScope({
          userId: A,
          onboardedUserIds: [A],
          deviceOnboarded: true,
          accountOnboardedAt: null,
        }),
      ).toEqual({ onboarded: true, adopt: false });
    });
  });

  describe('the regression the naive fix would have caused', () => {
    it('keeps somebody who finished onboarding offline out of the wizard', () => {
      // No server stamp, and there never will be one: markOnboardingComplete
      // writes the stamp first and returns silently on failure with no retry.
      // The local list is the only record, and it has to be enough.
      expect(
        onboardingScope({
          userId: A,
          onboardedUserIds: [A],
          deviceOnboarded: true,
          accountOnboardedAt: null,
        }).onboarded,
      ).toBe(true);
    });

    it('does not re-ask while the profile is still loading', () => {
      // `profile` is null for a moment after sign-in, so accountOnboardedAt is
      // null even for an account that finished a year ago. The local list is
      // what stops that becoming a one-frame trip through onboarding.
      expect(
        onboardingScope({
          userId: A,
          onboardedUserIds: [A],
          deviceOnboarded: false,
          accountOnboardedAt: null,
        }).onboarded,
      ).toBe(true);
    });
  });

  describe('carrying onboarding to a new device', () => {
    it('trusts the server stamp and adopts it locally', () => {
      expect(
        onboardingScope({
          userId: A,
          onboardedUserIds: [],
          deviceOnboarded: false,
          accountOnboardedAt: 1_700_000_000_000,
        }),
      ).toEqual({ onboarded: true, adopt: true });
    });

    it('adopts even onto a device another account already owns', () => {
      // B finished onboarding elsewhere. Borrowing A's phone must not make B
      // redo it — the stamp is account-scoped and outranks the device.
      expect(
        onboardingScope({
          userId: B,
          onboardedUserIds: [A],
          deviceOnboarded: true,
          accountOnboardedAt: 1_700_000_000_000,
        }),
      ).toEqual({ onboarded: true, adopt: true });
    });
  });

  describe('the ambiguous case', () => {
    it('gives an onboarded device with no attributed account to whoever signs in', () => {
      // A guest who has now made an account, or an install predating this file.
      // Resolved toward the person already holding the phone, and `adopt`
      // means the question is asked once and never again.
      expect(
        onboardingScope({
          userId: A,
          onboardedUserIds: [],
          deviceOnboarded: true,
          accountOnboardedAt: null,
        }),
      ).toEqual({ onboarded: true, adopt: true });
    });

    it('closes as soon as one account is attributed', () => {
      // The same input, one sign-in later. B no longer inherits anything.
      expect(
        onboardingScope({
          userId: B,
          onboardedUserIds: [A],
          deviceOnboarded: true,
          accountOnboardedAt: null,
        }).onboarded,
      ).toBe(false);
    });
  });
});
