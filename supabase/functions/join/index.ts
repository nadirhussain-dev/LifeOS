// Supabase Edge Function: join
//
// The https:// landing page an invitation email links to. It carries no
// secrets, talks to no database, and is deployed without JWT verification:
//
//   supabase functions deploy join --no-verify-jwt
//
// ---------------------------------------------------------------------------
// Why this exists
// ---------------------------------------------------------------------------
// send-invite used to email `daykeep://join/<token>` directly, and that link is
// dead on arrival for two independent reasons:
//
//  1. **Mail clients strip it.** Gmail — web and mobile — sanitises `href` down
//     to http, https, mailto and ftp. An anchor pointing at a custom scheme is
//     rendered as unclickable text. So the invitation looked fine and simply
//     did nothing when tapped, for the largest email provider there is.
//  2. **It requires the app to already be installed.** An invitation is, by
//     definition, mostly sent to people who do not have Daykeep yet. On those
//     phones a custom scheme resolves to nothing at all — no error, no store
//     page, nothing.
//
// An https link fixes both, but only if something answers it. This is that
// something. It is hosted on the project's own functions domain rather than a
// marketing site, because that domain already exists, is already TLS-terminated
// and is per-environment for free: the staging project serves the staging
// scheme, production serves production, and neither needs DNS, a certificate,
// or App Links verification to work.
//
// ---------------------------------------------------------------------------
// What it does
// ---------------------------------------------------------------------------
// GET /join/<token> returns a small HTML page that immediately tries to hand
// the token to the app over the deep link, and shows a tappable button plus
// store links if that does nothing. The redirect is attempted from JavaScript
// rather than via a 302 to `daykeep://…` on purpose: a 302 to an unhandled
// scheme is an error page in most mobile browsers, whereas a failed
// `location.href` assignment leaves the fallback content on screen, which is
// precisely what somebody without the app needs to see.
//
// The token is echoed into the page and nowhere else. That is not a leak — it
// is already in the URL the recipient followed, and the invitation is a bearer
// credential by design (see send-invite) — but it does mean the token must be
// escaped before it reaches the markup, or a crafted link becomes stored XSS on
// the project's own origin.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { optionalSecret } from '../_shared/env.ts';

/** The app's deep-link scheme for THIS project. Staging builds are
 *  `daykeep-staging://` (scripts/build-env.js gives them their own scheme so
 *  both apps can sit on one phone), so the staging project must serve that or
 *  its invitations open the production app — which then rejects a token its
 *  own database has never seen. Defaults to the production scheme, which is
 *  the correct thing to be wrong about: a production project with the secret
 *  unset still works. */
const SCHEME = optionalSecret('APP_LINK_SCHEME') ?? 'daykeep';

/** Where to send somebody who does not have the app. Unset renders the page
 *  without store buttons rather than with broken ones — Daykeep is not on
 *  either store yet, and a link to a 404 is worse than no link. */
const ANDROID_STORE_URL = optionalSecret('ANDROID_STORE_URL');
const IOS_STORE_URL = optionalSecret('IOS_STORE_URL');

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Tokens are base64url from send-invite's `mintToken`. Anything else is not a
 *  token we issued, so it is refused before it can reach the page — this is
 *  what keeps `escapeHtml` from being the only thing standing between a crafted
 *  URL and the markup. */
const isWellFormedToken = (token: string) => /^[A-Za-z0-9_-]{16,128}$/.test(token);

const page = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The token is in the URL. Keeping it out of shared caches and out of the
      // Referer header of anything the page links to costs nothing here.
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      // Belt and braces around escapeHtml: even if something did get through,
      // there is no inline-script allowance for it to execute in beyond the one
      // hash-free `script` block this page ships, which is why 'unsafe-inline'
      // is present. Everything else is denied.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    },
  });

/** Shared shell, so the invitation page and the error page cannot drift into
 *  looking like they came from different products. Matches the email templates
 *  in supabase/templates/ and constants/design-tokens.ts. */
function shell(title: string, inner: string, script = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px; background: #f8fbf9; color: #161c19;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  .card {
    width: 100%; max-width: 420px; background: #fff; border: 1px solid #e2e9e5;
    border-radius: 20px; padding: 36px 32px; text-align: center;
  }
  .wordmark {
    font-family: 'Sora', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 20px; font-weight: 700; letter-spacing: -0.2px; margin-bottom: 24px;
  }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { color: #6d7a74; line-height: 1.6; margin: 0 0 24px; font-size: 15px; }
  .btn {
    display: block; background: #188b61; color: #fff; text-decoration: none;
    padding: 14px 20px; border-radius: 12px; font-weight: 600; margin-bottom: 12px;
  }
  .btn.secondary { background: transparent; color: #188b61; border: 1px solid #e2e9e5; }
  .fine { font-size: 13px; color: #9aa8a1; margin: 20px 0 0; border-top: 1px solid #eef3f0; padding-top: 16px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0e1210; color: #eef3f0; }
    .card { background: #1a201d; border-color: #2b332e; }
    p { color: #9aa8a1; }
    .btn.secondary { border-color: #2b332e; }
    .fine { border-color: #2b332e; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="wordmark">Daykeep</div>
    ${inner}
  </div>
${script}
</body>
</html>`;
}

function invitationPage(token: string): string {
  const deepLink = `${SCHEME}://join/${token}`;
  const escaped = escapeHtml(deepLink);

  const storeButtons = [
    ANDROID_STORE_URL
      ? `<a class="btn secondary" href="${escapeHtml(ANDROID_STORE_URL)}">Get Daykeep for Android</a>`
      : '',
    IOS_STORE_URL
      ? `<a class="btn secondary" href="${escapeHtml(IOS_STORE_URL)}">Get Daykeep for iPhone</a>`
      : '',
  ].join('\n    ');

  return shell(
    'Join a group on Daykeep',
    `<h1>You've been invited</h1>
    <p>Open this invitation in Daykeep to join the group and see what you owe or are owed.</p>
    <a class="btn" href="${escaped}">Open in Daykeep</a>
    ${storeButtons}
    <p class="fine">If nothing happens, Daykeep isn't installed on this device yet. Install it,
    then open this link again — the invitation stays valid for 14 days.</p>`,
    // Attempted once, on load, and only for the deep link. If the app is
    // installed the OS takes over before anything else renders; if it is not,
    // the assignment fails silently and the buttons above are what remains.
    `<script>
      try { window.location.href = ${JSON.stringify(deepLink)}; } catch (e) {}
    </script>`,
  );
}

Deno.serve((req: Request) => {
  const url = new URL(req.url);

  // Supabase routes the whole path to the function, so the request arrives as
  // /join/<token> — the last non-empty segment is the token.
  const segments = url.pathname.split('/').filter(Boolean);
  const token = segments[segments.length - 1] ?? '';

  if (token === 'join' || !isWellFormedToken(token)) {
    return page(
      shell(
        'Invitation link not recognised',
        `<h1>This link doesn't look right</h1>
        <p>The invitation link is incomplete or was cut short by the email client.
        Ask whoever invited you to send it again, or paste the whole link into
        your browser's address bar.</p>`,
      ),
      404,
    );
  }

  return page(invitationPage(token));
});
