-- ---------------------------------------------------------------------------
-- 0074 — The private space ships switched off, and stays off until an operator
--        decides otherwise.
--
-- ## Why a flag rather than deleting the code
--
-- The private space is the most sensitive surface in the product: cycle,
-- recovery, intimacy, a vault, and shared albums. It is also the one whose
-- value depends on there being people to share with and enough usage to justify
-- the support and moderation load it carries. Shipping it to the first hundred
-- installs means carrying all of that risk for an audience too small to learn
-- anything from.
--
-- So it goes out dark. `module_flags` already does exactly this job — one row,
-- one boolean, flipped from the operator console with no release — and 0011
-- established the rule these rows exist to invert: **an absent row means
-- enabled**, so that a new module ships working rather than waiting on a
-- migration. That default is right for an ordinary module and wrong for this
-- one, which is why every id here gets an explicit row.
--
-- ## Absent, not locked
--
-- `private-modules.ts` opens with the rule this migration has to respect: a
-- greyed-out "🔒 Cycle" tells a snooping partner exactly what is being hidden,
-- which is the thing the feature exists to prevent. The client honours that —
-- `useModuleAccess` returns `disabled` and the entry point renders nothing at
-- all — so a disabled private space looks like an app that never had one.
--
-- The `message` column is therefore left null on purpose. Everywhere else it is
-- the operator's explanation for an outage; here it would be a sentence
-- describing a feature the user is not supposed to know about.
--
-- ## What an operator does later
--
-- One switch per row in the console, or the umbrella `private` row on its own —
-- which gates the whole space regardless of the five beneath it, so turning the
-- programme on is one tap rather than six, and turning it off in a hurry is
-- also one.
-- ---------------------------------------------------------------------------

/*
 * `actor` is nullable and null here means the deploy rather than a person.
 *
 * Every other row in this table is written by `admin_set_module_flag`, which
 * stamps `auth.uid()`. A migration has no session, and inventing one — stamping
 * the owner, say — would put a name against a decision they did not make in a
 * table whose whole purpose is saying who did what.
 */
insert into public.module_flags (module, enabled, message, actor, updated_at)
values
  -- The umbrella. `/private/*` is gated on this one, so it alone is enough to
  -- close the whole space.
  ('private',       false, null, null, now()),
  ('cycle',         false, null, null, now()),
  ('recovery',      false, null, null, now()),
  ('intimacy',      false, null, null, now()),
  ('vault',         false, null, null, now()),
  ('shared-albums', false, null, null, now()),
  ('together',      false, null, null, now())
/*
 * Never overwrite a decision already made.
 *
 * `do nothing`, not `do update`. If an operator has already switched one of
 * these on — on staging, or in the window between this landing and being
 * applied — re-running the migration must not silently take it back. The seed
 * is the *initial* state, and after that the console owns the column.
 */
on conflict (module) do nothing;
