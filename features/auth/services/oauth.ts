import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import type { AuthResult } from '@/features/auth/services/auth-store';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { isSupabaseConfigured } from '@/lib/env';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * Sign-in with Google and with Apple.
 *
 * The two use deliberately different mechanisms, and the reason is worth stating
 * because the obvious instinct is to make them symmetrical.
 *
 * **Apple is native.** `expo-apple-authentication` is a config-plugin-only
 * module with no JavaScript configuration, and App Store guideline 4.8 requires
 * Sign in with Apple to be offered alongside any other third-party login. It
 * returns an identity token that Supabase verifies directly, so there is no
 * browser and no redirect.
 *
 * **Google goes through the browser**, not `@react-native-google-signin`. The
 * native module gives a nicer sheet, and it also needs a native build, three
 * OAuth client ids, and SHA-1 fingerprints per signing key. This app has never
 * been built on a device — device validation is still the top open item in
 * TODO.md — so that would be stacking unverifiable native configuration on top
 * of unverified native configuration. The browser flow needs one web client and
 * one redirect URL, works in Expo Go as well as a dev build, and rides the PKCE
 * flow `lib/supabase.ts` already sets up. If the native sheet is wanted later it
 * drops in behind `signInWithGoogle` without anything else changing.
 */

export type OAuthProvider = 'google' | 'apple';

/** Where Google's consent screen sends the browser back to. Must be registered
 *  in Supabase → Authentication → URL Configuration → Redirect URLs, or the
 *  provider refuses the request before the user sees anything. In a build this
 *  resolves via the `lifeos` scheme; under Expo Go it is an `exp://` URL, which
 *  is why the development entry has to be allowlisted separately. */
export function oauthRedirectUrl(): string {
  return Linking.createURL('/auth/callback');
}

const NOT_CONFIGURED: AuthResult = {
  ok: false,
  error: 'Cloud sync isn’t set up on this build, so there is no account to sign in to.',
};

/** A user closing the sheet is not an error and must not be shown as one. */
const CANCELLED = { ok: false as const, error: '' };

/** True when a failed result was the user backing out rather than something
 *  breaking — screens use this to stay silent instead of showing a red line. */
export function wasCancelled(result: AuthResult): boolean {
  return !result.ok && result.error === '';
}

/**
 * Whether Sign in with Apple can be offered on this device.
 *
 * iOS-only, and false in a simulator without an iCloud account, so it is asked
 * rather than assumed from the platform. Offering a button that throws the
 * moment it is pressed is worse than not offering it.
 */
export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Google, through an in-app browser session.
 *
 * `skipBrowserRedirect` is what makes this work on a phone: without it the
 * client tries to navigate the current window, which on native is nothing at
 * all. Instead Supabase hands back the URL, `openAuthSessionAsync` presents it
 * in an `ASWebAuthenticationSession` / Custom Tab, and the redirect comes back
 * as a `code` in the result URL for `exchangeCodeForSession` to turn into a
 * session. Under PKCE the verifier never leaves the device, so the code in that
 * URL is worthless to anything that intercepts it.
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  try {
    const redirectTo = oauthRedirectUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        // Without this, Google silently reuses whichever account the system
        // browser is already signed into, and a user with two accounts has no
        // way to reach the other one — the sheet flashes and they are in as
        // somebody they did not choose.
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) return { ok: false, error: friendlyOAuthError(error.message) };
    if (!data?.url) return { ok: false, error: 'Google sign-in is not enabled for this project.' };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return CANCELLED;

    const { queryParams } = Linking.parse(result.url);

    // Google reports a refusal in the URL rather than by failing. Surfacing it
    // matters most for `access_denied`, which is what "Cancel" on the consent
    // screen produces and should read as a cancellation, not a fault.
    const providerError = firstParam(queryParams?.error);
    if (providerError) {
      return providerError === 'access_denied'
        ? CANCELLED
        : { ok: false, error: firstParam(queryParams?.error_description) ?? providerError };
    }

    const code = firstParam(queryParams?.code);
    if (!code) {
      return { ok: false, error: 'Google sent us back without a sign-in code. Please try again.' };
    }

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return { ok: false, error: friendlyOAuthError(exchangeError.message) };

    // onAuthStateChange clears this too; setting it here as well means the gate
    // cannot briefly treat a freshly signed-in user as a guest.
    useAuthStore.setState({ isGuest: false });
    return { ok: true };
  } catch (error) {
    reportError(error, { scope: 'oauth:google' });
    return { ok: false, error: 'Could not reach Google. Check your connection and try again.' };
  }
}

/**
 * Apple, natively.
 *
 * ## The nonce, which is the part that is easy to get wrong
 *
 * Two different values are in play and swapping them breaks sign-in completely:
 *
 *   - Apple is given the **SHA-256 hash** of the nonce. It embeds that hash in
 *     the identity token's `nonce` claim.
 *   - Supabase is given the **raw** nonce. GoTrue hashes it itself and compares
 *     the result against the claim in the token.
 *
 * So a stolen identity token cannot be replayed against this project: whoever
 * replays it does not have the raw value the claim was derived from. If Apple
 * sign-in ever fails with a nonce mismatch, this pair is the first place to
 * look — the fix is which of the two values goes where, not the hashing.
 *
 * ## Name and email arrive once, ever
 *
 * Apple returns them on the *first* authorisation for this Apple ID and never
 * again, so they are pushed into user metadata immediately. There is no second
 * chance to collect them, and a user who reinstalls comes back nameless
 * otherwise.
 */
export async function signInWithApple(): Promise<AuthResult> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  try {
    const rawNonce = randomNonce();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      return { ok: false, error: 'Apple did not return a sign-in token. Please try again.' };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) return { ok: false, error: friendlyOAuthError(error.message) };

    useAuthStore.setState({ isGuest: false });

    // Best-effort, and deliberately after the session exists: this is a nicety,
    // and a failure here must not turn a successful sign-in into an error.
    const displayName = appleDisplayName(credential.fullName);
    if (displayName) {
      await supabase.auth
        .updateUser({ data: { display_name: displayName } })
        .catch(() => undefined);
    }

    return { ok: true };
  } catch (error) {
    // Apple signals a cancelled sheet by throwing with this code rather than
    // returning anything, so it has to be caught here to avoid showing an error
    // to somebody who simply changed their mind.
    if (isAppleCancellation(error)) return CANCELLED;
    reportError(error, { scope: 'oauth:apple' });
    return { ok: false, error: 'Apple sign-in did not complete. Please try again.' };
  }
}

/** 32 bytes of CSPRNG output, hex-encoded. `Math.random` is not acceptable for
 *  a value whose whole job is being unguessable. */
function randomNonce(): string {
  return Array.from(Crypto.getRandomBytes(32))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function appleDisplayName(fullName: AppleAuthentication.AppleAuthenticationFullName | null) {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.familyName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function isAppleCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_REQUEST_CANCELED'
  );
}

/** `Linking.parse` types query values as `string | string[]`, because a URL may
 *  repeat a key. Only the first is ever meaningful here. */
function firstParam(value: string | string[] | undefined | null): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Provider errors, translated.
 *
 * The two worth special-casing are both configuration mistakes that produce
 * messages naming nothing the user could act on — and, because they only appear
 * once a real provider is wired up, they are exactly the errors that will be hit
 * first and understood last.
 */
function friendlyOAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('provider is not enabled')) {
    return 'That sign-in method is not switched on for this project yet.';
  }
  if (m.includes('redirect') || m.includes('invalid request')) {
    return 'This app’s sign-in address has not been allowlisted for the project yet.';
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'Network error — check your connection and try again.';
  }
  if (m.includes('nonce')) {
    return 'Sign-in could not be verified. Please try again.';
  }
  return message;
}
