import { notifyWrite } from '@/database/write-observer';
import { attributableModules, moduleForTable } from '@/features/challenge/config/write-attribution';
import { startChallengeWriteTracking } from '@/features/challenge/services/challenge-tracking';
import { currentDay, useChallengeStore } from '@/features/challenge/store/challenge-store';

/**
 * That a write to a module's table actually reaches the challenge buffer.
 *
 * This is the wiring test the plan called for, aimed at a different target than
 * originally intended. The plan assumed each feature's mutation hook would call
 * a tracking function, and that the risk was somebody deleting the call during a
 * refactor. Observing the database instead removes that risk rather than testing
 * for it — a module cannot stop being observed without ceasing to use the
 * database — so what is worth holding here is the part that *can* still break:
 * the map from table to module, and the fact that the observer is connected at
 * all.
 */

const reset = () => {
  useChallengeStore.setState({
    enrolled: false,
    seasonId: null,
    required: [],
    minWrites: 1,
    days: {},
    hydrated: true,
  });
};

describe('attribution', () => {
  it('covers every module the challenge is likely to make eligible', () => {
    // The eligible set proposed in docs/REWARDS_PROGRAM.md §1.2.1. If a module
    // here stops being attributable, somebody could commit to it and then be
    // unable to satisfy it — the worst failure this feature has.
    for (const module of [
      'habits',
      'tasks',
      'journal',
      'water',
      'sleep',
      'study',
      'goals',
      'notes',
    ]) {
      expect(attributableModules()).toContain(module);
    }
  });

  it('maps a module’s own tables to it', () => {
    expect(moduleForTable('habits')).toBe('habits');
    expect(moduleForTable('habit_logs')).toBe('habits');
    expect(moduleForTable('tasks')).toBe('tasks');
    expect(moduleForTable('journal_entries')).toBe('journal');
    expect(moduleForTable('water_intake_logs')).toBe('water');
  });

  it('is case-insensitive, because SQLite and drizzle disagree about quoting', () => {
    expect(moduleForTable('HABIT_LOGS')).toBe('habits');
  });

  it('counts nothing for a table no module owns', () => {
    expect(moduleForTable('notification_log')).toBeNull();
    expect(moduleForTable('some_future_table')).toBeNull();
  });

  it('does not count changing a module’s settings as using it', () => {
    // Otherwise a streak could be held by toggling a reminder switch every
    // evening, which is configuration and not use.
    expect(moduleForTable('sleep_settings')).toBeNull();
    expect(moduleForTable('study_settings')).toBeNull();
  });
});

describe('the write path, end to end', () => {
  let stop: () => void;

  beforeEach(() => {
    reset();
    stop = startChallengeWriteTracking();
  });
  afterEach(() => stop());

  it('buffers nothing at all before somebody has joined a run', () => {
    notifyWrite('insert into "habit_logs" ("id") values (?)');
    expect(useChallengeStore.getState().days).toEqual({});
  });

  it('records a write against the right module once enrolled', () => {
    useChallengeStore
      .getState()
      .setEnrolment({ seasonId: 's', required: ['habits', 'water'], minWrites: 1 });

    notifyWrite('insert into "habit_logs" ("id") values (?)');
    notifyWrite('update "habits" set "name" = ? where "id" = ?');
    notifyWrite('insert into "water_intake_logs" ("id") values (?)');

    expect(useChallengeStore.getState().days[currentDay()].writes).toEqual({
      habits: 2,
      water: 1,
    });
  });

  it('ignores reads, so opening a screen is not the same as using it', () => {
    useChallengeStore
      .getState()
      .setEnrolment({ seasonId: 's', required: ['habits'], minWrites: 1 });
    notifyWrite('select * from "habits"');
    expect(useChallengeStore.getState().days).toEqual({});
  });

  it('stops observing once torn down', () => {
    useChallengeStore
      .getState()
      .setEnrolment({ seasonId: 's', required: ['habits'], minWrites: 1 });
    stop();
    notifyWrite('insert into "habit_logs" ("id") values (?)');
    expect(useChallengeStore.getState().days).toEqual({});
    stop = () => undefined;
  });
});
