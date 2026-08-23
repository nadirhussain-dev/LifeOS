import {
  RUNG_HORIZON_DAYS,
  VARIANTS,
  reminderCopyFor,
  variantFor,
  type ReminderInput,
} from './reminder-copy';

const base: ReminderInput = {
  modules: 'Journal, Water',
  cost: null,
  shields: 0,
  qualifiedDays: 84,
  daysToRung: null,
  rungName: null,
  localDay: '2026-08-22',
};

describe('variantFor', () => {
  it('stays the same all day', () => {
    // The reminder is cancelled and rescheduled on every write, so a rotation
    // that moved within a day would rebuild a different notification each time
    // somebody logged something.
    expect(variantFor('2026-08-22')).toBe(variantFor('2026-08-22'));
  });

  it('lands inside the range of keys that exist', () => {
    // A variant with no i18n key renders the key path itself, in the middle of
    // a notification.
    for (const day of ['2026-01-01', '2026-08-22', '2026-12-31', '2027-06-15']) {
      const v = variantFor(day);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(VARIANTS);
    }
  });

  it('does move between consecutive days', () => {
    // The whole point. Asserted across a stretch rather than on one pair,
    // because a digit sum steps by one most days and rolls at a month boundary.
    const week = ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'].map((d) => variantFor(d));
    expect(new Set(week).size).toBeGreaterThan(1);
  });

  it('ignores the punctuation rather than counting it', () => {
    expect(variantFor('2026-08-22')).toBe(variantFor('20260822'));
  });
});

describe('reminderCopyFor', () => {
  it('leads with a rung that is nearly here', () => {
    /*
     * The one branch that offers a reason to act rather than a consequence of
     * not acting, and it outranks the cost line even though the cost line
     * carries a number. "Two days to Ember" is the most motivating true
     * sentence available on those two days.
     */
    const copy = reminderCopyFor({
      ...base,
      cost: 24,
      daysToRung: 2,
      rungName: 'Ember',
    });
    expect(copy.bodyKey).toBe('challenge.reminderNearRung');
    expect(copy.values).toMatchObject({ count: 2, name: 'Ember', modules: 'Journal, Water' });
  });

  it('still counts down when the rung has no name yet', () => {
    // A cold start has the thresholds (they arrive with the counters) and no
    // names (those come from the ladder screen). Losing the countdown over a
    // missing name would drop the most motivating line for exactly the people
    // who have not been looking at the app.
    const copy = reminderCopyFor({ ...base, daysToRung: 1, rungName: null });
    expect(copy.bodyKey).toBe('challenge.reminderNearRungPlain');
    expect(copy.values).toMatchObject({ count: 1, modules: 'Journal, Water' });
    expect(copy.values.name).toBeUndefined();
  });

  it('goes quiet about the rung once it is further off than the horizon', () => {
    // What stops it wearing out: it is invisible except on the few days it is
    // the most useful thing that can be said.
    const copy = reminderCopyFor({
      ...base,
      cost: 24,
      daysToRung: RUNG_HORIZON_DAYS + 1,
      rungName: 'Ember',
    });
    expect(copy.bodyKey).toBe('challenge.reminderCost');
  });

  it('states the price when there is an honest number for it', () => {
    const copy = reminderCopyFor({ ...base, cost: 24 });
    expect(copy.bodyKey).toBe('challenge.reminderCost');
    expect(copy.values).toMatchObject({ count: 24, from: 84, to: 60 });
  });

  it('says a shield will take it when one will', () => {
    // A warning somebody knows is overstated is a warning they stop reading.
    const copy = reminderCopyFor({ ...base, shields: 2 });
    expect(copy.bodyKey).toBe('challenge.reminderShielded');
  });

  it('rotates the framing when there is nothing else true to say', () => {
    const monday = reminderCopyFor({ ...base, localDay: '2026-08-20' });
    const tuesday = reminderCopyFor({ ...base, localDay: '2026-08-21' });
    expect(monday.bodyKey).toMatch(/^challenge\.nudgeBody\.\d$/);
    expect(monday.bodyKey).not.toBe(tuesday.bodyKey);
  });

  it('names the outstanding modules in every branch', () => {
    // The facts never rotate — only the framing does. A nudge that dropped the
    // list would be a generic "your streak is at risk", which is the thing this
    // reminder beats by being specific.
    const cases: ReminderInput[] = [
      { ...base, daysToRung: 1, rungName: 'Ember' },
      { ...base, cost: 12 },
      { ...base, shields: 1 },
      { ...base },
    ];
    for (const input of cases) {
      expect(reminderCopyFor(input).values.modules).toBe('Journal, Water');
    }
  });

  it('rotates the title independently of which body was chosen', () => {
    // The title is the part visible on a lock screen before anything is
    // expanded, so it is the part that has to stop looking identical.
    const copy = reminderCopyFor({ ...base, cost: 12 });
    expect(copy.titleKey).toMatch(/^challenge\.nudgeTitle\.\d$/);
  });
});
