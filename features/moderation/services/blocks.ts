import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/**
 * Blocking another user.
 *
 * The operator-side moderation built in 0010–0019 all routes through somebody
 * at Daykeep deciding something, which is the right shape for adjudication and
 * the wrong shape for the moment you actually want it. This is the part a user
 * can do themselves, immediately, without explaining themselves to anybody.
 *
 * Enforcement is entirely server-side (migration 0021). That matters more here
 * than usual: the person a block is aimed at is by definition motivated, and a
 * check that lives in the client is a check they can remove by building their
 * own. The three doors — being added to a group, being invited, and a token
 * minted before the block — are shut by triggers and by
 * accept_group_invitation, so the app below is only ever a way to ask.
 *
 * What blocking does NOT do is remove either party from a group they are
 * already both in. Deleting a membership row breaks the ledger it anchors (see
 * migration 0008, where filtering members out of the balances lost £75 from a
 * £100 dinner), and silently changing what other people are owed is not a thing
 * a block should do. Leaving the group is the action for that, and the UI says
 * so rather than implying otherwise.
 */

export type BlockedAccount = {
  userId: string;
  /** Whatever the server could label them with — both may be null for an
   *  account with no profile name set. The UI falls back to a generic label
   *  rather than showing a uuid. */
  displayName: string | null;
  username: string | null;
  blockedAt: string;
};

export type BlockResult = { ok: true } | { ok: false; error: 'not-configured' | 'failed' };

export async function blockUser(userId: string): Promise<BlockResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'not-configured' };
  // Idempotent server-side, so a double tap is not an error state the UI has
  // to model.
  const { error } = await supabase.rpc('block_user', { p_user_id: userId });
  return error ? { ok: false, error: 'failed' } : { ok: true };
}

export async function unblockUser(userId: string): Promise<BlockResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'not-configured' };
  const { error } = await supabase.rpc('unblock_user', { p_user_id: userId });
  return error ? { ok: false, error: 'failed' } : { ok: true };
}

/** The accounts you have blocked. There is deliberately no counterpart for who
 *  has blocked you — see the RLS policy in 0021. */
export async function listBlockedAccounts(): Promise<BlockedAccount[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('list_blocked_accounts');
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    userId: String(row.user_id),
    displayName: (row.display_name as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    blockedAt: String(row.blocked_at),
  }));
}
