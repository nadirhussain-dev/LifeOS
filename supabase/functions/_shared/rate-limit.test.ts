/**
 * The two limiters, and the decisions they make at their edges.
 *
 * Worth testing directly rather than only through the functions that call them,
 * because every interesting case here is a boundary — the call that is exactly
 * at the limit, the one after it, the window rolling over, the limiter itself
 * being broken — and reaching those through nine separate handlers would mean
 * asserting the same arithmetic nine times.
 */

import {
  __resetLocalBudgets,
  callerKey,
  consumeLocalBudget,
  consumeRateLimit,
  LIMITS,
  tooManyRequests,
} from './rate-limit';

/** `returns table (...)` arrives from PostgREST as an array of one row. */
const row = (allowed: boolean, remaining: number, retry: number) => ({
  data: [{ allowed, remaining, retry_after_seconds: retry }],
  error: null,
});

function clientReturning(
  result: { data: unknown; error: { message: string } | null },
  calls: { name: string; params: Record<string, unknown> }[] = [],
) {
  return {
    calls,
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return result;
    },
  };
}

/** Silences the deliberate console.error on the fail-open paths, and returns
 *  what was logged so the test can assert it said something. */
async function capturingErrors<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const result = await fn();
    return { result, logged: JSON.stringify(logged) };
  } finally {
    console.error = original;
  }
}

describe('consumeRateLimit — the database-backed limiter', () => {
  it('sends the action and its configured budget, and nothing else', async () => {
    const client = clientReturning(row(true, 9, 3600));

    const decision = await consumeRateLimit(client, 'edge_safepay_checkout');

    expect(client.calls).toEqual([
      {
        name: 'consume_rate_limit',
        params: { p_action: 'edge_safepay_checkout', p_limit: 10, p_window_ms: 3600000 },
      },
    ]);
    expect(decision).toEqual({ allowed: true, retryAfterSeconds: 3600, remaining: 9 });
  });

  it('never sends a user id — the identity is the caller JWT, not a parameter', async () => {
    // This is the property that makes the function safe to grant to
    // `authenticated`: there is no field in the request that says who to
    // charge, so there is no field to forge. See 0062's header.
    const client = clientReturning(row(true, 5, 60));
    await consumeRateLimit(client, 'edge_notify_group');

    const params = client.calls[0].params;
    expect(Object.keys(params).sort()).toEqual(['p_action', 'p_limit', 'p_window_ms']);
  });

  it('passes a refusal through with its retry hint', async () => {
    const client = clientReturning(row(false, 0, 137));

    expect(await consumeRateLimit(client, 'edge_send_invite')).toEqual({
      allowed: false,
      retryAfterSeconds: 137,
      remaining: 0,
    });
  });

  it('honours an override, for a caller that needs a tighter budget than the default', async () => {
    const client = clientReturning(row(true, 1, 60));

    await consumeRateLimit(client, 'edge_notify_album', { limit: 2, windowMs: 60_000 });

    expect(client.calls[0].params).toEqual({
      p_action: 'edge_notify_album',
      p_limit: 2,
      p_window_ms: 60000,
    });
  });

  it('fails OPEN when the RPC errors, and says so', async () => {
    // The migration not being applied yet is the realistic version of this. The
    // caller has already been authenticated and authorized by the time the
    // limiter runs, so refusing here would turn a database problem into "nobody
    // can subscribe" — a worse outage than the abuse being prevented.
    const client = clientReturning({ data: null, error: { message: 'relation missing' } });

    const { result, logged } = await capturingErrors(() =>
      consumeRateLimit(client, 'edge_safepay_checkout'),
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeNull();
    expect(logged).toContain('rate limit check failed');
  });

  it('fails OPEN on a shape it does not recognise, rather than reading undefined as refusal', async () => {
    // `{}` is what a renamed column or a changed return type looks like from
    // here. Treating a missing `allowed` as falsy would refuse every call in
    // production the moment the RPC's shape drifted.
    const client = clientReturning({ data: [{}], error: null });

    const { result, logged } = await capturingErrors(() =>
      consumeRateLimit(client, 'edge_ban_account'),
    );

    expect(result.allowed).toBe(true);
    expect(logged).toContain('unrecognised shape');
  });

  it('accepts a bare object as well as a one-row array', async () => {
    const client = clientReturning({
      data: { allowed: false, remaining: 0, retry_after_seconds: 12 },
      error: null,
    });

    expect((await consumeRateLimit(client, 'edge_delete_account')).allowed).toBe(false);
  });

  it('floors the retry hint at one second, so a client cannot be told to retry immediately', async () => {
    const client = clientReturning(row(false, 0, 0));

    expect((await consumeRateLimit(client, 'edge_send_invite')).retryAfterSeconds).toBe(1);
  });
});

describe('the budgets themselves', () => {
  it('rations the things that cost money more tightly than the things that do not', async () => {
    // Not a style rule — the ordering IS the policy. If a push fan-out is ever
    // budgeted below a Safepay Plan creation, somebody has inverted the cost
    // model, and that is worth failing a build over.
    expect(LIMITS.edge_safepay_checkout.limit).toBeLessThan(LIMITS.edge_send_invite.limit);
    expect(LIMITS.edge_send_invite.limit).toBeLessThan(LIMITS.edge_notify_group.limit);
    expect(LIMITS.edge_notify_group.limit).toBeLessThan(LIMITS.edge_notify_album.limit);
  });

  it('gives account deletion the smallest budget of all', () => {
    const smallest = Math.min(...Object.values(LIMITS).map((l) => l.limit));
    expect(LIMITS.edge_delete_account.limit).toBe(smallest);
  });

  it('has a real window on every action — a zero window is an unlimited action', () => {
    for (const [action, { limit, windowMs }] of Object.entries(LIMITS)) {
      expect(windowMs).toBeGreaterThan(0);
      expect(limit).toBeGreaterThan(0);
      expect(action).toMatch(/^edge_/);
    }
  });
});

describe('consumeLocalBudget — the in-memory limiter join uses', () => {
  beforeEach(() => {
    __resetLocalBudgets();
  });

  it('allows exactly up to the limit, and refuses the next one', () => {
    const now = 1_000_000;
    for (let i = 1; i <= 3; i++) {
      const decision = consumeLocalBudget('1.2.3.4', 3, 60_000, now);
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(3 - i);
    }
    expect(consumeLocalBudget('1.2.3.4', 3, 60_000, now).allowed).toBe(false);
  });

  it('keeps separate keys separate', () => {
    const now = 1_000_000;
    consumeLocalBudget('1.1.1.1', 1, 60_000, now);
    expect(consumeLocalBudget('1.1.1.1', 1, 60_000, now).allowed).toBe(false);
    expect(consumeLocalBudget('2.2.2.2', 1, 60_000, now).allowed).toBe(true);
  });

  it('forgives everything once the window rolls over', () => {
    const start = 1_000_000;
    consumeLocalBudget('1.2.3.4', 1, 60_000, start);
    expect(consumeLocalBudget('1.2.3.4', 1, 60_000, start + 30_000).allowed).toBe(false);
    expect(consumeLocalBudget('1.2.3.4', 1, 60_000, start + 60_001).allowed).toBe(true);
  });

  it('counts the retry hint down as the window elapses, never below one second', () => {
    const start = 1_000_000;
    consumeLocalBudget('1.2.3.4', 1, 60_000, start);
    expect(consumeLocalBudget('1.2.3.4', 1, 60_000, start).retryAfterSeconds).toBe(60);
    expect(consumeLocalBudget('1.2.3.4', 1, 60_000, start + 59_500).retryAfterSeconds).toBe(1);
  });

  it('does not grow without bound when flooded with distinct keys', () => {
    // The map is the leak this guards. A flood of one-shot keys must not be able
    // to hold memory for the whole window — and dropping a counter forgives that
    // key's spend, which is the safe direction: it can never lock anybody out.
    const now = 1_000_000;
    for (let i = 0; i < 25_000; i++) consumeLocalBudget(`ip-${i}`, 5, 60_000, now);

    // The most recent key is still tracked, so the eviction dropped older
    // entries rather than refusing to record new ones.
    expect(consumeLocalBudget('ip-24999', 5, 60_000, now).remaining).toBe(3);
    // And an early key was dropped, so the map really is bounded. 25,000 live
    // keys through a 10,000-key ceiling cannot all still be held.
    expect(consumeLocalBudget('ip-0', 5, 60_000, now).remaining).toBe(4);
  });
});

describe('callerKey', () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request('https://edge.test/join/abc', { headers });

  it('takes the FIRST x-forwarded-for entry — the client, not the proxies behind it', () => {
    // Taking the last entry would key every request through one proxy to the
    // same bucket, which turns the limiter into a regional outage.
    expect(callerKey(withHeaders({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 10.0.0.2' }))).toBe(
      '9.9.9.9',
    );
  });

  it('falls back through the other proxy headers, then to a constant', () => {
    expect(callerKey(withHeaders({ 'cf-connecting-ip': '8.8.8.8' }))).toBe('8.8.8.8');
    expect(callerKey(withHeaders({ 'x-real-ip': '7.7.7.7' }))).toBe('7.7.7.7');
    expect(callerKey(withHeaders({}))).toBe('unknown');
  });

  it('does not treat a blank forwarded-for as a key of its own', () => {
    expect(callerKey(withHeaders({ 'x-forwarded-for': '  ', 'x-real-ip': '7.7.7.7' }))).toBe(
      '7.7.7.7',
    );
  });
});

describe('tooManyRequests', () => {
  it('answers 429 with Retry-After in seconds and the same number in the body', async () => {
    const res = tooManyRequests({ allowed: false, retryAfterSeconds: 90, remaining: 0 });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    // The app reads JSON, not headers — auth-errors.ts already parses this shape
    // out of GoTrue's own 429s, so both halves have to be present.
    expect(await res.json()).toEqual({ error: 'rate_limited', retryAfterSeconds: 90 });
  });

  it('merges in the CORS headers its caller passes', async () => {
    const res = tooManyRequests(
      { allowed: false, retryAfterSeconds: 5, remaining: 0 },
      { 'Access-Control-Allow-Origin': '*' },
    );

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Retry-After')).toBe('5');
  });
});
