import {
  MAILER_SETTINGS,
  MAILER_TEMPLATES,
  googleCallbackUrl,
  googleProviderFields,
  mergeAllowList,
  parseSender,
  projectRefFromDbUrl,
  redirectUrlsFor,
} from './auth-config.mjs';

/**
 * What `npm run configure:auth` writes into a live Supabase project.
 *
 * Everything here is a value that only ever gets checked by a human reading a
 * dashboard, which is to say never. The two that decide *which project* is
 * being written to matter most: `projectRefFromDbUrl` picking the wrong ref
 * means production's auth email is silently reconfigured while the console
 * says "staging".
 */

describe('projectRefFromDbUrl', () => {
  /** The form docs/ENVIRONMENTS.md tells you to use, and the one both real
   *  connection strings in this project take. */
  it('reads the ref out of a session-pooler URL', () => {
    expect(
      projectRefFromDbUrl(
        'postgresql://postgres.wucwbtjgeuersnrctuze:s3cret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
      ),
    ).toBe('wucwbtjgeuersnrctuze');
  });

  it('reads the ref out of a direct-connection URL', () => {
    expect(
      projectRefFromDbUrl(
        'postgres://postgres:s3cret@db.ksrpdaudraulmsyhrjrg.supabase.co:5432/postgres',
      ),
    ).toBe('ksrpdaudraulmsyhrjrg');
  });

  /**
   * A generated Postgres password contains `@`, `/`, `#` and `:`. Parsing with
   * `new URL()` throws on some of those, and a naive split on `@` picks the
   * wrong one — which would yield a ref that is either garbage or, worse, a
   * real-looking string. Losing the ability to read a public identifier
   * because of the secret sitting next to it is the failure being guarded.
   */
  it('is not confused by punctuation in the password', () => {
    expect(
      projectRefFromDbUrl(
        'postgresql://postgres.wucwbtjgeuersnrctuze:p%40ss/w#rd@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
      ),
    ).toBe('wucwbtjgeuersnrctuze');
  });

  it.each([
    ['', null],
    [undefined, null],
    ['not a url', null],
    ['postgres://localhost/db', null],
  ])('returns null rather than guessing for %p', (url, expected) => {
    expect(projectRefFromDbUrl(url as string)).toBe(expected);
  });
});

describe('parseSender', () => {
  it('splits a display name from the address', () => {
    expect(parseSender('Daykeep <invites@daykeep.app>', 'INVITE_FROM')).toEqual({
      name: 'Daykeep',
      email: 'invites@daykeep.app',
    });
  });

  it('strips quotes people paste around the display name', () => {
    expect(parseSender('"Daykeep Support" <help@daykeep.app>', 'INVITE_FROM')).toEqual({
      name: 'Daykeep Support',
      email: 'help@daykeep.app',
    });
  });

  /** A bare address is the mistake worth catching loudly. Accepted, it becomes
   *  a From header with an empty display name that Resend rejects per message
   *  — a failure that shows up one email at a time rather than at setup. */
  it.each(['invites@daykeep.app', '', 'Daykeep'])('refuses %p', (raw) => {
    expect(() => parseSender(raw, 'INVITE_FROM')).toThrow('INVITE_FROM');
  });
});

describe('redirectUrlsFor', () => {
  /**
   * Staging gets its own scheme from scripts/build-env.js because it installs
   * as a separate app. Allow-listing `daykeep://` on the staging project would
   * therefore permit a redirect no staging build ever emits, and Google
   * sign-in would fail there with a message naming an address that appears in
   * neither the app nor the dashboard.
   */
  it('uses the staging scheme for staging', () => {
    expect(redirectUrlsFor('staging')).toEqual([
      'daykeep-staging://auth/callback',
      'daykeep-staging:///auth/callback',
      'daykeep-staging://reset-password',
      'daykeep-staging:///reset-password',
    ]);
  });

  it('uses the plain scheme for production', () => {
    expect(redirectUrlsFor('production')).toEqual([
      'daykeep://auth/callback',
      'daykeep:///auth/callback',
      'daykeep://reset-password',
      'daykeep:///reset-password',
    ]);
  });

  /** Both slash forms, always. `Linking.createURL` emits the triple-slash form
   *  on some platforms and the double on others, and an unlisted redirect is
   *  refused before the user sees anything. */
  it.each(['staging', 'production'])('lists both slash forms for %s', (environment) => {
    const urls = redirectUrlsFor(environment);
    for (const url of urls.filter((u) => !u.includes(':///'))) {
      expect(urls).toContain(url.replace('://', ':///'));
    }
  });
});

describe('mergeAllowList', () => {
  it('adds what is missing and keeps what is there', () => {
    const result = mergeAllowList('exp://192.168.0.5:8081', ['daykeep://auth/callback']);
    expect(result).toEqual({
      list: 'exp://192.168.0.5:8081,daykeep://auth/callback',
      added: ['daykeep://auth/callback'],
    });
  });

  /**
   * The entries added by hand — an Expo Go tunnel URL, a colleague's machine —
   * are the ones nobody can reconstruct. Replacing rather than merging would
   * make a routine re-run of the deploy script break sign-in for whoever put
   * them there, with no record that anything was removed.
   */
  it('never drops an entry it did not add', () => {
    const existing = 'exp://tunnel.exp.direct,https://example.test/callback';
    const result = mergeAllowList(existing, ['daykeep://auth/callback']);
    for (const entry of existing.split(',')) {
      expect(result?.list.split(',')).toContain(entry);
    }
  });

  /** Null means "no PATCH needed" — the script uses it to skip the write
   *  entirely, so returning an unchanged list instead would rewrite the
   *  allow-list on every run for no reason. */
  it('returns null when everything is already present', () => {
    expect(mergeAllowList('a://b,c://d', ['a://b', 'c://d'])).toBeNull();
  });

  it('tolerates an unset allow-list and stray whitespace', () => {
    expect(mergeAllowList(undefined, ['a://b'])).toEqual({ list: 'a://b', added: ['a://b'] });
    expect(mergeAllowList(' a://b , ', ['a://b'])).toBeNull();
  });
});

describe('MAILER_SETTINGS', () => {
  /**
   * The verify screens re-enable "Resend code" after 30 seconds
   * (RESEND_COOLDOWN_S in app/(auth)/verify-signup.tsx and verify-reset.tsx).
   * Supabase's `smtp_max_frequency` defaults to 60, so the app invites the
   * user to do something the server refuses, and the refusal arrives as
   * `over_email_send_rate_limit` — indistinguishable, to the person waiting,
   * from the code never being sent. Strictly less than 30 so a second of clock
   * skew cannot put the two on opposite sides of one boundary.
   */
  it('lets the app resend a code before the server would refuse', () => {
    expect(MAILER_SETTINGS.smtp_max_frequency).toBeLessThan(30);
  });

  /** features/auth/components/otp-field.tsx accepts exactly six digits. A
   *  longer code cannot be entered at all. */
  it('asks for a code the OTP field can hold', () => {
    expect(MAILER_SETTINGS.mailer_otp_length).toBe(6);
  });
});

describe('googleProviderFields', () => {
  /** Typed loosely on purpose: the function takes a bag of names and this test
   *  passes deliberately incomplete ones, which `process.env`'s own type
   *  (NodeJS.ProcessEnv, with a required NODE_ENV) refuses. */
  const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

  const CREDS = {
    GOOGLE_OAUTH_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-secret',
  };

  it('enables the provider when both halves are present', () => {
    expect(googleProviderFields(env(CREDS))).toEqual({
      external_google_enabled: true,
      external_google_client_id: CREDS.GOOGLE_OAUTH_CLIENT_ID,
      external_google_secret: CREDS.GOOGLE_OAUTH_CLIENT_SECRET,
    });
  });

  /** Absent is a legitimate state — email auth is worth configuring on its own,
   *  and the script skips step 6 rather than failing. It must NOT return
   *  `enabled: false`, which would actively switch off a provider somebody had
   *  turned on in the dashboard. */
  it('returns null when neither is set, rather than disabling anything', () => {
    expect(googleProviderFields(env({}))).toBeNull();
  });

  /**
   * Half-configured is the case worth throwing on. Supabase accepts a client id
   * with no secret, so the provider goes green in the dashboard and every
   * sign-in then dies at Google with `invalid_client` — a message that names
   * neither the project nor the missing value.
   */
  it.each([
    ['id only', { GOOGLE_OAUTH_CLIENT_ID: CREDS.GOOGLE_OAUTH_CLIENT_ID }],
    ['secret only', { GOOGLE_OAUTH_CLIENT_SECRET: CREDS.GOOGLE_OAUTH_CLIENT_SECRET }],
  ])('refuses %s', (_label, values) => {
    expect(() => googleProviderFields(env(values))).toThrow('must be set together');
  });

  /** Whitespace-only is how a value arrives from a `.env` line someone cleared
   *  by deleting the value but not the key. */
  it('treats a blank value as absent', () => {
    expect(googleProviderFields(env({ GOOGLE_OAUTH_CLIENT_ID: '   ' }))).toBeNull();
  });
});

describe('googleCallbackUrl', () => {
  /** Supabase's URL, not the app's — Google redirects to Supabase, and Supabase
   *  redirects to the app. Getting this backwards is the single most common
   *  Google-OAuth mistake, and it fails as `redirect_uri_mismatch` before any
   *  consent screen appears. */
  it('points at the project, not the app', () => {
    expect(googleCallbackUrl('wucwbtjgeuersnrctuze')).toBe(
      'https://wucwbtjgeuersnrctuze.supabase.co/auth/v1/callback',
    );
  });
});

describe('MAILER_TEMPLATES', () => {
  it('lands each template in a distinct pair of API fields', () => {
    const fields = MAILER_TEMPLATES.flatMap((t) => [t.subjectField, t.contentField]);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('gives every template a subject and a file', () => {
    for (const template of MAILER_TEMPLATES) {
      expect(template.file).toMatch(/\.html$/);
      expect(template.subject).toContain('Daykeep');
    }
  });
});
