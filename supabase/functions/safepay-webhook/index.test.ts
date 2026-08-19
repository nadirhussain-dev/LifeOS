/**
 * Executes the safepay-webhook edge function for real, with an in-memory
 * `payment_events` that enforces 0047's primary key.
 *
 * This is the function that decides whether anybody is on a paid plan, and it is
 * the only one here with no caller to authenticate — it deploys
 * `--no-verify-jwt`, so its signature check and its freshness window are the
 * whole of its front door. Both are asserted here, along with the replay guard
 * they sit in front of.
 *
 * The freshness window is the part worth reading carefully. It has three
 * behaviours that all matter and pull against each other:
 *   • a stale delivery is REFUSED, and deliberately not recorded — recording it
 *     would consume its event id and turn a later legitimate retry into a silent
 *     no-op, which is the exact failure the primary key exists to prevent;
 *   • an UNDATED delivery is accepted by default, because Safepay's timestamp
 *     field name is not confirmed and a strict check against the wrong name
 *     would refuse every payment;
 *   • strict mode exists so that tolerance can be switched off once the field is
 *     confirmed, and it has to actually refuse when it is on.
 *
 * This file lives beside the function rather than under test/ so it stays with
 * what it covers, and because supabase/functions is excluded from the app's
 * tsconfig: the Deno globals below would otherwise fail typecheck.
 */

type Handler = (req: Request) => Promise<Response>;

type Descriptor = {
  table: string;
  op: string;
  filters: { type: string; column: string; value: unknown }[];
  payload?: Record<string, unknown>;
};

let handler: Handler;
let env: Record<string, string>;
let events: Record<string, Record<string, unknown>>;
let subscriptions: Record<string, Record<string, unknown>>;
let intents: Record<string, Record<string, unknown>>;
let profiles: Record<string, Record<string, unknown>>;
let claimResult: unknown;
let logged: unknown[][];

const NOW = 1_760_000_000_000;
const UNIQUE_VIOLATION = '23505';

const value = (d: Descriptor, column: string) => d.filters.find((f) => f.column === column)?.value;

/** A delivery. `signedAt` of `undefined` means "carry no timestamp at all",
 *  which is a case the function has to have an answer for. */
function delivery(
  overrides: {
    id?: string;
    type?: string;
    signedAt?: number | null;
    header?: string | null;
    reference?: string;
    subscriptionId?: string;
  } = {},
): Request {
  const {
    id = 'evt-1',
    type = 'subscription.payment_succeeded',
    signedAt = NOW,
    header = null,
    reference = 'ref-1',
    subscriptionId = 'sfpy-sub-1',
  } = overrides;

  const payload: Record<string, unknown> = {
    id,
    type,
    data: { object: { id: subscriptionId, reference, customer_id: 'cust-1' } },
  };
  if (signedAt !== null && signedAt !== undefined) payload.created = signedAt;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (header) headers['x-sfpy-timestamp'] = header;

  return new Request('https://edge.test/safepay-webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

function query(d: Descriptor): { data: unknown; error: unknown } {
  if (d.table === 'payment_events' && d.op === 'insert') {
    const payload = d.payload as Record<string, unknown>;
    if (events[payload.id as string]) {
      return { data: null, error: { code: UNIQUE_VIOLATION, message: 'duplicate key' } };
    }
    events[payload.id as string] = payload;
    return { data: null, error: null };
  }

  if (d.table === 'subscriptions') {
    if (d.op === 'select') {
      const id = value(d, 'safepay_subscription_id') ?? value(d, 'user_id');
      return { data: subscriptions[id as string] ?? null, error: null };
    }
    if (d.op === 'update' || d.op === 'upsert') {
      const id = (value(d, 'safepay_subscription_id') ??
        (d.payload as Record<string, unknown>).safepay_subscription_id) as string;
      subscriptions[id] = { ...(subscriptions[id] ?? {}), ...d.payload };
      return { data: null, error: null };
    }
  }

  if (d.table === 'profiles' && d.op === 'update') {
    const id = value(d, 'id') as string;
    profiles[id] = { ...(profiles[id] ?? {}), ...d.payload };
    return { data: null, error: null };
  }

  if (d.table === 'billing_plans' && d.op === 'select') {
    return { data: { period: 'month' }, error: null };
  }

  if (d.table === 'coupon_redemptions' && d.op === 'insert') {
    return { data: null, error: null };
  }

  if (d.table === 'coupons' && d.op === 'select') {
    return { data: null, error: null };
  }

  return { data: null, error: null };
}

beforeAll(() => {
  (globalThis as { Deno?: unknown }).Deno = {
    serve: (h: Handler) => {
      handler = h;
    },
    env: { get: (key: string) => env[key] },
  };
  jest.spyOn(Date, 'now').mockImplementation(() => NOW);
  require('./index.ts');
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  env = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SAFEPAY_API_KEY: 'sfpy-api',
    SAFEPAY_SECRET_KEY: 'sfpy-secret',
    SAFEPAY_WEBHOOK_SECRET: 'sfpy-webhook',
    SAFEPAY_ENVIRONMENT: 'sandbox',
  };
  events = {};
  subscriptions = {
    'sfpy-sub-1': {
      user_id: 'user-1',
      plan_id: 'plus-month',
      coupon_id: null,
      cycles_remaining: null,
    },
  };
  intents = { 'ref-1': { user_id: 'user-1', plan_id: 'plus-month', coupon_id: null } };
  profiles = {};
  claimResult = [intents['ref-1']];

  logged = [];
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => logged.push(args));

  globalThis.__safepayStub = {};
  globalThis.__supabaseStub = {
    rpc: async (name: string) => {
      if (name === 'claim_checkout_intent') return { data: claimResult, error: null };
      return { data: null, error: null };
    },
    query,
  };
});

const said = () => JSON.stringify(logged);

describe('the front door', () => {
  it('rejects anything that is not POST', async () => {
    const res = await handler(new Request('https://edge.test/safepay-webhook', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('refuses a bad signature, and records nothing', async () => {
    globalThis.__safepayStub.verifyWebhook = () => false;

    const res = await handler(delivery());

    expect(res.status).toBe(401);
    expect(Object.keys(events)).toHaveLength(0);
  });

  it('logs WHY when the verifier throws, rather than collapsing it into the 401', async () => {
    // A thrown verifier (a missing webhook secret, an SDK change) and a genuinely
    // forged signature produce the same 401 and need completely different
    // responses from whoever reads the logs.
    globalThis.__safepayStub.verifyWebhook = () => {
      throw new Error('no webhook secret configured');
    };

    const res = await handler(delivery());

    expect(res.status).toBe(401);
    expect(said()).toContain('signature verification threw');
    expect(said()).toContain('no webhook secret configured');
  });

  it('verifies against the exact bytes received, not a re-serialization', async () => {
    // Safepay signs the body it sent. Anything that parses and re-stringifies
    // before verifying would break on key order or whitespace alone.
    let seenBody: string | null = null;
    globalThis.__safepayStub.verifyWebhook = async (req: Request) => {
      seenBody = await req.text();
      return true;
    };
    const req = delivery();
    const original = await req.clone().text();

    await handler(req);

    expect(seenBody).toBe(original);
  });
});

describe('the freshness window', () => {
  it('accepts a delivery inside the default five minutes', async () => {
    const res = await handler(delivery({ signedAt: NOW - 60_000 }));

    expect(res.status).toBe(200);
    expect(events['evt-1'].signed_at).toBe(NOW - 60_000);
    // Both halves recorded, so `received_at - signed_at` is the real delivery
    // lag — the number to look at before anybody tightens the window.
    expect(events['evt-1'].received_at).toBe(NOW);
  });

  it('refuses one older than the window, and does NOT consume its event id', async () => {
    const res = await handler(delivery({ signedAt: NOW - 10 * 60 * 1000 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('stale delivery');
    // The critical half. Recording a refused delivery would claim its id and
    // turn a later legitimate retry of the same event into a silent no-op.
    expect(Object.keys(events)).toHaveLength(0);
    expect(said()).toContain('refusing a stale delivery');
  });

  it('a refused delivery can still be replayed legitimately and processed', async () => {
    // The consequence of the rule above, stated as behaviour: refusing must not
    // poison the event id.
    await handler(delivery({ signedAt: NOW - 10 * 60 * 1000 }));

    const res = await handler(delivery({ signedAt: NOW }));

    expect(res.status).toBe(200);
    expect(Object.keys(events)).toEqual(['evt-1']);
  });

  it('honours a widened window', async () => {
    env.SAFEPAY_WEBHOOK_MAX_AGE_SECONDS = '3600';

    expect((await handler(delivery({ signedAt: NOW - 10 * 60 * 1000 }))).status).toBe(200);
  });

  it('disables the check entirely at 0', async () => {
    env.SAFEPAY_WEBHOOK_MAX_AGE_SECONDS = '0';

    const res = await handler(delivery({ signedAt: NOW - 365 * 24 * 60 * 60 * 1000 }));

    expect(res.status).toBe(200);
  });

  it('falls back to the default when the secret is blank or nonsense', async () => {
    // `supabase secrets set --env-file` pushes blank keys, and `?? 300` on an
    // empty string would leave the window at NaN — every comparison false, so the
    // check silently stops refusing anything.
    env.SAFEPAY_WEBHOOK_MAX_AGE_SECONDS = '   ';
    expect((await handler(delivery({ signedAt: NOW - 10 * 60 * 1000 }))).status).toBe(400);

    events = {};
    env.SAFEPAY_WEBHOOK_MAX_AGE_SECONDS = 'five minutes';
    expect((await handler(delivery({ signedAt: NOW - 10 * 60 * 1000 }))).status).toBe(400);
    expect(said()).toContain('is not a number');
  });

  it('refuses a delivery dated well into the future', async () => {
    const res = await handler(delivery({ signedAt: NOW + 10 * 60 * 1000 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('timestamp is in the future');
  });

  it('tolerates a minute of clock skew, which is not the same as a future date', async () => {
    expect((await handler(delivery({ signedAt: NOW + 30_000 }))).status).toBe(200);
  });

  it('prefers a per-delivery header over the body, since a retry carries a fresh one', async () => {
    const res = await handler(
      delivery({ signedAt: NOW - 10 * 60 * 1000, header: String(NOW - 30_000) }),
    );

    expect(res.status).toBe(200);
    expect(events['evt-1'].signed_at).toBe(NOW - 30_000);
  });

  it('ignores the created date on the subscription object itself', async () => {
    // The trap. `data.object.created` is when the SUBSCRIPTION was set up, which
    // for any renewal is months ago — read as the delivery time, every renewal
    // payment would be refused as stale while Safepay kept charging the card.
    const req = new Request('https://edge.test/safepay-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'evt-old-sub',
        type: 'subscription.payment_succeeded',
        data: {
          object: {
            id: 'sfpy-sub-1',
            reference: 'ref-1',
            // Set up six months ago, paying today.
            created: NOW - 180 * 24 * 60 * 60 * 1000,
          },
        },
      }),
    });

    const res = await handler(req);

    expect(res.status).toBe(200);
    // Undated as far as the window is concerned, which is the tolerated path —
    // not a stale refusal.
    expect(events['evt-old-sub'].signed_at).toBeNull();
  });

  it('reads seconds, milliseconds and ISO strings alike', async () => {
    // Safepay's own payloads already mix the first two — see readEvent's period
    // handling — so guessing by magnitude is the established approach here.
    const asSeconds = Math.floor((NOW - 60_000) / 1000);
    expect((await handler(delivery({ header: String(asSeconds) }))).status).toBe(200);
    expect(events['evt-1'].signed_at).toBe(asSeconds * 1000);

    events = {};
    const iso = new Date(NOW - 60_000).toISOString();
    expect((await handler(delivery({ id: 'evt-2', header: iso }))).status).toBe(200);
    expect(events['evt-2'].signed_at).toBe(NOW - 60_000);
  });
});

describe('an undated delivery', () => {
  it('is accepted by default, loudly, with a NULL signed_at to count', async () => {
    // Safepay's timestamp field name is documented but unconfirmed. If every
    // guess is wrong, refusing would mean payments succeed at Safepay and nobody
    // is upgraded — a far worse outcome than accepting a delivery whose signature
    // already checked out. 0064's header has the query that counts these.
    const res = await handler(delivery({ signedAt: null }));

    expect(res.status).toBe(200);
    expect(events['evt-1'].signed_at).toBeNull();
    expect(said()).toContain('accepting an undated delivery');
  });

  it('is refused once strict mode is switched on', async () => {
    env.SAFEPAY_WEBHOOK_REQUIRE_TIMESTAMP = 'true';

    const res = await handler(delivery({ signedAt: null }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing timestamp');
    expect(Object.keys(events)).toHaveLength(0);
  });

  it('treats any value but "true" as off, so a typo cannot switch it on', async () => {
    for (const raw of ['false', 'yes', '1', '']) {
      events = {};
      env.SAFEPAY_WEBHOOK_REQUIRE_TIMESTAMP = raw;
      expect((await handler(delivery({ signedAt: null }))).status).toBe(200);
    }
  });
});

describe('replay, which the window sits in front of rather than replaces', () => {
  it('processes an event once and reports a redelivery as replayed', async () => {
    expect((await handler(delivery())).status).toBe(200);

    const res = await handler(delivery());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, replayed: true });
    // Still a 200: Safepay retries on anything else, so a replay must not look
    // like a failure to it.
    expect(Object.keys(events)).toHaveLength(1);
  });

  it('upgrades the profile on a successful payment', async () => {
    await handler(delivery({ type: 'subscription.payment_succeeded' }));

    expect(profiles['user-1'].plan_id).toBe('plus-month');
    expect(subscriptions['sfpy-sub-1'].status).toBe('active');
  });

  it('claims the checkout intent rather than only reading it', async () => {
    // A plain select left every converted intent looking reusable forever, which
    // is what safepay-checkout's reuse path depends on being false.
    await handler(delivery({ type: 'subscription.created' }));

    const claim = globalThis.__supabaseStub.rpcCalls.find(
      (c: { name: string }) => c.name === 'claim_checkout_intent',
    );
    expect(claim.params).toEqual({ p_reference: 'ref-1', p_now: NOW });
  });

  it('does nothing when the intent has already been claimed', async () => {
    claimResult = [];

    const res = await handler(delivery({ type: 'subscription.created' }));

    expect(res.status).toBe(200);
    expect((await res.json()).note).toContain('no open checkout_intent');
    expect(Object.keys(subscriptions)).toEqual(['sfpy-sub-1']);
  });

  it('stamps every row this event writes with the same instant it was received at', async () => {
    await handler(delivery({ type: 'subscription.payment_succeeded' }));

    expect(events['evt-1'].received_at).toBe(NOW);
    expect(subscriptions['sfpy-sub-1'].updated_at).toBe(NOW);
    expect(profiles['user-1'].updated_at).toBe(NOW);
  });
});
