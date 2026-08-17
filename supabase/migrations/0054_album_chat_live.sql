-- ---------------------------------------------------------------------------
-- 0054 — Voice notes, delivery receipts, and the carve-out that keeps voice
--        free.
--
-- 0053 gave the chat replies, reactions, edits, read receipts and a
-- disappearing timer. Three things it did not give it, all of them the
-- difference between "a message list" and "a conversation":
--
--   1. **Voice notes.** A recording, encrypted under the album key like every
--      other body, stored as an object rather than inline.
--   2. **A delivered state.** 0053 can say "read". It cannot say "it got
--      there" — and the gap between sent and read is exactly where the
--      question "did that send?" lives.
--   3. **Presence and typing** — which are deliberately NOT here. See §0.
--
-- ## 0. Why presence and typing are not in this migration
--
-- Stated first because their absence is a decision, not an oversight, and the
-- obvious next commit is somebody adding a `last_seen_at` column.
--
-- "Who is online" and "who is typing" are carried over Realtime — presence
-- state and broadcast on the channel the client already holds open — and are
-- never written down. There is no table below for them and there should not
-- be one.
--
-- The reason is that they are the highest-frequency, highest-resolution
-- metadata this app could possibly collect: a typing indicator is a keystroke
-- timestamp, and a `last_seen_at` column is a permanent activity log for
-- every member of every album, sitting in a database the server can read in
-- full. 0053's header already concedes that read receipts let the server see
-- "who was active when", and calls that the honest cost of receipts. Presence
-- persisted to a column is that same cost multiplied by every minute of the
-- day, bought for a green dot.
--
-- Ephemeral presence gives up exactly one feature: "active 2h ago" for
-- somebody who is offline. That is the whole price, and it is worth paying.
--
-- ## 1. Voice notes are free, and photos are not
--
-- 0052 put every object in the `shared-albums` bucket behind a paid plan.
-- Voice notes land in that same bucket, so they would have been paid-only by
-- default — not by decision, but by inheriting a gate written before they
-- existed. The call here is that voice stays free.
--
-- The carve-out is by path: an object at `<album>/voice/<name>` skips the
-- premium check. That is a convention, not a proof, and a client that wanted
-- to store photographs free could name them into `voice/`. Two things bound
-- that, and neither is "nobody would":
--
--   * The shared-album byte quota (0028) still applies in full. The carve-out
--     changes who may write, never how much — so the ceiling on the abuse is
--     the ceiling that already existed.
--   * `enforce_voice_object_size` caps a single voice object at 16 MiB, which
--     is minutes of speech at the bitrate the app records and far too small to
--     make the path worth abusing for media.
--
-- Together those turn "free storage loophole" into "a smaller amount of free
-- storage than the quota already grants", which is not a loophole.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. THE VOICE MESSAGE
-- ===========================================================================

alter table public.shared_album_messages
  /**
   * What kind of body this row has. `text` is the default and every row that
   * existed before this migration is one, which is why the default is not
   * null — a nullable discriminator would make every reader handle a third
   * case that only means "written before 0054".
   */
  add column if not exists kind text not null default 'text'
    check (kind in ('text', 'voice')),
  /**
   * Object path in the `shared-albums` bucket, `<album>/voice/<id>.bin`. The
   * bytes there are ciphertext under the album key — the same discipline as a
   * photo (0028), and the reason the server can no more play a voice note than
   * it can read a message.
   *
   * Null for a text message, and null for a voice message whose upload has not
   * landed yet: the row is written first so the chat can show it sending, and
   * this column becoming non-null IS the record that the upload succeeded.
   * That makes an interrupted send resumable by finding rows where it is still
   * null, the same pattern 0026 uses for media.
   */
  add column if not exists voice_path text,
  /**
   * How long the recording runs, in milliseconds, in the clear.
   *
   * A real disclosure and worth naming: the server learns that somebody sent
   * eleven seconds of speech. It is stored plainly because the bubble has to
   * be drawn — at its right width, with its duration label — before the object
   * is downloaded and decrypted, and a chat that renders every voice note as
   * an identical grey box until it is fetched is a worse product for a
   * disclosure the ciphertext's own byte length already makes to within a
   * second or so.
   */
  add column if not exists voice_duration_ms integer
    check (voice_duration_ms is null or voice_duration_ms between 0 and 600000),
  /** Ciphertext size, for the download progress bar and nothing else. */
  add column if not exists voice_byte_length bigint;

/**
 * A voice message must eventually have a recording; a text message must never
 * have one. Enforced as a constraint rather than left to clients because the
 * two are read by different code paths, and a `kind = 'voice'` row with no
 * path and no pending upload renders as a bubble that can never play.
 *
 * `voice_path` is allowed to be null while `kind = 'voice'` — that is the
 * sending state described above. What is refused is the reverse: a text
 * message carrying a recording.
 */
alter table public.shared_album_messages
  drop constraint if exists shared_album_messages_voice_shape;
alter table public.shared_album_messages
  add constraint shared_album_messages_voice_shape check (
    kind = 'voice' or (voice_path is null and voice_duration_ms is null)
  );

-- ===========================================================================
-- 2. VOICE ESCAPES THE PREMIUM GATE
-- ===========================================================================

/**
 * Replaces 0052's gate with one that lets `<album>/voice/<name>` through.
 *
 * Everything else about it is 0052's function unchanged, including checking
 * the UPLOADER rather than the album's owner — see that migration's header for
 * why one paying member must not make an album's storage free for everybody in
 * it.
 */
create or replace function public.enforce_album_media_premium()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bucket_id <> 'shared-albums' then
    return new;
  end if;
  -- The carve-out. `<album>/voice/<name>` — segment 2, so an album literally
  -- named "voice" cannot be used to smuggle photographs past this.
  if split_part(new.name, '/', 2) = 'voice' then
    return new;
  end if;
  if not public.has_premium() then
    raise exception 'adding photos to a shared album requires a paid plan'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

/**
 * Caps one voice object at 16 MiB.
 *
 * This is what stops the carve-out above from being free storage: without it,
 * `voice/` is an unmetered door into a paid bucket. 16 MiB is minutes of
 * speech at the bitrate the recorder uses and nowhere near a photograph
 * library.
 *
 * Separate from the quota trigger rather than folded into it, because they
 * answer different questions — "is this one object sane" and "has this account
 * used too much in total" — and a single trigger answering both would have to
 * be edited by anybody changing either.
 */
create or replace function public.enforce_voice_object_size()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bucket_id <> 'shared-albums' or split_part(new.name, '/', 2) <> 'voice' then
    return new;
  end if;
  if coalesce((new.metadata->>'size')::bigint, 0) > 16 * 1024 * 1024 then
    raise exception 'a voice note is limited to 16 MiB'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_voice_object_size_trigger on storage.objects;
create trigger enforce_voice_object_size_trigger
  before insert or update on storage.objects
  for each row execute function public.enforce_voice_object_size();

-- ===========================================================================
-- 3. DELIVERY RECEIPTS
-- ===========================================================================

/**
 * How far each member's device has actually received, per album.
 *
 * Deliberately the same shape as `shared_album_reads` (0053) — a high-water
 * mark per member rather than a row per message — for the same reason: a row
 * per message per member is quadratic in the thing that grows fastest.
 *
 * Kept as its own table rather than a second column on `shared_album_reads`,
 * because the two move at different times and for different reasons. Delivered
 * is stamped by a device that fetched a page while the app was in the
 * background; read is stamped by a person looking at the screen. Sharing a row
 * would mean every delivery write also touching the read marker's
 * `updated_at`, and "when did they last read" is a question somebody will
 * eventually ask that column.
 */
create table if not exists public.shared_album_deliveries (
  album_id text not null references public.shared_albums(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  /** `created_at` of the newest message this member's device has received. */
  delivered_through bigint not null,
  updated_at bigint not null,
  primary key (album_id, user_id)
);

alter table public.shared_album_deliveries enable row level security;

/** Everybody in the album sees everybody's marker — that is what makes the
 *  second tick possible, and it is the same call 0053 made for reads. */
create policy "album_deliveries_read" on public.shared_album_deliveries
  for select using (album_id in (select public.my_album_ids()));

create policy "album_deliveries_write_own" on public.shared_album_deliveries
  for insert with check (
    user_id = (select auth.uid()) and album_id in (select public.my_album_ids())
  );

create policy "album_deliveries_update_own" on public.shared_album_deliveries
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

/**
 * Moves this member's delivery marker forward.
 *
 * `greatest`, for the same reason `mark_album_read` uses it: two devices on
 * one account report independently and out of order, and the later report
 * being older must not undo the earlier one.
 */
create or replace function public.mark_album_delivered(p_album_id text, p_through bigint)
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

  insert into public.shared_album_deliveries (album_id, user_id, delivered_through, updated_at)
  values (p_album_id, v_uid, coalesce(p_through, 0), v_now)
  on conflict (album_id, user_id) do update
     set delivered_through =
           greatest(public.shared_album_deliveries.delivered_through, excluded.delivered_through),
         updated_at = v_now;
end;
$$;

revoke all on function public.mark_album_delivered(text, bigint) from public, anon;
grant execute on function public.mark_album_delivered(text, bigint) to authenticated;

/**
 * Reading a message necessarily means it was delivered.
 *
 * Without this, a device that opens a chat and marks it read leaves the
 * delivery marker behind it, and the sender sees a blue "read" tick sitting
 * above a grey "not delivered" one — which is not a race, it is a permanent
 * contradiction, since nothing else would ever move the delivery marker for
 * messages that were already read.
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

  -- See this function's header: read implies delivered.
  insert into public.shared_album_deliveries (album_id, user_id, delivered_through, updated_at)
  values (p_album_id, v_uid, coalesce(p_through, 0), v_now)
  on conflict (album_id, user_id) do update
     set delivered_through =
           greatest(public.shared_album_deliveries.delivered_through, excluded.delivered_through),
         updated_at = v_now;
end;
$$;

revoke all on function public.mark_album_read(text, bigint) from public, anon;
grant execute on function public.mark_album_read(text, bigint) to authenticated;
