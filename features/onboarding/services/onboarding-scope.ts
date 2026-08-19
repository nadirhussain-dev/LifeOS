/**
 * Whether the person now holding this device has been through onboarding.
 *
 * ## The bug this replaces, and the worse one next to it
 *
 * `onboardingComplete` was a single device-level boolean. A brand-new account
 * signing in on a phone somebody else had already onboarded inherited it and
 * skipped the flow entirely — landing on the profile screen with an empty
 * display name and no username, which is how it was found on a real device.
 *
 * The obvious fix — distrust the local flag whenever the loaded profile carries
 * no `onboardingCompletedAt` — is a worse bug, which is why this stayed open in
 * TODO.md for so long. `markOnboardingComplete` writes the server stamp first
 * and returns silently on failure with no retry, so anybody who finished
 * onboarding offline has no stamp and never will. Distrusting the flag would
 * bounce them into the wizard on every launch, permanently. An optimistic local
 * write does not save it either: `loadProfile` re-reads the row and overwrites.
 *
 * ## So the device records *who*
 *
 * `onboardedUserIds` is the list of accounts that have finished onboarding on
 * this device. That single change separates the two cases the old boolean
 * conflated:
 *
 *   - "this account finished, we just cannot reach the server" → onboarded,
 *     because the id is in the local list and no network is involved.
 *   - "some other account finished, on this phone" → not onboarded, because
 *     this id is not in it.
 *
 * The server stamp is still consulted, and still wins when present — it is what
 * carries onboarding across to a *new* device, which the local list by
 * definition cannot.
 *
 * ## The one genuinely ambiguous case
 *
 * A device with `deviceOnboarded` true and an empty list: either somebody
 * onboarded as a guest and has now made an account, or this is an install that
 * predates this file. Both look identical from here, and both are far more
 * likely to be the same person than a different one — an existing account that
 * onboarded normally carries the server stamp (migration 0042) and is caught by
 * the branch above this one, so what falls through is overwhelmingly guests.
 *
 * It resolves in favour of the person already using the phone, and `adopt`
 * closes it permanently: the id is written to the list, so the question is
 * asked once per device and never again.
 */

export type OnboardingScopeInput = {
  /** The signed-in account, or null for a guest or a signed-out device. */
  userId: string | null;
  /** Accounts that have completed onboarding on this device. */
  onboardedUserIds: string[];
  /** The old device-level flag. Still the whole answer when nobody is signed in. */
  deviceOnboarded: boolean;
  /** `profiles.onboarding_completed_at` for the signed-in account (0042), or
   *  null — including while the profile is still loading. */
  accountOnboardedAt: number | null;
};

export type OnboardingScope = {
  onboarded: boolean;
  /**
   * This account should be recorded against the device.
   *
   * Separate from `onboarded` because the caller has to perform a write, and a
   * decision function that performed it itself could not be tested without a
   * store. True only on the two paths that learn something new: a server stamp
   * seen for the first time on this device, and the guest-upgrade case above.
   */
  adopt: boolean;
};

export function onboardingScope(input: OnboardingScopeInput): OnboardingScope {
  // Nobody is signed in, so there is no account to scope to. A guest who
  // finished onboarding is onboarded; anyone else is not.
  if (input.userId === null) {
    return { onboarded: input.deviceOnboarded, adopt: false };
  }

  // This account, on this device. Deliberately checked before the server stamp:
  // it is the branch that must hold with no network, which is the whole reason
  // the naive fix was unshippable.
  if (input.onboardedUserIds.includes(input.userId)) {
    return { onboarded: true, adopt: false };
  }

  // Finished on some other device. Adopt it so the next launch answers locally.
  if (input.accountOnboardedAt != null) {
    return { onboarded: true, adopt: true };
  }

  // The ambiguous case — see the header.
  if (input.deviceOnboarded && input.onboardedUserIds.length === 0) {
    return { onboarded: true, adopt: true };
  }

  // A new account on a device that already belongs to somebody else. This is
  // the case the whole file exists for, and the answer is the flow.
  return { onboarded: false, adopt: false };
}
