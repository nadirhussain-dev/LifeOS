import {
  capsExceedMonthlyBudget,
  categoryBudgetStatuses,
  categoryStatus,
} from '@/features/budget/services/category-budgets';

describe('categoryStatus', () => {
  it('reports what is left', () => {
    expect(categoryStatus('food', 3000, 5000)).toMatchObject({
      spentCents: 3000,
      limitCents: 5000,
      remainingCents: 2000,
      ratio: 0.6,
      isOver: false,
    });
  });

  it('reports a negative remainder rather than clamping to zero', () => {
    // "£12 over" is the actionable number; "£0 left" is not.
    expect(categoryStatus('food', 7000, 5000).remainingCents).toBe(-2000);
  });

  it('does not clamp the ratio', () => {
    // 20% over and 300% over are not the same month. The bar clamps; the number
    // it is derived from must not.
    expect(categoryStatus('food', 20000, 5000).ratio).toBe(4);
  });

  it('is exactly at the cap without being over', () => {
    const status = categoryStatus('food', 5000, 5000);
    expect(status.ratio).toBe(1);
    expect(status.isOver).toBe(false);
    expect(status.remainingCents).toBe(0);
  });

  describe('a cap of zero', () => {
    // Zero is a real intention — "I plan to spend nothing here" — not an
    // absent cap, and there is no ratio that expresses spending against it.
    it('is not over budget when nothing was spent', () => {
      const status = categoryStatus('gym', 0, 0);
      expect(status.ratio).toBe(0);
      expect(status.isOver).toBe(false);
    });

    it('is over budget the moment anything is spent, without dividing by zero', () => {
      const status = categoryStatus('gym', 100, 0);
      expect(status.isOver).toBe(true);
      expect(status.ratio).toBe(Number.POSITIVE_INFINITY);
      expect(Number.isNaN(status.ratio)).toBe(false);
    });
  });
});

describe('categoryBudgetStatuses', () => {
  it('puts the worst first, because that is why the list is opened', () => {
    const statuses = categoryBudgetStatuses(
      { food: 4000, transport: 9000, gym: 500 },
      { food: 5000, transport: 6000, gym: 5000 },
    );
    expect(statuses.map((s) => s.category)).toEqual(['transport', 'food', 'gym']);
  });

  it('counts a capped category with no spending as zero', () => {
    const statuses = categoryBudgetStatuses({}, { food: 5000 });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ spentCents: 0, remainingCents: 5000 });
  });

  it('omits categories nobody capped', () => {
    // An uncapped category is not "0% of nothing", it is one this feature has
    // no opinion about — listing it would invent a budget the user never set.
    const statuses = categoryBudgetStatuses({ food: 4000, shopping: 9000 }, { food: 5000 });
    expect(statuses.map((s) => s.category)).toEqual(['food']);
  });

  it('returns nothing when no caps are set', () => {
    expect(categoryBudgetStatuses({ food: 4000 }, {})).toEqual([]);
  });
});

describe('capsExceedMonthlyBudget', () => {
  it('notices when the caps add up to more than the month', () => {
    expect(capsExceedMonthlyBudget({ food: 5000, transport: 6000 }, 10000)).toBe(true);
  });

  it('is content when they fit', () => {
    expect(capsExceedMonthlyBudget({ food: 5000, transport: 4000 }, 10000)).toBe(false);
  });

  it('is content when they add up to exactly the month', () => {
    expect(capsExceedMonthlyBudget({ food: 5000, transport: 5000 }, 10000)).toBe(false);
  });

  it('has no opinion without a monthly budget', () => {
    expect(capsExceedMonthlyBudget({ food: 5000 }, null)).toBe(false);
  });
});
