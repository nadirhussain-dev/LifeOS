import { create } from 'zustand';

import type { TaskListFilter, TaskSort } from '@/features/tasks/types/task.types';

type TasksFilterState = {
  filter: TaskListFilter;
  sort: TaskSort;
  searchQuery: string;
  /** One tag, not a set. Narrowing to "tasks in both #home and #urgent" is a
   *  different question from "tasks in #home", and answering it well needs an
   *  and/or choice this row has nowhere to put. One tag is the question people
   *  actually ask of a tag chip. */
  tagId: string | null;
  setFilter: (filter: TaskListFilter) => void;
  setSort: (sort: TaskSort) => void;
  setSearchQuery: (query: string) => void;
  setTagId: (tagId: string | null) => void;
};

export const useTasksFilterStore = create<TasksFilterState>((set) => ({
  filter: 'active',
  sort: 'due-date',
  searchQuery: '',
  tagId: null,
  setFilter: (filter) => set({ filter }),
  setSort: (sort) => set({ sort }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setTagId: (tagId) => set({ tagId }),
}));
