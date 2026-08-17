import { MODULE_FOCUS_MAP } from '@/features/hub/config/module-focus-map';
import type { ModuleFlag } from '@/features/module-flags/store/module-flags-store';
import type { FocusArea } from '@/features/profile/store/profile-store';

/**
 * Modules the user is never offered a switch for.
 *
 * Settings only. It is the app's own controls, and the manager that could put
 * it back is two screens away behind a FAB — a user who closes it has hidden
 * the door and kept the key in the room. The same reasoning as
 * `canBePrivate: false` on that entry, but a separate rule: `rewards` and
 * `insights` are also `canBePrivate: false`, and for an unrelated reason (they
 * own no local tables, so there is nothing to move behind the vault). Closing
 * either of those is perfectly reasonable, so they are not listed here.
 */
export const ALWAYS_VISIBLE_MODULES: readonly string[] = ['settings'];

/** Why a module is not on the Hub grid right now. `null` = it is. */
export type HiddenReason =
  /** The operator pulled it. Not the user's choice and not theirs to undo. */
  | 'operator'
  /** The user moved it behind the vault. Visible only while that is unlocked. */
  | 'private'
  /** The user closed it in the module manager. */
  | 'closed'
  /** Outside the onboarding focus areas, and never explicitly asked for. */
  | 'curated';

export type VisibilityContext = {
  /** Remote switches. Absent entry means enabled — see module-flags-store. */
  flags: Record<string, ModuleFlag>;
  /** Ids the user moved into the private space. */
  privatised: string[];
  /** The user's own per-module choices. Absent entry means "no opinion". */
  overrides: Record<string, boolean>;
  /** Answers from onboarding. Empty means the question was skipped. */
  focusAreas: FocusArea[];
  showAllModules: boolean;
};

/**
 * Whether the focus-area guess is being applied at all.
 *
 * Nobody answering the focus question isn't the same as answering "none of
 * these" — curating down to zero signal would hide half the app from someone
 * who simply skipped a screen, so an empty answer curates nothing.
 */
export function isCurationActive(context: VisibilityContext): boolean {
  return !context.showAllModules && context.focusAreas.length > 0;
}

/** Whether the focus-area guess *would* hide this module, ignoring overrides. */
function isCuratedOut(moduleId: string, context: VisibilityContext): boolean {
  if (!isCurationActive(context)) return false;
  const area = MODULE_FOCUS_MAP[moduleId];
  return !!area && !context.focusAreas.includes(area);
}

/**
 * Why a module is off the grid, or `null` if it belongs on it.
 *
 * The order of these tests is the whole policy, so it is written as one
 * function rather than a chain of `&&`s spread across the screens that ask.
 *
 *   1. The operator's switch wins over everything, including an explicit "yes,
 *      I want this" — a module whose backend is down does not work better
 *      because the user asked for it.
 *   2. The vault comes next: a privatised module is reached through the private
 *      space, and appearing in the ordinary grid as well would defeat the point.
 *   3. Then the user's own answer, which beats the guess in both directions.
 *   4. Only then the guess made from onboarding.
 *
 * `ALWAYS_VISIBLE_MODULES` short-circuits 3 and 4 but deliberately not 1 or 2:
 * those are not the user's preference to overrule.
 */
export function hiddenReason(moduleId: string, context: VisibilityContext): HiddenReason | null {
  if (context.flags[moduleId]?.enabled === false) return 'operator';
  if (context.privatised.includes(moduleId)) return 'private';
  if (ALWAYS_VISIBLE_MODULES.includes(moduleId)) return null;

  const override = context.overrides[moduleId];
  if (override === false) return 'closed';
  if (override === true) return null;

  return isCuratedOut(moduleId, context) ? 'curated' : null;
}

/** Shorthand for the common question. */
export function isModuleVisible(moduleId: string, context: VisibilityContext): boolean {
  return hiddenReason(moduleId, context) === null;
}

/**
 * Whether the module manager should offer a switch for this module.
 *
 * A module the operator pulled has no switch to offer — turning it "on" would
 * change nothing visible, and a control that does nothing is worse than no
 * control. A privatised module is absent from the manager entirely rather than
 * shown as locked: the list is rendered on the ordinary Hub, and a row reading
 * "Journal — in your private space" tells anyone holding the phone that there
 * is a private space and what is in it.
 */
export function isManageable(moduleId: string, context: VisibilityContext): boolean {
  return (
    context.flags[moduleId]?.enabled !== false &&
    !context.privatised.includes(moduleId) &&
    !ALWAYS_VISIBLE_MODULES.includes(moduleId)
  );
}
