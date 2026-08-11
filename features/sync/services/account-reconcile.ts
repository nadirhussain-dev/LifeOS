import { useProfileStore } from '@/features/profile/store/profile-store';
import { useSyncStore } from '@/features/sync/store/sync-store';
import { clearAllData } from '@/lib/data-management';
import { reportError } from '@/lib/error-reporting';
import { queryClient } from '@/lib/query-client';

/**
 * Reconciles local state with the account that just signed in.
 *
 * The local DB is single-tenant (`user_id = 'local'`). If a DIFFERENT account
 * signs in on this device than the one whose data is currently local, wipe the
 * local data, sync cursors, and device profile FIRST — otherwise the previous
 * user's rows would be pushed up under the new uid (cross-account cloud bleed)
 * and the two users' data would merge locally.
 *
 * The same user re-signing-in keeps their data (their uid is still stamped as
 * `lastUserId` from before). A guest, on the other hand, is stamped with the
 * `GUEST_SENTINEL` the moment they choose "continue as guest" (see
 * `continueAsGuest()` in auth-store.ts) — so the first real sign-in on that
 * device is treated as a genuine identity change and wipes the unidentified
 * guest data before it can bleed into the new account. A device that has
 * NEVER been touched by guest mode or a prior sign-in has `lastUserId ===
 * null`, which is the one case that still means "nothing to wipe."
 *
 * ## Why this waits for hydration
 *
 * `lastUserId` lives in a zustand store persisted to AsyncStorage, and that
 * rehydration is asynchronous. Nothing used to wait for it, and this function
 * runs from `onAuthStateChange`, which Supabase fires as soon as IT has read
 * its own persisted session — a race with no guaranteed winner. Losing that
 * race had two consequences, in opposite directions:
 *
 *  - `lastUserId` read as `null`, so a genuine account switch was NOT detected
 *    and the wipe never happened. That is the cross-account data bleed this
 *    function exists to prevent, quietly reintroduced by a timing accident.
 *  - The `setLastUserId` immediately after triggered a persist WRITE of the
 *    pre-hydration state, overwriting the stored sync cursors with empty ones —
 *    so the next sync re-pulled everything from scratch.
 *
 * Waiting for `hydrated` removes the race. The decision is then made against
 * real state, or not at all.
 *
 * ## Why it fails safe
 *
 * Wiping is irreversible and the data is the user's. The rule is therefore:
 * wipe only when a DIFFERENT prior account can be positively identified. Every
 * uncertain case — not yet hydrated, no prior id, unreadable state — keeps the
 * data. Losing somebody's journal to a race is a far worse failure than a
 * delayed wipe.
 */
export function reconcileAccountOnSignIn(uid: string): void {
  const store = useSyncStore.getState();

  if (!store.hydrated) {
    // Decide once the persisted value is actually readable. `subscribe` returns
    // its own unsubscribe, called the moment the flag flips, so repeated auth
    // events cannot accumulate listeners.
    const unsubscribe = useSyncStore.subscribe((state) => {
      if (!state.hydrated) return;
      unsubscribe();
      reconcileAccountOnSignIn(uid);
    });
    return;
  }

  const previous = store.lastUserId;

  if (previous && previous !== uid) {
    try {
      wipeLocalData();
    } catch (error) {
      // A failed wipe must not pass silently: carrying on would push the
      // previous account's rows up under the new uid, which is precisely the
      // leak this exists to prevent.
      reportError(error, { scope: 'account-reconcile', previous, uid });
      throw error;
    }
  }

  useSyncStore.getState().setLastUserId(uid);
}

/** Wipes all local data, the query cache, sync cursors, and the device
 * profile's onboarding *answers*. Used on an account switch — deliberately
 * keeps `onboardingComplete: true` (via `resetAnswers()`, not `reset()`): a
 * device that has already been onboarded doesn't need to relearn what
 * onboarding is just because a different account signed in, and bouncing a
 * user who just successfully authenticated straight back into the onboarding
 * wizard is exactly the "doesn't redirect anywhere useful" bug this avoids.
 * Full `reset()` (which also clears `onboardingComplete`) is for callers that
 * actually mean "wipe this device back to first-run," e.g. Delete Everything. */
export function wipeLocalData(): void {
  clearAllData();
  queryClient.clear();
  useSyncStore.getState().resetCursors();
  useSyncStore.getState().setLastUserId(null);
  useProfileStore.getState().resetAnswers();
}
