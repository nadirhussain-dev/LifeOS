/**
 * The id the whole streak programme is gated under in `module_flags`
 * (supabase/migrations/0011_module_flags.sql).
 *
 * A constant rather than a literal in three files, for the same reason
 * `ADS_MODULE_ID` is one: the Hub tile, the route guard
 * (features/hub/config/route-modules.ts) and the operator's switch all have to
 * name the same string, and two of them drifting apart would produce a feature
 * that is visible but unreachable — or worse, gated in the console and not in
 * the app.
 *
 * Named `rewards` rather than `challenge` because the switch governs the whole
 * programme, including the parts that ship things to people, not only the
 * screen that happens to live at `/challenge` today.
 *
 * **Seed it disabled.** `module_flags` treats an absent row as enabled — 0011's
 * rule 1, so that a new module ships working rather than waiting on a migration
 * — which for this feature means it would switch itself on during a deploy
 * nobody was watching.
 */
export const REWARDS_MODULE_ID = 'rewards';
