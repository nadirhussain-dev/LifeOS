import { useEffect, useRef } from 'react';

import { resolveGuestData } from '@/features/sync/services/account-reconcile';
import { useSyncStore } from '@/features/sync/store/sync-store';
import { confirm } from '@/lib/dialog-store';
import i18n from '@/lib/i18n';

/**
 * Asks what to do with the data a guest built before they signed in.
 *
 * ## Why this is a question and not a rule
 *
 * Guest data is *unidentified*. Almost always it belongs to the person who has
 * just signed in — they used the app without an account for a week and then
 * made one, which is the path the account step promises will cost them
 * nothing. Occasionally it belongs to whoever lent them the phone. Nothing on
 * the device distinguishes the two, both answers are irreversible, and only the
 * user knows which is theirs.
 *
 * Before this, the app answered on their behalf and answered wrongly: the guest
 * sentinel made a first sign-in look like an account switch, so the local
 * database was wiped — against a promise that had been on screen a minute
 * earlier. See `reconcileAccountOnSignIn`.
 *
 * ## The safe default is keeping
 *
 * Dismissing the dialog, backgrounding the app, force-quitting — every way out
 * that is not an explicit answer leaves the data alone and leaves the question
 * open, because `pendingGuestData` is persisted. The destructive option has to
 * be chosen by name.
 *
 * That is also why "start fresh" is the *confirm* button and "keep" is the
 * cancel: `confirm()` resolves false on a dismissal, and the dismissal must
 * never be the destructive branch. It reads slightly against convention and it
 * is the right way round for a dialog about somebody's journal.
 *
 * ## Mounted once, at the root
 *
 * Sign-in can complete on the account step, in the auth stack, or from a deep
 * link on a cold start, and the answer gates sync in all three. A hook on any
 * one screen would miss the other two.
 */
export function useGuestDataPrompt(): void {
  const pending = useSyncStore((s) => s.pendingGuestData);
  const hydrated = useSyncStore((s) => s.hydrated);

  /*
   * One dialog per pending question, however many times this re-renders.
   *
   * `confirm()` is a promise against a store, so a second call while the first
   * is unanswered would stack two dialogs for one decision — and answering the
   * top one would leave the other behind, asking about data that had already
   * been discarded.
   */
  const asking = useRef(false);

  useEffect(() => {
    if (!hydrated || !pending || asking.current) return;
    asking.current = true;

    void confirm({
      title: i18n.t('sync.guestDataTitle'),
      message: i18n.t('sync.guestDataBody'),
      confirmLabel: i18n.t('sync.guestDataDiscard'),
      cancelLabel: i18n.t('sync.guestDataKeep'),
      destructive: true,
    })
      .then((discard) => {
        resolveGuestData(discard ? 'discard' : 'keep');
      })
      .finally(() => {
        asking.current = false;
      });
  }, [pending, hydrated]);
}
