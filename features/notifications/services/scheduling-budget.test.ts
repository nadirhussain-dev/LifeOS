import {
  allowance,
  hasHeadroom,
  releaseSlot,
  remainingSlots,
  seedSlots,
  slotsSpent,
  spendSlot,
} from '@/features/notifications/services/scheduling-budget';

/**
 * The ceiling this defends is invisible when it is breached: iOS accepts every
 * `scheduleNotificationAsync` call and then keeps only the 64 soonest-firing,
 * with no error and no callback. So the failure mode is a task due-time that
 * simply never arrives, and the only observable difference between "scheduled"
 * and "silently discarded" is whether the app stayed under the limit.
 */

const IOS = 60;
const ANDROID = Number.POSITIVE_INFINITY;

beforeEach(() => seedSlots(0));

describe('the ledger', () => {
  it('counts what has been scheduled', () => {
    spendSlot();
    spendSlot();
    expect(slotsSpent()).toBe(2);
    expect(remainingSlots(IOS)).toBe(58);
  });

  it('gives a slot back when a notification is cancelled', () => {
    spendSlot();
    releaseSlot();
    expect(slotsSpent()).toBe(0);
  });

  it('never counts below zero', () => {
    // Cancelling something scheduled by a previous launch releases a slot the
    // ledger never saw spent; that must not create phantom headroom.
    releaseSlot();
    releaseSlot();
    expect(slotsSpent()).toBe(0);
    expect(remainingSlots(IOS)).toBe(IOS);
  });

  it('reseeds from the real queue', () => {
    spendSlot();
    seedSlots(41);
    expect(slotsSpent()).toBe(41);
    expect(remainingSlots(IOS)).toBe(19);
  });
});

describe('headroom', () => {
  it('is exhausted exactly at the budget, not past it', () => {
    seedSlots(IOS - 1);
    expect(hasHeadroom(IOS)).toBe(true);
    spendSlot();
    expect(hasHeadroom(IOS)).toBe(false);
    expect(remainingSlots(IOS)).toBe(0);
  });

  it('is never exhausted on a platform without a ceiling', () => {
    // Android has no equivalent limit, so every guard built on this has to be
    // a no-op there rather than a smaller ceiling.
    seedSlots(5000);
    expect(hasHeadroom(ANDROID)).toBe(true);
    expect(remainingSlots(ANDROID)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('allowance', () => {
  it('grants the full request when there is room', () => {
    expect(allowance(12, IOS)).toBe(12);
  });

  it('grants only what is left when there is not', () => {
    seedSlots(55);
    expect(allowance(12, IOS)).toBe(5);
  });

  it('grants nothing once the budget is spent', () => {
    seedSlots(IOS);
    expect(allowance(12, IOS)).toBe(0);
  });

  it('holds slots back for the steps that have not run yet', () => {
    // Hydration is scheduled near-last but is the biggest consumer; the digest
    // and the private-space reminders still come after it.
    seedSlots(50);
    expect(allowance(12, IOS, 4)).toBe(6);
  });

  it('grants nothing rather than a negative when the reserve alone exceeds what is left', () => {
    seedSlots(58);
    expect(allowance(12, IOS, 4)).toBe(0);
  });

  it('is unbounded where the platform is', () => {
    expect(allowance(27, ANDROID)).toBe(27);
  });
});
