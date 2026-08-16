/**
 * Which environment a build is for, and what that changes about its identity.
 *
 * Split out of app.config.js so it can be tested without running Expo's config
 * resolution. What it decides is not cosmetic: get it wrong and a build signed
 * and shipped as "Daykeep" talks to the staging database, or a tester's staging
 * APK overwrites the production app on their phone along with its local data.
 *
 * CommonJS, and `.js` rather than the `.mjs` every other script here uses,
 * because app.config.js is CommonJS and `require()` of an ESM file depends on
 * the Node version — which is not something to discover on an EAS builder.
 *
 * ---------------------------------------------------------------------------
 * The three environments, and why they are named this way
 * ---------------------------------------------------------------------------
 * EAS has exactly three environments — `development`, `preview`, `production`
 * — and those names are not configurable. Ours are `development`, `staging`,
 * `production`, because "staging" is what the database it talks to is called
 * and matching those two mattered more than matching EAS's vocabulary.
 * PROFILE_ENVIRONMENT below is the whole of the mapping between them.
 *
 * ---------------------------------------------------------------------------
 * Why EXPO_PUBLIC_APP_ENV is a variable rather than derived from the profile
 * ---------------------------------------------------------------------------
 * It could be derived: `EAS_BUILD_PROFILE` is right there. But then it could
 * never disagree with the profile, and disagreement is exactly what we need it
 * to be able to express.
 *
 * The realistic mistake here is not choosing the wrong profile — that is one
 * word on a command line you are looking at. It is a variable sitting in the
 * wrong EAS environment: you set `EXPO_PUBLIC_SUPABASE_URL` while "preview" was
 * selected, months ago, and the production build has been quietly picking up
 * the staging project ever since. Nothing surfaces that, because a Supabase URL
 * pointing at the wrong project behaves perfectly.
 *
 * Setting `EXPO_PUBLIC_APP_ENV` alongside the credentials in each environment
 * turns that silence into a failed build: the variables travel together, so if
 * the production build is reading preview's values then APP_ENV says "staging"
 * while the profile says production, and assertEnvironmentAgrees stops it.
 * The check is worth exactly as much as that co-location, which is why
 * docs/ENVIRONMENTS.md sets them in one command per environment.
 */

/** EAS build profile (eas.json) -> the environment it is building for. */
const PROFILE_ENVIRONMENT = {
  development: 'development',
  staging: 'staging',
  preview: 'staging',
  production: 'production',
  'production-apk': 'production',
};

const ENVIRONMENTS = ['development', 'staging', 'production'];

/** Profiles that must not produce an installable build without working
 * credentials. `development` is exempt: a dev client is routinely built before
 * a backend exists, and guest mode is a legitimate way to run the app. */
const CREDENTIALED_PROFILES = ['staging', 'preview', 'production', 'production-apk'];

/** The two credentials without which auth and sync cannot work at all. */
const REQUIRED_VARS = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];

/**
 * Identity overrides per environment.
 *
 * `null` means "leave app.json alone" — production is the identity the stores
 * know, and it is defined in exactly one place.
 *
 * Everything in a non-null entry has to change together. The package/bundle id
 * is what lets both apps sit on one phone; without a distinct `scheme` the two
 * installs would fight over `daykeep://` links and which one wins is undefined,
 * so an OAuth callback or a password-reset email could open the wrong app.
 */
const IDENTITY = {
  development: null,
  production: null,
  staging: {
    nameSuffix: ' (Staging)',
    idSuffix: '.staging',
    scheme: 'daykeep-staging',
  },
};

/**
 * The environment this build is for.
 *
 * Falls back to the profile's environment when `EXPO_PUBLIC_APP_ENV` is unset,
 * so an existing build command keeps working — the unset case is a warning in
 * app.config.js, not an error, and a local `expo start` has neither variable.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
function resolveEnvironment(env = process.env) {
  const declared = (env.EXPO_PUBLIC_APP_ENV ?? '').trim();
  if (declared) return declared;

  const profile = (env.EAS_BUILD_PROFILE ?? '').trim();
  return PROFILE_ENVIRONMENT[profile] ?? 'development';
}

/**
 * Refuses a build whose declared environment contradicts its profile.
 *
 * Returns null when there is nothing to say, or the message to throw. Only
 * meaningful on the build server: locally `EAS_BUILD_PROFILE` is unset and the
 * check declines to guess.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
function assertEnvironmentAgrees(env = process.env) {
  const declared = (env.EXPO_PUBLIC_APP_ENV ?? '').trim();
  const profile = (env.EAS_BUILD_PROFILE ?? '').trim();
  if (!declared || !profile) return null;

  if (!ENVIRONMENTS.includes(declared)) {
    return [
      `EXPO_PUBLIC_APP_ENV is "${declared}", which is not an environment.`,
      `Expected one of: ${ENVIRONMENTS.join(', ')}.`,
    ].join('\n');
  }

  const expected = PROFILE_ENVIRONMENT[profile];
  if (!expected || expected === declared) return null;

  const easEnvironment = profile === 'production-apk' ? 'production' : profile;

  return [
    `The "${profile}" profile builds for ${expected}, but EXPO_PUBLIC_APP_ENV says "${declared}".`,
    '',
    "This build is reading another environment's variables. Almost always that",
    'means EXPO_PUBLIC_APP_ENV — and the Supabase credentials sitting next to it',
    `— were assigned to the wrong EAS environment, which would make a ${declared}`,
    `build and a ${expected} build identical apart from the label.`,
    '',
    'Check what this profile actually sees, and fix the assignment:',
    `  eas env:list --environment ${easEnvironment}`,
    `  eas env:set --environment ${easEnvironment} --name EXPO_PUBLIC_APP_ENV --value "${expected}"`,
    '',
    'See docs/ENVIRONMENTS.md.',
  ].join('\n');
}

/**
 * Applies the environment's identity to a resolved Expo config.
 *
 * Android and iOS ids are suffixed rather than replaced so there is one string
 * to change if the app is ever renamed, and so the relationship between the two
 * ids stays readable in a Play Console list.
 */
function withIdentity(config, environment) {
  const identity = IDENTITY[environment];
  if (!identity) return config;

  const { nameSuffix, idSuffix, scheme } = identity;

  config.name = `${config.name}${nameSuffix}`;
  config.scheme = scheme;

  if (config.android && config.android.package) {
    config.android = { ...config.android, package: `${config.android.package}${idSuffix}` };
  }
  if (config.ios && config.ios.bundleIdentifier) {
    config.ios = { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}${idSuffix}` };
  }

  return config;
}

/**
 * The Supabase project a URL points at, for logging.
 *
 * `https://abcdefgh.supabase.co` -> `abcdefgh`. The ref is public — it is half
 * of every request the app makes — and it is the only part of the credentials
 * that can safely be printed, which makes it the thing to print: "which project
 * did this build get" is otherwise unanswerable from a build log.
 */
function projectRef(url) {
  const match = /^https?:\/\/([^.]+)\./.exec((url ?? '').trim());
  return match ? match[1] : null;
}

module.exports = {
  CREDENTIALED_PROFILES,
  ENVIRONMENTS,
  IDENTITY,
  PROFILE_ENVIRONMENT,
  REQUIRED_VARS,
  assertEnvironmentAgrees,
  projectRef,
  resolveEnvironment,
  withIdentity,
};
