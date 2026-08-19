import {
  checklistForNextOccurrence,
  subtaskProgress,
} from '@/features/tasks/services/subtask-progress';
import type { Subtask } from '@/features/tasks/types/task.types';

const item = (over: Partial<Subtask> = {}): Subtask => ({
  id: 's1',
  taskId: 't1',
  title: 'Something',
  isDone: false,
  completedAt: null,
  position: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('subtaskProgress', () => {
  it('counts what is done against the whole list', () => {
    const progress = subtaskProgress([
      item({ id: 'a', isDone: true }),
      item({ id: 'b', isDone: true }),
      item({ id: 'c' }),
      item({ id: 'd' }),
    ]);
    expect(progress).toEqual({ done: 2, total: 4, ratio: 0.5 });
  });

  it('reports an empty checklist as 0, not as complete', () => {
    // This drives a progress bar. A task with no subtasks rendering full reads
    // as "done" on a list of things that are not.
    expect(subtaskProgress([])).toEqual({ done: 0, total: 0, ratio: 0 });
  });

  it('reports a finished checklist as complete', () => {
    expect(subtaskProgress([item({ isDone: true })]).ratio).toBe(1);
  });
});

describe('checklistForNextOccurrence', () => {
  it('carries the items onto the next occurrence unticked', () => {
    const next = checklistForNextOccurrence([
      item({ id: 'a', title: 'Rinse', position: 0, isDone: true }),
      item({ id: 'b', title: 'Refill', position: 1, isDone: true }),
    ]);
    expect(next).toEqual([
      { title: 'Rinse', position: 0 },
      { title: 'Refill', position: 1 },
    ]);
  });

  it('keeps the order the user wrote, not the order the rows came back in', () => {
    const next = checklistForNextOccurrence([
      item({ id: 'c', title: 'Third', position: 9 }),
      item({ id: 'a', title: 'First', position: 1 }),
      item({ id: 'b', title: 'Second', position: 4 }),
    ]);
    expect(next.map((s) => s.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('renumbers positions so gaps left by deleted items do not accumulate', () => {
    const next = checklistForNextOccurrence([
      item({ id: 'a', position: 3 }),
      item({ id: 'b', position: 17 }),
    ]);
    expect(next.map((s) => s.position)).toEqual([0, 1]);
  });

  it('does not mutate the list it was given', () => {
    const list = [item({ id: 'b', position: 2 }), item({ id: 'a', position: 1 })];
    checklistForNextOccurrence(list);
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('handles a task with no checklist', () => {
    expect(checklistForNextOccurrence([])).toEqual([]);
  });
});
