-- 0035 — Cloud media backup becomes a Plus feature.
--
-- The business line, stated plainly: keeping data on-device costs nothing
-- and stays free forever. Ordinary app data (habits, tasks, journal,
-- budget — everything in sync-tables.ts) and a profile picture
-- (features/profile/services/avatar.ts, its own bucket, never touched by
-- this) keep syncing free on every plan, always. The one thing with a real,
-- unbounded storage cost is somebody's photo and audio library, and that is
-- the one thing this migration gates.
--
-- `enforce_media_quota()` (0026, already replaced once by 0030 for the
-- quota number) gets the same treatment: a body replacement, same trigger,
-- same signature. A free account's upload is now refused outright, before
-- the byte-quota check ever runs — not "you get 0 bytes", but "this needs a
-- paid plan", which is a materially different, more honest message.
--
-- Deliberately NOT applied to the `shared-albums` bucket (0028)'s trigger.
-- A shared album already has its own monetization lever — one album, two
-- members, free (0032) — and requiring Plus just to add a photo on top of
-- that would make the free tier's couple use case not work at all, which
-- defeats the point of a feature built to make couples want to use it.
-- "Your own device's discretionary backup" and "the shared space actually
-- functioning" are different things, priced differently, on purpose.

create or replace function public.enforce_media_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := (storage.foldername(new.name))[1];
  v_used bigint;
  v_incoming bigint := coalesce((new.metadata->>'size')::bigint, 0);
begin
  if new.bucket_id <> 'media' then
    return new;
  end if;

  if public.my_plan_id() = 'free' then
    raise exception 'media backup requires a paid plan'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum((o.metadata->>'size')::bigint), 0)
    into v_used
    from storage.objects o
   where o.bucket_id = 'media'
     and (storage.foldername(o.name))[1] = v_uid;

  if v_used + v_incoming > public.media_quota_bytes() then
    raise exception 'media storage quota exceeded'
      using errcode = 'disk_full';
  end if;

  return new;
end;
$$;
