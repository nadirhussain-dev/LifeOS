-- ---------------------------------------------------------------------------
-- 0068 — Finding out whether a push was actually delivered.
--
-- ## The gap
--
-- `notify-group` and `notify-album` treated an HTTP 200 from Expo as delivery
-- and counted it in the `sent` number they return. It is not delivery. Expo
-- answers a send with one **ticket** per message, and the ticket only says the
-- message was accepted for processing. Whether APNs or FCM took it is knowable
-- some minutes later, from a **receipt** fetched by ticket id.
--
-- Nothing fetched receipts, so nothing ever learned that a token had stopped
-- working. `push_tokens` only ever grew: an uninstall left its row behind
-- forever, every subsequent fan-out paid to send to it, and every one of those
-- sends was reported as a success. A group of four where three people have
-- reinstalled reports `sent: 4` and reaches one person.
--
-- Handling the ticket inline (0068's companion, `_shared/expo-push.ts`) catches
-- the tokens Expo already knows are dead. This table is for the rest — the ones
-- only the receipt reveals.
--
-- ## Why a table and not an inline wait
--
-- Expo asks callers to wait before reading receipts; they are not ready when
-- the send returns. An edge function that slept would hold an invocation open
-- for minutes per push, on the request path of a user action, to learn
-- something nobody is waiting for. So the ticket ids are written down and a
-- separate scheduled function reads them later.
--
-- ## Why there is no user_id
--
-- A ticket id is about a message in flight, not about a person, and the only
-- questions asked of this table are "which tickets are due a check" and "which
-- token did this one belong to". Adding an owner column would make it a log of
-- who was notified and when — a different and much more sensitive thing than
-- what this needs to be. The token is here because the token is what gets
-- deleted when the receipt comes back fatal; nothing else is.
--
-- ## Lifecycle
--
-- Rows are transient. They are inserted at send, read once by
-- `check-push-receipts`, and deleted whether the verdict was good or bad —
-- there is nothing to keep afterwards. `checked_at` exists so a receipt Expo
-- reports as still-pending can be retried rather than dropped, and the sweep
-- discards anything older than a day regardless: a ticket Expo cannot resolve
-- in 24 hours is not going to resolve.
-- ---------------------------------------------------------------------------

create table if not exists public.push_receipts (
  -- Expo's ticket id is the natural key: one row per accepted message, and a
  -- retry of the same ticket must not duplicate.
  ticket_id text primary key,
  -- The device this message went to, so a fatal receipt has something to act
  -- on. Cascades, so releasing a token cannot leave rows pointing at nothing.
  token text not null references public.push_tokens(token) on delete cascade,
  created_at bigint not null,
  -- When a check last looked and found the receipt not yet ready. Null until
  -- the first attempt.
  checked_at bigint
);

create index if not exists push_receipts_created_idx on public.push_receipts (created_at);

alter table public.push_receipts enable row level security;

-- ---------------------------------------------------------------------------
-- No policy is granted to anyone.
--
-- Deliberate, and not an oversight. RLS with no permissive policy denies every
-- authenticated and anonymous request, which is exactly right here: nothing in
-- the app reads or writes this table. Only the edge functions touch it, and
-- they do so with the service-role key, which bypasses RLS entirely.
--
-- Stating that as "no policy" rather than as a policy nobody matches keeps the
-- intent legible — a future reader looking for the policy that scopes this to
-- its owner will find this comment instead of writing one.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- SWEEP
--
-- Belt and braces under `check-push-receipts`, which deletes each row as it
-- resolves it. If that function stops running — unscheduled, erroring, or
-- simply never deployed — this table would otherwise grow one row per push
-- forever. Called by the checker at the start of each run, so the cleanup
-- cannot be forgotten separately from the thing that needs it.
-- ===========================================================================
create or replace function public.sweep_push_receipts(p_before bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.push_receipts where created_at < p_before;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.sweep_push_receipts(bigint) from public, anon, authenticated;
