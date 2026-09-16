import * as LocalAuthentication from 'expo-local-authentication';

import {
  authenticate,
  getBiometricLabel,
  isBiometricAvailable,
} from '@/features/security/lib/biometrics';

/**
 * The app lock's gate to the OS.
 *
 * Two failure directions matter here and they are not symmetric. Reporting
 * biometrics as *available* when they are not offers a lock the device can
 * never satisfy — the person turns it on, backgrounds the app, and cannot get
 * back in. Letting any of these throw is the same outcome by a different route:
 * the unlock screen is what raises it, so the throw lands in the root
 * ErrorBoundary and the recovery UI replaces the only way back into the app.
 *
 * Every function here is therefore asserted to be total.
 */

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

jest.mock('@/lib/i18n', () => ({
  __esModule: true,
  // Identity: the assertions below are about which key is chosen, not what it
  // renders to in any one language.
  default: { t: (key: string) => key },
}));

const hasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
const isEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
const authenticateAsync = LocalAuthentication.authenticateAsync as jest.Mock;
const supportedTypes = LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('isBiometricAvailable', () => {
  it('is true only when the device has hardware AND an enrolment', async () => {
    // Hardware without an enrolment is the case that matters: every phone with
    // a fingerprint reader reports hardware, whether or not anybody has ever
    // registered a finger. Treating that as available offers a lock the device
    // cannot open.
    hasHardware.mockResolvedValue(true);
    isEnrolled.mockResolvedValue(true);
    await expect(isBiometricAvailable()).resolves.toBe(true);

    hasHardware.mockResolvedValue(true);
    isEnrolled.mockResolvedValue(false);
    await expect(isBiometricAvailable()).resolves.toBe(false);

    hasHardware.mockResolvedValue(false);
    isEnrolled.mockResolvedValue(true);
    await expect(isBiometricAvailable()).resolves.toBe(false);
  });

  it('reports unavailable rather than throwing when the native call fails', async () => {
    hasHardware.mockRejectedValue(new Error('no native module'));
    isEnrolled.mockResolvedValue(true);

    await expect(isBiometricAvailable()).resolves.toBe(false);
  });
});

describe('authenticate', () => {
  it('passes through the OS verdict', async () => {
    authenticateAsync.mockResolvedValue({ success: true });
    await expect(authenticate()).resolves.toBe(true);

    authenticateAsync.mockResolvedValue({ success: false });
    await expect(authenticate()).resolves.toBe(false);
  });

  it('leaves the device-passcode fallback enabled', async () => {
    // Not a preference. With `disableDeviceFallback: true`, somebody whose face
    // stops being recognised — a new pair of glasses, a cut finger — has no
    // second route and is locked out of their own data with no way back short
    // of reinstalling, which discards the SQLCipher key and the database with
    // it. See features/security/lib/db-key.ts.
    authenticateAsync.mockResolvedValue({ success: true });

    await authenticate();

    expect(authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });

  it('returns false rather than throwing when the prompt fails', async () => {
    // The unlock screen calls this. An exception here reaches the root
    // ErrorBoundary, which replaces the only route back into the app.
    authenticateAsync.mockRejectedValue(new Error('cancelled by system'));

    await expect(authenticate()).resolves.toBe(false);
  });

  it('uses the caller-supplied reason when one is given', async () => {
    authenticateAsync.mockResolvedValue({ success: true });

    // Deliberately not a key-shaped string: `check:i18n` scans source for
    // dotted literals and would report a fake key here as a missing
    // translation. The assertion is about pass-through, not about the key.
    await authenticate('a caller supplied reason');

    expect(authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'a caller supplied reason' }),
    );
  });
});

describe('getBiometricLabel', () => {
  it('prefers face over fingerprint over iris', async () => {
    // A device reporting several methods should be described by the one the OS
    // will actually present first, or the setting names a sensor the person
    // never sees.
    supportedTypes.mockResolvedValue([
      LocalAuthentication.AuthenticationType.FINGERPRINT,
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
      LocalAuthentication.AuthenticationType.IRIS,
    ]);
    await expect(getBiometricLabel()).resolves.toBe('security.faceId');

    supportedTypes.mockResolvedValue([
      LocalAuthentication.AuthenticationType.FINGERPRINT,
      LocalAuthentication.AuthenticationType.IRIS,
    ]);
    await expect(getBiometricLabel()).resolves.toBe('security.fingerprint');

    supportedTypes.mockResolvedValue([LocalAuthentication.AuthenticationType.IRIS]);
    await expect(getBiometricLabel()).resolves.toBe('security.iris');
  });

  it('falls back to the generic label for an unknown or empty method list', async () => {
    supportedTypes.mockResolvedValue([]);
    await expect(getBiometricLabel()).resolves.toBe('security.biometrics');

    supportedTypes.mockResolvedValue([99]);
    await expect(getBiometricLabel()).resolves.toBe('security.biometrics');
  });

  it('falls back to the generic label rather than throwing', async () => {
    supportedTypes.mockRejectedValue(new Error('no native module'));

    await expect(getBiometricLabel()).resolves.toBe('security.biometrics');
  });
});
