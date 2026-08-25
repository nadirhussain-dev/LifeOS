/**
 * Turns a Supabase failure into something a person can act on.
 *
 * Every server-backed call used to end at `throw new Error(error.message)`, and
 * every screen rendered the same sentence for whatever came back: "check your
 * connection and try again". That sentence was wrong far more often than it was
 * right. A missing RPC, an expired session and a row-level-security refusal all
 * look identical to the user, and all of them point at the network — the one
 * thing that was working. The Split module made this concrete: a group-creation
 * bug (see supabase/migrations/0007) surfaced as a connection error, so the only
 * suggested remedy was the only one that could never help.
 *
 * `code` is what makes the distinction possible, so it has to survive the throw
 * — hence SupabaseError rather than a bare Error. `kind` is then the small,
 * closed set the UI actually branches on, and each kind maps to copy that names
 * a cause and a next step.
 */

import { isSupabaseConfigured } from '@/lib/env';

export type SupabaseErrorKind =
  /** The device has no working connection. The only kind the old copy fitted. */
  | 'offline'
  /** This build shipped without Supabase credentials — guest-only. */
  | 'not-configured'
  /** Signed out, or the token expired mid-request. */
  | 'signed-out'
  /** Reached the server, but the schema/function isn't there: migrations
   *  haven't been applied to this project. */
  | 'backend-missing'
  /** Reached the server and it refused: RLS, or not a member of this group. */
  | 'permission'
  /** Uniqueness/constraint violation — usually "that already exists". */
  | 'conflict'
  /** Refused for going too fast, not for being wrong. The only kind that comes
   *  with a specific "try again in N seconds", which is why it is not folded
   *  into 'server': retrying immediately is exactly what must not happen, and
   *  every other retryable kind invites it. */
  | 'rate-limited'
  /** The server errored. Ours to fix, not the user's. */
  | 'server'
  | 'unknown';

/** Shape of a PostgrestError / FunctionsError, without importing their types. */
type RawError = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
  name?: unknown;
};

export class SupabaseError extends Error {
  readonly kind: SupabaseErrorKind;
  /** Postgres SQLSTATE or PostgREST code, kept for logs and triage. */
  readonly code: string | null;
  readonly details: string | null;
  /** Set only on 'rate-limited'. Seconds, from the server's own Retry-After —
   *  never guessed, because a guess that is too short spends the next window
   *  too. */
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: SupabaseErrorKind,
    message: string,
    code: string | null,
    details: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'SupabaseError';
    this.kind = kind;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * PostgREST codes.
 * PGRST202 — no function matching that name/signature in the schema cache. In
 *   practice: the RPC migration was never run against this project.
 * PGRST205 — same, for a table.
 * PGRST301 — JWT missing or expired.
 * PGRST116 — zero rows where exactly one was required; with RLS on, this is
 *   nearly always "you can't see that row" rather than "it doesn't exist".
 */
const BACKEND_MISSING = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);
const PERMISSION = new Set(['42501', 'PGRST116']);
const SIGNED_OUT = new Set(['PGRST301', '28000']);
const CONFLICT = new Set(['23505', '23503', '23514']);

/** Network failures surface as a TypeError from fetch with no code at all.
 *  Exported so callers with an error shape this file's own `classify()`
 *  doesn't cover (Supabase Auth's errors, not PostgREST's) can still ask
 *  "does this look like it never reached the server" without duplicating
 *  the string list — see auth-store.ts's `isRetryableAuthError`. */
export function looksOffline(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('network request failed') ||
    m.includes('failed to fetch') ||
    m.includes('fetch failed') ||
    m.includes('networkerror') ||
    m.includes('timeout') ||
    m.includes('abort')
  );
}

function classify(code: string | null, message: string): SupabaseErrorKind {
  // Checked first: with placeholder credentials every request fails at the
  // socket, which would otherwise read as "offline" and send the user to look
  // at their wifi over a build-configuration problem.
  if (!isSupabaseConfigured) return 'not-configured';

  if (code) {
    if (BACKEND_MISSING.has(code)) return 'backend-missing';
    if (SIGNED_OUT.has(code)) return 'signed-out';
    if (PERMISSION.has(code)) return 'permission';
    if (CONFLICT.has(code)) return 'conflict';
    if (code === '429') return 'rate-limited';
    // Everything else in the 5xx/PGRST5xx space is a server fault.
    if (code.startsWith('PGRST5') || code === '57014') return 'server';
  }

  if (looksOffline(message)) return 'offline';

  // A raised `raise exception` from one of our own RPCs arrives as P0001 with
  // the message we wrote — worth treating as a server fault so it gets reported
  // rather than blamed on the user's connection.
  if (code === 'P0001') return 'server';

  return 'unknown';
}

/** Normalises anything a Supabase call can reject with into a SupabaseError. */
export function toSupabaseError(error: unknown): SupabaseError {
  if (error instanceof SupabaseError) return error;

  const raw = (typeof error === 'object' && error !== null ? error : {}) as RawError;
  const message =
    typeof raw.message === 'string' && raw.message
      ? raw.message
      : error instanceof Error
        ? error.message
        : String(error ?? 'unknown error');

  const code =
    typeof raw.code === 'string' && raw.code
      ? raw.code
      : typeof raw.status === 'number'
        ? String(raw.status)
        : null;

  const details = typeof raw.details === 'string' ? raw.details : null;

  return new SupabaseError(classify(code, message), message, code, details);
}

/** The kind of a failure, for anything that already caught it loosely. */
export function errorKind(error: unknown): SupabaseErrorKind {
  return toSupabaseError(error).kind;
}

/**
 * i18n key for the user-facing explanation. Deliberately one key per kind:
 * screens should not be inventing their own wording for "offline".
 */
export function errorMessageKey(error: unknown): string {
  return `errors.${errorKind(error)}`;
}

/**
 * Interpolation values the key above may need. Empty for every kind but
 * 'rate-limited', whose copy names the wait.
 *
 * Returned alongside the key rather than baked into it, because a caller that
 * forgets it renders the literal `{{seconds}}` on screen — so the pair is what
 * gets passed to `t()`, and there is exactly one place that knows which kinds
 * take params. Falls back to 60 rather than omitting the number: copy with a
 * hole in it reads as a bug, and the header is only missing when a proxy ate it.
 */
export function errorMessageParams(error: unknown): { seconds: number } | undefined {
  const wait = retryAfterSeconds(error);
  return errorKind(error) === 'rate-limited' ? { seconds: wait ?? 60 } : undefined;
}

/**
 * True when retrying the exact same request could plausibly work.
 *
 * 'rate-limited' is deliberately absent. A retry *will* eventually work, but not
 * now, and every caller of this treats `true` as "retry immediately" — which for
 * a rate limit spends the next window as well. Ask `retryAfterSeconds` instead
 * and wait.
 */
export function isRetryable(error: unknown): boolean {
  const kind = errorKind(error);
  return kind === 'offline' || kind === 'server' || kind === 'unknown';
}

/** Seconds to wait before retrying, when the server said so. Null otherwise. */
export function retryAfterSeconds(error: unknown): number | null {
  return error instanceof SupabaseError ? error.retryAfterSeconds : null;
}

// ---------------------------------------------------------------------------
// Edge functions
// ---------------------------------------------------------------------------

/**
 * Normalises a `supabase.functions.invoke` failure, reading the function's own
 * response body.
 *
 * Needed because `invoke` does NOT behave like an RPC call on a non-2xx: it
 * throws a `FunctionsHttpError` whose message is the literal string "Edge
 * Function returned a non-2xx status code", sets `data` to null, and puts the
 * real body on the `Response` it hands back separately. Passed through
 * `toSupabaseError`, every 400, 403, 429 and 500 an edge function can return
 * therefore classified as 'unknown' and told the user to check their connection
 * — the exact failure this module was written to stop, reintroduced by a
 * different transport.
 *
 * So the status is read from the response, and the body is read for the
 * `{ error, retryAfterSeconds }` shape our own functions answer with.
 *
 * Async because reading a Response body is. Callers already `await` the invoke,
 * so this costs them nothing.
 */
export async function toEdgeFunctionError(
  error: unknown,
  response?: Response,
): Promise<SupabaseError> {
  if (error instanceof SupabaseError) return error;
  if (!response) return toSupabaseError(error);

  let body: {
    error?: unknown;
    message?: unknown;
    retryAfterSeconds?: unknown;
  } = {};
  try {
    // Cloned: the caller may want the body too, and a Response body can only be
    // read once.
    body = await response.clone().json();
  } catch {
    // A non-JSON body (a gateway's own HTML error page, most likely) is not a
    // reason to lose the status, which is the more useful half anyway.
  }

  /*
   * `error` first, then `message`, then whatever the throw carried.
   *
   * `error` is the key our own functions answer with, so it stays the first
   * reading. `message` is the platform's, and skipping it is why this whole
   * mechanism could still surface the string it was written to replace: a
   * function that fails *before* its own handler runs never gets to write an
   * `error` key. A missing deploy answers `{"code":"NOT_FOUND","message":"..."}`
   * and a module-scope throw — an unset secret, a bad import — answers
   * `{"code":"BOOT_ERROR","message":"Worker failed to boot"}`. Both are 4xx/5xx
   * with a perfectly good explanation in a key nothing was reading, so the user
   * got "Edge Function returned a non-2xx status code" for the two failures
   * where knowing which one it was matters most.
   */
  const message =
    typeof body.error === 'string' && body.error
      ? body.error
      : typeof body.message === 'string' && body.message
        ? body.message
        : error instanceof Error
          ? error.message
          : String(error ?? 'unknown error');

  const code = String(response.status);

  // The header is authoritative — it is what every HTTP client already
  // understands — and the body is the fallback, since the app reads JSON.
  const header = Number(response.headers.get('Retry-After'));
  const fromBody = Number(body.retryAfterSeconds);
  const retryAfter =
    Number.isFinite(header) && header > 0
      ? header
      : Number.isFinite(fromBody) && fromBody > 0
        ? fromBody
        : null;

  return new SupabaseError(classify(code, message), message, code, null, retryAfter);
}
