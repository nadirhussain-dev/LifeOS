import { equippedOwned, useCosmeticsStore } from './cosmetics-store';

describe('equipping a cosmetic', () => {
  beforeEach(() => {
    useCosmeticsStore.setState({ equipped: {} });
  });

  it('keeps one slot per kind, so two chains can never both be worn', () => {
    const { equip } = useCosmeticsStore.getState();
    equip('chain', 'ember-glow');
    equip('chain', 'summit-aurora');
    expect(useCosmeticsStore.getState().equipped).toEqual({ chain: 'summit-aurora' });
  });

  it('lets different kinds be worn at once', () => {
    const { equip } = useCosmeticsStore.getState();
    equip('chain', 'ember-glow');
    equip('frame', 'blaze-ring');
    expect(useCosmeticsStore.getState().equipped).toEqual({
      chain: 'ember-glow',
      frame: 'blaze-ring',
    });
  });

  it('removes the key rather than storing an empty choice', () => {
    // A `{ chain: undefined }` and a missing key read the same in JS and
    // differently through JSON persistence, and only one of them survives a
    // round trip. Deleting keeps the two the same thing.
    const { equip } = useCosmeticsStore.getState();
    equip('chain', 'ember-glow');
    equip('chain', null);
    expect(Object.keys(useCosmeticsStore.getState().equipped)).toEqual([]);
  });
});

describe('equippedOwned', () => {
  it('returns the choice when the account owns it', () => {
    expect(equippedOwned({ chain: 'ember-glow' }, 'chain', ['ember-glow'])).toBe('ember-glow');
  });

  it('refuses a cosmetic this account does not own', () => {
    /*
     * The case the whole function exists for. This store is local and survives
     * a sign-out, so after somebody else signs in on the same phone the raw
     * `equipped` value names a chain they never earned. Validating at the point
     * of use is what makes that unforgettable — the alternative, a reset wired
     * into the sign-out flow, fails silently the day somebody forgets it.
     */
    expect(equippedOwned({ chain: 'ember-glow' }, 'chain', [])).toBeNull();
    expect(equippedOwned({ chain: 'ember-glow' }, 'chain', ['summit-aurora'])).toBeNull();
  });

  it('returns null for a kind with nothing equipped', () => {
    expect(equippedOwned({}, 'frame', ['blaze-ring'])).toBeNull();
  });
});
