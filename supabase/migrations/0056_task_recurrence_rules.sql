-- ---------------------------------------------------------------------------
-- 0056 — Carry the richer task repeat rules.
--
-- The device gained three columns on `tasks`: an interval ("every 2 weeks"),
-- a set of chosen weekdays ("Mon/Wed/Fri"), and an anchor deciding whether the
-- next occurrence counts from the due date or from the day the task was
-- actually completed. This is the server half.
--
-- ## Why this cannot wait for the feature to be "finished"
--
-- The sync engine pushes raw rows with no per-column mapping — it builds the
-- upsert from the local column names. A local column with no server counterpart
-- is therefore not a missing feature on the second device; it is a failed push
-- for the whole tasks table, every launch, for anyone who upgrades. The
-- schemas have to move together even though nothing reads these values
-- server-side.
--
-- ## Types
--
-- Mirroring the on-device SQLite exactly, as everywhere else in this schema:
-- INTEGER -> bigint, TEXT -> text. `recurrence_days_of_week` is a JSON array
-- in a text column rather than `bigint[]`, because the engine moves the value
-- through verbatim and a Postgres array would arrive on the next device as a
-- string SQLite cannot parse back.
--
-- ## Defaults
--
-- Chosen so that a row written by an older build, which does not know these
-- columns exist, describes the behaviour it actually had: interval 1 anchored
-- on the due date is precisely the old four-case frequency switch. That
-- matters because two versions of the app will be pushing to this table at the
-- same time for as long as anyone delays an update, and the older one must not
-- silently rewrite a fortnightly rule into a weekly one.
--
-- No RLS work here: `public.tasks` already has its owner policies from 0001,
-- and they are written against `user_id` rather than any column below.
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists recurrence_interval bigint not null default 1,
  add column if not exists recurrence_days_of_week text,
  add column if not exists recurrence_anchor text not null default 'due_date';
