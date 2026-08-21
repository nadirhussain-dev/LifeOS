import { isClosedByUser } from '@/features/hub/services/module-visibility';
import { useModuleCurationStore } from '@/features/hub/store/module-curation-store';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import { usePrivateStore } from '@/features/private/store/private-store';

/**
 * May this module's content be shown *inside the app* right now?
 *
 * The app has two versions of this question and they are not interchangeable,
 * which is why they live apart:
 *
 *   - `moduleMayBeNamed()` (notification-visibility.ts) answers it for things
 *     the OS renders outside the app — a lock-screen reminder, the home-screen
 *     widget. A privatised module fails that one *always*, unlocked or not,
 *     because the lock screen doesn't know the vault is open and the person
 *     reading it may not be its owner.
 *   - this one answers it for a screen the user is already looking at, so a
 *     privatised module passes while the vault is unlocked. Anything else
 *     would make unlocking the vault do nothing.
 *
 * Both agree on the other two switches, and on which is checked first: the
 * operator's kill switch, then the module the user closed. Those are exactly
 * the gates `useModuleRouteGuard` redirects on, which is the point — a search
 * hit, a widget or a correlation naming a module whose routes are being
 * bounced is offering a tap-through to a redirect.
 *
 * Curation is deliberately absent. See `isClosedByUser` for why: the guess
 * onboarding made is not a decision the user confirmed, and silencing the
 * cards and hits that would let them discover the module turns it into one.
 */
export type ModuleGateContext = {
  flags: Record<string, { enabled: boolean }>;
  overrides: Record<string, boolean>;
  privatised: string[];
  /** Whether the vault is open — `key !== null`. */
  unlocked: boolean;
};

/** The rule itself, pure, so the React and non-React callers cannot drift. */
export function moduleMayBeShownIn(moduleId: string, context: ModuleGateContext): boolean {
  if (context.flags[moduleId]?.enabled === false) return false;
  if (isClosedByUser(moduleId, context.overrides)) return false;
  if (context.privatised.includes(moduleId) && !context.unlocked) return false;
  return true;
}

/**
 * The same rule read straight off the stores, for services that run outside
 * React (global search, the insight engine's inputs).
 */
export function moduleMayBeShown(moduleId: string): boolean {
  const { privatised, key } = usePrivateStore.getState();
  return moduleMayBeShownIn(moduleId, {
    flags: useModuleFlagsStore.getState().flags,
    overrides: useModuleCurationStore.getState().overrides,
    privatised,
    unlocked: key !== null,
  });
}
