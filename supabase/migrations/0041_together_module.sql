-- 0041 — The "Together" module: turns one shared album into a couple's
-- dedicated relationship hub instead of "Together" being nothing more than
-- TogetherStrip's day-count strip inside an arbitrary album screen.
--
-- No new table. `is_together_hub` marks which one shared album (if any) a
-- member has designated as "us" — a plain boolean on the same row every
-- other album setting already lives on, following allow_chat/allow_notes'
-- precedent (0029/0040): the existing `shared_albums_update` policy already
-- lets any member set it, same as those flags, so no new RLS is needed.
-- `relationship_start_date` exists because an album's own `created_at` is
-- when the *space* was made, not when the relationship started — a couple
-- setting this up six years in shouldn't have their day-counter reset to
-- zero.
--
-- `cycle_share_ciphertext`/`cycle_share_updated_at` back the opt-in "share
-- cycle status with partner" toggle: a small, separately-encrypted summary
-- (day-of-cycle and predicted next start only — never raw entries) that
-- only the album's own members can decrypt, same E2E discipline as every
-- other ciphertext column on this table.

alter table public.shared_albums
  add column if not exists relationship_start_date bigint,
  add column if not exists is_together_hub boolean not null default false,
  add column if not exists cycle_share_ciphertext text,
  add column if not exists cycle_share_updated_at bigint,
  -- Whose cycle this is. Without it, a second member turning sharing on would
  -- silently overwrite the first member's row with no way for either client
  -- to tell whose data is currently sitting in it — including a member
  -- reading back their OWN summary and mistaking it for a partner's.
  add column if not exists cycle_share_author_id uuid references auth.users(id) on delete set null;

-- Cheap lookup for "which album (if any) has this member designated as the
-- together hub" — a handful of rows per account at most, but the app checks
-- it on every open of the Together screen.
create index if not exists shared_albums_together_hub_idx
  on public.shared_albums (is_together_hub)
  where is_together_hub = true and deleted_at is null;
