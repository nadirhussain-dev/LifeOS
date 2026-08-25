/**
 * The edge-function half of the error classifier, and the 'rate-limited' kind.
 *
 * Written because `supabase.functions.invoke` does not fail the way the rest of
 * this module's callers do, and the difference is invisible at the call site: on
 * any non-2xx it sets `data` to null and rejects with a `FunctionsHttpError`
 * whose message is the fixed string "Edge Function returned a non-2xx status
 * code", putting the function's real body on a `Response` handed back
 * separately. Passed through `toSupabaseError` — which is what every call site
 * did — that classified as 'unknown', so the user was told to check their
 * connection for a 403, a 429 and a 500 alike. Precisely the failure the
 * module's own header says it exists to prevent, reintroduced by a different
 * transport.
 */

import {
  errorKind,
  errorMessageKey,
  errorMessageParams,
  isRetryable,
  retryAfterSeconds,
  SupabaseError,
  toEdgeFunctionError,
  toSupabaseError,
} from '@/lib/supabase-error';

/**
 * `classify()` short-circuits to 'not-configured' whenever Supabase credentials
 * are absent — correct in the app (with placeholder creds every request fails at
 * the socket, which would otherwise read as "offline" and send the user to look
 * at their wifi over a build problem) and fatal to a test, which runs with no
 * `.env` and so would see that one kind for every case below.
 *
 * Written below the import rather than above it because babel-plugin-jest-hoist
 * lifts `jest.mock` above every import regardless, so the position here is only
 * a question of which order reads better to a person.
 */
jest.mock('@/lib/env', () => ({ isSupabaseConfigured: true }));

/** What supabase-js rejects with on a non-2xx, message and all. */
const httpError = () => {
  const error = new Error('Edge Function returned a non-2xx status code');
  error.name = 'FunctionsHttpError';
  return error;
};

const response = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('toEdgeFunctionError', () => {
  it('recovers the status and the message the function itself sent', async () => {
    const error = await toEdgeFunctionError(
      httpError(),
      response(403, { error: 'not a member of this group' }),
    );

    expect(error.code).toBe('403');
    expect(error.message).toBe('not a member of this group');
    // 403 is not in the PostgREST code sets, so it lands in 'unknown' — but the
    // message is now the real one, which is the half that matters here.
    expect(error).toBeInstanceOf(SupabaseError);
  });

  it("reads the platform's own shape, which is what a failed deploy answers in", async () => {
    /*
     * The gap that let the string this function exists to replace reach a
     * user's screen. A function that fails before its own handler runs never
     * writes an `error` key: a missing deploy answers `NOT_FOUND` and a
     * module-scope throw — an unset secret, a bad URL import — answers
     * `BOOT_ERROR`, both with the explanation under `message`. Reading only
     * `error` meant those two fell through to the generic supabase-js text,
     * for the two failures where knowing which one it is matters most.
     */
    const boot = await toEdgeFunctionError(
      httpError(),
      response(500, { code: 'BOOT_ERROR', message: 'Worker failed to boot' }),
    );
    expect(boot.message).toBe('Worker failed to boot');

    const missing = await toEdgeFunctionError(
      httpError(),
      response(404, { code: 'NOT_FOUND', message: 'Function not found' }),
    );
    expect(missing.message).toBe('Function not found');
  });

  it('still prefers our own `error` key when a body carries both', async () => {
    // Our functions answer with `error`; `message` is the platform's fallback
    // and must not win over the one written for this app's users.
    const error = await toEdgeFunctionError(
      httpError(),
      response(400, { error: 'coupon expired', message: 'Bad Request' }),
    );
    expect(error.message).toBe('coupon expired');
  });

  it('classifies a 429 as rate-limited and carries the Retry-After', async () => {
    const error = await toEdgeFunctionError(
      httpError(),
      response(429, { error: 'rate_limited', retryAfterSeconds: 42 }, { 'Retry-After': '42' }),
    );

    expect(error.kind).toBe('rate-limited');
    expect(error.retryAfterSeconds).toBe(42);
    expect(retryAfterSeconds(error)).toBe(42);
  });

  it('prefers the header over the body, since every HTTP client reads the header', async () => {
    const error = await toEdgeFunctionError(
      httpError(),
      response(429, { error: 'rate_limited', retryAfterSeconds: 9 }, { 'Retry-After': '77' }),
    );

    expect(error.retryAfterSeconds).toBe(77);
  });

  it('falls back to the body when a proxy strips the header', async () => {
    const error = await toEdgeFunctionError(
      httpError(),
      response(429, { error: 'rate_limited', retryAfterSeconds: 9 }),
    );

    expect(error.retryAfterSeconds).toBe(9);
  });

  it('keeps the status when the body is not JSON at all', async () => {
    // A gateway's own HTML error page, most likely. Losing the status because
    // the body was unreadable would throw away the more useful half.
    const error = await toEdgeFunctionError(
      httpError(),
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    expect(error.code).toBe('502');
    expect(error.message).toBe('Edge Function returned a non-2xx status code');
  });

  it('does not consume the response body, so the caller can still read it', async () => {
    const res = response(429, { error: 'rate_limited', retryAfterSeconds: 5 });

    await toEdgeFunctionError(httpError(), res);

    // Cloned inside, so this does not throw "Body has already been read".
    await expect(res.json()).resolves.toEqual({ error: 'rate_limited', retryAfterSeconds: 5 });
  });

  it('falls back to toSupabaseError when there is no response — a network failure', async () => {
    const error = await toEdgeFunctionError(
      Object.assign(new Error('Network request failed'), { name: 'FunctionsFetchError' }),
      undefined,
    );

    expect(error.kind).toBe('offline');
  });

  it('passes an already-classified error straight through', async () => {
    const original = new SupabaseError('permission', 'nope', '42501');

    expect(await toEdgeFunctionError(original, response(500, {}))).toBe(original);
  });
});

describe('the rate-limited kind', () => {
  it('is NOT retryable, because every caller treats retryable as "retry now"', async () => {
    // A retry will eventually work, but not immediately — and retrying
    // immediately spends the next window too. Callers are meant to read
    // retryAfterSeconds and wait instead.
    const error = await toEdgeFunctionError(
      httpError(),
      response(429, {}, { 'Retry-After': '30' }),
    );

    expect(isRetryable(error)).toBe(false);
  });

  it('renders copy with the wait interpolated', async () => {
    const error = await toEdgeFunctionError(
      httpError(),
      response(429, {}, { 'Retry-After': '30' }),
    );

    expect(errorMessageKey(error)).toBe('errors.rate-limited');
    expect(errorMessageParams(error)).toEqual({ seconds: 30 });
  });

  it('still names a number when the server gave none, rather than leaving a hole in the sentence', async () => {
    const error = await toEdgeFunctionError(httpError(), response(429, {}));

    expect(error.retryAfterSeconds).toBeNull();
    // Copy with `{{seconds}}` showing through reads as a bug to the user.
    expect(errorMessageParams(error)).toEqual({ seconds: 60 });
  });

  it('adds no params to any other kind', () => {
    expect(errorMessageParams(new SupabaseError('offline', 'x', null))).toBeUndefined();
    expect(errorMessageParams(new SupabaseError('permission', 'x', '42501'))).toBeUndefined();
  });

  it('is reachable from a plain error carrying status 429 too', () => {
    // PostgREST and the auth client both put the status on the error itself.
    expect(errorKind({ message: 'too many', status: 429 })).toBe('rate-limited');
  });
});

describe('the existing classifications still hold', () => {
  it('keeps the PostgREST codes mapped where they were', () => {
    expect(errorKind({ code: 'PGRST202', message: 'x' })).toBe('backend-missing');
    expect(errorKind({ code: 'PGRST301', message: 'x' })).toBe('signed-out');
    expect(errorKind({ code: '42501', message: 'x' })).toBe('permission');
    expect(errorKind({ code: '23505', message: 'x' })).toBe('conflict');
  });

  it('still recognises an offline failure with no code at all', () => {
    expect(errorKind(new TypeError('Network request failed'))).toBe('offline');
  });

  it('leaves details intact rather than casting them away', () => {
    // This was `details as never`, which typechecked and meant the field was
    // only ever whatever the cast let through.
    const error = toSupabaseError({ code: '42501', message: 'denied', details: 'on table notes' });

    expect(error.details).toBe('on table notes');
    expect(error.retryAfterSeconds).toBeNull();
  });
});
