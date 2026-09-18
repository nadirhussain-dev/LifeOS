import { REWARDS_MODULE_ID } from '@/features/challenge/config/rewards-flag';
import {
  isLocallyDisabled,
  LOCALLY_DISABLED_MODULES,
} from '@/features/hub/config/module-availability';
import { HUB_SECTIONS } from '@/features/hub/config/modules';
import { moduleForPath } from '@/features/hub/config/route-modules';
import { moduleMayBeShownIn } from '@/features/hub/services/module-gate';
import { hiddenReason, isManageable } from '@/features/hub/services/module-visibility';
import {
  isModuleEnabled,
  useModuleFlagsStore,
} from '@/features/module-flags/store/module-flags-store';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

/**
 * The build-time disable, tested through the gates it is supposed to reach
 * rather than by reading the list back.
 *
 * The whole design of `module-availability.ts` is that it is applied in one
 * place — the flag cache — so that every consumer which already honours the
 * operator's remote switch honours this one for free. That is a claim about
 * the *other* modules' behaviour, so asserting `LOCALLY_DISABLED_MODULES`
 * contains `rewards` would test nothing at all: it would pass just as happily
 * if the merge were deleted from the store.
 */
describe('a module this build does not ship', () => {
  beforeEach(() => {
    useModuleFlagsStore.getState().clear();
  });

  it('is off before anything has been fetched', () => {
    expect(isModuleEnabled(REWARDS_MODULE_ID)).toBe(false);
  });

  it('stays off when the server says it is on', () => {
    // The remote switch can turn a shipped module off. It must not be able to
    // turn one of these on — that asymmetry is the point of the file.
    useModuleFlagsStore.getState().setFlags({
      [REWARDS_MODULE_ID]: { enabled: true, message: null },
    });

    expect(isModuleEnabled(REWARDS_MODULE_ID)).toBe(false);
  });

  it('stays off when the server sends no opinion at all', () => {
    // An absent entry means enabled (0011 rule 1). That default is what this
    // list exists to override.
    useModuleFlagsStore.getState().setFlags({ journal: { enabled: false, message: 'Paused' } });

    expect(isModuleEnabled(REWARDS_MODULE_ID)).toBe(false);
    expect(isModuleEnabled('journal')).toBe(false);
    expect(isModuleEnabled('notes')).toBe(true);
  });

  it('does not take any other module with it', () => {
    expect(isLocallyDisabled('journal')).toBe(false);
    expect(isModuleEnabled('tasks')).toBe(true);
  });

  it('is off the Hub grid, out of the manager, and out of search', () => {
    const flags = useModuleFlagsStore.getState().flags;
    const context = {
      flags,
      privatised: [],
      overrides: {},
      focusAreas: [],
      showAllModules: true,
    };

    // 'operator' rather than null: the grid filters on exactly this.
    expect(hiddenReason(REWARDS_MODULE_ID, context)).toBe('operator');
    // No switch offered — a control that cannot change anything is worse than
    // no control.
    expect(isManageable(REWARDS_MODULE_ID, context)).toBe(false);
    // And nothing may render its content from elsewhere: a search hit or a
    // dashboard card here would be a tap-through to a redirect.
    expect(
      moduleMayBeShownIn(REWARDS_MODULE_ID, {
        flags,
        overrides: {},
        privatised: [],
        unlocked: false,
      }),
    ).toBe(false);
  });

  it('gates every route the module owns, not just its landing screen', () => {
    // The guard redirects on `flags[moduleForPath(path)]`, so a sub-route that
    // resolved to a different id — or to null — would be a live deep link into
    // a module that is supposed to be gone.
    for (const path of [
      '/challenge',
      '/challenge/join',
      '/challenge/swap',
      '/challenge/timeline',
    ]) {
      const moduleId = moduleForPath(path);
      expect(moduleId).toBe(REWARDS_MODULE_ID);
      expect(isModuleEnabled(moduleId as string)).toBe(false);
    }
  });

  it('names a module that actually exists', () => {
    // A typo here disables nothing and reports nothing. Every id in the list
    // has to match a real Hub entry.
    const known = new Set(HUB_SECTIONS.flatMap((section) => section.modules).map((m) => m.id));
    for (const moduleId of LOCALLY_DISABLED_MODULES) {
      expect(known).toContain(moduleId);
    }
  });
});
