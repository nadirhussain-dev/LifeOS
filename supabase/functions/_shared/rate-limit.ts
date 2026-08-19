// Rate limiting for the edge functions.
//
// Every function here authenticates its caller and then does work that costs
// real money or reputation per call — a Safepay Plan object, a Resend email, an
// Expo push fan-out — and until this file existed, not one of them bounded how
// often. 0062's own header has the full account of why `note_abuse_action`
// (0010) could not be reused for it.
//
// Two mechanisms, because there are two kinds of caller:
//
//   • `consumeRateLimit` — durable, database-backed, keyed on the caller's own
//     uid. Correct for anything authenticated: the count survives cold starts
//     and is shared across every isolate, which is what matters when the abuse
//     is authenticated and the cost is per-request.
//
//   • `consumeLocalBudget` — in-memory, per-isolate, keyed on whatever the
//     caller supplies (an IP, in practice). The only option for `join`, which
//     is unauthenticated, has no uid to key on, and — importantly — talks to no
//     database at all. Giving it a database round-trip per request to protect
//     it from floods would hand the flood a better target than the one it
//     started with. Best-effort by construction, and documented as such at its
//     call site rather than pretended otherwise.
//
// This file is Deno (URL imports in its callers) and is excluded from the app's
// tsconfig, same as everything else under supabase/functions/.

/** The shape both mechanisms answer with. */
export type RateLimitDecision = {
  allowed: boolean;
  /** Seconds until the caller's window rolls over. Always ≥ 1. */
  retryAfterSeconds: number;
  /** Calls left in this window, or null when the limiter could not say. */
  remaining: number | null;
};

/** Minimal shape of the supabase-js client this needs — `rpc` and nothing
 *  else, so a caller can pass whichever of its two clients is at hand. */
type RpcClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type RateLimitAction =
  | 'edge_safepay_checkout'
  | 'edge_safepay_cancel'
  | 'edge_send_invite'
  | 'edge_notify_group'
  | 'edge_notify_album'
  | 'edge_ban_account'
  | 'edge_delete_account';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The budgets, in one place so they can be compared against each other rather
 * than discovered one function at a time.
 *
 * Every number is "generous for a person, ruinous for a script". They are per
 * account per hour, and the thing each one is actually protecting is named,
 * because that is what should decide the number if it ever changes:
 */
export const LIMITS: Record<RateLimitAction, { limit: number; windowMs: number }> = {
  /** A Safepay Plan object + a checkout_intents row. Somebody comparing plans
   *  and changing their mind is a handful of these; nobody subscribes ten times
   *  an hour. */
  edge_safepay_checkout: { limit: 10, windowMs: HOUR_MS },
  /** Cheap, but it reaches the payment provider, so it is not free. */
  edge_safepay_cancel: { limit: 10, windowMs: HOUR_MS },
  /** Real email from our sending domain. The cost of getting this wrong is not
   *  the bill, it is the domain reputation, which does not come back quickly. */
  edge_send_invite: { limit: 20, windowMs: HOUR_MS },
  /** Push fan-out per shared-expense write. A busy group settling up is maybe
   *  a few dozen. */
  edge_notify_group: { limit: 120, windowMs: HOUR_MS },
  /** Higher than notify-group because this one is chat: a fast back-and-forth
   *  in an album genuinely produces a push per message. */
  edge_notify_album: { limit: 240, windowMs: HOUR_MS },
  /** Admin-gated already. This is not about the admin, it is about a stolen
   *  admin session not being able to ban the whole user table in a loop. */
  edge_ban_account: { limit: 60, windowMs: HOUR_MS },
  /** Irreversible and runs a table-by-table preflight over the whole schema.
   *  You get three attempts an hour, which is two more than anyone needs. */
  edge_delete_account: { limit: 3, windowMs: HOUR_MS },
};

/**
 * Spends one unit of the caller's budget for `action`.
 *
 * The client must carry the caller's JWT — `consume_rate_limit` reads
 * `auth.uid()` rather than taking an id, so passing a bare service-role client
 * gets a `sign in first` error, not somebody else's bucket.
 *
 * ## Fails open, deliberately
 *
 * If the RPC itself errors — the migration is not applied yet, the connection
 * pool is exhausted, PostgREST is having a moment — this returns `allowed`. A
 * limiter is a defence, not an authorization gate: the caller has already been
 * authenticated and authorized by the time this runs, and every one of these
 * functions has a correct answer for "this person is allowed to do this". Fail
 * closed and a database hiccup becomes "nobody can subscribe" and "no
 * invitation sends", which is a worse outage than the abuse this prevents.
 *
 * The error is logged rather than swallowed, because "the limiter has been
 * silently off since the deploy" is the one way this file fails at its job.
 */
export async function consumeRateLimit(
  client: RpcClient,
  action: RateLimitAction,
  override?: { limit?: number; windowMs?: number },
): Promise<RateLimitDecision> {
  const { limit, windowMs } = LIMITS[action];
  const effectiveLimit = override?.limit ?? limit;
  const effectiveWindow = override?.windowMs ?? windowMs;

  const { data, error } = await client.rpc('consume_rate_limit', {
    p_action: action,
    p_limit: effectiveLimit,
    p_window_ms: effectiveWindow,
  });

  if (error) {
    console.error('rate limit check failed — allowing the call', { action, error: error.message });
    return { allowed: true, retryAfterSeconds: 1, remaining: null };
  }

  // `returns table (...)` arrives as an array of one row through PostgREST.
  const row = (Array.isArray(data) ? data[0] : data) as
    { allowed?: boolean; remaining?: number; retry_after_seconds?: number } | null | undefined;

  // A shape we do not recognise is the same situation as an error: the limiter
  // did not answer, so it does not get to refuse.
  if (!row || typeof row.allowed !== 'boolean') {
    console.error('rate limit returned an unrecognised shape — allowing the call', {
      action,
      data,
    });
    return { allowed: true, retryAfterSeconds: 1, remaining: null };
  }

  return {
    allowed: row.allowed,
    retryAfterSeconds: Math.max(1, row.retry_after_seconds ?? 1),
    remaining: typeof row.remaining === 'number' ? row.remaining : null,
  };
}

// ---------------------------------------------------------------------------
// In-memory limiter, for the unauthenticated case.
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };

/**
 * Per-isolate counters. Supabase runs many isolates and recycles them, so this
 * is a floor and not a ceiling: a distributed flood gets a multiple of the
 * limit, and a cold start forgives everything spent so far.
 *
 * That is still worth having for `join`. The thing it prevents is one source
 * hammering one isolate, which is the shape a scraper walking token guesses
 * actually takes, and it costs one map lookup rather than a database round trip
 * on a function whose entire value is that it has no dependencies.
 */
const buckets = new Map<string, Bucket>();

/** Beyond this the map is the leak, so the oldest windows are dropped. Sized so
 *  ordinary traffic never reaches it — this is a backstop against a flood of
 *  distinct keys, not a cache policy. */
const MAX_TRACKED_KEYS = 10_000;

/**
 * Eviction drops down to here rather than to exactly the limit.
 *
 * Without the gap, a flood sitting at the threshold triggers a full O(n) walk on
 * *every* subsequent request — the map goes one over, gets trimmed back to
 * exactly the limit, and the next request repeats it. Leaving 20% of headroom
 * makes the walk happen once per 2,000 new keys instead of once per key, which
 * is the difference between amortised O(1) and O(n) per request under exactly
 * the conditions this is meant to survive.
 */
const EVICT_TO_KEYS = 8_000;

/**
 * Drops expired buckets, and then live ones if the map is still over budget.
 *
 * Called ONLY when the map is over `MAX_TRACKED_KEYS`, never per request. That
 * distinction is the whole design: this walk is O(n), so running it on every
 * call makes the limiter O(n²) in the size of the flood it is supposed to be
 * cheap protection against — the limiter becoming the bottleneck is the one
 * outcome worse than not having it. A key's own expiry does not need this walk;
 * `consumeLocalBudget` handles that in O(1) when it touches the key.
 */
function evict(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still over after dropping everything expired: the keys are all live, so
  // drop in insertion order (Map iterates that way) until it fits. Losing a
  // counter forgives that key's spend, which is the correct direction to be
  // wrong in — it cannot lock anybody out.
  if (buckets.size > EVICT_TO_KEYS) {
    const excess = buckets.size - EVICT_TO_KEYS;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

/**
 * Spends one unit against an in-process bucket.
 *
 * `now` is injectable so a test can advance the clock instead of sleeping
 * through a real window.
 */
export function consumeLocalBudget(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitDecision {
  // This key's own expiry, in O(1) — the common case, and the only one that has
  // to be exact.
  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  buckets.set(key, bucket);

  // Everyone else's, amortised. An expired bucket nobody touches again lingers
  // until the map is actually under pressure, which costs a few hundred bytes
  // and saves a full walk per request.
  if (buckets.size > MAX_TRACKED_KEYS) evict(now);

  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    remaining: Math.max(0, limit - bucket.count),
  };
}

/** Only for tests — the module-level map otherwise leaks state between cases. */
export function __resetLocalBudgets(): void {
  buckets.clear();
}

/**
 * Best available identifier for an unauthenticated caller.
 *
 * `x-forwarded-for` is a list, and only the FIRST entry is the client as the
 * edge saw it; the rest are proxies, and taking the last one would key every
 * request in a region to the same bucket. It is also client-supplied and
 * therefore forgeable — which is fine for what this is used for: forging it
 * spreads your own requests across buckets, and the alternative to a forgeable
 * key is no key at all.
 */
export function callerKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}

// ---------------------------------------------------------------------------
// The response.
// ---------------------------------------------------------------------------

/**
 * The 429 every caller should return, so the header and the body agree across
 * all of them.
 *
 * `Retry-After` in seconds is the form every HTTP client already understands,
 * and it is repeated in the body because the app reads JSON, not headers —
 * `features/auth/services/auth-errors.ts` already parses exactly this shape out
 * of GoTrue's own 429s, so the client side of this is written.
 */
export function tooManyRequests(
  decision: RateLimitDecision,
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({
      error: 'rate_limited',
      retryAfterSeconds: decision.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Retry-After': String(decision.retryAfterSeconds),
      },
    },
  );
}
