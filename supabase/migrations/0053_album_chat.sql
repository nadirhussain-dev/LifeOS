-- ---------------------------------------------------------------------------
-- 0053 — The album chat grows up: replies, reactions, edits, receipts, and
--        messages that disappear on a timer the album sets.
--
-- 0029 gave the chat one shape: a row with a ciphertext body, a soft `deleted_at`,
-- and realtime. Everything below is additive to that row or beside it; nothing
-- changes what a body is or who can read one, and the server still cannot read
-- a single message — every human-authored string here stays client-encrypted
-- under the album key.
--
-- ## Disappearing messages are a SOFT delete
--
-- Stated first because it is the decision most likely to be "corrected" by
-- somebody later who assumes disappearing must mean `delete from`.
--
-- When a message's timer passes it is stamped `disappeared_at` and stops being
-- returned. The row stays. Two reasons, and neither is squeamishness:
--
--  1. **A hard delete cannot be undone by anybody, including us.** A timer set
--     to the wrong unit — minutes where hours were meant — destroys a
--     conversation permanently and irrecoverably, and the person it happens to
--     has no recourse and no evidence. A soft delete makes that a support
--     question rather than a bereavement.
--  2. **It is not a weaker privacy promise than it looks.** The body is
--     ciphertext the server has never been able to read, and clients stop
--     showing it the moment it expires. What a hard delete would additionally
--     buy is protection against somebody with direct database access AND the
--     album key, which is a threat model the album's own design already says
--     it does not cover.
--
-- The sweep is therefore an UPDATE, and `expire_album_messages()` says so.
--
-- ## Receipts leak metadata, and that is not hidden
--
-- `shared_album_message_reads` records that a user read a message at a time.
-- The server cannot read the message, but it can now see who was active when,
-- which it could not before. That is the cost of read receipts and there is no
-- version of them that avoids it — the honest thing is to write it down here
-- rather than let it be discovered.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. THE MESSAGE ROW
-- ===========================================================================

alter table public.shared_album_messages
  /** The message this one answers. `on delete set null` rather than cascade: a
   *  reply is still a thing somebody said, and deleting the message it quoted
   *  must not delete the answer to it. */
  add column if not exists reply_to_id text
    references public.shared_album_messages(id) on delete set null,
  /** Stamped when the author rewrites the body. Distinct from `updated_at`,
   *  which any write touches — clients show "edited" from this and would show
   *  it on every reaction if they used the other. */
  add column if not exists edited_at bigint,
  /** Epoch ms this message is due to disappear, copied from the album's timer
   *  at insert. Held per message, not read live from the album, so changing the
   *  album's timer never retroactively expires what was already said under the
   *  old one. */
  add column if not exists expires_at bigint,
  /** Epoch ms the timer was actually applied. The soft delete — see header. */
  add column if not exists disappeared_at bigint;

/** The sweep's working set: due, not yet swept. Partial, so it stays small
 *  however large the table gets. */
create index if not exists shared_album_messages_expiry_idx
  on public.shared_album_messages (expires_at)
  where expires_at is not null and disappeared_at is null;

alter table public.shared_albums
  /**
   * How long a message in this album lives, in seconds. Null = forever, which
   * is the default and stays the default: a chat that starts deleting itself
   * because a feature shipped would be a betrayal of everyone already using it.
   */
  add column if not exists disappear_after_seconds integer
    check (disappear_after_seconds is null or disappear_after_seconds between 5 and 31536000);

-- ===========================================================================
-- 2. REACTIONS
-- ===========================================================================

/**
 * One row per (message, person, emoji).
 *
 * The emoji is stored in the clear, and that is a real disclosure: the server
 * learns that somebody reacted with 👍 even though it cannot read what they
 * reacted to. Encrypting it under the album key was the alternative and it buys
 * very little — a set of a dozen possible values is trivially distinguishable
 * by ciphertext length and frequency — at the cost of making "how many people
 * reacted with what" impossible to count without downloading every reaction.
 * The primary key is the deduplication: reacting twice with the same emoji is
 * the same fact, not two.
 */
create table if not exists public.shared_album_message_reactions (
  message_id text not null references public.shared_album_messages(id) on delete cascade,
  album_id text not null references public.shared_albums(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 16),
  created_at bigint not null,
  primary key (message_id, user_id, emoji)
);

create index if not exists shared_album_message_reactions_message_idx
  on public.shared_album_message_reactions (message_id);

alter table public.shared_album_message_reactions enable row level security;

create policy "album_reactions_read" on public.shared_album_message_reactions
  for select using (album_id in (select public.my_album_ids()));

create policy "album_reactions_write" on public.shared_album_message_reactions
  for insert with check (
    user_id = (select auth.uid()) and album_id in (select public.my_album_ids())
  );

/** Only your own, and only ever removal — a reaction cannot be edited into a
 *  different one, it is removed and another is added. */
create policy "album_reactions_delete_own" on public.shared_album_message_reactions
  for delete using (user_id = (select auth.uid()));

-- ===========================================================================
-- 3. READ RECEIPTS
-- ===========================================================================

/**
 * The furthest point each member has read to, per album.
 *
 * One row per (album, member) holding a high-water mark, rather than one row
 * per message read. A per-message table is the obvious design and is quadratic
 * in the thing that grows fastest — a hundred-message backlog opened by five
 * people writes five hundred rows to say something two numbers already say.
 */
create table if not exists public.shared_album_reads (
  album_id text not null references public.shared_albums(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  /** `created_at` of the newest message this member has seen. */
  read_through bigint not null,
  updated_at bigint not null,
  primary key (album_id, user_id)
);

alter table public.shared_album_reads enable row level security;

/** Everybody in the album sees everybody's marker — that is what a receipt is
 *  for, and hiding it from the person it is about would be strange. */
create policy "album_reads_read" on public.shared_album_reads
  for select using (album_id in (select public.my_album_ids()));

create policy "album_reads_write_own" on public.shared_album_reads
  for insert with check (
    user_id = (select auth.uid()) and album_id in (select public.my_album_ids())
  );

create policy "album_reads_update_own" on public.shared_album_reads
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

/**
 * Moves this member's marker forward.
 *
 * `greatest` rather than a plain assignment: opening an old message must not
 * un-read the newer ones above it, and two devices reporting out of order must
 * not fight.
 */
create or replace function public.mark_album_read(p_album_id text, p_through bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  if p_album_id not in (select public.my_album_ids()) then
    raise exception 'not a member of this album' using errcode = 'insufficient_privilege';
  end if;

  insert into public.shared_album_reads (album_id, user_id, read_through, updated_at)
  values (p_album_id, v_uid, coalesce(p_through, 0), v_now)
  on conflict (album_id, user_id) do update
     set read_through = greatest(public.shared_album_reads.read_through, excluded.read_through),
         updated_at = v_now;
end;
$$;

revoke all on function public.mark_album_read(text, bigint) from public, anon;
grant execute on function public.mark_album_read(text, bigint) to authenticated;

-- ===========================================================================
-- 4. DISAPPEARING — THE SWEEP
-- ===========================================================================

/**
 * Soft-deletes every message whose timer has passed. **UPDATE, never DELETE**
 * — see this file's header for why, before changing it.
 *
 * Runs for the caller's own albums only, and is safe to call from any client at
 * any time: it is idempotent (a swept row no longer matches), it cannot touch a
 * message that is not due, and it holds no state of its own. Clients call it on
 * opening a chat, which means expiry does not depend on a scheduler existing —
 * and a cron job can call it too without the two interfering.
 *
 * Returns the number swept so a caller can decide whether to refetch.
 */
create or replace function public.expire_album_messages(p_album_id text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  update public.shared_album_messages m
     set disappeared_at = v_now,
         updated_at = v_now
   where m.disappeared_at is null
     and m.expires_at is not null
     and m.expires_at <= v_now
     and m.album_id in (select public.my_album_ids())
     and (p_album_id is null or m.album_id = p_album_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_album_messages(text) from public, anon;
grant execute on function public.expire_album_messages(text) to authenticated;

/**
 * Sets or clears an album's timer. Owner only — a disappearing-message setting
 * any member could flip is one a member can use to destroy the record of a
 * conversation the others wanted kept.
 *
 * Only ever affects messages sent AFTER it: `expires_at` is stamped at insert
 * (see `stamp_message_expiry`), so nothing already said is re-dated by this.
 */
create or replace function public.set_album_disappearing(
  p_album_id text,
  p_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shared_album_owner(p_album_id) then
    raise exception 'only the album owner may change this'
      using errcode = 'insufficient_privilege';
  end if;
  if p_seconds is not null and (p_seconds < 5 or p_seconds > 31536000) then
    raise exception 'timer out of range' using errcode = 'invalid_parameter_value';
  end if;

  update public.shared_albums
     set disappear_after_seconds = p_seconds
   where id = p_album_id;
end;
$$;

revoke all on function public.set_album_disappearing(text, integer) from public, anon;
grant execute on function public.set_album_disappearing(text, integer) to authenticated;

/**
 * Stamps a new message with its own deadline, from the album's timer.
 *
 * Server-side rather than client-side because a client that "forgets" to set
 * `expires_at` would otherwise post a permanent message into an album that
 * everybody in it believes is ephemeral. Being able to opt out of a disappearing
 * chat by using a modified client is exactly the failure this trigger exists to
 * prevent, and it costs one lookup per insert.
 */
create or replace function public.stamp_message_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds integer;
begin
  select disappear_after_seconds into v_seconds
    from public.shared_albums where id = new.album_id;

  if v_seconds is null then
    new.expires_at := null;
  else
    new.expires_at := new.created_at + (v_seconds::bigint * 1000);
  end if;

  return new;
end;
$$;

drop trigger if exists stamp_message_expiry_trigger on public.shared_album_messages;
create trigger stamp_message_expiry_trigger
  before insert on public.shared_album_messages
  for each row execute function public.stamp_message_expiry();

-- ===========================================================================
-- 5. EDITING
-- ===========================================================================

/**
 * Rewrites your own message.
 *
 * The author check is the whole function: `shared_album_messages_update`
 * (0029) already allows a member to update rows in their album, which is what
 * a soft delete needs, and that is broader than editing should be. Editing
 * somebody else's words while their name stays on them is the one operation in
 * a chat that is worse than deleting them.
 */
create or replace function public.edit_album_message(
  p_message_id text,
  p_body_ciphertext text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_author uuid;
begin
  select author_id into v_author
    from public.shared_album_messages where id = p_message_id;

  if v_author is null or v_author <> auth.uid() then
    raise exception 'only the author may edit a message'
      using errcode = 'insufficient_privilege';
  end if;
  if p_body_ciphertext is null or length(p_body_ciphertext) = 0 then
    raise exception 'an empty message is a delete, not an edit'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.shared_album_messages
     set body_ciphertext = p_body_ciphertext,
         edited_at = v_now,
         updated_at = v_now
   where id = p_message_id;
end;
$$;

revoke all on function public.edit_album_message(text, text) from public, anon;
grant execute on function public.edit_album_message(text, text) to authenticated;

-- ===========================================================================
-- 6. REALTIME
-- ===========================================================================

-- Reactions and receipts arrive the same way messages already do (0029), or a
-- reaction added on one phone is invisible on the other until something else
-- forces a refetch.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'shared_album_message_reactions'
    ) then
      alter publication supabase_realtime add table public.shared_album_message_reactions;
    end if;
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'shared_album_reads'
    ) then
      alter publication supabase_realtime add table public.shared_album_reads;
    end if;
  end if;
end $$;
