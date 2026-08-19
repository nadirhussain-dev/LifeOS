/**
 * Executes the join edge function for real.
 *
 * This is the only function here that anybody on the internet can reach — it
 * deploys `--no-verify-jwt` because the request comes from a mail client, not a
 * signed-in app — so it is also the only one whose rate limit cannot be keyed on
 * an account. What it gets instead is an in-memory per-IP ceiling, and the point
 * worth testing is that a refusal still looks like a page to the one audience
 * that ever sees it: a browser following a link from an email.
 *
 * The token-shape check is covered too. It is what keeps `escapeHtml` from being
 * the only thing between a crafted URL and the markup on the project's own
 * origin — and unlike the escaping, nothing about the rendered page reveals
 * whether it is still working.
 *
 * This file lives beside the function rather than under test/ so it stays with
 * what it covers, and because supabase/functions is excluded from the app's
 * tsconfig: the Deno globals below would otherwise fail typecheck.
 */

type Handler = (req: Request) => Response;

let handler: Handler;

/**
 * Loads the function fresh, with `env` in place first.
 *
 * Reloaded per test rather than imported once, for two reasons that both come
 * from the module body: `APP_LINK_SCHEME`, `ANDROID_STORE_URL` and
 * `IOS_STORE_URL` are read into module-level constants at import time, so
 * setting them afterwards changes nothing; and the rate limiter's bucket map is
 * module-level too, so a shared instance would carry one test's flood into the
 * next. A reset module gives both a clean slate.
 */
function load(env: Record<string, string> = {}): Handler {
  jest.resetModules();
  let loaded: Handler | undefined;
  (globalThis as { Deno?: unknown }).Deno = {
    serve: (h: Handler) => {
      loaded = h;
    },
    env: { get: (key: string) => env[key] },
  };
  require('./index.ts');
  if (!loaded) throw new Error('join/index.ts did not register a handler');
  return loaded;
}

/** A request from `ip`, so a flood in one case cannot reach another. */
function get(path: string, ip = '203.0.113.1'): Request {
  return new Request(`https://project.functions.supabase.co${path}`, {
    headers: { 'x-forwarded-for': ip },
  });
}

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

beforeEach(() => {
  handler = load();
});

describe('the invitation page', () => {
  it('renders a group invitation that hands the token to the app', async () => {
    const res = handler(get(`/join/${TOKEN}`));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(html).toContain(`daykeep://join/${TOKEN}`);
    expect(html).toContain('Daykeep');
  });

  it('sends an album invitation to the album route instead', async () => {
    const html = await handler(get(`/join/album/${TOKEN}`)).text();

    expect(html).toContain(`daykeep://private/albums/accept/${TOKEN}`);
    expect(html).toContain('end-to-end encrypted');
  });

  it('keeps the token out of shared caches and out of the Referer', async () => {
    // The token is a bearer credential sitting in the URL.
    const res = handler(get(`/join/${TOKEN}`));

    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('refuses a token that is not shaped like one we issued', async () => {
    // The first line of defence for the markup — a crafted link never reaches
    // the page at all, so escapeHtml is the second layer rather than the only
    // one.
    for (const bad of ['<script>', 'short', 'join', 'album', 'a'.repeat(200)]) {
      const res = handler(get(`/join/${bad}`));
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('<script>alert');
    }
  });
});

describe('the per-IP ceiling', () => {
  it('serves a normal invitation flow without complaint', async () => {
    // A recipient opens the link once, maybe twice if the app was not installed
    // yet. The limit must be nowhere near that.
    for (let i = 0; i < 5; i++) {
      expect(handler(get(`/join/${TOKEN}`)).status).toBe(200);
    }
  });

  it('refuses a flood with a 429, a Retry-After, and an HTML page', async () => {
    for (let i = 0; i < 60; i++) handler(get(`/join/${TOKEN}`, '198.51.100.7'));

    const res = handler(get(`/join/${TOKEN}`, '198.51.100.7'));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    // HTML, not JSON: the only caller that ever sees this is a browser, and a
    // JSON body renders as a wall of punctuation.
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Slow down a moment');
    // And it says the invitation survived, because that is the actual question
    // somebody in this state has.
    expect(html).toContain('stays valid for 14 days');
  });

  it('does not punish one recipient for a flood from somebody else', async () => {
    for (let i = 0; i < 70; i++) handler(get(`/join/${TOKEN}`, '198.51.100.8'));

    expect(handler(get(`/join/${TOKEN}`, '203.0.113.99')).status).toBe(200);
  });

  it('counts the flood before parsing the path, so a bad token costs the same', async () => {
    // Otherwise the cheapest way past the limiter is to send nonsense, which is
    // exactly what a scraper walking token guesses is already doing.
    for (let i = 0; i < 60; i++) handler(get('/join/nope', '198.51.100.9'));

    expect(handler(get(`/join/${TOKEN}`, '198.51.100.9')).status).toBe(429);
  });
});

describe('per-project configuration', () => {
  it('serves the staging scheme when APP_LINK_SCHEME says so', async () => {
    // A staging project serving the production scheme opens the production app,
    // which then rejects a token its own database has never seen.
    const staging = load({ APP_LINK_SCHEME: 'daykeep-staging' });

    expect(await staging(get(`/join/${TOKEN}`)).text()).toContain('daykeep-staging://join/');
  });

  it('renders no store buttons rather than broken ones when the URLs are unset', async () => {
    const html = await handler(get(`/join/${TOKEN}`)).text();

    expect(html).not.toContain('Get Daykeep for Android');
    expect(html).not.toContain('Get Daykeep for iPhone');
  });

  it('escapes a store URL before it reaches the markup', async () => {
    const withStore = load({
      ANDROID_STORE_URL: 'https://play.google.com/store?id=a"><script>alert(1)</script>',
    });

    const html = await withStore(get(`/join/${TOKEN}`)).text();

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('"><script>alert(1)');
  });
});
