import { authFailure, retryAfterSeconds } from '@/features/auth/services/auth-errors';

/**
 * The mapping from what Supabase says to what the user reads.
 *
 * Every payload below was captured from a live Supabase project rather than
 * written from memory — that distinction matters here, because the bug this
 * file exists to prevent came from assuming the shape of these errors. The
 * assumption was that anything mentioning "otp" was about a code the user had
 * typed; the reality is that GoTrue's answer to *"send a code to an address
 * with no account"* is `otp_disabled: "Signups not allowed for otp"`, which
 * mentions otp and has nothing to do with a typed code.
 */

// Captured: POST /auth/v1/otp, create_user false, address with no account.
const NO_ACCOUNT = {
  name: 'AuthApiError',
  code: 'otp_disabled',
  status: 422,
  message: 'Signups not allowed for otp',
};

// Captured: POST /auth/v1/verify with a wrong code.
const WRONG_CODE = {
  name: 'AuthApiError',
  code: 'otp_expired',
  status: 403,
  message: 'Token has expired or is invalid',
};

// Captured: POST /auth/v1/otp where the mail relay refused the recipient.
// supabase-js reports the 500 like this — the message really is "{}".
const RELAY_REFUSED = {
  name: 'AuthRetryableFetchError',
  status: 500,
  message: '{}',
};

describe('the failure that broke sign-up', () => {
  /**
   * The exact regression. Told "that code is incorrect or has expired" on the
   * first screen of sign-up, a person has no code, no verify screen and no
   * resend button — nothing on screen relates to what they were just told, so
   * there is no next move. Whatever the sentence is, it must not be about a
   * code.
   */
  it('never blames a code for a failure that happened before one was sent', () => {
    for (const action of ['sendSignUpCode', 'sendSignInCode', 'sendResetCode'] as const) {
      expect(authFailure(NO_ACCOUNT, action).key).not.toBe('codeExpired');
      expect(authFailure(RELAY_REFUSED, action).key).not.toBe('codeExpired');
    }
  });

  /** Same code, two questions, two answers — the server cannot tell them
   *  apart, so the caller has to. */
  it('reads otp_disabled by what was asked', () => {
    expect(authFailure(NO_ACCOUNT, 'sendSignInCode').key).toBe('noAccountForEmail');
    expect(authFailure(NO_ACCOUNT, 'sendSignUpCode').key).toBe('codeSignUpOff');
  });

  /**
   * The other half of "nothing works": a relay that refuses the recipient. The
   * user must not be left waiting for a code, because none was sent — and they
   * certainly must not be shown `{}`.
   */
  it('says the email was not sent, rather than showing raw JSON', () => {
    expect(authFailure(RELAY_REFUSED, 'sendSignUpCode').key).toBe('emailNotSent');
    expect(authFailure(RELAY_REFUSED, 'sendResetCode').key).toBe('emailNotSent');
  });

  it('still calls a wrong code a wrong code', () => {
    expect(authFailure(WRONG_CODE, 'verifyCode').key).toBe('codeExpired');
  });
});

describe('rate limits', () => {
  const limited = {
    name: 'AuthApiError',
    code: 'over_email_send_rate_limit',
    status: 429,
    message: 'For security purposes, you can only request this after 17 seconds.',
  };

  it('passes the wait on, so the countdown can match the server', () => {
    expect(retryAfterSeconds(limited)).toBe(17);
    expect(authFailure(limited, 'sendSignUpCode')).toEqual({
      key: 'waitSeconds',
      params: { seconds: 17 },
    });
  });

  it('falls back to a vaguer sentence when no number is given', () => {
    expect(
      authFailure(
        { code: 'over_email_send_rate_limit', status: 429, message: 'Email rate limit exceeded' },
        'sendSignUpCode',
      ).key,
    ).toBe('tooManyEmails');
  });
});

describe('the ordinary rejections', () => {
  it.each([
    ['invalid_credentials', 'signInWithPassword', 'wrongEmailOrPassword'],
    ['email_exists', 'sendSignUpCode', 'emailTaken'],
    ['weak_password', 'updatePassword', 'weakPassword'],
    ['same_password', 'updatePassword', 'samePassword'],
    ['email_address_invalid', 'sendSignUpCode', 'invalidEmail'],
    ['email_not_confirmed', 'signInWithPassword', 'emailNotConfirmed'],
    ['user_not_found', 'sendResetCode', 'noAccountForEmail'],
    ['signup_disabled', 'sendSignUpCode', 'signUpsClosed'],
    ['email_provider_disabled', 'sendSignInCode', 'emailAuthOff'],
  ])('%s -> %s', (code, action, expected) => {
    expect(
      authFailure({ code, status: 400, message: 'irrelevant' }, action as never).key,
    ).toBe(expected);
  });
});

describe('when there is no error code at all', () => {
  /** An older GoTrue, or a self-hosted one, answers in prose only. */
  it('falls back to the message for a project that sends no codes', () => {
    expect(
      authFailure({ status: 400, message: 'Invalid login credentials' }, 'signInWithPassword').key,
    ).toBe('wrongEmailOrPassword');
    expect(
      authFailure({ status: 403, message: 'Token has expired or is invalid' }, 'verifyCode').key,
    ).toBe('codeExpired');
  });

  it('recognises being offline, which is not a rejection', () => {
    expect(
      authFailure({ name: 'AuthRetryableFetchError', message: 'Network request failed' }, 'verifyCode')
        .key,
    ).toBe('offline');
  });

  /**
   * A server string is better than nothing — but only when it is a sentence.
   * `"{}"`, an error id, or a bare token on a sign-in screen tells the user
   * less than a generic apology does.
   */
  it('refuses to put unreadable server output in front of a user', () => {
    for (const message of ['{}', '{"error_id":"01a0"}', 'ERR', '   ']) {
      expect(authFailure({ status: 400, message }, 'signInWithPassword').key).toBe('unknown');
    }
  });

  it('passes a genuine sentence through unchanged', () => {
    expect(authFailure({ status: 400, message: 'Something specific went wrong' }, 'verifyCode')).toEqual(
      { key: 'raw', params: { message: 'Something specific went wrong' } },
    );
  });
});
