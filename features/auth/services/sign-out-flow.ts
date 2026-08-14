import i18n from '@/lib/i18n';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { evacuateBeforeWipe } from '@/features/sync/services/sync-engine';
import { confirm } from '@/lib/dialog-store';
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

  const unsaved = await unsavedModules();
  if (unsaved.length > 0) {
    const anyway = await confirm({
      title: t('sync.signOutUnsyncedTitle'),
      message:
        unsaved[0] === '*'
          ? t('sync.signOutUnsyncedOffline')
          : t('sync.signOutUnsyncedBody', { modules: nameModules(unsaved) }),
      confirmLabel: t('sync.signOutAnyway'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!anyway) return false;
  }

  await useAuthStore.getState().signOut();
  return true;
}

/**
 * Pushes everything it can and reports what it could not.
 *
 * A thrown evacuation means the push never ran — offline, most often — and is
 * reported as the wildcard `'*'` rather than an empty list. An empty list means
 * "everything is safely on the server", and answering that after a request that
 * never happened is exactly the reassurance that would cost somebody their data.
 */
async function unsavedModules(): Promise<string[]> {
  if (!useAuthStore.getState().session) return [];
  try {
    const evacuation = await evacuateBeforeWipe();
    return evacuation.unsaved;
  } catch (error) {
    reportError(error, { scope: 'sign-out-evacuation' });
    return ['*'];
  }
}

/** Module keys as the names the user knows them by, e.g. "Budget, Journal". */
function nameModules(keys: string[]): string {
  return keys.map((key) => i18n.t(`syncModule.${key}`, { defaultValue: key })).join(', ');
}
