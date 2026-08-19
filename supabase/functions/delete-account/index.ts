// Supabase Edge Function: delete-account
//
// Permanently deletes the calling user's account and all their synced rows.
// The client (features/auth/services/auth-store.ts → deleteAccount) invokes
// this; the client CANNOT call auth.admin.deleteUser, so it must run here with
// the service-role key. Required for App Store 5.1.1(v) / Google Play
// account-deletion compliance and GDPR Art. 17.
//
// Deploy:
//   supabase functions deploy delete-account
// The SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase runtime; no manual secrets needed.
//
// Requires migration 0020 to have been applied. It refuses to run otherwise,
// loudly — see below.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.
//
// ## Why there is no list of tables here any more
//
// There was one, of 15 names, while sync covered 38. It had been correct when
// it was written and was never revised as 0009 and 0016 added history and media
// tables, so deleting an account left behind every water log, the gallery and
// music libraries, all habit/goal/journal/note history, `private_entries`
// (cycle and intimacy records) and `vault_escrow` (the sealed private-space
// key). None of it was recoverable afterwards either: with the auth user gone
// and every policy keyed on `user_id = auth.uid()`, the rows answer to nobody.
//
// A list in this file is the wrong shape for the job. It has to be revised by
// whoever adds a table, months later, in a different language, in a directory
// the migration does not touch — and being wrong produces no error, no failed
// deploy and no failing test, only data that quietly outlives the person who
// asked for it to be gone.
//
// So the table list lives in the schema now: 0020 gives every per-user table
// `references auth.users(id) on delete cascade`, and deleting the auth user
// deletes the data in the same transaction. What is left here is the part a
// foreign key cannot do — checking that the guarantee is present before relying
// on it, and confirming afterwards that it held.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { consumeRateLimit, tooManyRequests } from '../_shared/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Identify the caller from their JWT.
    const authClient = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);
    const userId = userData.user.id;

    // Three an hour. Before the preflight below, which walks every table in the
    // schema counting rows — the most expensive single query any of these
    // functions runs, and the one a retry loop would be hitting.
    //
    // A rate limit on account deletion is not there to slow the user down: it
    // is there because a client that retries a request whose response was lost
    // would otherwise re-run that walk on every attempt against a uid whose
    // rows are already gone.
    const budget = await consumeRateLimit(authClient, 'edge_delete_account');
    if (!budget.allowed) return tooManyRequests(budget, corsHeaders);

    // Service-role admin client: deletes the auth user and reads the catalog.
    const admin = createClient(supabaseUrl, serviceKey);

    // Preflight. A table holding `user_id` with no foreign key to auth.users is
    // a table the cascade will not reach — either 0020 has not been applied, or
    // a later migration added a table without the constraint.
    //
    // This refuses rather than proceeding-and-reporting because the delete is
    // not retryable: once auth.admin.deleteUser has run, the uid is gone and
    // with it the only handle on whatever was missed. Better to fail with the
    // account intact and a list of what to fix.
    const { data: uncovered, error: preflightError } = await admin.rpc(
      'account_deletion_uncovered_tables',
    );
    if (preflightError) {
      return json(
        {
          error:
            'Cannot verify account deletion is complete — migration 0020 may not be applied: ' +
            preflightError.message,
        },
        500,
      );
    }
    if (Array.isArray(uncovered) && uncovered.length > 0) {
      return json(
        {
          error:
            'Refusing to delete: these tables would keep the account’s rows. ' +
            'Add the auth.users cascade (see migration 0020) first.',
          tables: uncovered,
        },
        500,
      );
    }

    // The delete itself. Cascades through every per-user table; `profiles` has
    // cascaded since 0001; `expense_group_members` and `content_reports`
    // deliberately null their reference instead, so a shared ledger keeps
    // balancing and a report outlives the account it names.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) return json({ error: deleteError.message }, 500);

    // Postflight. Every cascade has fired and every `set null` has nulled, so
    // anything still answering for this uid is something nothing reached. This
    // should be unreachable given the preflight; it is here because the whole
    // failure mode being fixed was a deletion that reported success.
    const { data: remaining, error: verifyError } = await admin.rpc('account_data_remaining', {
      p_user_id: userId,
    });
    if (verifyError) {
      return json(
        { error: `Account deleted, but the result could not be verified: ${verifyError.message}` },
        500,
      );
    }
    if (Array.isArray(remaining) && remaining.length > 0) {
      // Deliberately not a 200. The account is gone; the data is not, and the
      // operator needs to know which tables to clear by hand.
      return json({ error: 'Account deleted, but rows remain', remaining }, 500);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
