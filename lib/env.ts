/**
 * Public environment for the app. Deliberately lenient: missing/blank Supabase
 * creds must NOT crash the app — Daykeep is offline-first and fully usable in
 * guest mode with no backend at all. Auth and sync check `isSupabaseConfigured`
 * and stay disabled (guest-only) until real values are present.
 *
 * EXPO_PUBLIC_ vars are inlined by Metro at build time. For local dev they come
 * from `.env`; for an EAS build they come from the EAS environment that eas.json
 * links the build profile to — and app.config.js now fails a release build
 * outright when the required ones are absent, rather than letting a
 * credential-less APK ship silently. The anon key is safe to expose client-side:
 * it only grants what your Row Level Security policies allow.
 *
 * Note that `process.env` must be indexed with a literal here. Metro's inlining
 * is a compile-time text substitution, so a computed key like `process.env[name]`
 * resolves to nothing at runtime.
 */

const read = (v: string | undefined) => (v ?? '').trim();

export const env = {
  /**
   * Which backend this build talks to: `development` | `staging` |
   * `production`. Set per EAS environment; see scripts/build-env.js for the
   * profile mapping and docs/ENVIRONMENTS.md for the setup.
   *
   * A release build cannot omit it — app.config.js fails the build — because it
   * also decides the app id, the app name and the deep-link scheme, and a
   * staging install that looks exactly like the real app is how somebody ends
   * up reporting a bug against the wrong database.
   */
  EXPO_PUBLIC_APP_ENV: read(process.env.EXPO_PUBLIC_APP_ENV),
  EXPO_PUBLIC_SUPABASE_URL: read(process.env.EXPO_PUBLIC_SUPABASE_URL),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: read(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  /** Where the password-reset email links back to. Optional — falls back to the
   * app's `daykeep://reset-password` deep link (see lib/supabase.ts). */
  EXPO_PUBLIC_SUPABASE_REDIRECT_URL: read(process.env.EXPO_PUBLIC_SUPABASE_REDIRECT_URL),
  /** Sentry DSN. Optional — when absent, crash/error reporting stays local-only
   * (console + dev banner). See lib/sentry.ts. */
  EXPO_PUBLIC_SENTRY_DSN: read(process.env.EXPO_PUBLIC_SENTRY_DSN),

  /**
   * Base64 X25519 public key the vault master key is sealed to, enabling
   * operator access to private spaces (see features/private/services/
   * vault-escrow.ts and supabase/migrations/0015).
   *
   * Unset means no escrow: the vault stays genuinely end-to-end encrypted and
   * nobody but the user can open it. That is the safe default on purpose — a
   * misconfigured build must never quietly start uploading keys.
   */
  EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY: read(process.env.EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY),

  /**
   * Where the published privacy policy and terms live.
   *
   * Configurable rather than hardcoded because the store requirement is about
   * the URL, not the text: Google wants a stable, publicly reachable,
   * non-editable address, and the app must point at whatever that turns out to
   * be. The default is the GitHub Pages site built by .github/workflows/
   * pages.yml from PRIVACY.md and TERMS.md, so the app and the published
   * documents cannot drift apart. Moving to your own domain later is an
   * environment change, not a release.
   *
   * The previous value was a GitHub *blob* URL — the file as rendered inside
   * the repository. That fails the requirement twice over: it is editable by
   * the owner without any record a reviewer can see, and it 404s entirely if
   * the repository is private.
   */
  EXPO_PUBLIC_PRIVACY_URL:
    read(process.env.EXPO_PUBLIC_PRIVACY_URL) ||
    'https://nadirhussain786.github.io/Daykeep/privacy/',
  EXPO_PUBLIC_TERMS_URL:
    read(process.env.EXPO_PUBLIC_TERMS_URL) || 'https://nadirhussain786.github.io/Daykeep/terms/',
  /**
   * Where support and data-access requests go. Both stores require a working
   * contact address; a block screen's mailto was the only one the app had.
   *
   * A role address, not a person's. Google Play publishes this on the store
   * listing, so it is public and permanent the moment the app ships — and it is
   * also the contact printed in PRIVACY.md and TERMS.md, which get archived.
   * Both are reasons it must be an address that can be handed to somebody else
   * without handing over a personal inbox.
   */
  EXPO_PUBLIC_SUPPORT_EMAIL:
    read(process.env.EXPO_PUBLIC_SUPPORT_EMAIL) || 'daykeepsupport@gmail.com',

  /**
   * Real AdMob banner ad unit ids, one per platform (AdMob issues a separate
   * unit id per platform even for "the same" placement). See features/ads/
   * components/ad-slot.tsx: unset on either platform falls back to Google's
   * own `TestIds.BANNER` for that platform, the same "unset = safe default"
   * pattern as the vault escrow key above — a build with these blank still
   * ships, it just keeps showing Google's self-labeled test creative instead
   * of real inventory. The App IDs these units belong to are a separate,
   * build-time-only pair (`ADMOB_ANDROID_APP_ID`/`ADMOB_IOS_APP_ID`, no
   * EXPO_PUBLIC_ prefix — see app.config.js) because they're consumed by the
   * native config plugin, never read from JS.
   */
  EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_ANDROID: read(
    process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_ANDROID,
  ),
  EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_IOS: read(process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_IOS),
};

export type AppEnvironment = 'development' | 'staging' | 'production';

const ENVIRONMENTS: AppEnvironment[] = ['development', 'staging', 'production'];

/**
 * The environment this build was made for.
 *
 * Defaults to `development` rather than `production` when unset or unrecognised.
 * That direction is deliberate: everything keyed off this makes a
 * non-production build *more* visible (a badge, a project ref on the sync
 * screen), so guessing "development" degrades to showing a badge on a build
 * that did not need one. Guessing "production" would hide the badge on a
 * staging build, which is the failure this whole mechanism exists to prevent.
 */
export const appEnv: AppEnvironment = ENVIRONMENTS.includes(
  env.EXPO_PUBLIC_APP_ENV as AppEnvironment,
)
  ? (env.EXPO_PUBLIC_APP_ENV as AppEnvironment)
  : 'development';

/** True only for a build made against the real, user-facing backend. Anything
 * that must not run against real accounts — seeding, destructive debug tools —
 * should gate on this rather than on `__DEV__`, which is false in a staging
 * release build too. */
export const isProductionEnv = appEnv === 'production';

/**
 * The Supabase project this build points at (`abcdefgh` from
 * `https://abcdefgh.supabase.co`), or null.
 *
 * The ref is public — it is half of every request the app makes — so it is safe
 * on screen, and it is the only way to tell from a phone whether an install is
 * talking to staging or production when both are configured and working.
 */
export const supabaseProjectRef: string | null =
  /^https?:\/\/([^.]+)\./.exec(env.EXPO_PUBLIC_SUPABASE_URL)?.[1] ?? null;

/** True only when both a real-looking URL and a plausible anon key are present.
 * Auth/sync gate on this so a build without creds runs cleanly in guest mode. */
export const isSupabaseConfigured =
  /^https?:\/\/[^\s]+\.[^\s]+$/.test(env.EXPO_PUBLIC_SUPABASE_URL) &&
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY.length > 20;

/** Truncated, non-reversible preview of a credential — enough to tell "wrong
 * value" from "no value" on a device, without putting the key on screen. */
function preview(value: string): string {
  if (!value) return '—';
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export type EnvDiagnostics = {
  supabaseConfigured: boolean;
  environment: AppEnvironment;
  /** Which Supabase project the build is pointed at, or null. */
  projectRef: string | null;
  /** Which values survived into this build. Shown on the sync screen so an EAS
   * credential problem can be identified from the phone — the alternative is
   * rebuilding blind, because a missing variable leaves no other trace. */
  entries: { key: keyof typeof env; present: boolean; preview: string }[];
};

export function envDiagnostics(): EnvDiagnostics {
  const describe = (key: keyof typeof env) => ({
    key,
    present: !!env[key],
    preview: preview(env[key]),
  });

  return {
    supabaseConfigured: isSupabaseConfigured,
    environment: appEnv,
    projectRef: supabaseProjectRef,
    entries: [
      describe('EXPO_PUBLIC_APP_ENV'),
      describe('EXPO_PUBLIC_SUPABASE_URL'),
      describe('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
      describe('EXPO_PUBLIC_SENTRY_DSN'),
    ],
  };
}
