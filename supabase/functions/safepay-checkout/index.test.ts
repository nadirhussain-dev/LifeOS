/**
 * Executes the safepay-checkout edge function for real, against an in-memory
 * `checkout_intents` that enforces 0063's unique index.
 *
 * The unique index is simulated rather than stubbed away, because it IS the
 * guard. A test that mocked the insert to "succeed once" would pass whether or
 * not the function claims the key before doing the expensive work, and that
 * ordering is the entire fix: with the claim after plan resolution, two
 * concurrent calls both create a Safepay Plan and only then discover one was
 * redundant.
 *
 * What each group covers, in order of how much it costs to get wrong:
 *   • the replay paths — a retry must never mint a second checkout or a second
 *     Plan object at the provider;
 *   • the claim's ordering, asserted against the recorded call sequence;
 *   • the race, since a duplicate insert is an expected outcome here and not an
 *     error to bubble up as a 500;
 *   • the coupon-variant conflict, which used to discard its own error and so
 *     created two Plans for one cached row.
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
  rowMode: string | null;
};

let handler: Handler;
let env: Record<string, string>;

/** Rows of `checkout_intents`, keyed by reference. */
let intents: Record<string, Record<string, unknown>>;
/** Rows of `plan_coupon_variants`, keyed by `${base_plan_id}:${coupon_id}`. */
let variants: Record<string, Record<string, unknown>>;
let planRow: Record<string, unknown>;
let couponRow: Record<string, unknown> | null;
let rateLimit: { allowed: boolean; remaining: number; retry_after_seconds: number };
/** Every Safepay Plan created through the raw REST call in _shared/safepay.ts. */
let plansCreated: string[];
let nextReference: number;

const UNIQUE_VIOLATION = '23505';

const USER = { id: 'user-1', email: 'a@b.c' };
const NOW = 1_760_000_000_000;

function post(
  body: unknown,
  options: { auth?: string | null; idempotencyKey?: string } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = options.auth === undefined ? 'Bearer caller-jwt' : options.auth;
  if (auth) headers.Authorization = auth;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  return new Request('https://edge.test/safepay-checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const value = (d: Descriptor, column: string) => d.filters.find((f) => f.column === column)?.value;

/** The database operations performed, in order, as `op:table`. The claim's
 *  position in this list is what the ordering test asserts against. */
function sequence(): string[] {
  const queries = (globalThis.__supabaseStub.queries ?? []) as Descriptor[];
  return queries.map((q) => `${q.op}:${q.table}`);
}

/** The in-memory database. One function, so the whole of what this test believes
 *  about the schema is readable in one place. */
function query(d: Descriptor): { data: unknown; error: unknown } {
  if (d.table === 'billing_plans') {
    if (d.op === 'select') return { data: planRow, error: null };
    if (d.op === 'update') {
      // `.is('safepay_plan_id', null)` — only fills an empty slot.
      const requiresNull = d.filters.some((f) => f.type === 'is' && f.column === 'safepay_plan_id');
      if (!requiresNull || planRow.safepay_plan_id == null) {
        planRow = { ...planRow, ...d.payload };
      }
      return { data: null, error: null };
    }
  }

  if (d.table === 'plan_coupon_variants') {
    const key = `${value(d, 'base_plan_id')}:${value(d, 'coupon_id')}`;
    if (d.op === 'select') return { data: variants[key] ?? null, error: null };
    if (d.op === 'insert') {
      const payload = d.payload as Record<string, unknown>;
      const insertKey = `${payload.base_plan_id}:${payload.coupon_id}`;
      if (variants[insertKey]) {
        return { data: null, error: { code: UNIQUE_VIOLATION, message: 'duplicate key' } };
      }
      variants[insertKey] = payload;
      return { data: null, error: null };
    }
  }

  if (d.table === 'checkout_intents') {
    if (d.op === 'select') {
      const rows = Object.values(intents).filter((row) => {
        return d.filters.every((f) => {
          if (f.type === 'eq') return row[f.column] === f.value;
          if (f.type === 'is') return (row[f.column] ?? null) === f.value;
          if (f.type === 'gt') return (row[f.column] as number) > (f.value as number);
          return true;
        });
      });
      rows.sort((a, b) => (b.created_at as number) - (a.created_at as number));
      return { data: rows[0] ?? null, error: null };
    }
    if (d.op === 'insert') {
      const payload = d.payload as Record<string, unknown>;
      // 0063's `unique (user_id, idempotency_key) where idempotency_key is not
      // null`.
      const clash = Object.values(intents).some(
        (row) =>
          row.user_id === payload.user_id &&
          payload.idempotency_key != null &&
          row.idempotency_key === payload.idempotency_key,
      );
      if (clash) {
        return { data: null, error: { code: UNIQUE_VIOLATION, message: 'duplicate key' } };
      }
      const reference = `ref-${nextReference++}`;
      intents[reference] = { reference, consumed_at: null, checkout_url: null, ...payload };
      return { data: { reference }, error: null };
    }
    if (d.op === 'update') {
      const reference = value(d, 'reference') as string;
      if (intents[reference]) intents[reference] = { ...intents[reference], ...d.payload };
      return { data: null, error: null };
    }
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

  // `createSafepayPlan` in _shared/safepay.ts is a raw REST call, not an SDK
  // method — see its own header for why. So it is stubbed at fetch.
  globalThis.fetch = (async (url: string) => {
    const id = `sfpy-plan-${plansCreated.length + 1}`;
    plansCreated.push(String(url));
    return new Response(JSON.stringify({ data: { id } }), { status: 200 });
  }) as typeof fetch;

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
    SAFEPAY_ENVIRONMENT: 'sandbox',
  };
  intents = {};
  variants = {};
  plansCreated = [];
  nextReference = 1;
  planRow = {
    id: 'plus-month',
    name: 'Plus',
    price_cents: 499,
    currency: 'PKR',
    period: 'month',
    active: true,
    safepay_plan_id: 'sfpy-plan-existing',
  };
  couponRow = null;
  rateLimit = { allowed: true, remaining: 9, retry_after_seconds: 3600 };

  globalThis.__safepayStub = {};
  globalThis.__supabaseStub = {
    getUser: async () => ({ data: { user: USER }, error: null }),
    rpc: async (name: string) => {
      if (name === 'consume_rate_limit') return { data: [rateLimit], error: null };
      if (name === 'validate_coupon') return { data: couponRow ? [couponRow] : [], error: null };
      return { data: null, error: null };
    },
    query,
  };
});

describe('request handling', () => {
  it('answers the CORS preflight, and allows the Idempotency-Key header through it', async () => {
    const res = await handler(
      new Request('https://edge.test/safepay-checkout', { method: 'OPTIONS' }),
    );

    expect(res.status).toBe(200);
    // Without this a browser drops the header before it is sent, and the web
    // build silently downgrades to the synthesized key — the protection quietly
    // weakening on exactly the platform that preflights.
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('idempotency-key');
  });

  it('rejects a caller with no Authorization header', async () => {
    expect((await handler(post({ planId: 'plus-month' }, { auth: null }))).status).toBe(401);
  });

  it('rejects a request with no planId', async () => {
    expect((await handler(post({}))).status).toBe(400);
  });

  it('refuses a free or inactive plan', async () => {
    planRow = { ...planRow, active: false };
    expect((await handler(post({ planId: 'plus-month' }))).status).toBe(400);

    planRow = { ...planRow, active: true, period: 'free' };
    expect((await handler(post({ planId: 'plus-month' }))).status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('refuses with 429 before creating an intent or reaching Safepay', async () => {
    rateLimit = { allowed: false, remaining: 0, retry_after_seconds: 77 };

    const res = await handler(post({ planId: 'plus-month' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('77');
    expect(Object.keys(intents)).toHaveLength(0);
    expect(globalThis.__safepayStub.calls ?? []).toHaveLength(0);
  });

  it('spends the checkout budget and no other', async () => {
    await handler(post({ planId: 'plus-month' }));

    const limitCall = globalThis.__supabaseStub.rpcCalls.find(
      (c: { name: string }) => c.name === 'consume_rate_limit',
    );
    expect(limitCall.params.p_action).toBe('edge_safepay_checkout');
    expect(limitCall.params.p_limit).toBe(10);
  });
});

describe('the happy path', () => {
  it('mints a checkout against the cached Safepay plan and records the URL on the intent', async () => {
    const res = await handler(post({ planId: 'plus-month' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.replayed).toBeUndefined();
    expect(body.checkoutUrl).toContain(body.reference);

    // No Plan created: billing_plans already had one cached.
    expect(plansCreated).toHaveLength(0);

    const intent = intents[body.reference];
    expect(intent.user_id).toBe(USER.id);
    expect(intent.plan_id).toBe('plus-month');
    expect(intent.checkout_url).toBe(body.checkoutUrl);
    // Stamped, so a replay has something to answer with.
    expect(intent.updated_at).toBe(NOW);
    expect(intent.consumed_at).toBeNull();
  });

  it('claims the intent BEFORE creating a Safepay Plan — the ordering is the guard', async () => {
    planRow = { ...planRow, safepay_plan_id: null };

    await handler(post({ planId: 'plus-month' }));

    const ops = sequence();
    const claim = ops.indexOf('insert:checkout_intents');
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(plansCreated).toHaveLength(1);
    // The Plan is created after the claim, which is what makes a concurrent
    // second call unable to reach the creation at all.
    const planWrite = ops.indexOf('update:billing_plans');
    expect(planWrite).toBeGreaterThan(claim);
  });
});

describe('idempotency — a client-supplied key', () => {
  it('replays the first response instead of creating anything a second time', async () => {
    const first = await (
      await handler(post({ planId: 'plus-month' }, { idempotencyKey: 'k-abc-1234' }))
    ).json();
    const second = await handler(post({ planId: 'plus-month' }, { idempotencyKey: 'k-abc-1234' }));
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(body.checkoutUrl).toBe(first.checkoutUrl);
    expect(body.reference).toBe(first.reference);

    // The properties that actually matter: one intent, and one checkout at the
    // provider.
    expect(Object.keys(intents)).toHaveLength(1);
    expect(
      globalThis.__safepayStub.calls.filter(
        (c: { name: string }) => c.name === 'checkout.createSubscription',
      ),
    ).toHaveLength(1);
  });

  it('replays for as long as the intent lives, not only inside the reuse window', async () => {
    const first = await (
      await handler(post({ planId: 'plus-month' }, { idempotencyKey: 'k-abc-1234' }))
    ).json();

    // An explicit key means "this exact call" regardless of elapsed time —
    // applying a window to it would make one key mean two things depending on
    // how slowly the client retried.
    intents[first.reference].created_at = NOW - 24 * 60 * 60 * 1000;

    const body = await (
      await handler(post({ planId: 'plus-month' }, { idempotencyKey: 'k-abc-1234' }))
    ).json();
    expect(body.replayed).toBe(true);
    expect(Object.keys(intents)).toHaveLength(1);
  });

  it('accepts the key in the body too, for a client that cannot set headers', async () => {
    await handler(post({ planId: 'plus-month', idempotencyKey: 'body-key-1234' }));
    const body = await (
      await handler(post({ planId: 'plus-month', idempotencyKey: 'body-key-1234' }))
    ).json();

    expect(body.replayed).toBe(true);
  });

  it('rejects a malformed key rather than silently falling back', async () => {
    // A client that believes it sent a key and is quietly not protected by it is
    // worse than either a 400 or no key at all.
    const res = await handler(post({ planId: 'plus-month' }, { idempotencyKey: 'short' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Idempotency-Key');
    expect(Object.keys(intents)).toHaveLength(0);
  });

  it('scopes a key to its own account, so two accounts cannot collide', async () => {
    await handler(post({ planId: 'plus-month' }, { idempotencyKey: 'shared-key-1' }));

    globalThis.__supabaseStub.getUser = async () => ({
      data: { user: { id: 'user-2', email: 'x@y.z' } },
      error: null,
    });
    const body = await (
      await handler(post({ planId: 'plus-month' }, { idempotencyKey: 'shared-key-1' }))
    ).json();

    // Not a replay: the index is per user, so the second account gets its own
    // checkout rather than being handed the first account's URL.
    expect(body.replayed).toBeUndefined();
    expect(Object.keys(intents)).toHaveLength(2);
  });

  it('409s while the winner of a race is still mid-flight', async () => {
    // The claimed-but-not-yet-answered state: a row with no checkout_url. Not a
    // 200-with-no-url (which the client would have to special-case) and not a
    // second checkout (which is the whole thing being prevented).
    intents['ref-existing'] = {
      reference: 'ref-existing',
      user_id: USER.id,
      plan_id: 'plus-month',
      coupon_id: null,
      idempotency_key: 'c:k-inflight-99',
      checkout_url: null,
      consumed_at: null,
      created_at: NOW,
    };

    const res = await handler(post({ planId: 'plus-month' }, { idempotencyKey: 'k-inflight-99' }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('checkout_in_progress');
    expect(res.headers.get('Retry-After')).toBe('2');
    expect(globalThis.__safepayStub.calls ?? []).toHaveLength(0);
  });
});

describe('idempotency — a client that sends no key at all', () => {
  it('reuses the recent intent on a double tap', async () => {
    // Every build shipped before 0063 is this client, which is why the
    // synthesized key exists: the protection cannot depend on the app updating
    // first.
    const first = await (await handler(post({ planId: 'plus-month' }))).json();
    const second = await (await handler(post({ planId: 'plus-month' }))).json();

    expect(second.replayed).toBe(true);
    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    expect(Object.keys(intents)).toHaveLength(1);
  });

  it('does not reuse an intent for a different plan', async () => {
    await handler(post({ planId: 'plus-month' }));

    planRow = { ...planRow, id: 'pro-year', period: 'year', price_cents: 4999 };
    const body = await (await handler(post({ planId: 'pro-year' }))).json();

    expect(body.replayed).toBeUndefined();
    expect(Object.keys(intents)).toHaveLength(2);
  });

  it('does not reuse an intent that has already converted', async () => {
    // `consumed_at` is stamped by the webhook's claim_checkout_intent. Without
    // that filter, every converted intent would look reusable forever and a
    // second subscription attempt would be handed a dead URL.
    const first = await (await handler(post({ planId: 'plus-month' }))).json();
    intents[first.reference].consumed_at = NOW;
    // Push past the synthesized key's minute bucket so the reuse read is what
    // is being tested rather than the unique index.
    (Date.now as jest.Mock).mockImplementation(() => NOW + 120_000);

    const body = await (await handler(post({ planId: 'plus-month' }))).json();

    expect(body.replayed).toBeUndefined();
    expect(Object.keys(intents)).toHaveLength(2);
    (Date.now as jest.Mock).mockImplementation(() => NOW);
  });

  it('creates a new intent once the reuse window has passed', async () => {
    await handler(post({ planId: 'plus-month' }));
    (Date.now as jest.Mock).mockImplementation(() => NOW + 11 * 60 * 1000);

    const body = await (await handler(post({ planId: 'plus-month' }))).json();

    expect(body.replayed).toBeUndefined();
    expect(Object.keys(intents)).toHaveLength(2);
    (Date.now as jest.Mock).mockImplementation(() => NOW);
  });
});

describe('coupons', () => {
  beforeEach(() => {
    couponRow = {
      coupon_id: 'coupon-1',
      discount_type: 'percent',
      discount_value: 50,
      duration_cycles: 3,
    };
  });

  it('creates the discounted Plan variant once, and caches it', async () => {
    await handler(post({ planId: 'plus-month', couponCode: 'HALF' }));
    expect(plansCreated).toHaveLength(1);
    expect(variants['plus-month:coupon-1'].price_cents).toBe(250);

    // A second, distinct checkout on the same coupon reuses the cached variant
    // rather than creating another Plan object.
    (Date.now as jest.Mock).mockImplementation(() => NOW + 20 * 60 * 1000);
    await handler(post({ planId: 'plus-month', couponCode: 'HALF' }));
    expect(plansCreated).toHaveLength(1);
    (Date.now as jest.Mock).mockImplementation(() => NOW);
  });

  it('refuses an invalid coupon before claiming anything', async () => {
    couponRow = null;

    const res = await handler(post({ planId: 'plus-month', couponCode: 'NOPE' }));

    expect(res.status).toBe(400);
    expect(Object.keys(intents)).toHaveLength(0);
  });

  it('does not replay a no-coupon intent for a coupon checkout', async () => {
    couponRow = null;
    await handler(post({ planId: 'plus-month' }));

    couponRow = {
      coupon_id: 'coupon-1',
      discount_type: 'percent',
      discount_value: 50,
      duration_cycles: 3,
    };
    const body = await (await handler(post({ planId: 'plus-month', couponCode: 'HALF' }))).json();

    // The coupon is part of what identifies the checkout — the same plan at a
    // different price is not the same purchase.
    expect(body.replayed).toBeUndefined();
    expect(intents[body.reference].coupon_id).toBe('coupon-1');
  });

  it('defers to the winner when two first-ever coupon checkouts race', async () => {
    // Previously the variant insert's error was discarded, so the loser kept
    // using the Plan it had created: two Plan objects at Safepay for one cached
    // row, and the row naming only one of them.
    const logged: unknown[][] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      variants['plus-month:coupon-1'] = {
        base_plan_id: 'plus-month',
        coupon_id: 'coupon-1',
        safepay_plan_id: 'sfpy-plan-winner',
        price_cents: 250,
        created_at: NOW,
      };
      // The race, staged as it actually happens: the FIRST select misses because
      // the other caller has not inserted yet, the insert then conflicts because
      // by that point it has, and the re-read afterwards finds the winner. Only
      // the first select is suppressed — making every select miss would test the
      // fallback path instead of the one that matters.
      const original = globalThis.__supabaseStub.query;
      let variantSelects = 0;
      globalThis.__supabaseStub.query = (d: Descriptor) => {
        if (d.table === 'plan_coupon_variants' && d.op === 'select' && variantSelects++ === 0) {
          return { data: null, error: null };
        }
        return original(d);
      };

      const body = await (await handler(post({ planId: 'plus-month', couponCode: 'HALF' }))).json();

      expect(body.ok).toBe(true);
      // Checked out against the winner's Plan, not the one this call made.
      const checkout = globalThis.__safepayStub.calls.find(
        (c: { name: string }) => c.name === 'checkout.createSubscription',
      );
      expect(checkout.input.planId).toBe('sfpy-plan-winner');
    } finally {
      console.error = consoleError;
    }
    // The Plan this call created is now orphaned at Safepay. Harmless, but the
    // log is the only way anybody would know to tidy it up.
    expect(JSON.stringify(logged)).toContain('discarding the Plan this call created');
  });
});

describe('the uncouponed first-ever checkout', () => {
  it('caches the Plan it creates on the billing_plans row', async () => {
    planRow = { ...planRow, safepay_plan_id: null };

    await handler(post({ planId: 'plus-month' }));

    expect(plansCreated).toHaveLength(1);
    expect(planRow.safepay_plan_id).toBe('sfpy-plan-1');
  });

  it('defers to the winner of a race rather than overwriting its cached id', async () => {
    // `billing_plans.safepay_plan_id` is a cache slot, not a key, so it cannot
    // carry a constraint — the `.is('safepay_plan_id', null)` on the update is
    // what makes this safe. Without it, the second call would overwrite the id
    // the first is already checking out against.
    const logged: unknown[][] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      planRow = { ...planRow, safepay_plan_id: null };
      const original = globalThis.__supabaseStub.query;
      let selects = 0;
      globalThis.__supabaseStub.query = (d: Descriptor) => {
        // The first read misses (nothing cached yet); by the time the update
        // runs, the concurrent caller has filled the slot.
        if (d.table === 'billing_plans' && d.op === 'select' && selects++ === 0) {
          return { data: { ...planRow, safepay_plan_id: null }, error: null };
        }
        if (d.table === 'billing_plans' && d.op === 'update') {
          planRow = { ...planRow, safepay_plan_id: 'sfpy-plan-winner' };
          return { data: null, error: null };
        }
        return original(d);
      };

      const body = await (await handler(post({ planId: 'plus-month' }))).json();

      expect(body.ok).toBe(true);
      const checkout = globalThis.__safepayStub.calls.find(
        (c: { name: string }) => c.name === 'checkout.createSubscription',
      );
      expect(checkout.input.planId).toBe('sfpy-plan-winner');
    } finally {
      console.error = consoleError;
    }
    expect(JSON.stringify(logged)).toContain('discarding the Plan this call created');
  });
});

describe('failure handling', () => {
  it('still returns the checkout when the URL cannot be recorded', async () => {
    const logged: unknown[][] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      const original = globalThis.__supabaseStub.query;
      globalThis.__supabaseStub.query = (d: Descriptor) => {
        if (d.table === 'checkout_intents' && d.op === 'update') {
          return { data: null, error: { code: '42501', message: 'denied' } };
        }
        return original(d);
      };

      const res = await handler(post({ planId: 'plus-month' }));
      const body = await res.json();

      // The checkout is real and the user must be sent to it. What is lost is
      // only the ability to replay, which degrades a later retry to a 409 — a
      // worse experience than a replay and a much better one than a charge.
      expect(res.status).toBe(200);
      expect(body.checkoutUrl).toBeTruthy();
    } finally {
      console.error = consoleError;
    }
    expect(JSON.stringify(logged)).toContain('could not record checkout_url');
  });

  it('surfaces a non-conflict insert error as a 500 rather than pretending to succeed', async () => {
    const original = globalThis.__supabaseStub.query;
    globalThis.__supabaseStub.query = (d: Descriptor) => {
      if (d.table === 'checkout_intents' && d.op === 'insert') {
        return { data: null, error: { code: '42501', message: 'permission denied' } };
      }
      return original(d);
    };

    const res = await handler(post({ planId: 'plus-month' }));

    expect(res.status).toBe(500);
    expect(globalThis.__safepayStub.calls ?? []).toHaveLength(0);
  });
});
