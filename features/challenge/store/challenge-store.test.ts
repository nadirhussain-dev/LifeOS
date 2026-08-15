import { currentDay, useChallengeStore } from './challenge-store';

const YESTERDAY = '2026-08-13';
const TODAY_FIXED = '2026-08-14';
const ANCIENT = '2026-07-01';

const reset = () =>
  useChallengeStore.setState({
    enrolled: false,
    seasonId: null,
    required: [],
    minWrites: 1,
    days: {},
    hydrated: true,
  });

const enrol = () =>
  useChallengeStore
    .getState()
    .setEnrolment({ seasonId: 'season-1', required: ['habits', 'water'], minWrites: 1 });

describe('the day buffer', () => {
  beforeEach(reset);

  it('ignores everything until somebody has joined a run', () => {
    useChallengeStore.getState().recordWrite('habits');
    useChallengeStore.getState().addActiveSeconds(120);
    expect(useChallengeStore.getState().days).toEqual({});
  });

  it('counts writes per module rather than as one number', () => {
    enrol();
    useChallengeStore.getState().recordWrite('habits');
    useChallengeStore.getState().recordWrite('habits');
    useChallengeStore.getState().recordWrite('water');

    expect(useChallengeStore.getState().days[currentDay()].writes).toEqual({
      habits: 2,
      water: 1,
    });
  });

  it('accrues foreground time in whole seconds', () => {
    enrol();
    useChallengeStore.getState().addActiveSeconds(12.4);
    useChallengeStore.getState().addActiveSeconds(30.6);
    expect(useChallengeStore.getState().days[currentDay()].activeSeconds).toBe(43);
  });

  it('refuses a negative or empty stretch of time', () => {
    enrol();
    useChallengeStore.getState().addActiveSeconds(0);
    useChallengeStore.getState().addActiveSeconds(-90);
    expect(useChallengeStore.getState().days).toEqual({});
  });

  it('keeps days apart, so a day rolling over starts a fresh one', () => {
    enrol();
    useChallengeStore.getState().recordWrite('habits', YESTERDAY);
    useChallengeStore.getState().recordWrite('water', TODAY_FIXED);

    const { days } = useChallengeStore.getState();
    expect(days[YESTERDAY].writes).toEqual({ habits: 1 });
    expect(days[TODAY_FIXED].writes).toEqual({ water: 1 });
  });
});

describe('what gets offered to the server', () => {
  beforeEach(reset);

  it('offers the oldest day first, so the ledger fills in order', () => {
    enrol();
    useChallengeStore.getState().recordWrite('water', TODAY_FIXED);
    useChallengeStore.getState().recordWrite('habits', YESTERDAY);

    const pending = useChallengeStore.getState().pendingDays();
    expect(pending.map((p) => p.day)).toEqual([YESTERDAY, TODAY_FIXED]);
  });

  it('offers nothing for a day with no evidence in it', () => {
    enrol();
    useChallengeStore.setState({ days: { [TODAY_FIXED]: { writes: {}, activeSeconds: 0 } } });
    expect(useChallengeStore.getState().pendingDays()).toEqual([]);
  });

  it('never offers a day the server would refuse', () => {
    enrol();
    useChallengeStore.getState().recordWrite('habits', ANCIENT);
    useChallengeStore.getState().recordWrite('habits', YESTERDAY);
    useChallengeStore.getState().recordWrite('habits', TODAY_FIXED);

    // Only today and yesterday are inside the server's window; a third day
    // would be buffered forever and accepted never.
    expect(
      useChallengeStore
        .getState()
        .pendingDays()
        .map((p) => p.day),
    ).toEqual([YESTERDAY, TODAY_FIXED]);
  });
});

describe('pruning and forgetting', () => {
  beforeEach(reset);

  it('drops days that have aged out of the window', () => {
    enrol();
    useChallengeStore.getState().recordWrite('habits', ANCIENT);
    useChallengeStore.getState().recordWrite('habits', YESTERDAY);
    useChallengeStore.getState().recordWrite('habits', TODAY_FIXED);

    useChallengeStore.getState().prune(TODAY_FIXED);
    expect(Object.keys(useChallengeStore.getState().days).sort()).toEqual([YESTERDAY, TODAY_FIXED]);
  });

  it('forgets one named day, for when the server has refused it outright', () => {
    enrol();
    useChallengeStore.getState().recordWrite('habits', YESTERDAY);
    useChallengeStore.getState().recordWrite('habits', TODAY_FIXED);

    useChallengeStore.getState().dropDay(YESTERDAY);
    expect(Object.keys(useChallengeStore.getState().days)).toEqual([TODAY_FIXED]);
  });
});

describe('leaving a run', () => {
  beforeEach(reset);

  it('takes the buffer with it', () => {
    enrol();
    useChallengeStore.getState().recordWrite('habits');
    useChallengeStore.getState().clearEnrolment();

    const state = useChallengeStore.getState();
    expect(state.enrolled).toBe(false);
    expect(state.days).toEqual({});
    // Otherwise these counters would flush into whatever season was joined next.
  });
});
