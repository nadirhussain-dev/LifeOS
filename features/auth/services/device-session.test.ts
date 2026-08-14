import {
  claimThisDevice,
  refreshDeviceSession,
  releaseThisDevice,
  revokeAllDevices,
} from '@/features/auth/services/device-session';
import { useDeviceSessionStore } from '@/features/auth/store/device-session-store';

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

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
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
  useDeviceSessionStore.getState().clear();
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
        activeDevice: { label: 'iPhone 14 · iOS 17', platform: 'ios', lastSeenAt: null },
      },
      error: null,
    });

    await expect(refreshDeviceSession()).resolves.toBe('revoked');
    expect(useDeviceSessionStore.getState().revokedReason).toBe('signed_in_elsewhere');
    expect(useDeviceSessionStore.getState().otherDevice?.label).toBe('iPhone 14 · iOS 17');
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
