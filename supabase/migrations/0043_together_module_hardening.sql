-- 0043 — Together module hardening: two write-path gaps left open by 0041.
--
-- 1. `is_together_hub`/`relationship_start_date` rode on the fully-permissive
--    shared_albums_update policy (0027) under the claim that this "follows
--    allow_chat/allow_notes' precedent" — that precedent is actually the
--    opposite: those flags are owner-only via guard_album_permission_flags()
--    (0029, extended 0040). Extends the same guard to these two columns so a
--    non-owner member can't silently redesignate the couple's hub or rewrite
--    how long the relationship-day-counter has been running.
--
-- 2. `cycle_share_author_id` had no constraint tying it to the caller, so any
--    member could attribute fabricated cycle-share ciphertext to the OTHER
--    member's uid — the UI takes this column at face value for "whose cycle
--    is this" (see app/private/together.tsx). A member may only ever write
--    their own uid here, or clear it to null.

create or replace function public.guard_album_permission_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.allow_comments is distinct from old.allow_comments
      or new.allow_chat is distinct from old.allow_chat
      or new.allow_notes is distinct from old.allow_notes)
     and not public.is_shared_album_owner(new.id) then
    raise exception 'only the album owner can change who may comment, chat, or post notes here'
      using errcode = '42501';
  end if;

  if (new.is_together_hub is distinct from old.is_together_hub
      or new.relationship_start_date is distinct from old.relationship_start_date)
     and not public.is_shared_album_owner(new.id) then
    raise exception 'only the album owner can change the together-hub designation'
      using errcode = '42501';
  end if;

  if new.cycle_share_author_id is distinct from old.cycle_share_author_id
     and new.cycle_share_author_id is not null
     and new.cycle_share_author_id is distinct from auth.uid() then
    raise exception 'cycle_share_author_id can only be set to the caller''s own id'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
