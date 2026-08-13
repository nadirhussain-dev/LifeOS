-- 0046_song_favorites_and_play_stats.sql
--
-- Adds favoriting and play tracking to the Music module. The client (see
-- database/schema.ts's ADDITIVE_COLUMNS.songs) gained the matching local
-- SQLite columns in the same change — the sync engine pushes whatever
-- columns exist locally (features/sync/services/sync-engine.ts reads
-- `PRAGMA table_info` and upserts every non-device-local one it finds), so
-- without this migration every sync of a favorited or played song fails at
-- PostgREST with an unknown-column error rather than failing loudly here.
--
-- All three are plain counters/flags on the row itself, not a join table or
-- a history table — same shape as gallery_photos.is_favorite (0016).
-- `is_favorite` is `bigint`, not a native `boolean`, to match that column and
-- everything else this app calls a boolean on the Postgres side: the SQLite
-- source of truth stores it as INTEGER 0/1, and the sync engine's upsert
-- round-trips whatever type is on each side verbatim.

alter table public.songs add column if not exists is_favorite bigint not null default 0;
alter table public.songs add column if not exists play_count bigint not null default 0;
alter table public.songs add column if not exists last_played_at bigint;
