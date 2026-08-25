import {
  claimThisDevice,
  refreshDeviceSession,
  releaseThisDevice,
  revokeAllDevices,
  sendTakeoverOtp,
  verifyTakeoverOtp,
} from '@/features/auth/services/device-session';
import { useDeviceSessionStore } from '@/features/auth/store/device-session-store';
import i18n from '@/lib/i18n';

/**
 * The client half of the one-device rule, tested where it can actually go
 * wrong: in the mapping between what the server answers and what the app then
 * believes.
 *
 * The server's rule is enforced by RLS and is not what these cover. What they
 * cover is the failure mode this feature has that a moderation block does not
 * — being WRONG in the permissive direction is a second live session, and
 * being wrong in the restrictive direction locks somebody out of their own
 * offline-first app over a dropped request. Both directions are asserted.
 */

const mockRpc = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    },
  },
}));

jest.mock('@/lib/env', () => ({ isSupabaseConfigured: true }));

jest.mock('@/lib/device-id', () => ({
  getDeviceId: () => Promise.resolve('device-under-test-0001'),
  deviceLabel: () => 'Pixel 7 · Android 14',
  devicePlatform: () => 'android',
}));

jest.mock('@/lib/error-reporting', () => ({ reportError: jest.fn() }));

beforeEach(() => {
  mockRpc.mockReset();
  mockSignInWithOtp.mockReset();
  mockVerifyOtp.mockReset();
  useDeviceSessionStore.getState().clear();
  // `clear()` deliberately spares `surrenderedFor` — see the store. Tests need
  // the genuinely blank slate that no runtime caller wants.
  useDeviceSessionStore.setState({ surrenderedFor: null });
});

describe('claiming this device', () => {
  it('claims when nothing else holds the account', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'claimed', takeOver: false }, error: null });

    const result = await claimThisDevice();

    expect(result).toEqual({ status: 'claimed', tookOver: false });
    expect(useDeviceSessionStore.getState().verdict).toBe('active');
  });

  it('sends the device id, label and platform the roster needs', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'claimed' }, error: null });

    await claimThisDevice();

    expect(mockRpc).toHaveBeenCalledWith('claim_device', {
      p_device_id: 'device-under-test-0001',
      p_label: 'Pixel 7 · Android 14',
      p_platform: 'android',
      p_take_over: false,
    });
  });

  it('reports the other device so the screen can name it', async () => {
    mockRpc.mockResolvedValue({
      data: {
        status: 'otp_required',
        otherDevice: {
          label: 'iPhone 14 · iOS 17',
          platform: 'ios',
          lastSeenAt: '2026-08-14T09:00:00Z',
        },
      },
      error: null,
    });

    const result = await claimThisDevice();

    expect(result).toEqual({
      status: 'otp_required',
      otherDevice: {
        label: 'iPhone 14 · iOS 17',
        platform: 'ios',
        lastSeenAt: '2026-08-14T09:00:00Z',
      },
    });
    expect(useDeviceSessionStore.getState().verdict).toBe('otp_required');
    expect(useDeviceSessionStore.getState().otherDevice?.label).toBe('iPhone 14 · iOS 17');
  });

  it('only asks for a takeover when told to', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'claimed', takeOver: true }, error: null });

    const result = await claimThisDevice({ takeOver: true });

    expect(mockRpc).toHaveBeenCalledWith(
      'claim_device',
      expect.objectContaining({ p_take_over: true }),
    );
    expect(result).toEqual({ status: 'claimed', tookOver: true });
  });

  /**
   * The direction that matters most. If migration 0047 has not been applied,
   * `claim_device` does not exist and the RPC 404s. Treating that as a refusal
   * would lock every user out of their own data over an operator's un-run
   * migration — and the account is unrestricted server-side in exactly that
   * case, so a lockout would be pure client-side invention.
   */
  it('does not lock the device out when the call fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });

    const result = await claimThisDevice();

    expect(result.status).toBe('unavailable');
    expect(useDeviceSessionStore.getState().verdict).toBe('unknown');
  });

  it('does not lock the device out when the request throws', async () => {
    mockRpc.mockRejectedValue(new Error('Network request failed'));

    const result = await claimThisDevice();

    expect(result.status).toBe('unavailable');
    expect(useDeviceSessionStore.getState().verdict).toBe('unknown');
  });
});

describe('the heartbeat', () => {
  it('reports a revocation, with the reason the notice screen shows', async () => {
    mockRpc.mockResolvedValue({
      data: {
        status: 'revoked',
        revokedReason: 'signed_in_elsewhere',
        revokedAt: '2026-08-16T10:00:00Z',
        activeDevice: { label: 'iPhone 14 · iOS 17', platform: 'ios', lastSeenAt: null },
      },
      error: null,
    });

    await expect(refreshDeviceSession()).resolves.toBe('revoked');
    expect(useDeviceSessionStore.getState().revokedReason).toBe('signed_in_elsewhere');
    expect(useDeviceSessionStore.getState().otherDevice?.label).toBe('iPhone 14 · iOS 17');
    // Which revocation, not merely that there was one: the hook surrenders once
    // per revocation and needs to tell a second takeover from the first.
    expect(useDeviceSessionStore.getState().revokedAt).toBe('2026-08-16T10:00:00Z');
  });

  /**
   * The regression this mapping exists for. 0047 revokes the row on an
   * ordinary sign-out (`revoked_reason = 'signed_out'`) and its `device_status`
   * reported that as 'revoked' — so signing out and back in on the SAME phone
   * wiped it, showed "your account was opened on another device", and signed
   * the user out again. Migration 0051 answers 'unknown' now; this covers the
   * databases that still only have 0047.
   */
  it('lets a device that signed itself out sign back in', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'revoked', revokedReason: 'signed_out', activeDevice: null },
      error: null,
    });

    await expect(refreshDeviceSession()).resolves.toBe('unregistered');
    // Nothing written back: the notice screen reads the verdict, and this is
    // not something to notify anybody about.
    expect(useDeviceSessionStore.getState().verdict).toBe('unknown');
    expect(useDeviceSessionStore.getState().revokedReason).toBeNull();
  });

  /** Offline must be distinguishable from an answer, and must leave the
   *  cached verdict exactly as it was. */
  it('reports unreachable, and changes nothing, when offline', async () => {
    useDeviceSessionStore.getState().setVerdict('active');
    mockRpc.mockRejectedValue(new Error('offline'));

    await expect(refreshDeviceSession()).resolves.toBe('unreachable');
    expect(useDeviceSessionStore.getState().verdict).toBe('active');
  });

  /**
   * A device that is signed in but not yet on the roster answers 'unknown'.
   * That is the ordinary state between sign-in and the first claim, and
   * promoting it to 'revoked' would put the "you were signed out elsewhere"
   * screen in front of somebody who had just signed in.
   */
  it('does not treat an unregistered device as revoked', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'unknown' }, error: null });

    await expect(refreshDeviceSession()).resolves.toBe('unregistered');
  });

  /**
   * A device waiting on a one-time code IS unregistered server-side. Writing
   * that answer back over its verdict would take the takeover screen down and
   * leave the app rendering a dashboard that RLS is refusing to fill.
   */
  it('leaves a pending takeover on screen', async () => {
    useDeviceSessionStore.getState().setVerdict('otp_required');
    mockRpc.mockResolvedValue({ data: { status: 'unknown' }, error: null });

    await refreshDeviceSession();

    expect(useDeviceSessionStore.getState().verdict).toBe('otp_required');
  });
});

/**
 * The record that keeps a taken-over phone from becoming a dead end. Once this
 * device has wiped and signed out for a revocation, signing in on it again must
 * lead to the takeover screen — not to the same notice, forever.
 */
describe('the mark of a revocation already carried out', () => {
  const store = () => useDeviceSessionStore.getState();

  it('survives the wipe and the sign-out that follow it', () => {
    store().setVerdict('revoked', null, 'signed_in_elsewhere', '2026-08-16T10:00:00Z');
    store().markSurrendered();

    // What `wipeDeviceData()` and every sign-out do.
    store().clear();

    expect(store().verdict).toBe('unknown');
    expect(store().surrenderedFor).toBe('2026-08-16T10:00:00Z');
  });

  /** A boolean would swallow the second one. */
  it('does not cover a later, separate takeover', () => {
    store().setVerdict('revoked', null, 'signed_in_elsewhere', '2026-08-16T10:00:00Z');
    store().markSurrendered();
    store().clear();

    store().setVerdict('revoked', null, 'signed_in_elsewhere', '2026-08-20T18:30:00Z');

    expect(store().surrenderedFor).not.toBe(store().revokedAt);
  });
});

describe('giving the account back', () => {
  it('releases this device by id', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await releaseThisDevice();

    expect(mockRpc).toHaveBeenCalledWith('release_device', {
      p_device_id: 'device-under-test-0001',
    });
  });

  /** A sign-out that threw because the release failed would strand somebody
   *  signed in on a device they are trying to leave. */
  it('never throws when the release fails', async () => {
    mockRpc.mockRejectedValue(new Error('offline'));
    await expect(releaseThisDevice()).resolves.toBeUndefined();
  });

  it('revokes every device before an account deletion, and survives failure', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await revokeAllDevices();
    expect(mockRpc).toHaveBeenCalledWith('revoke_all_devices', { p_reason: 'account_deleted' });

    mockRpc.mockRejectedValue(new Error('offline'));
    await expect(revokeAllDevices()).resolves.toBeUndefined();
  });
});

/**
 * What the takeover screen puts in front of somebody when the code cannot be
 * sent.
 *
 * These two calls were the only auth requests in the app that did not go
 * through `authErrorMessage`, and the consequence was visible rather than
 * theoretical. auth-js turns any 5xx into
 * `AuthRetryableFetchError(_getErrorMessage(response), status)`, and
 * `_getErrorMessage` falls through to `JSON.stringify` when handed a `Response`
 * — which has no `msg`, `message`, `error_description` or `error`. So
 * `error.message` is the whole serialised response: headers, cookies, blob ids.
 * Returning it raw rendered that in red on the device-gate screen.
 */
describe('takeover code failures, as the user reads them', () => {
  // Captured from a live project: POST /auth/v1/otp answering 500 because the
  // mail relay would not take it. Truncated, but the shape is exact.
  const RELAY_REFUSED_500 = {
    name: 'AuthRetryableFetchError',
    status: 500,
    message:
      '{"type":"default","status":500,"ok":false,"statusText":"","headers":{"map":{"x-sb-error-code":"unexpected_failure"}},"url":"https://ref.supabase.co/auth/v1/otp","bodyUsed":false}',
  };

  it('says the email was not sent, rather than printing the response object', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: RELAY_REFUSED_500 });

    const result = await sendTakeoverOtp('someone@example.com');

    expect(result.ok).toBe(false);
    const message = (result as { ok: false; error: string }).error;
    // The bug, stated directly: no JSON, no URL, no header names.
    expect(message).not.toContain('{');
    expect(message).not.toContain('supabase.co');
    expect(message).toBe(i18n.t('authError.emailNotSent'));
  });

  it('does not create an account when the address has none', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });

    await sendTakeoverOtp('  someone@example.com  ');

    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'someone@example.com',
      options: { shouldCreateUser: false },
    });
  });

  /** A wrong code is the user's to fix and must read as such — never as a
   *  server fault, and never as raw GoTrue prose. */
  it('translates a rejected code', async () => {
    mockVerifyOtp.mockResolvedValue({
      error: {
        name: 'AuthApiError',
        code: 'otp_expired',
        status: 403,
        message: 'Token has expired or is invalid',
      },
    });

    const result = await verifyTakeoverOtp('someone@example.com', '123456');

    expect(result).toEqual({ ok: false, error: i18n.t('authError.codeExpired') });
  });
});
