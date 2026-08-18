import {
  ALWAYS_VISIBLE_MODULES,
  hiddenReason,
  isClosedByUser,
  isCurationActive,
  isManageable,
  isModuleVisible,
  type VisibilityContext,
} from '@/features/hub/services/module-visibility';

/**
 * The precedence between the four things that can hide a Hub module.
 *
 * Worth tests because the failure modes are asymmetric and none of them are
 * loud. Getting it wrong in one direction strips modules off somebody's Hub
 * with no error and no explanation; getting it wrong in the other shows a tile
 * for a module whose backend the operator has just pulled, which is the exact
 * support mail the kill switch exists to prevent.
 */

const base: VisibilityContext = {
  flags: {},
  privatised: [],
  overrides: {},
  focusAreas: [],
  showAllModules: false,
};

/** `budget` is in MODULE_FOCUS_MAP, so the focus areas can reach it.
 *  `notes` deliberately is not — curation must leave it alone. */
const curating: VisibilityContext = { ...base, focusAreas: ['sleep'] };

describe('isCurationActive', () => {
  it('is off when no focus areas were chosen', () => {
    // Skipping the onboarding question must not curate anything — see the
    // comment on isCurationActive for why an empty answer is not "none".
    expect(isCurationActive(base)).toBe(false);
  });

  it('is off when the user asked to see everything', () => {
    expect(isCurationActive({ ...curating, showAllModules: true })).toBe(false);
  });

  it('is on with focus areas and no global override', () => {
    expect(isCurationActive(curating)).toBe(true);
  });
});

describe('hiddenReason', () => {
  it('shows everything by default', () => {
    expect(hiddenReason('budget', base)).toBeNull();
    expect(hiddenReason('notes', base)).toBeNull();
  });

  it('curates out a module outside the focus areas', () => {
    expect(hiddenReason('budget', curating)).toBe('curated');
  });

  it('leaves modules with no focus area alone', () => {
    expect(hiddenReason('notes', curating)).toBeNull();
  });

  it('lets an explicit yes beat curation', () => {
    const context = { ...curating, overrides: { budget: true } };
    expect(hiddenReason('budget', context)).toBeNull();
  });

  it('lets an explicit no beat a module the focus areas kept', () => {
    const context = { ...curating, overrides: { sleep: false } };
    expect(hiddenReason('sleep', context)).toBe('closed');
  });

  it('puts the operator kill switch above the user asking for it', () => {
    const context: VisibilityContext = {
      ...base,
      flags: { budget: { enabled: false, message: null } },
      overrides: { budget: true },
    };
    expect(hiddenReason('budget', context)).toBe('operator');
  });

  it('keeps an enabled flag from hiding anything', () => {
    const context: VisibilityContext = {
      ...base,
      flags: { budget: { enabled: true, message: null } },
    };
    expect(hiddenReason('budget', context)).toBeNull();
  });

  it('puts the private space above the user asking for it', () => {
    const context = { ...base, privatised: ['journal'], overrides: { journal: true } };
    expect(hiddenReason('journal', context)).toBe('private');
  });

  it('ignores both the guess and an explicit close for always-visible modules', () => {
    for (const id of ALWAYS_VISIBLE_MODULES) {
      expect(hiddenReason(id, { ...curating, overrides: { [id]: false } })).toBeNull();
    }
  });

  it('still honours the operator switch for always-visible modules', () => {
    for (const id of ALWAYS_VISIBLE_MODULES) {
      const context: VisibilityContext = {
        ...base,
        flags: { [id]: { enabled: false, message: null } },
      };
      expect(hiddenReason(id, context)).toBe('operator');
    }
  });
});

describe('isModuleVisible', () => {
  it('agrees with hiddenReason', () => {
    expect(isModuleVisible('budget', base)).toBe(true);
    expect(isModuleVisible('budget', curating)).toBe(false);
  });
});

describe('isManageable', () => {
  it('offers a switch for an ordinary module', () => {
    expect(isManageable('budget', base)).toBe(true);
    // Including one curation has hidden — that is the whole point of the sheet.
    expect(isManageable('budget', curating)).toBe(true);
  });

  it('offers no switch for a module the operator pulled', () => {
    const context: VisibilityContext = {
      ...base,
      flags: { budget: { enabled: false, message: null } },
    };
    expect(isManageable('budget', context)).toBe(false);
  });

  it('offers no switch for a privatised module', () => {
    // A row reading "Journal" in a sheet on the ordinary Hub would announce
    // that there is a private space and what is in it.
    expect(isManageable('journal', { ...base, privatised: ['journal'] })).toBe(false);
  });

  it('offers no switch for the modules that must stay', () => {
    for (const id of ALWAYS_VISIBLE_MODULES) {
      expect(isManageable(id, base)).toBe(false);
    }
  });
});

/**
 * `isClosedByUser` is the gate that turns a module OFF rather than merely
 * hiding its tile — routes stop opening, reminders stop firing. So the thing
 * worth testing is what it declines to cover: three of the four hidden reasons
 * must not reach it, and the reason each one is excluded is different.
 */
describe('isClosedByUser', () => {
  it('is true only for a module the user actually switched off', () => {
    expect(isClosedByUser('budget', { budget: false })).toBe(true);
    expect(isClosedByUser('budget', { budget: true })).toBe(false);
    expect(isClosedByUser('budget', {})).toBe(false);
  });

  it('never disables a module the guess merely dropped', () => {
    // The whole point: a curated-out module keeps working, because its
    // reminders and deep links are how somebody finds a module onboarding
    // hid on their behalf. Only an explicit `false` counts.
    expect(isClosedByUser('budget', curating.overrides)).toBe(false);
    expect(hiddenReason('budget', curating)).toBe('curated');
  });

  it('cannot switch off the modules that must stay, whatever the store says', () => {
    for (const id of ALWAYS_VISIBLE_MODULES) {
      expect(isClosedByUser(id, { [id]: false })).toBe(false);
    }
  });
});
