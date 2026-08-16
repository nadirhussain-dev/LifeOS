/**
 * What Daykeep will accept as a password.
 *
 * Supabase's default floor is six characters of anything, which in practice
 * means `123456` guards a journal, a cycle tracker and a private space. This is
 * the app's own floor, applied before the request goes out so the person gets a
 * specific reason rather than a generic server rejection.
 *
 * The rules follow NIST SP 800-63B rather than the older "one upper, one digit,
 * one symbol" pattern: length is what actually resists guessing, and composition
 * rules mostly produce `Password1!`. So the requirements are a real minimum
 * length and a check against the passwords attackers try first.
 *
 * This is a client-side check and therefore advisory — it improves the choice a
 * person makes, it does not stop a crafted request. The server-side floor is
 * Supabase's own `password_min_length` / `password_required_characters` project
 * settings, which should be raised to match (see docs/SECURITY.md).
 */

export const PASSWORD_MIN_LENGTH = 10;

/** Long enough that the length rule alone is sufficient — a passphrase does not
 * need to also contain a digit. */
const PASSPHRASE_LENGTH = 16;

export type PasswordProblem =
  'too_short' | 'too_common' | 'too_simple' | 'contains_identity' | 'too_long';

/**
 * bcrypt — which is what Supabase Auth hashes with — silently truncates at 72
 * bytes, so everything past that contributes nothing and pretending otherwise
 * overstates the strength of what was chosen.
 */
const PASSWORD_MAX_BYTES = 72;

/**
 * The passwords that appear at the top of every breach corpus, plus the ones
 * this app invites specifically. Not a substitute for a real breach-corpus
 * check (that belongs server-side, against HIBP's k-anonymity API); it catches
 * the handful that a meaningful share of people would otherwise pick.
 */
const COMMON = new Set([
  '123456789',
  '1234567890',
  'password1',
  'password123',
  'qwertyuiop',
  'qwerty123',
  'iloveyou1',
  'admin12345',
  'welcome123',
  'letmein123',
  'monkey1234',
  'abc12345',
  'password!',
  'p@ssw0rd',
  'p@ssword1',
  'lifeos1234',
  'daykeep1234',
  'lifeospassword',
  'daykeeppassword',
  'changeme123',
  'trustno1234',
]);

export type PasswordCheck = { ok: true } | { ok: false; problem: PasswordProblem };

/**
 * `identity` is the email and display name the user is signing up with. A
 * password derived from either is trivially guessable by anyone who knows who
 * the account belongs to, which for a shared-device app is often the exact
 * threat.
 */
export function checkPassword(password: string, identity: string[] = []): PasswordCheck {
  if (password.length < PASSWORD_MIN_LENGTH) return { ok: false, problem: 'too_short' };

  // Byte length, not character length: one emoji is four bytes of the budget.
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return { ok: false, problem: 'too_long' };
  }

  const normalized = password.toLowerCase();
  if (COMMON.has(normalized)) return { ok: false, problem: 'too_common' };

  for (const part of identityTokens(identity)) {
    if (normalized.includes(part)) return { ok: false, problem: 'contains_identity' };
  }

  // A long passphrase needs nothing else; anything shorter has to be more than
  // one repeated character or a straight run off the keyboard.
  if (password.length >= PASSPHRASE_LENGTH) return { ok: true };
  if (isTrivial(normalized)) return { ok: false, problem: 'too_simple' };

  return { ok: true };
}

/** The meaningful pieces of an email or a name: the local part, the domain
 * label, each word of the name. Fragments under four characters are dropped —
 * refusing a password because it contains "an" helps nobody. */
function identityTokens(identity: string[]): string[] {
  return identity
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
    .filter((token) => token.length >= 4);
}

/** One character over and over, or a straight run along the keyboard/alphabet. */
function isTrivial(normalized: string): boolean {
  if (new Set(normalized).size <= 2) return true;
  const runs = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl'];
  return runs.some(
    (run) => run.includes(normalized) || [...run].reverse().join('').includes(normalized),
  );
}

/** The i18n key explaining a problem, so screens do not each invent wording. */
export function passwordProblemKey(problem: PasswordProblem): string {
  return `auth.passwordProblem.${problem}`;
}
