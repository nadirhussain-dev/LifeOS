import i18n from '@/lib/i18n';

import { looksOffline } from '@/lib/supabase-error';

/**
 * What went wrong with an auth request, in words a person can act on.
 *
 * ## Why this replaced a list of `message.includes(...)` tests
 *
 * GoTrue's messages are written for the log, not the user, and matching them by
 * substring is wrong in both directions. The test that actually shipped —
 * `message.includes('otp')` — matched `"Signups not allowed for otp"`, which is
 * the answer to *"send a code to this address"* when no account exists there.
 * A person who had just typed their email and tapped Continue was told "That
 * code is incorrect or has expired", about a code that had never been sent,
 * with no code on screen to be incorrect. Every following step was then
 * unreachable: no verify screen, no resend, no password.
 *
 * The opposite direction is worse and was also live. supabase-js turns a 500
 * into an `AuthRetryableFetchError` whose message is the literal string `"{}"`,
 * and a 500 is exactly what a rejected recipient produces — so the failure that
 * means *the email was never sent* reached the screen as `{}`.
 *
 * ## What it keys on instead
 *
 * `error.code`, GoTrue's stable machine-readable identifier, which is present on
 * every rejection a current Supabase project returns and does not change when
 * somebody rewords a message. `status` and the message are consulted only as
 * fallbacks, in that order, for the two cases where no code arrives: an old
 * GoTrue, and a transport-level failure that never reached the API.
 *
 * ## Why the same code can need two different sentences
 *
 * `otp_disabled` is returned both when emailed codes are switched off for the
 * project and when the address has no account and the caller asked not to
 * create one. The server cannot tell those apart for us, but the caller always
 * knows which question it asked — hence `action`. Getting this wrong is not
 * cosmetic: "there's no account with that email" and "sign-ups are closed" send
 * a person to two different screens.
 */

/** Which request failed. See the note above on why the caller has to say. */
export type AuthAction =
  | 'signInWithPassword'
  | 'sendSignUpCode'
  | 'sendSignInCode'
  | 'sendResetCode'
  | 'verifyCode'
  | 'updatePassword'
  | 'deleteAccount';

/** The shape both supabase-js error classes share. Structural rather than
 *  `AuthError`, so tests can pass the exact JSON a live project returns
 *  without constructing SDK objects. */
export type SupabaseAuthError = {
  name?: string;
  code?: string;
  status?: number;
  message: string;
};

export type AuthFailure = {
  /** i18n key under `authError.` */
  key: string;
  params?: Record<string, string | number>;
};

/** Sending an email is the only thing a project's mail relay can fail at, and
 *  it fails differently from a rejection — see `emailNotSent` below. */
const SEND_ACTIONS = new Set<AuthAction>(['sendSignUpCode', 'sendSignInCode', 'sendResetCode']);

/**
 * "For security purposes, you can only request this after 17 seconds."
 *
 * Pulled out because a rate limit with the number in it is a wait, and one
 * without is a wall. The resend button uses this to line its countdown up with
 * the server's rather than guessing — see `email-code-step.tsx`.
 */
export function retryAfterSeconds(error: SupabaseAuthError | null | undefined): number | null {
  const match = /after (\d+) seconds?/i.exec(error?.message ?? '');
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** The i18n key (and any interpolations) for a failed auth request. */
export function authFailure(
  error: SupabaseAuthError | null | undefined,
  action: AuthAction,
): AuthFailure {
  if (!error) return { key: 'unknown' };

  const seconds = retryAfterSeconds(error);

  switch (error.code) {
    case 'otp_expired':
      return { key: 'codeExpired' };

    // The one that produced the original bug. Which sentence is right depends
    // entirely on what was asked — see the note at the top of this file.
    case 'otp_disabled':
      return action === 'sendSignInCode' ? { key: 'noAccountForEmail' } : { key: 'codeSignUpOff' };

    case 'signup_disabled':
      return { key: 'signUpsClosed' };
    case 'email_provider_disabled':
      return { key: 'emailAuthOff' };

    case 'over_email_send_rate_limit':
      return seconds ? { key: 'waitSeconds', params: { seconds } } : { key: 'tooManyEmails' };
    case 'over_request_rate_limit':
    case 'over_sms_send_rate_limit':
      return seconds ? { key: 'waitSeconds', params: { seconds } } : { key: 'tooManyAttempts' };

    case 'email_exists':
    case 'user_already_exists':
      return { key: 'emailTaken' };

    case 'invalid_credentials':
      return { key: 'wrongEmailOrPassword' };
    case 'email_not_confirmed':
      return { key: 'emailNotConfirmed' };
    case 'user_not_found':
      return { key: 'noAccountForEmail' };

    case 'weak_password':
      return { key: 'weakPassword' };
    case 'same_password':
      return { key: 'samePassword' };

    case 'email_address_invalid':
    case 'validation_failed':
      return { key: 'invalidEmail' };

    case 'captcha_failed':
      return { key: 'captchaFailed' };

    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
      return { key: 'sessionExpired' };
  }

  // No code. Either the transport never reached the API, or this is an older
  // GoTrue whose rejections are prose only.
  const message = error.message ?? '';

  if (looksOffline(message) || (error.name === 'AuthRetryableFetchError' && !error.status)) {
    return { key: 'offline' };
  }

  if (typeof error.status === 'number' && error.status >= 500) {
    // A 500 on a send is overwhelmingly the relay refusing the recipient, and
    // it is the failure most worth naming precisely: nothing was delivered, so
    // waiting for a code that is coming is exactly the wrong thing to do.
    return SEND_ACTIONS.has(action) ? { key: 'emailNotSent' } : { key: 'serverBusy' };
  }

  const m = message.toLowerCase();
  if (m.includes('invalid login')) return { key: 'wrongEmailOrPassword' };
  if (m.includes('already registered') || m.includes('already been registered')) {
    return { key: 'emailTaken' };
  }
  if (m.includes('password should be')) return { key: 'weakPassword' };
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return { key: 'invalidEmail' };
  }
  if (m.includes('email not confirmed')) return { key: 'emailNotConfirmed' };
  if (m.includes('token has expired') || m.includes('token is invalid'))
    return { key: 'codeExpired' };
  if (m.includes('for security purposes')) {
    return seconds ? { key: 'waitSeconds', params: { seconds } } : { key: 'tooManyAttempts' };
  }
  if (m.includes('signups not allowed')) {
    return action === 'sendSignInCode' ? { key: 'noAccountForEmail' } : { key: 'codeSignUpOff' };
  }

  // Nothing recognised. A server message is still better than silence — but
  // only if it is a sentence: supabase-js hands back `"{}"` for some failures,
  // and JSON on a sign-up screen is worse than saying nothing specific.
  return isReadable(message) ? { key: 'raw', params: { message } } : { key: 'unknown' };
}

/** The same thing, already translated — what the screens call. */
export function authErrorMessage(
  error: SupabaseAuthError | null | undefined,
  action: AuthAction,
): string {
  const failure = authFailure(error, action);
  if (failure.key === 'raw') return String(failure.params?.message ?? '');
  return i18n.t(`authError.${failure.key}`, failure.params);
}

/** Whether a server string is fit to put in front of somebody: prose, not a
 *  serialised object, an error id, or an empty shell. */
function isReadable(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 4) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  return /\s/.test(trimmed);
}
