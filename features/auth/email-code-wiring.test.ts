import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * That the three emailed-code flows are actually connected end to end.
 *
 * Read as source text, in the style of `device-session-wiring.test.ts` and for
 * the same reason: these screens pull in expo-router and reanimated, neither of
 * which renders under Jest, and every assertion here is about whether A leads
 * to B — a question that is answerable statically.
 *
 * The failure shape being guarded against is specific and was live: a flow that
 * *starts* and then has nowhere to go. Sign-up could send a code but the screen
 * that accepts one was unreachable if the send failed; sign-in could not send
 * one at all, so an account created with a code and no password had no route
 * back in that did not begin with resetting a password nobody had set.
 */

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('sign-up', () => {
  const screen = read('app/(auth)/sign-up.tsx');

  /** Every step of the chain exists and points at the next one. */
  it('leads to the code screen, and from there to a password', () => {
    expect(screen).toContain('/(auth)/verify-signup');
    expect(read('app/(auth)/verify-signup.tsx')).toContain('/(auth)/create-password');
  });

  /**
   * An address that already has an account must not be run through sign-up.
   * It used to be: the emailed code signed the person in, and create-password
   * then reset the password on the account they already had — from a form
   * headed "Create your account", with nothing said and nothing undoable.
   */
  it('checks for an existing account before creating one', () => {
    expect(screen).toContain('sendSignInOtp');
    expect(screen.indexOf('sendSignInOtp')).toBeLessThan(screen.indexOf('sendSignupOtp(email'));
    expect(screen).toContain('/(auth)/verify-signin');
    // Branching on the classified key, never on the translated sentence.
    expect(screen).toContain("key !== 'noAccountForEmail'");
  });
});

describe('sign-in', () => {
  const screen = read('app/(auth)/login.tsx');

  /** The path that did not exist. */
  it('offers a code as well as a password', () => {
    expect(screen).toContain('sendSignInOtp');
    expect(screen).toContain('/(auth)/verify-signin');
    expect(screen).toContain('auth.emailMeACode');
  });

  /**
   * `shouldCreateUser: false` is what makes "there's no account with that
   * email" answerable — and what stops a typo silently creating a second,
   * empty account that the user's data is not in.
   */
  it('never creates an account from the sign-in path', () => {
    const store = read('features/auth/services/auth-store.ts');
    const send = store.slice(store.indexOf('sendSignInOtp: async'));
    expect(send.slice(0, 500)).toContain('shouldCreateUser: false');
  });

  /** Verified, the code IS a session — the gate must be allowed to act on it,
   *  so this screen is deliberately not among the ones it leaves alone. */
  it('lets the auth gate route the user after the code', () => {
    const gate = read('features/auth/hooks/use-auth-gate.ts');
    const list = gate.slice(gate.indexOf('PASSWORD_SETUP_SCREENS = ['));
    expect(list.slice(0, 200)).not.toContain('verify-signin');
    expect(list.slice(0, 200)).toContain('verify-signup');
  });
});

describe('every code screen', () => {
  const screens = [
    'app/(auth)/verify-signup.tsx',
    'app/(auth)/verify-signin.tsx',
    'app/(auth)/verify-reset.tsx',
  ];

  /** One implementation of the countdown, the resend and the auto-submit —
   *  three copies is how they came to disagree. */
  it('shares one implementation', () => {
    for (const path of screens) expect(read(path)).toContain('EmailCodeStep');
  });

  it('can resend, and can go back to fix a mistyped address', () => {
    const step = read('features/auth/components/email-code-step.tsx');
    expect(step).toContain('onResend');
    expect(step).toContain('auth.wrongEmail');
    // The server knows when it will accept the next send; the screen does not.
    expect(step).toContain('retryAfterSeconds');
  });
});

describe('what the user is told when it fails', () => {
  const store = read('features/auth/services/auth-store.ts');

  /**
   * The bug behind the original report. `message.includes('otp')` matched
   * "Signups not allowed for otp" — the answer to *sending* a code — and
   * announced that a code the user had never seen was incorrect or expired.
   */
  it('classifies by error code, not by words in the message', () => {
    expect(store).not.toMatch(/includes\('otp'\)/);
    expect(store).toContain('authErrorMessage');
    const mapper = read('features/auth/services/auth-errors.ts');
    expect(mapper).toContain('switch (error.code)');
  });

  /** Every auth call has to say which question it asked: the same code means
   *  different things depending on it. */
  it('tells the mapper what was being attempted', () => {
    for (const action of [
      'signInWithPassword',
      'sendSignUpCode',
      'sendSignInCode',
      'sendResetCode',
      'verifyCode',
      'updatePassword',
    ]) {
      expect(store).toContain(`'${action}'`);
    }
  });
});
