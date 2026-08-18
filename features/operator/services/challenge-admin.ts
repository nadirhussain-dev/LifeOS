import type { SeasonState } from '@/features/challenge/services/season-state';
import type { OperatorResult } from '@/features/operator/services/operator-repository';
import { supabase } from '@/lib/supabase';

/**
 * The season console's calls onto migration 0055.
 *
 * Same discipline as `operator-repository.ts`: a view, never a privilege
 * boundary. Every function here calls an RPC that gates itself on `is_admin()`
 * and writes its own audit row, so a console that hid a button would be hiding
 * it from an honest operator and nobody else.
 *
 * Kept in its own file rather than added to the operator repository because the
 * challenge is the one part of the console that edits a *programme* rather than
 * an account, and the two have no types in common.
 */

/** One season, as `admin_challenge_seasons()` returns it. */
export type AdminSeason = {
  id: string;
  name: string;
  /** The season's own switch. Not the `rewards` module flag — see `SeasonCard`. */
  enabled: boolean;
  /** The server's word, identical to the one users' phones are acting on. */
  state: SeasonState;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  maxEnrollments: number | null;
  dayGraceHours: number;
  minActiveSeconds: number;
  minWrites: number;
  requiredModules: number;
  moduleLockDays: number;
  moduleSwapsAllowed: number;
  shieldEarnDays: number;
  shieldFloorDays: number;
  shieldCap: number;
  maxDemotionDays: number;
  termsUrl: string | null;
  /** The count that explains a `notReady`, next to the number it must reach. */
  eligibleModules: number;
  tierCount: number;
  enrolledCount: number;
  activeCount: number;
};

/** One eligible-module row for a season. */
export type AdminSeasonModule = {
  moduleId: string;
  eligible: boolean;
  estDailySeconds: number;
  sortOrder: number;
};

/** One rung. */
export type AdminSeasonTier = {
  dayThreshold: number;
  name: string;
  rewardKind: 'digital' | 'physical';
  rewardTitle: string | null;
  rewardDescription: string | null;
};

/**
 * Only the keys an operator actually changed.
 *
 * The whole point of the patch shape: 0048's upsert coalesces every absent
 * setting to its factory default, so sending the full object to move an end
 * date would quietly reset the shield economy of a season people are two
 * hundred days into. An absent key here means "leave it alone".
 */
export type SeasonPatch = {
  name?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  maxEnrollments?: number | null;
  dayGraceHours?: number;
  minActiveSeconds?: number;
  minWrites?: number;
  requiredModules?: number;
  moduleLockDays?: number;
  moduleSwapsAllowed?: number;
  shieldEarnDays?: number;
  shieldFloorDays?: number;
  shieldCap?: number;
  maxDemotionDays?: number;
  termsUrl?: string | null;
};

const failed = (message: string): { ok: false; error: string } => ({
  ok: false,
  error: friendlyChallengeError(message),
});

/** Every season, newest first, each carrying its state and the counts behind it. */
export async function listSeasons(): Promise<OperatorResult<AdminSeason[]>> {
  const { data, error } = await supabase.rpc('admin_challenge_seasons');
  if (error) return failed(error.message);
  return { ok: true, data: (data ?? []) as AdminSeason[] };
}

/**
 * Creates a season, switched off.
 *
 * Off is not a default worth overriding from a form: a season that ships itself
 * on is a season that opens during a deploy nobody was watching, and 0048's
 * column default says the same thing. The operator switches it on once its
 * modules and ladder are in place — which is precisely the step whose absence
 * produced the "Open here, closed there" split this console exists to end.
 */
export async function createSeason(name: string): Promise<OperatorResult<string>> {
  const { data, error } = await supabase.rpc('admin_upsert_challenge_season', {
    p_id: null,
    p_name: name,
    p_enabled: false,
    p_settings: {},
  });
  if (error) return failed(error.message);
  return { ok: true, data: data as string };
}

/** The season's own open/closed switch, and nothing else. */
export async function setSeasonEnabled(
  seasonId: string,
  enabled: boolean,
): Promise<OperatorResult<SeasonState>> {
  const { data, error } = await supabase.rpc('admin_set_challenge_season_enabled', {
    p_season: seasonId,
    p_enabled: enabled,
  });
  if (error) return failed(error.message);
  return { ok: true, data: (data as { state: SeasonState }).state };
}

/** Patches only what changed. See `SeasonPatch`. */
export async function updateSeason(
  seasonId: string,
  patch: SeasonPatch,
): Promise<OperatorResult<SeasonState>> {
  const { data, error } = await supabase.rpc('admin_update_challenge_season', {
    p_season: seasonId,
    p_patch: patch,
  });
  if (error) return failed(error.message);
  return { ok: true, data: (data as { state: SeasonState }).state };
}

/**
 * Moves an end date by `days`, in either direction.
 *
 * Anchored on the current end date, or on now for a season with no end at all,
 * so "extend by 30" means the same thing whether or not the season had a bound.
 * Computed here rather than in SQL because the console has the row in hand and
 * an operator should see the resulting date before committing to it.
 */
export function shiftedEnd(endsAt: string | null, days: number, now = Date.now()): string {
  const base = endsAt ? Date.parse(endsAt) : now;
  return new Date((Number.isNaN(base) ? now : base) + days * 86_400_000).toISOString();
}

/** Fills an empty season with the default modules and reference ladder. */
export async function seedSeason(
  seasonId: string,
): Promise<OperatorResult<{ modulesAdded: number; tiersAdded: number; state: SeasonState }>> {
  const { data, error } = await supabase.rpc('admin_seed_challenge_season', { p_season: seasonId });
  if (error) return failed(error.message);
  return {
    ok: true,
    data: data as { modulesAdded: number; tiersAdded: number; state: SeasonState },
  };
}

/**
 * Deletes a season the server has confirmed nobody has joined.
 *
 * The refusal lives in SQL, not here: every challenge table cascades from this
 * row, so a season with runs in it would take the ledger and event history of
 * everybody in it. A joined season is closed, never deleted.
 */
export async function deleteSeason(seasonId: string): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_delete_challenge_season', { p_season: seasonId });
  if (error) return failed(error.message);
  return { ok: true, data: null };
}

/** Which modules may be committed to. Readable by anyone (0048); the writes are gated. */
export async function listSeasonModules(
  seasonId: string,
): Promise<OperatorResult<AdminSeasonModule[]>> {
  const { data, error } = await supabase
    .from('challenge_modules')
    .select('module_id, eligible, est_daily_seconds, sort_order')
    .eq('season_id', seasonId)
    .order('sort_order');
  if (error) return failed(error.message);
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      moduleId: row.module_id as string,
      eligible: row.eligible as boolean,
      estDailySeconds: row.est_daily_seconds as number,
      sortOrder: row.sort_order as number,
    })),
  };
}

export async function setSeasonModule(
  seasonId: string,
  moduleId: string,
  eligible: boolean,
  estDailySeconds: number,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_set_challenge_module', {
    p_season: seasonId,
    p_module: moduleId,
    p_eligible: eligible,
    p_est_daily_seconds: estDailySeconds,
  });
  if (error) return failed(error.message);
  return { ok: true, data: null };
}

export async function listSeasonTiers(
  seasonId: string,
): Promise<OperatorResult<AdminSeasonTier[]>> {
  const { data, error } = await supabase
    .from('challenge_tiers')
    .select('day_threshold, name, reward_kind, reward_title, reward_description')
    .eq('season_id', seasonId)
    .order('day_threshold');
  if (error) return failed(error.message);
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      dayThreshold: row.day_threshold as number,
      name: row.name as string,
      rewardKind: row.reward_kind as 'digital' | 'physical',
      rewardTitle: (row.reward_title as string | null) ?? null,
      rewardDescription: (row.reward_description as string | null) ?? null,
    })),
  };
}

export async function upsertSeasonTier(
  seasonId: string,
  tier: AdminSeasonTier,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_upsert_challenge_tier', {
    p_season: seasonId,
    p_day: tier.dayThreshold,
    p_name: tier.name,
    p_kind: tier.rewardKind,
    p_title: tier.rewardTitle,
    p_description: tier.rewardDescription,
  });
  if (error) return failed(error.message);
  return { ok: true, data: null };
}

export async function deleteSeasonTier(
  seasonId: string,
  dayThreshold: number,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_delete_challenge_tier', {
    p_season: seasonId,
    p_day: dayThreshold,
  });
  if (error) return failed(error.message);
  return { ok: true, data: null };
}

/**
 * Postgres messages, turned into something an operator can act on.
 *
 * The refusals worth translating are the ones that are *decisions* rather than
 * faults — a season with runs in it cannot be deleted, and saying so plainly is
 * better than surfacing a raise from a function nobody has read.
 */
export function friendlyChallengeError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('not an administrator')) {
    return 'This needs full admin access — staff can view the challenge, but not change it.';
  }
  if (m.includes('close it instead')) {
    return 'People have already joined this season, so it cannot be deleted. Close it instead — that stops it without touching anyone’s record.';
  }
  if (m.includes('no such season')) {
    return 'That season no longer exists. Pull to refresh.';
  }
  if (m.includes('violates check constraint') || m.includes('check constraint')) {
    return 'One of those numbers is outside what the season allows. Check the limits noted under each field.';
  }
  return message;
}
