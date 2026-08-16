/**
 * What configure-auth.mjs applies, separated from the applying.
 *
 * Same split as migration-plan.mjs / migrate.mjs, and for the same reason: the
 * CLI half needs `import.meta.url`, which the jest transform this repo uses
 * targets Hermes and cannot provide, so anything importable by a test has to
 * live outside it. The decisions worth asserting on are all here — which
 * templates exist, what the rate limits must be, which redirect URLs an
 * environment needs, and the two parsers that turn opaque strings into the
 * project this writes to.
 */
import buildEnv from './build-env.js';

const { IDENTITY } = buildEnv;

/**
 * Every template the script applies, and the API field pair each lands in.
 *
 * All five are here even though the app only ever triggers three. The other
 * two are not dead weight: `email_change` and `reauthentication` are sent by
 * GoTrue on paths reachable without any app screen — an address changed
 * through the dashboard, a reauthentication challenge — and a template left
 * unset is not absent. It is Supabase's stock one, which says Supabase to a
 * user who has only ever seen Daykeep.
 *
 * The subject lines are duplicated in a comment at the top of each HTML file,
 * for whoever is pasting one into the dashboard by hand; the copy here is the
 * one that actually gets applied, and templates.test.ts holds the two together.
 */
export const MAILER_TEMPLATES = [
  {
    file: 'confirm-signup.html',
    subjectField: 'mailer_subjects_confirmation',
    contentField: 'mailer_templates_confirmation_content',
    subject: 'Your Daykeep verification code',
  },
  {
    file: 'reset-password.html',
    subjectField: 'mailer_subjects_recovery',
    contentField: 'mailer_templates_recovery_content',
    subject: 'Your Daykeep password reset code',
  },
  {
    file: 'magic-link.html',
    subjectField: 'mailer_subjects_magic_link',
    contentField: 'mailer_templates_magic_link_content',
    subject: 'Your Daykeep sign-in code',
  },
  {
    file: 'email-change.html',
    subjectField: 'mailer_subjects_email_change',
    contentField: 'mailer_templates_email_change_content',
    subject: 'Confirm your new Daykeep email address',
  },
  {
    file: 'reauthentication.html',
    subjectField: 'mailer_subjects_reauthentication',
    contentField: 'mailer_templates_reauthentication_content',
    subject: 'Your Daykeep confirmation code',
  },
];

/**
 * OTP shape and the two rate limits, which have to be set together.
 *
 * `mailer_otp_length: 6` because features/auth/components/otp-field.tsx
 * accepts exactly six digits — a project left on the default emits a longer
 * code the field physically cannot hold.
 *
 * `smtp_max_frequency` is the one that actually bites. It is the minimum gap
 * between two emails to the same address, it defaults to 60 seconds, and
 * app/(auth)/verify-signup.tsx and verify-reset.tsx both re-enable "Resend
 * code" after 30. So the app invites the user to do something the server
 * refuses, and the refusal arrives as `over_email_send_rate_limit` — which
 * reads, to the person waiting, as the code never arriving at all. 20s rather
 * than 30 so the app's cooldown is the binding constraint and a second of
 * clock skew cannot put the two on opposite sides of one boundary.
 *
 * `rate_limit_email_sent` is per hour and project-wide. Supabase's default of
 * 30 is sized for its own shared mailer, which it is rationing across every
 * free project; once the relay is yours the limit that matters is Resend's,
 * and 30/hour spread over every user of the project is low enough that a
 * modest signup burst starts dropping verification emails silently.
 */
export const MAILER_SETTINGS = {
  mailer_otp_length: 6,
  mailer_otp_exp: 3600,
  smtp_max_frequency: 20,
  rate_limit_email_sent: 200,
};

/**
 * The Google provider, or null when it is not configured locally.
 *
 * Both halves or neither: a client id with no secret is accepted by the
 * Management API and then fails at Google with `invalid_client`, which is a
 * long way from anything naming the missing value.
 *
 * `oauth.ts` uses the browser PKCE flow, so Google only ever sees Supabase's
 * `/auth/v1/callback` — one **Web application** client, no Android client, no
 * package id and no SHA-1. That is why the same credentials can serve both
 * projects: register both projects' callbacks on the one client. (A move to
 * `@react-native-google-signin` is what would introduce per-package clients;
 * this is a property of the native sheet, not of Google sign-in.)
 */
export function googleProviderFields(env = process.env) {
  const clientId = (env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim();
  const secret = (env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim();
  if (!clientId && !secret) return null;
  if (!clientId || !secret) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set together.\n\n' +
        `Currently: id ${clientId ? 'set' : 'MISSING'}, secret ${secret ? 'set' : 'MISSING'}.\n` +
        'Half-configured, Supabase accepts the provider and every sign-in then\n' +
        'fails at Google with "invalid_client".',
    );
  }
  return {
    external_google_enabled: true,
    external_google_client_id: clientId,
    external_google_secret: secret,
  };
}

/** The callback Google must have registered for a project, which is Supabase's
 *  URL and not the app's. This is the step everyone gets wrong once: Google
 *  redirects to Supabase, and Supabase redirects to the app. */
export const googleCallbackUrl = (ref) => `https://${ref}.supabase.co/auth/v1/callback`;

/** The environments this can target, and the connection string each one's
 *  project ref is read out of. Static property access rather than
 *  `process.env[name]` for the reason spelled out in scripts/migrate.mjs:
 *  `expo/no-dynamic-env-var` bans the dynamic form repo-wide. */
export const ENVIRONMENTS = {
  staging: {
    variable: 'SUPABASE_DB_URL_STAGING',
    read: () => process.env.SUPABASE_DB_URL_STAGING,
  },
  production: {
    variable: 'SUPABASE_DB_URL_PRODUCTION',
    read: () => process.env.SUPABASE_DB_URL_PRODUCTION,
  },
};

/**
 * The deep links this environment's Auth must be willing to redirect back to.
 *
 * Both slash forms of each, because `Linking.createURL` emits the triple-slash
 * form on some platforms and the double on others, and an unlisted redirect is
 * refused before the user sees anything.
 *
 * The scheme is per-environment and comes from scripts/build-env.js, which is
 * also what app.config.js applies to the build — so this cannot drift from the
 * scheme the app actually emits. Hardcoding `daykeep` here instead is how a
 * staging project ends up allow-listing a scheme no staging build uses, and
 * Google sign-in fails with a message about an address that appears nowhere.
 */
export function redirectUrlsFor(environment) {
  const scheme = IDENTITY[environment]?.scheme ?? 'daykeep';
  return [
    `${scheme}://auth/callback`,
    `${scheme}:///auth/callback`,
    `${scheme}://reset-password`,
    `${scheme}:///reset-password`,
  ];
}

/**
 * The project ref inside a Postgres connection string.
 *
 * Both shapes Supabase hands out, because both are in circulation: the session
 * pooler authenticates as `postgres.<ref>`, and the direct host is
 * `db.<ref>.supabase.co`. Matched with a regex rather than `new URL()` because
 * a generated Postgres password contains characters that make URL parsing
 * throw — and failing to read a public identifier because of the secret next
 * to it would be an absurd way to lose.
 */
export function projectRefFromDbUrl(url) {
  const pooler = /postgres(?:ql)?:\/\/postgres\.([a-z0-9]+)[:@]/i.exec(url ?? '');
  if (pooler) return pooler[1];
  const direct = /@db\.([a-z0-9]+)\.supabase\.co/i.exec(url ?? '');
  if (direct) return direct[1];
  return null;
}

/** `Daykeep <invites@example.com>` -> `{ name, email }`. Throws rather than
 *  guessing: this value becomes the From header on every email the project
 *  sends, and a half-parsed one fails at the provider, later, per message. */
export function parseSender(raw, varName) {
  const match = /^(.*)<(.+)>$/.exec(raw ?? '');
  if (!match) {
    throw new Error(`${varName} must look like "Daykeep <address@yourdomain.com>" — got: ${raw}`);
  }
  return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
}

/**
 * The redirect allow-list after adding what this environment needs, or null
 * when it already covers all of it.
 *
 * A union, never a replacement. The entries added by hand are the ones hardest
 * to recreate — an `exp://` tunnel URL for testing OAuth in Expo Go, a
 * colleague's dev machine — and quietly dropping them turns a routine re-run
 * of this script into a broken sign-in for whoever put them there.
 */
export function mergeAllowList(current, required) {
  const existing = (current ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const missing = required.filter((url) => !existing.includes(url));
  if (missing.length === 0) return null;
  return { list: [...existing, ...missing].join(','), added: missing };
}
