/**
 * Executes the send-invite edge function for real — the handler is invoked
 * with actual Request objects and its Responses are read back.
 *
 * This file lives beside the function rather than under test/ so it stays with
 * what it covers, and because supabase/functions is excluded from the app's
 * tsconfig: the Deno globals below would otherwise fail typecheck.
 *
 * What it guards, in order of how badly each failed before:
 *   • the wordmark, which stayed "LifeOS" through the whole rebrand;
 *   • the subject line, which used HTML-escaped names so "Mum & Dad" reached
 *     the inbox as "Mum &amp; Dad";
 *   • the text/plain part, whose absence is a spam signal;
 *   • the CORS preflight the other two functions already handled;
 *   • and the degradation path the members screen depends on — no key, or a
 *     provider failure, must still return a real redeemable link.
 */

type Handler = (req: Request) => Promise<Response>;

let handler: Handler;
let env: Record<string, string>;
let fetchCalls: { url: string; init: RequestInit }[];
let resendResponse: () => Promise<Response> | Response;

/** The Resend payload from the most recent send. */
function lastEmail(): Record<string, unknown> {
  const call = fetchCalls[fetchCalls.length - 1];
  return JSON.parse(String(call.init.body));
}

function post(body: unknown, auth: string | null = 'Bearer caller-jwt'): Request {
  return new Request('https://edge.test/send-invite', {
    method: 'POST',
    headers: auth ? { Authorization: auth, 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  });
}

const VALID = {
  groupId: 'g-1',
  memberId: 'm-1',
  email: 'invitee@example.com',
  groupName: 'Flat 3',
};

beforeAll(() => {
  // Node's webcrypto, not a stub: mintToken's CSPRNG output is the security
  // property under test in `mints an unguessable token`.
  if (!globalThis.crypto?.getRandomValues) {
    (globalThis as { crypto?: unknown }).crypto = require('node:crypto').webcrypto;
  }

  (globalThis as { Deno?: unknown }).Deno = {
    serve: (h: Handler) => {
      handler = h;
    },
    env: { get: (key: string) => env[key] },
  };

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return resendResponse();
  }) as typeof fetch;

  // Registers the handler via the Deno.serve stub above. require, not import:
  // the globals have to exist before the module body runs.
  require('./index.ts');
});

beforeEach(() => {
  fetchCalls = [];
  resendResponse = () => new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
  env = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
  };
  globalThis.__supabaseStub = {
    getUser: async () => ({
      data: { user: { email: 'inviter@example.com', user_metadata: { display_name: 'Ada' } } },
    }),
    rpc: async () => ({ error: null }),
  };
});

describe('request handling', () => {
  it('answers the CORS preflight instead of 405ing on it', async () => {
    const res = await handler(new Request('https://edge.test/send-invite', { method: 'OPTIONS' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
  });

  it('carries CORS headers on JSON responses too, not just the preflight', async () => {
    const res = await handler(post(VALID, null));

    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects anything that is not POST', async () => {
    const res = await handler(new Request('https://edge.test/send-invite', { method: 'GET' }));

    expect(res.status).toBe(405);
  });

  it('rejects a caller with no Authorization header', async () => {
    expect((await handler(post(VALID, null))).status).toBe(401);
  });

  it('rejects a body missing the fields the invitation needs', async () => {
    expect((await handler(post({ groupId: 'g-1' }))).status).toBe(400);
  });

  it('forwards the caller JWT so RLS decides, and never trusts the client', async () => {
    env.RESEND_API_KEY = 'rk-test';
    await handler(post(VALID));

    const headers = globalThis.__supabaseStub.clientOptions.global.headers;
    expect(headers.Authorization).toBe('Bearer caller-jwt');
    // The token is minted server-side; nothing from the payload chooses it.
    const { params } = globalThis.__supabaseStub.rpcCalls[0];
    expect(typeof params.p_token).toBe('string');
    expect(params.p_token.length).toBeGreaterThan(20);
  });

  it('surfaces an RLS refusal as 403 rather than sending anything', async () => {
    globalThis.__supabaseStub.rpc = async () => ({ error: { message: 'denied' } });
    env.RESEND_API_KEY = 'rk-test';

    expect((await handler(post(VALID))).status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it('mints an unguessable token: url-safe, and never twice the same', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      await handler(post(VALID));
      const token = globalThis.__supabaseStub.rpcCalls[i].params.p_token;
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      seen.add(token);
    }
    expect(seen.size).toBe(5);
  });
});

describe('the email itself', () => {
  beforeEach(() => {
    env.RESEND_API_KEY = 'rk-test';
  });

  it('sends through Resend with the key as a bearer token', async () => {
    await handler(post(VALID));

    expect(fetchCalls[0].url).toBe('https://api.resend.com/emails');
    expect(fetchCalls[0].init.method).toBe('POST');
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer rk-test');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('is branded Daykeep, with no LifeOS left anywhere in it', async () => {
    await handler(post(VALID));
    const email = lastEmail();

    expect(email.html).toContain('Daykeep');
    expect(email.html).not.toMatch(/LifeOS|Life<span/);
    expect(email.text).not.toMatch(/LifeOS/);
    expect(email.from).toBe('Daykeep <invites@daykeep.app>');
  });

  it('includes a text/plain part carrying the same link as the HTML', async () => {
    await handler(post(VALID));
    const email = lastEmail();
    const link = String(globalThis.__supabaseStub.rpcCalls[0].params.p_token);

    expect(typeof email.text).toBe('string');
    expect(String(email.text)).toContain(link);
    expect(String(email.html)).toContain(link);
    expect(String(email.text)).toContain('Ada added you to “Flat 3” on Daykeep.');
  });

  it('escapes the HTML part but leaves subject and text unescaped', async () => {
    globalThis.__supabaseStub.getUser = async () => ({
      data: { user: { email: 'x@y.z', user_metadata: { display_name: 'Mum & Dad' } } },
    });
    await handler(post({ ...VALID, groupName: '<script>alert(1)</script>' }));
    const email = lastEmail();

    // Markup: escaped, so a group name cannot inject script into the email.
    expect(email.html).toContain('Mum &amp; Dad');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).not.toContain('<script>');
    // Not markup: raw, so the inbox does not display "Mum &amp; Dad".
    expect(email.subject).toBe('Mum & Dad added you to <script>alert(1)</script>');
    expect(String(email.text)).toContain('Mum & Dad');
    expect(String(email.text)).not.toContain('&amp;');
  });

  it('honours INVITE_FROM and APP_INVITE_BASE_URL when set', async () => {
    env.INVITE_FROM = 'Daykeep <hello@example.com>';
    env.APP_INVITE_BASE_URL = 'https://example.com/join';
    const res = await handler(post(VALID));

    expect(lastEmail().from).toBe('Daykeep <hello@example.com>');
    expect((await res.json()).link).toContain('https://example.com/join/');
  });

  it('falls back to the inviter email when they have no display name', async () => {
    globalThis.__supabaseStub.getUser = async () => ({
      data: { user: { email: 'inviter@example.com', user_metadata: {} } },
    });
    await handler(post(VALID));

    expect(lastEmail().subject).toContain('inviter@example.com');
  });

  it('reports the send as emailed once Resend accepts it', async () => {
    const body = await (await handler(post(VALID))).json();

    expect(body).toMatchObject({ ok: true, emailed: true });
    expect(body.link).toContain('/join/');
  });
});

describe('degradation — the invitation must survive email failing', () => {
  it('returns a real link, unemailed, when no API key is configured', async () => {
    const body = await (await handler(post(VALID))).json();

    expect(fetchCalls).toHaveLength(0);
    expect(body).toMatchObject({ ok: true, emailed: false, reason: 'email_not_configured' });
    expect(body.link).toContain('https://daykeep.app/join/');
    // The invitation was still written — the members screen shares this link.
    expect(globalThis.__supabaseStub.rpcCalls).toHaveLength(1);
  });

  it('returns a real link, unemailed, when Resend rejects the send', async () => {
    env.RESEND_API_KEY = 'rk-test';
    resendResponse = () => new Response('domain not verified', { status: 403 });

    const body = await (await handler(post(VALID))).json();

    expect(body).toMatchObject({ ok: true, emailed: false });
    expect(body.reason).toContain('domain not verified');
    expect(body.link).toContain('/join/');
  });

  it('returns a real link, unemailed, when the network throws', async () => {
    env.RESEND_API_KEY = 'rk-test';
    resendResponse = () => {
      throw new Error('connection reset');
    };

    const body = await (await handler(post(VALID))).json();

    expect(body).toMatchObject({ ok: true, emailed: false });
    expect(body.reason).toContain('connection reset');
    expect(body.link).toContain('/join/');
  });
});
