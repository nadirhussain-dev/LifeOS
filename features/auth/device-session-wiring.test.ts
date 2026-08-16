import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * That the one-device rule is actually wired, end to end.
 *
 * Every assertion here corresponds to a way this feature can be *present and
 * inert* — the failure shape `moderation-wiring.test.ts` was written for, and
 * one this feature is unusually exposed to because its parts are so far apart:
 * a SQL function, an HTTP header set in a fetch wrapper, a hook in the root
 * layout, and an overlay. Remove any one and nothing throws, nothing fails to
 * typecheck, and the app silently allows two live sessions again.
 *
 * Read as source text on purpose. The migration only runs against a hosted
 * database, and the layout pulls in expo-router and reanimated, neither of
 * which render under Jest. What is being asked — does A reference B — is
 * answerable statically, which is the only reason this can run in CI at all.
 */

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const migration = read('supabase/migrations/0047_single_device_sessions.sql');

describe('the server rule', () => {
  /**
   * The single most important line in the feature. `may_access_own_data()` is
   * in the USING and WITH CHECK of every synced table's policy (0019), so this
   * call is what turns "the app asks nicely" into "PostgREST refuses". Without
   * it every other part of this file is theatre.
   */
  it('gates every synced table on the device check', () => {
    const gate = migration.slice(migration.indexOf('function public.may_access_own_data'));
    expect(gate).toContain('public.device_may_sync()');
  });

  /** The invariant in the schema, not only in the function meant to maintain
   *  it — a claim that forgot to revoke would otherwise fail silently. */
  it('permits at most one unrevoked device per account', () => {
    expect(migration).toMatch(
      /create unique index[^;]*on public\.user_devices \(user_id\) where revoked_at is null/,
    );
  });

  /** An account with no registered device stays unrestricted, exactly as
   *  0014's empty allowlist does. This is what stops the migration locking out
   *  every already-installed build the moment it is applied. */
  it('leaves an account with no active device unrestricted', () => {
    const check = migration.slice(migration.indexOf('function public.device_may_sync'));
    expect(check).toContain('not exists');
  });

  /** A wipe aimed at the old phone must not be picked up by the new one. */
  it('scopes device commands to their target', () => {
    expect(migration).toContain('alter table public.device_commands');
    expect(migration).toContain('add column if not exists device_id');
    const pending = migration.slice(migration.indexOf('function public.pending_device_commands'));
    expect(pending).toContain('c.device_id is null or c.device_id = p_device_id');
  });

  /** The proof a takeover needs is read from the JWT, where the client cannot
   *  write it — a boolean parameter would be worth nothing. */
  it('checks the one-time-code proof against the JWT, not a parameter', () => {
    const proof = migration.slice(migration.indexOf('function public.otp_proof_age'));
    expect(proof).toContain("auth.jwt() -> 'amr'");
    // Password and OAuth sessions must not satisfy it: the point is proving
    // control of the mailbox, which a stored password on the new phone is not.
    expect(proof).not.toMatch(/'password'/);
    expect(proof).not.toMatch(/'oauth'/);
  });

  /** The revoked device keeps write access briefly so its final push can save
   *  what it never synced — otherwise the wipe destroys exactly the rows it is
   *  supposed to preserve first. */
  it('opens an evacuation window on the device it revokes', () => {
    const claim = migration.slice(migration.indexOf('function public.claim_device'));
    expect(claim).toContain('evacuation_until');
    expect(claim).toContain("revoked_reason = 'signed_in_elsewhere'");
  });
});

describe('the client half', () => {
  /** Every request has to carry the id, or the server cannot tell which device
   *  is asking — including Storage and Edge Functions, which is why it belongs
   *  in the shared fetch rather than in each call site. */
  it('stamps the device id on every Supabase request', () => {
    const client = read('lib/supabase.ts');
    expect(client).toContain('x-daykeep-device');
    expect(client).toContain('getDeviceId');
    expect(client).toMatch(/global:\s*\{[\s\S]*fetch:/);
  });

  /** A hook nothing mounts is a feature nothing runs. */
  it('runs the claim and the heartbeat from the root layout', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('useDeviceSessionSync');
    expect(layout).toContain('<DeviceGateOverlay />');
  });

  /**
   * A phone revoked while it sat closed comes back knowing nothing. If it
   * claimed first, the server would answer `otp_required` and it would be
   * shown the takeover prompt for the takeover that already happened —
   * with its queued wipe never running. Asking for its own standing first is
   * what gets the right answer.
   */
  it('checks this device’s standing before trying to claim', () => {
    const hook = read('features/auth/hooks/use-device-session.ts');
    const body = hook.slice(hook.indexOf('async function pass'));
    expect(body.indexOf('refreshDeviceSession')).toBeLessThan(body.indexOf('claimThisDevice'));
    expect(body).toContain("standing === 'revoked'");
    expect(body).toContain("standing === 'unregistered'");
  });

  /** The takeover screen is the only way past `otp_required`, and the notice
   *  screen is the only explanation a wiped phone gets. */
  it('has a screen for both sides of a takeover', () => {
    const overlay = read('features/auth/components/device-gate-overlay.tsx');
    expect(overlay).toContain("verdict === 'revoked'");
    expect(overlay).toContain('completeTakeover');
    expect(overlay).toContain('requestTakeover');
  });
});

describe('leaving a device', () => {
  const store = read('features/auth/services/auth-store.ts');

  /** The headline requirement: signing out takes the data with it. */
  it('wipes the device on sign-out by default', () => {
    const signOut = store.slice(
      store.indexOf('signOut: async'),
      store.indexOf('resetPassword: async'),
    );
    expect(signOut).toContain('options?.wipeDevice ?? true');
    expect(signOut).toContain('wipeDeviceData()');
  });

  /** Without the release, moving to a new phone the honest way — sign out
   *  here, sign in there — would still cost an email round trip. */
  it('hands the device slot back on the way out', () => {
    const signOut = store.slice(
      store.indexOf('signOut: async'),
      store.indexOf('resetPassword: async'),
    );
    expect(signOut).toContain('releaseThisDevice()');
  });

  /** Queued while there is still an account to queue them against: the rows
   *  cascade away moments later. */
  it('orders every other device wiped before deleting the account', () => {
    const remove = store.slice(store.indexOf('deleteAccount: async'));
    const revokeAt = remove.indexOf('revokeAllDevices');
    const invokeAt = remove.indexOf("functions.invoke('delete-account')");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeLessThan(invokeAt);
    expect(remove).toContain('wipeDeviceData()');
  });

  /** Sign-out is destructive now, so the push has to come first — and every
   *  UI entry point has to go through the flow that does it. */
  it('pushes unsynced work before the wipe, from both entry points', () => {
    const flow = read('features/auth/services/sign-out-flow.ts');
    expect(flow).toContain('evacuateBeforeWipe');
    expect(flow.indexOf('evacuateBeforeWipe')).toBeLessThan(flow.indexOf('.signOut()'));

    for (const screen of ['app/settings/sync.tsx', 'app/profile.tsx']) {
      expect(read(screen)).toContain('confirmAndSignOut');
    }
  });

  /** The wipe has to reach the OS scheduler too. Reminders outlive the
   *  database that described them, and would keep firing on a cleared phone. */
  it('cancels scheduled reminders as part of the wipe', () => {
    const reconcile = read('features/sync/services/account-reconcile.ts');
    const wipe = reconcile.slice(reconcile.indexOf('export function wipeDeviceData'));
    expect(wipe).toContain('cancelScheduledReminders()');
    expect(reconcile).toContain('cancelAllScheduled');
  });
});
