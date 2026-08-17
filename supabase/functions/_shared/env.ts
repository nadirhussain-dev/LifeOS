/**
 * Reading secrets that are allowed to be absent.
 *
 * `Deno.env.get('X') ?? fallback` is the obvious form and it is wrong here.
 * Both ways secrets reach these functions — `npm run secrets:push` and
 * `scripts/configure-auth.mjs` — push the whole of `supabase/.env` with
 * `supabase secrets set --env-file`, which sets *every* key in the file,
 * including the ones deliberately left blank. Those arrive as empty strings,
 * and an empty string is not null, so `??` hands it straight through as though
 * it were a real value.
 *
 * The failure that produces is quiet and specific: an empty
 * `APP_INVITE_BASE_URL` does not fall back to the project's own landing page,
 * it builds every invitation link as `/<token>`. Nothing errors. The email
 * sends. The link goes nowhere.
 */

/** The secret, or null if it is unset, empty, or only whitespace. */
export const optionalSecret = (name: string): string | null => {
  const value = (Deno.env.get(name) ?? '').trim();
  return value || null;
};
