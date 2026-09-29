import { HUB_SECTIONS } from '@/features/hub/config/modules';
// `jest.mock` below is hoisted above this by babel, so the store still closes
// over the synthetic list.
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
 * The build-time disable, driven with a synthetic id.
 *
 * The list is empty — it held `rewards` while the streak programme was being
 * withheld, and that module has since been removed rather than hidden. An empty
 * list makes every assertion about its *contents* vacuous, so this mocks a
 * module in instead and tests the thing that actually has to keep working: that
 * an entry here beats whatever the server says, in the one place the merge
 * happens.
 *
 * Testing it through `isModuleEnabled` rather than by reading the array back is
 * the same choice the previous version made, and for the same reason: the whole
 * design is that the disable is applied once, in the flag cache, so every gate
 * that honours the operator's remote switch honours this one for free. Reading
 * the array back would pass just as happily with the merge deleted.
 */
jest.mock('@/features/hub/config/module-availability', () => ({
  LOCALLY_DISABLED_MODULES: ['journal'],
  isLocallyDisabled: (id: string) => id === 'journal',
}));

describe('a module this build does not ship', () => {
  beforeEach(() => {
    useModuleFlagsStore.getState().clear();
  });

  it('is off before anything has been fetched', () => {
    expect(isModuleEnabled('journal')).toBe(false);
  });

  it('stays off when the server says it is on', () => {
    // The remote switch can turn a shipped module off. It must not be able to
    // turn one of these on — that asymmetry is the point of the file.
    useModuleFlagsStore.getState().setFlags({ journal: { enabled: true, message: null } });
    expect(isModuleEnabled('journal')).toBe(false);
  });

  it('stays off when the server sends no opinion at all', () => {
    // An absent entry means enabled (0011 rule 1). That default is what this
    // list exists to override.
    useModuleFlagsStore.getState().setFlags({ notes: { enabled: false, message: 'Paused' } });

    expect(isModuleEnabled('journal')).toBe(false);
    expect(isModuleEnabled('notes')).toBe(false);
    expect(isModuleEnabled('tasks')).toBe(true);
  });

  it('does not take any other module with it', () => {
    expect(isModuleEnabled('tasks')).toBe(true);
  });
});

describe('the real list', () => {
  it('names modules that actually exist', () => {
    // A typo disables nothing and reports nothing. Vacuous while the list is
    // empty, and the assertion that stops the next entry being a dead string.
    const { LOCALLY_DISABLED_MODULES } = jest.requireActual<{
      LOCALLY_DISABLED_MODULES: readonly string[];
    }>('@/features/hub/config/module-availability');
    const known = new Set(HUB_SECTIONS.flatMap((section) => section.modules).map((m) => m.id));
    for (const moduleId of LOCALLY_DISABLED_MODULES) {
      expect(known).toContain(moduleId);
    }
  });
});
