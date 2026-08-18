-- ---------------------------------------------------------------------------
-- 0060 — Let a task or a habit name the goal it advances.
--
-- Two columns, `tasks.goal_id` and `habits.goal_id`, and the same
-- schemas-move-together reasoning as 0056: the sync engine builds its upsert
-- from local column names, so a column the server lacks is a failed push for
-- the whole table rather than one absent field.
--
-- ## No foreign key
--
-- Deliberate, and the opposite of the choice 0057 made for `user_id`. Rows
-- arrive from the engine in table order, and a task can be pushed before the
-- goal it names — a device that created both offline pushes `tasks` and `goals`
-- in whatever order the module registry lists them. A reference would reject
-- the task outright, and the engine's failure mode for one rejected row is the
-- whole page.
--
-- The app already treats a missing goal as "no contribution" rather than an
-- error, because a task can outlive the goal it named, and a tick that refuses
-- to register because of a goal deleted weeks ago is worse than a tick that
-- quietly advances nothing. That tolerance is what makes the absent constraint
-- safe here; `user_id` had no such story, which is why it does carry one.
--
-- ## Nothing reads these server-side
--
-- Contribution is computed on the device, against the device's own goal row,
-- and written as an ordinary `goal_progress_logs` entry that syncs like any
-- other. The server needs the column so the link survives a reinstall; it does
-- not need to understand it.
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists goal_id text;

alter table public.habits
  add column if not exists goal_id text;
