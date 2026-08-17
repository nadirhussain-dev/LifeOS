import i18n from '@/lib/i18n';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { evacuateBeforeWipe } from '@/features/sync/services/sync-engine';
import { confirm, type ConfirmRequest } from '@/lib/dialog-store';
import { reportError } from '@/lib/error-reporting';

/**
 * Signing out, with the one question that has to be asked first.
 *
 * Sign-out wipes this device (see `auth-store`'s `signOut`), and a wipe is
 * irreversible for anything that never reached the server. So the flow is:
 * confirm, push everything that can still be pushed, and only if something
 * could NOT be pushed, stop and name it — because "your data is in your
 * account" is a promise this app has no right to make about rows that are
 * still sitting in a local SQLite file.
 *
 * The second confirmation is deliberately not merged into the first. A single
 * dialog carrying both "this clears the device" and a conditional "…and you'll
 * lose Budget and Journal" would have to state the worst case every time, to
 * every user, including the overwhelming majority for whom it is false. Asking
 * twice costs a tap in the rare case and nothing in the common one.
 *
 * Lives here rather than in the store because the evacuation is `sync-engine`'s
 * job, and `sync-engine` imports the auth store — putting this in the store
 * would close that loop into an import cycle.
 */
export async function confirmAndSignOut(): Promise<boolean> {
  const t = i18n.t.bind(i18n);

  const agreed = await confirm({
    title: t('sync.signOutTitle'),
    message: t('sync.signOutBody'),
    confirmLabel: t('sync.signOut'),
    cancelLabel: t('common.cancel'),
    destructive: true,
  });
  if (!agreed) return false;

  const warning = await whatWouldBeLost();
  if (warning) {
    const anyway = await confirm({
      ...warning,
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!anyway) return false;
  }

  await useAuthStore.getState().signOut();
  return true;
}

/** The second dialog, minus the parts every version of it shares. */
type Warning = Omit<ConfirmRequest, 'cancelLabel' | 'destructive'>;

/**
 * Pushes everything it can, then describes what a wipe would still cost — in
 * the words that fit the actual reason.
 *
 * The screen this is raised from is the one with the per-module sync switches
 * on it, so a module that is switched off is not a fault the user needs
 * alarming about; it is the setting they are looking at, doing what it says.
 * What they need is the consequence they may not have connected to it — that
 * device-only means this device, and this device is about to be cleared — and
 * the one action that would save it, which is a switch and a wait away.
 *
 * A push that FAILED is the opposite: unexpected, and worth alarm, because data
 * they believed was in their account is not. Cancelling and retrying is a real
 * fix there, and it is worth saying so.
 *
 * Returns null when there is nothing to warn about, so the common case — the
 * overwhelming majority of sign-outs — costs no second dialog at all.
 */
async function whatWouldBeLost(): Promise<Warning | null> {
  const t = i18n.t.bind(i18n);
  if (!useAuthStore.getState().session) return null;

  let unsaved: string[] = [];
  let deviceOnly: string[] = [];
  try {
    const evacuation = await evacuateBeforeWipe();
    unsaved = evacuation.unsaved;
    deviceOnly = evacuation.deviceOnly;
  } catch (error) {
    // The push never ran at all — offline, most often. Reported as the whole
    // account being at risk rather than an empty list: "everything is safely in
    // your account" is exactly the reassurance that would cost somebody their
    // data after a request that never happened.
    reportError(error, { scope: 'sign-out-evacuation' });
    return {
      title: t('sync.signOutUnsyncedTitle'),
      message: t('sync.signOutUnsyncedOffline'),
      confirmLabel: t('sync.signOutAnyway'),
    };
  }

  if (unsaved.length === 0 && deviceOnly.length === 0) return null;

  const parts: string[] = [];
  if (unsaved.length > 0) {
    parts.push(t('sync.signOutUnsyncedBody', { modules: nameModules(unsaved) }));
  }
  if (deviceOnly.length > 0) {
    parts.push(t('sync.signOutDeviceOnlyBody', { modules: nameModules(deviceOnly) }));
  }

  // A genuine failure sets the tone when both are present: it is the half the
  // user did not choose, and the half that is still fixable.
  return unsaved.length > 0
    ? {
        title: t('sync.signOutUnsyncedTitle'),
        message: parts.join('\n\n'),
        confirmLabel: t('sync.signOutAnyway'),
      }
    : {
        title: t('sync.signOutDeviceOnlyTitle'),
        message: parts.join('\n\n'),
        // Named after what it does. "Anyway" asks somebody to overrule a
        // warning; this asks them to confirm a deletion, which is the actual
        // decision in front of them.
        confirmLabel: t('sync.signOutAndDelete'),
      };
}

/** Module keys as the names the user knows them by, e.g. "Budget, Journal". */
function nameModules(keys: string[]): string {
  return keys.map((key) => i18n.t(`syncModule.${key}`, { defaultValue: key })).join(', ');
}
