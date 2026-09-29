import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * That a provider sign-in has somewhere to land.
 *
 * The bug this exists for produced a completed, successful Google sign-in that
 * ended on Expo Router's **"Unmatched Route — page could not be found"**, with
 * the authorisation code printed on screen underneath it. Nothing threw,
 * nothing was logged, and every other part of the flow was correct: the
 * provider was configured, the redirect was allow-listed, the code was issued.
 * There was simply no route file at the address the redirect names.
 *
 * That is a gap between three places that must agree and cannot check each
 * other at runtime — `oauthRedirectUrl()`, the file tree, and the Supabase
 * project's allow-list. This holds them together.
 */

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The path `oauthRedirectUrl()` builds, read from the source rather than
 *  restated here — restating it is how the two drift apart again. */
function redirectPath(): string {
  const source = read('features/auth/services/oauth.ts');
  const match = /Linking\.createURL\('([^']+)'\)/.exec(source);
  if (!match) throw new Error('oauthRedirectUrl() no longer calls Linking.createURL');
  return match[1];
}

describe('the OAuth redirect', () => {
  it('names a path the router can actually resolve', () => {
    const path = redirectPath().replace(/^\//, '');
    const candidates = [
      `app/${path}.tsx`,
      `app/${path}/index.tsx`,
      // A route group contributes nothing to the URL, so `(auth)` would serve
      // this path too — accepted here so moving the screen is not a failure.
      `app/(auth)/${path}.tsx`,
    ];
    expect(candidates.some((candidate) => existsSync(join(ROOT, candidate)))).toBe(true);
  });

  /** Registered on the root navigator alongside every other top-level route. */
  it('is declared in the root layout', () => {
    expect(read('app/_layout.tsx')).toContain(`name="${redirectPath().replace(/^\//, '')}"`);
  });

  /** The project has to be willing to redirect to it, or Google refuses before
   *  the user sees a consent screen at all. */
  it('is allow-listed for every environment', () => {
    const config = read('scripts/auth-config.mjs');
    const urls = config.slice(config.indexOf('export function redirectUrlsFor'));
    expect(urls).toContain(`://${redirectPath().replace(/^\//, '')}`);
  });
});

describe('completing the sign-in', () => {
  const callback = read('app/auth/callback.tsx');

  /** Both paths — the browser session and the deep link — end in the same
   *  exchange, so neither can be the one that was never finished. */
  it('goes through the shared exchange', () => {
    expect(callback).toContain('exchangeOAuthCode');
    expect(read('features/auth/services/oauth.ts')).toContain('exchangeOAuthCode');
  });

  /**
   * A code can only be spent once, and on Android both paths often run. The
   * second exchange failing is not a failed sign-in — the session is the only
   * thing that decides that.
   */
  it('survives being run twice with the same code', () => {
    const oauth = read('features/auth/services/oauth.ts');
    const exchange = oauth.slice(oauth.indexOf('export async function exchangeOAuthCode'));
    const body = exchange.slice(0, exchange.indexOf('\n}\n'));
    expect(body).toContain('getSession()');
    // Checked after the failure as well as before it, which is the half that
    // covers losing the race rather than arriving late.
    expect(body.lastIndexOf('getSession()')).toBeGreaterThan(
      body.indexOf('exchangeCodeForSession'),
    );
  });

  /** The gate only moves people out of `(onboarding)` and `(auth)`, and this
   *  route is in neither — so it has to route itself or the user waits forever
   *  on a spinner. */
  it('sends the user somewhere once it succeeds', () => {
    // Through the shared decision rather than an inlined ternary: this screen
    // spelled the branch out itself, and two other exits from the auth stack
    // spelled a *different* one — straight to the tabs — which stranded
    // first-time users. See features/auth/post-auth-destination.test.ts.
    expect(callback).toContain('router.replace(postAuthDestination())');
  });

  /** Cancelling on the consent screen is not a fault and must not be shown as
   *  one — it arrives as `access_denied` in the URL, not as a failed request. */
  it('treats a cancelled consent screen as a cancellation', () => {
    expect(callback).toContain('access_denied');
  });
});
