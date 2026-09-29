/**
 * Dynamic layer over app.json.
 *
 * Everything static still lives in app.json — Expo reads it first and hands it
 * to the function below as `config`. This file has two jobs:
 *
 *  1. Making a release EAS build FAIL, loudly and with instructions, when the
 *     Supabase credentials aren't present in the build environment.
 *  2. Giving a staging build its own identity — `com.daykeep.app.staging`,
 *     "Daykeep (Staging)", `daykeep-staging://` — so it installs alongside the
 *     real app instead of replacing it, and can never be mistaken for it. The
 *     rules live in scripts/build-env.js; docs/ENVIRONMENTS.md is the guide.
 *
 * Why that's the fix. `process.env.EXPO_PUBLIC_*` is inlined by Metro at bundle
 * time, so it depends entirely on those variables existing in the EAS build
 * environment. When they don't, the inlining quietly produces `undefined`,
 * `isSupabaseConfigured` goes false, and the APK installs and runs — as a
 * guest-only app that cannot sign anybody in. The failure surfaces hours later,
 * on a phone, as "supabase env issues", with nothing on screen to explain it.
 * Nothing in the build output flags it, because as far as the bundler is
 * concerned an absent variable is a perfectly valid empty string.
 *
 * Deliberately NOT done here: copying the values into `extra`. It looks like
 * useful redundancy, but `runtimeVersion.policy` is `fingerprint`, and the
 * fingerprint covers the resolved app config — so credentials in `extra` make
 * the runtime version change whenever a key is rotated. That silently cuts every
 * already-installed build off from OTA updates, which is the one channel through
 * which a rotated key could otherwise have been delivered. The redundancy would
 * also protect against almost nothing: the failure being fixed here is the
 * variable being absent, and `extra` reads from the same absent variable.
 */

const {
  CREDENTIALED_PROFILES,
  PROFILE_ENVIRONMENT,
  REQUIRED_VARS,
  assertEnvironmentAgrees,
  projectRef,
  resolveEnvironment,
  withIdentity,
} = require('./scripts/build-env');

function credentialsHelp(missing) {
  const profile = process.env.EAS_BUILD_PROFILE ?? 'production';
  // eas.json maps production-apk onto the production environment via `extends`.
  const environment = profile === 'production-apk' ? 'production' : profile;
  const commands = missing
    .map((name) => `  eas env:set --environment ${environment} --name ${name} --value "..."`)
    .join('\n');

  return [
    `Missing ${missing.join(' and ')} for the "${profile}" build.`,
    '',
    'Local .env files are NOT uploaded to EAS — they are gitignored, and EAS only',
    'uploads what git tracks. Build-time values come from the EAS environment that',
    `eas.json links this profile to, which here is "${environment}".`,
    '',
    'Set them once, then rebuild:',
    commands,
    '',
    `See what that environment currently holds:  eas env:list --environment ${environment}`,
    '',
    'A variable that exists but is assigned to a different environment is not',
    'visible to this build — that is the usual cause of this error.',
  ].join('\n');
}

/**
 * AdMob App IDs — deliberately NOT `EXPO_PUBLIC_`-prefixed. Unlike the ad unit
 * id (features/ads/components/ad-slot.tsx, read from JS at runtime, so it has
 * to survive Metro's inlining), these two are only ever consumed here, inside
 * the `react-native-google-mobile-ads` config plugin, at prebuild/EAS-build
 * time — plain `process.env` in a build-server Node process, same as
 * the AdMob app ids below.
 */
const ADMOB_ANDROID_APP_ID = (process.env.ADMOB_ANDROID_APP_ID ?? '').trim();
const ADMOB_IOS_APP_ID = (process.env.ADMOB_IOS_APP_ID ?? '').trim();

/** Overrides the test App IDs baked into app.json's plugin entry with real
 * ones when present. Absent means "keep shipping Google's universal TEST App
 * IDs" — a deliberately soft default: unlike missing Supabase creds, this
 * can't break the app, it can only mean a credentialed build still serves
 * self-labeled test ads instead of real inventory (see ad-slot.tsx/config.ts
 * for the full swap-in story). */
function withAdmobAppIds(config) {
  if (!ADMOB_ANDROID_APP_ID && !ADMOB_IOS_APP_ID) return config;
  config.plugins = (config.plugins ?? []).map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'react-native-google-mobile-ads') return plugin;
    const [name, pluginConfig] = plugin;
    return [
      name,
      {
        ...pluginConfig,
        androidAppId: ADMOB_ANDROID_APP_ID || pluginConfig.androidAppId,
        iosAppId: ADMOB_IOS_APP_ID || pluginConfig.iosAppId,
      },
    ];
  });
  return config;
}

module.exports = ({ config }) => {
  const environment = resolveEnvironment();
  const profile = process.env.EAS_BUILD_PROFILE;
  const onBuildServer = !!process.env.EAS_BUILD && !!profile;
  const credentialed = onBuildServer && CREDENTIALED_PROFILES.includes(profile);

  /**
   * Profile and declared environment must agree before anything else is
   * checked. A build reading the wrong environment's variables would otherwise
   * pass every check below — its credentials are present and valid, they just
   * belong to the other database.
   */
  const disagreement = assertEnvironmentAgrees();
  if (disagreement && credentialed) {
    throw new Error(`\n\n${disagreement}\n`);
  } else if (disagreement) {
    console.warn(`[daykeep] ${disagreement}`);
  }

  const missing = REQUIRED_VARS.filter((name) => !(process.env[name] ?? '').trim());

  if (missing.length > 0) {
    // Only on the build server: EAS also evaluates this config locally to compute
    // the fingerprint, where the variables are legitimately absent.
    if (credentialed) {
      // Fail here, where the message can still be read, rather than on a phone.
      throw new Error(`\n\n${credentialsHelp(missing)}\n`);
    }
    console.warn(
      `[daykeep] ${missing.join(', ')} not set — auth and cloud sync will be disabled ` +
        '(guest mode still works). See .env.example.',
    );
  }

  /**
   * A release build must say which environment it is, rather than inheriting
   * the fallback. Without this, forgetting the variable in the production EAS
   * environment produces an app that silently calls itself development —
   * meaning the in-app badge that distinguishes a staging install from a real
   * one is missing from precisely the build where being wrong costs the most.
   */
  if (credentialed && !(process.env.EXPO_PUBLIC_APP_ENV ?? '').trim()) {
    const easEnvironment = profile === 'production-apk' ? 'production' : profile;
    throw new Error(
      `\n\nEXPO_PUBLIC_APP_ENV is not set for the "${profile}" build.\n\n` +
        'It decides the app id, the app name, the deep-link scheme and the\n' +
        'in-app environment badge, so a build without it is not identifiable\n' +
        'once it is installed. Set it next to the Supabase credentials:\n\n' +
        `  eas env:set --environment ${easEnvironment} --name EXPO_PUBLIC_APP_ENV ` +
        `--value "${PROFILE_ENVIRONMENT[profile]}"\n\n` +
        'See docs/ENVIRONMENTS.md.\n',
    );
  }

  /**
   * Printed on every build, including local ones. The project ref is public and
   * is the only part of the credentials safe to log — and "which Supabase
   * project did this APK get" is otherwise a question with no answer short of
   * unzipping the bundle.
   */
  const ref = projectRef(process.env.EXPO_PUBLIC_SUPABASE_URL);
  console.log(
    `[daykeep] environment=${environment}` +
      (profile ? ` profile=${profile}` : '') +
      ` supabase=${ref ?? '(none)'}`,
  );

  if (
    process.env.EAS_BUILD_PROFILE === 'production' &&
    !ADMOB_ANDROID_APP_ID &&
    !ADMOB_IOS_APP_ID
  ) {
    console.warn(
      '[daykeep] ADMOB_ANDROID_APP_ID/ADMOB_IOS_APP_ID not set for the "production" build — ' +
        "shipping Google's universal TEST AdMob App IDs. Fine for internal testing, but Google " +
        'policy prohibits serving test ads to real users once this reaches the store. ' +
        'See .env.example.',
    );
  }

  return withIdentity(withAdmobAppIds(config), environment);
};
