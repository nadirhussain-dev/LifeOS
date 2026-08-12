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

  constructor(kind: SupabaseErrorKind, message: string, code: string | null, details = null) {
    super(message);
    this.name = 'SupabaseError';
    this.kind = kind;
    this.code = code;
    this.details = details;
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

  return new SupabaseError(classify(code, message), message, code, details as never);
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

/** True when retrying the exact same request could plausibly work. */
export function isRetryable(error: unknown): boolean {
  const kind = errorKind(error);
  return kind === 'offline' || kind === 'server' || kind === 'unknown';
}
