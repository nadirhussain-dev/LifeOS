import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import {
  isPrivatePath,
  moduleForPath,
  privateModuleForPath,
  PRIVATE_SPACE_MODULE_ID,
} from '@/features/hub/config/route-modules';
import { moduleMayBeShownIn } from '@/features/hub/services/module-gate';
import { isClosedByUser } from '@/features/hub/services/module-visibility';
import { useModuleCurationStore } from '@/features/hub/store/module-curation-store';
import { refreshModuleFlags } from '@/features/module-flags/services/module-flags';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import { usePrivateStore } from '@/features/private/store/private-store';

/** Keeps the remote switches current: once on launch, then on each foreground. */
export function useModuleFlagsSync(): void {
  useEffect(() => {
    void refreshModuleFlags();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshModuleFlags();
    });
    return () => subscription.remove();
  }, []);
}

export type ModuleAccess =
  | { allowed: true }
  | { allowed: false; reason: 'disabled'; message: string | null }
  | { allowed: false; reason: 'closed' }
  | { allowed: false; reason: 'locked' };

/**
 * Whether this module may be opened right now, and why not.
 *
 * Three independent gates, and the order matters. The operator's switch is
 * checked first: a module pulled because it corrupts data should not be
 * reachable by unlocking the private space. The user's own "I don't use this"
 * is second — closing a module in the manager switches it off rather than
 * merely untidying the Hub, so its routes stop opening too. Their "keep this
 * private" choice is last.
 */
export function useModuleAccess(moduleId: string): ModuleAccess {
  const flag = useModuleFlagsStore((s) => s.flags[moduleId]);
  const overrides = useModuleCurationStore((s) => s.overrides);
  const privatised = usePrivateStore((s) => s.privatised);
  const key = usePrivateStore((s) => s.key);

  if (flag && !flag.enabled) {
    return { allowed: false, reason: 'disabled', message: flag.message };
  }
  if (isClosedByUser(moduleId, overrides)) {
    return { allowed: false, reason: 'closed' };
  }
  if (privatised.includes(moduleId) && !key) {
    return { allowed: false, reason: 'locked' };
  }
  return { allowed: true };
}

/**
 * A reactive `(moduleId) => boolean` for screens that render another module's
 * content.
 *
 * The same three gates as `useModuleAccess`, and deliberately so: all three of
 * them stop the module's own routes from opening, so anything that surfaces its
 * content elsewhere — a dashboard widget, a search hit, a correlation on the
 * Insights screen — is offering a tap-through to a screen the guard will bounce,
 * and in the privatised case is showing the content itself on a screen that
 * anybody holding the phone can see.
 *
 * `moduleMayBeNamed()` is the same rule read outside React, for the scheduler
 * and the home-screen widget. This is the version a component can subscribe to,
 * because a module being privatised has to blank the screen already rendering
 * it rather than the next one.
 *
 * Everything is hidden until the private store has rehydrated — the same
 * reasoning as the route guard's `if (!hydrated) return`, but resolved the other
 * way because a screen has to render *something* meanwhile: a frame of nothing
 * is recoverable, a frame of somebody's private module is not.
 */
export function useModuleGate(): (moduleId: string) => boolean {
  const flags = useModuleFlagsStore((s) => s.flags);
  const overrides = useModuleCurationStore((s) => s.overrides);
  const privatised = usePrivateStore((s) => s.privatised);
  const key = usePrivateStore((s) => s.key);
  const hydrated = usePrivateStore((s) => s.hydrated);

  return useCallback(
    (moduleId: string) =>
      hydrated &&
      moduleMayBeShownIn(moduleId, { flags, overrides, privatised, unlocked: key !== null }),
    [flags, overrides, privatised, key, hydrated],
  );
}

/**
 * Route-level guard, mounted once from the root layout.
 *
 * Watches the current path and redirects off any module that may not be open.
 * One place rather than a call on each screen, for the same reason usage
 * reporting is derived from the route: it covers every sub-route a module has
 * and every deep link into them, including the ones added later. A per-screen
 * guard is a thing to remember, and the screen where it is forgotten is the
 * one somebody's partner taps.
 *
 * Where it sends people differs by reason. A privatised module goes to the PIN
 * pad — the person is almost certainly its owner arriving from a stale back
 * stack, and asking for the PIN is the useful answer. A disabled module goes to
 * the Hub, where the card carries the operator's explanation.
 *
 * Private-space modules (Cycle, Recovery, …) are a separate branch: they're
 * not in `SEGMENT_TO_MODULE` at all (every `/private/*` route shares the same
 * first segment), and a disabled one sends the person to `/private` — the
 * space's own home — rather than out to the Hub, since they're already inside
 * the vault. `PrivateScreen` (private-screen.tsx) already enforces this for
 * every screen that renders through it; this is the backstop for the private
 * routes that don't (e.g. the shared-album chat screen).
 */
export function useModuleRouteGuard(): void {
  const router = useRouter();
  const pathname = usePathname();
  const flags = useModuleFlagsStore((s) => s.flags);
  const overrides = useModuleCurationStore((s) => s.overrides);
  const privatised = usePrivateStore((s) => s.privatised);
  const key = usePrivateStore((s) => s.key);
  const hydrated = usePrivateStore((s) => s.hydrated);

  useEffect(() => {
    // Before rehydration `privatised` is still the initial empty array, so
    // acting on it would let a privatised module render for a frame on every
    // cold start — the exact moment somebody else might be holding the phone.
    if (!hydrated) return;

    const moduleId = moduleForPath(pathname);
    if (moduleId) {
      if (flags[moduleId]?.enabled === false) {
        router.replace('/(tabs)/hub');
        return;
      }
      // A module the user switched off. Same destination as the operator's
      // switch, and for the same reason: the Hub is where the way back is —
      // there the manager can turn it on again. Nothing here explains itself,
      // because unlike the operator case the user is the one who did this.
      if (isClosedByUser(moduleId, overrides)) {
        router.replace('/(tabs)/hub');
        return;
      }
      if (privatised.includes(moduleId) && key === null) {
        router.replace('/private/unlock');
      }
      return;
    }

    /*
     * The whole space, before any module inside it (0074).
     *
     * Checked first and answered differently: a disabled module inside an
     * enabled space sends you back to the space's home, but a disabled *space*
     * has no home to send you to. The destination has to be outside it, or the
     * redirect lands on `/private`, which is also inside it, and the two bounce
     * off each other forever.
     *
     * `isPrivatePath` rather than `privateModuleForPath`, because the screens
     * that belong to no module — the unlock pad, setup, transfer, receive — are
     * exactly the ones a closed space most needs to refuse. Gating only the
     * five modules would hide Cycle and Recovery while leaving the door they
     * are behind wide open.
     */
    if (isPrivatePath(pathname) && flags[PRIVATE_SPACE_MODULE_ID]?.enabled === false) {
      router.replace('/(tabs)/hub');
      return;
    }

    const privateModuleId = privateModuleForPath(pathname);
    if (privateModuleId && flags[privateModuleId]?.enabled === false) {
      router.replace(key ? '/private' : '/private/unlock');
    }
  }, [pathname, flags, overrides, privatised, key, hydrated, router]);
}
