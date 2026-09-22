import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The store-submission surface, held in place.
 *
 * Every assertion here corresponds to something that was actually wrong and
 * would have been found by a reviewer rather than by us. They are cheap, static
 * facts — a permission in a manifest, a URL in a config — and the reason they
 * need a test is that each one is invisible from inside the app. Nothing
 * crashes because the privacy policy links to a 404, or because the manifest
 * asks for precise location that no code path uses; it just fails review weeks
 * later with a message that does not say which line.
 */

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const appJson = JSON.parse(read('app.json')).expo;

describe('android permissions', () => {
  it('does not request precise location for a city-level lookup', () => {
    // The only consumer reverse-geocodes to "city, region", which coarse
    // answers identically. Play requires the narrowest permission that works
    // and makes you justify fine location in a declaration form.
    expect(appJson.android.permissions).not.toContain('android.permission.ACCESS_FINE_LOCATION');
  });

  it('blocks the precise permission the expo-location plugin adds anyway', () => {
    // Listing it in `permissions` is not what puts it in the manifest — the
    // config plugin adds ACCESS_COARSE_LOCATION *and* ACCESS_FINE_LOCATION
    // unconditionally. Removing it from the list above changes nothing on its
    // own; `blockedPermissions` is what actually keeps it out of the APK.
    expect(appJson.android.blockedPermissions).toContain('android.permission.ACCESS_FINE_LOCATION');
  });

  it('asks the OS for the accuracy it actually declared', () => {
    const journal = read('app/journal/[date].tsx');
    expect(journal).toMatch(/accuracy:\s*Location\.Accuracy\.Low/);
  });
});

describe('ios privacy manifest', () => {
  const manifest = appJson.ios.privacyManifests;

  it('declares what the app collects, not only which APIs it calls', () => {
    expect(manifest.NSPrivacyCollectedDataTypes.length).toBeGreaterThan(0);
  });

  it('declares the categories that carry the most review risk', () => {
    const declared = manifest.NSPrivacyCollectedDataTypes.map(
      (entry: Record<string, unknown>) => entry.NSPrivacyCollectedDataType,
    );
    // Health is cycle/recovery data in the private space — GDPR Art. 9 special
    // category, and the thing App Store 5.1.3 governs. Financial is the budget
    // ledger. Omitting either is the kind of mismatch between the manifest and
    // the App Store Connect answers that gets a build rejected.
    expect(declared).toEqual(
      expect.arrayContaining([
        'NSPrivacyCollectedDataTypeHealth',
        'NSPrivacyCollectedDataTypeOtherFinancialInfo',
        'NSPrivacyCollectedDataTypeOtherUserContent',
        'NSPrivacyCollectedDataTypeEmailAddress',
      ]),
    );
  });

  it('declares coarse location, matching the Android permission', () => {
    const declared = manifest.NSPrivacyCollectedDataTypes.map(
      (entry: Record<string, unknown>) => entry.NSPrivacyCollectedDataType,
    );
    expect(declared).toContain('NSPrivacyCollectedDataTypeCoarseLocation');
    expect(declared).not.toContain('NSPrivacyCollectedDataTypePreciseLocation');
  });

  it('claims no tracking, and nothing contradicts it', () => {
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
    for (const entry of manifest.NSPrivacyCollectedDataTypes) {
      expect(entry.NSPrivacyCollectedDataTypeTracking).toBe(false);
    }
  });
});

describe('published policies', () => {
  it('links to a hosted policy, not a repository blob', () => {
    // A blob URL is the file as rendered inside the repo: editable in place
    // with no record a reviewer can see, and a 404 if the repo is private.
    const env = read('lib/env.ts');
    expect(env).not.toContain('/blob/');
    expect(env).toMatch(/EXPO_PUBLIC_PRIVACY_URL/);
    expect(env).toMatch(/EXPO_PUBLIC_TERMS_URL/);
  });

  it('reaches both documents and a support address from Settings', () => {
    const settings = read('app/settings/index.tsx');
    expect(settings).toContain('EXPO_PUBLIC_PRIVACY_URL');
    expect(settings).toContain('EXPO_PUBLIC_TERMS_URL');
    expect(settings).toContain('EXPO_PUBLIC_SUPPORT_EMAIL');
  });

  it('publishes the documents from their single source', () => {
    // Copying PRIVACY.md into a site folder is how the published policy and
    // the one in the repository start disagreeing, and the published one is
    // the one that is legally operative.
    const workflow = read('.github/workflows/pages.yml');
    expect(workflow).toContain('cat PRIVACY.md');
    expect(workflow).toContain('cat TERMS.md');
  });

  it('has terms that carry the content rules Play requires', () => {
    const terms = read('TERMS.md');
    for (const clause of ['Harass', 'impersonat', 'Spam', 'Report', 'Block']) {
      expect(terms).toMatch(new RegExp(clause, 'i'));
    }
  });

  it('states the media-sync behaviour the policy used to deny', () => {
    // It said "Photos, audio, and reminders are not synced" while 0016 was
    // uploading album names, captions, playlist names and file names.
    const privacy = read('PRIVACY.md');
    expect(privacy).not.toMatch(/Photos, audio, and reminders are\s+\*\*not\*\* synced/);
    expect(privacy).toMatch(/the details travel but the files do not/i);
  });
});

describe('usage analytics consent', () => {
  it('collects nothing until asked', () => {
    const store = read('features/analytics/store/usage-store.ts');
    expect(store).toMatch(/enabled:\s*false/);
    expect(store).toMatch(/consentDecided:\s*false/);
  });

  it('turns existing installs off rather than inheriting their opt-out state', () => {
    // Without the migration, a phone upgrading from the opt-out build
    // rehydrates `enabled: true` over the new default and keeps reporting
    // while the consent card sits on screen unanswered.
    const store = read('features/analytics/store/usage-store.ts');
    expect(store).toMatch(/version:\s*2/);
    expect(store).toMatch(/migrate:/);
  });

  it('asks somewhere the user will actually see it', () => {
    expect(read('app/_layout.tsx')).toContain('UsageConsentCard');
  });

  it('discards anything buffered when consent is refused', () => {
    // A counter collected before the answer must not be sent, and leaving it
    // in `pending` means it flushes the moment consent is later given —
    // retroactively collecting the period somebody had declined.
    const store = read('features/analytics/store/usage-store.ts');
    // The implementation, not the type declaration above it — matching
    // `decideConsent:` alone finds the interface entry and passes on a file
    // where the behaviour is missing entirely.
    const decide = /decideConsent:\s*\(enabled\)\s*=>[\s\S]*?\n\n/.exec(store)?.[0];
    expect(decide).toBeDefined();
    expect(decide).toContain('pending: {}');
  });
});

/**
 * Release configuration that has to be supplied before a store build, and
 * cannot be supplied from in here.
 *
 * Same spirit as the rest of this file — static facts, invisible from inside
 * the app, that surface weeks later as a failed submission. The difference is
 * that these are *not* assertions that the config is correct: the values are
 * an Apple account's, and inventing them would be worse than leaving them
 * blank. What is asserted is that the blanks are still recognisable as blanks.
 *
 * The failure being prevented is the half-filled profile. `eas submit` with
 * two of three iOS fields replaced does not say "you forgot one" — it
 * authenticates, finds nothing matching, and reports something about the app
 * not existing. Either all three are placeholders or none of them are.
 */
describe('ios submit profile', () => {
  const easJson = JSON.parse(read('eas.json'));
  const ios = easJson.submit?.production?.ios ?? {};
  const FIELDS = ['appleId', 'ascAppId', 'appleTeamId'] as const;
  const isPlaceholder = (value: unknown) =>
    typeof value === 'string' && value.startsWith('REPLACE_WITH_');

  it('names every field a submission needs', () => {
    // A missing key and a placeholder fail differently: the placeholder is
    // visible in a diff, the missing key is only visible to somebody who
    // already knows it should be there.
    for (const field of FIELDS) {
      expect(ios).toHaveProperty(field);
    }
  });

  it('is either entirely unconfigured or entirely configured', () => {
    const placeholders = FIELDS.filter((field) => isPlaceholder(ios[field]));
    expect(placeholders.length === 0 || placeholders.length === FIELDS.length).toBe(true);
  });

  it('keeps the Android half configured, since it already is', () => {
    const android = easJson.submit?.production?.android ?? {};
    expect(android.serviceAccountKeyPath).toBeTruthy();
    expect(android.serviceAccountKeyPath).not.toMatch(/^REPLACE_WITH_/);
  });
});

/**
 * Sentry source maps on the profile whose stack traces nobody can read.
 *
 * `SENTRY_DISABLE_AUTO_UPLOAD` is set on every build profile, which is what
 * lets a build succeed without a Sentry token — a deliberate trade, and the
 * right one for development and staging. On production it means every crash
 * report arrives minified: the difference between a stack trace and a wall of
 * `a.b.c(d)`, discovered during the first incident rather than before it.
 *
 * Not asserted as "must be enabled", because enabling it makes a production
 * build fail when the token is absent, and that is a decision about release
 * process rather than about code. Asserted instead is that the cost is stated
 * where somebody running the build will see it — app.config.js warns, and this
 * pins the warning so it cannot be deleted as noise.
 */
describe('production crash reports', () => {
  it('says out loud when production stack traces will be minified', () => {
    const config = read('app.config.js');
    expect(config).toContain('SENTRY_DISABLE_AUTO_UPLOAD');
    expect(config).toMatch(/MINIFIED/);
    // And names the three variables, so the warning is actionable rather than
    // just alarming.
    for (const name of ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN']) {
      expect(config).toContain(name);
    }
  });

  it('warns when the DSN itself is missing, which turns reporting off entirely', () => {
    const config = read('app.config.js');
    expect(config).toContain('EXPO_PUBLIC_SENTRY_DSN');
    expect(config).toMatch(/reporting is OFF/i);
  });
});

/**
 * `expo-updates` is a dependency, and there is no `updates` block in app.json.
 *
 * That reads like an oversight and is not one. The module is here for
 * `Updates.reloadAsync()`, which restarts the app when the layout direction
 * changes — see features/settings/lib/layout-direction.ts, which notes that it
 * works with no update URL configured. Turning on OTA would be a decision
 * about what the app does at launch, not a missing line.
 *
 * Pinned so that nobody adds the URL on the assumption it was forgotten, and
 * so that nobody removes the dependency on the assumption it is unused.
 */
describe('expo-updates is a reload mechanism, not an update channel', () => {
  it('ships no update URL', () => {
    expect(appJson.updates).toBeUndefined();
  });

  it('is depended on for the reload that the RTL switch needs', () => {
    const direction = read('features/settings/lib/layout-direction.ts');
    expect(direction).toContain('expo-updates');
    expect(direction).toContain('reloadAsync');
  });
});
