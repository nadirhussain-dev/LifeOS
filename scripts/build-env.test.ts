import { assertEnvironmentAgrees, projectRef, resolveEnvironment, withIdentity } from './build-env';

/**
 * The half of the build config that decides which backend an APK talks to and
 * what it calls itself.
 *
 * Worth testing without Expo in the loop because every failure here is silent
 * and late: a staging build that keeps production's package id overwrites the
 * real app on a tester's phone, and a production build that quietly reads
 * preview's credentials ships to the store pointed at the staging database.
 * Neither shows up until somebody's data is in the wrong place.
 */

describe('resolveEnvironment', () => {
  it('prefers the declared environment', () => {
    expect(resolveEnvironment({ EXPO_PUBLIC_APP_ENV: 'staging' })).toBe('staging');
  });

  it('falls back to the profile when nothing is declared', () => {
    expect(resolveEnvironment({ EAS_BUILD_PROFILE: 'production-apk' })).toBe('production');
    expect(resolveEnvironment({ EAS_BUILD_PROFILE: 'preview' })).toBe('staging');
    expect(resolveEnvironment({ EAS_BUILD_PROFILE: 'staging' })).toBe('staging');
  });

  it('falls back to development, not production, when it knows nothing', () => {
    // The safe direction: everything keyed off this makes a non-production
    // build MORE visible, so guessing development over-warns rather than
    // letting a staging build pass itself off as the real app.
    expect(resolveEnvironment({})).toBe('development');
    expect(resolveEnvironment({ EAS_BUILD_PROFILE: 'some-future-profile' })).toBe('development');
  });

  it('ignores a blank declaration rather than treating it as an environment', () => {
    // An EAS variable that exists but is empty is indistinguishable from unset
    // as far as Metro is concerned, so it has to be here too.
    expect(
      resolveEnvironment({ EXPO_PUBLIC_APP_ENV: '   ', EAS_BUILD_PROFILE: 'production' }),
    ).toBe('production');
  });
});

describe('assertEnvironmentAgrees', () => {
  it('passes when the profile and the declaration match', () => {
    expect(
      assertEnvironmentAgrees({
        EAS_BUILD_PROFILE: 'production',
        EXPO_PUBLIC_APP_ENV: 'production',
      }),
    ).toBeNull();
    expect(
      assertEnvironmentAgrees({ EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_APP_ENV: 'staging' }),
    ).toBeNull();
    expect(
      assertEnvironmentAgrees({
        EAS_BUILD_PROFILE: 'production-apk',
        EXPO_PUBLIC_APP_ENV: 'production',
      }),
    ).toBeNull();
  });

  it('catches the production build that is reading staging credentials', () => {
    // The whole reason EXPO_PUBLIC_APP_ENV is a variable rather than derived
    // from the profile: this is the mistake it exists to make loud.
    const message = assertEnvironmentAgrees({
      EAS_BUILD_PROFILE: 'production',
      EXPO_PUBLIC_APP_ENV: 'staging',
    });
    expect(message).toContain('builds for production');
    expect(message).toContain('eas env:list --environment production');
  });

  it('catches a staging build reading production credentials', () => {
    expect(
      assertEnvironmentAgrees({ EAS_BUILD_PROFILE: 'staging', EXPO_PUBLIC_APP_ENV: 'production' }),
    ).toContain('builds for staging');
  });

  it('rejects an environment that does not exist', () => {
    expect(
      assertEnvironmentAgrees({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_APP_ENV: 'prod' }),
    ).toContain('not an environment');
  });

  it('declines to guess when either half is missing', () => {
    // Local `expo start` and EAS's own local fingerprint pass have no profile.
    // Erroring there would break every developer's machine to catch nothing.
    expect(assertEnvironmentAgrees({ EXPO_PUBLIC_APP_ENV: 'staging' })).toBeNull();
    expect(assertEnvironmentAgrees({ EAS_BUILD_PROFILE: 'production' })).toBeNull();
    expect(assertEnvironmentAgrees({})).toBeNull();
  });
});

describe('withIdentity', () => {
  const base = () => ({
    name: 'Daykeep',
    scheme: 'daykeep',
    android: { package: 'com.daykeep.app', edgeToEdgeEnabled: true },
    ios: { bundleIdentifier: 'com.daykeep.app', supportsTablet: true },
  });

  it('leaves production exactly as app.json defines it', () => {
    // The store identity must have one definition. If this test ever needs
    // changing, something is rewriting the shipped app's id.
    expect(withIdentity(base(), 'production')).toEqual(base());
  });

  it('leaves development alone too', () => {
    expect(withIdentity(base(), 'development')).toEqual(base());
  });

  it('gives staging its own id, name and scheme', () => {
    const config = withIdentity(base(), 'staging');
    expect(config.android.package).toBe('com.daykeep.app.staging');
    expect(config.ios.bundleIdentifier).toBe('com.daykeep.app.staging');
    expect(config.name).toBe('Daykeep (Staging)');
    // Distinct scheme or the two installs fight over daykeep:// links, and
    // which one receives an OAuth callback becomes undefined.
    expect(config.scheme).toBe('daykeep-staging');
  });

  it('keeps the rest of each platform block', () => {
    const config = withIdentity(base(), 'staging');
    expect(config.android.edgeToEdgeEnabled).toBe(true);
    expect(config.ios.supportsTablet).toBe(true);
  });

  it('tolerates a config with no platform blocks', () => {
    expect(() => withIdentity({ name: 'Daykeep' }, 'staging')).not.toThrow();
  });
});

describe('projectRef', () => {
  it('reads the ref out of a Supabase URL', () => {
    expect(projectRef('https://abcdefghijkl.supabase.co')).toBe('abcdefghijkl');
  });

  it('returns null for anything else', () => {
    expect(projectRef('')).toBeNull();
    expect(projectRef(undefined)).toBeNull();
    expect(projectRef('not-a-url')).toBeNull();
  });
});
