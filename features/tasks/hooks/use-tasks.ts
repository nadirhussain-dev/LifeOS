import { useQuery } from '@tanstack/react-query';

import { listTaskIdsForTag } from '@/features/tasks/services/task-tags-repository';
import {
  getCategoryById,
  listCategories,
  listTasks,
} from '@/features/tasks/services/tasks-repository';
import { useTasksFilterStore } from '@/features/tasks/store/tasks-filter-store';

export function useTasks() {
  const { filter, sort, searchQuery, tagId } = useTasksFilterStore();

  return useQuery({
    // The tag is part of the key, not just the `select`: it is answered by a
    // second query against the link table, so it has to re-run when the tag
    // changes rather than being re-filtered from a cached list.
    queryKey: ['tasks', filter, sort, tagId],
    queryFn: async () => {
      const tasks = listTasks(filter, sort);
      if (!tagId) return tasks;
      const tagged = new Set(listTaskIdsForTag(tagId));
      return tasks.filter((task) => tagged.has(task.id));
    },
    select: (tasks) =>
      searchQuery.trim()
        ? tasks.filter((task) =>
            task.title.toLowerCase().includes(searchQuery.trim().toLowerCase()),
          )
        : tasks,
  });
}

export function useTaskCategories() {
  return useQuery({ queryKey: ['task-categories'], queryFn: async () => listCategories() });
}

/** Resolves a category by id regardless of soft-delete, so an already-assigned task keeps showing its label. */
export function useTaskCategoryById(id: string | null) {
  return useQuery({
    queryKey: ['task-categories', 'detail', id],
    queryFn: async () => (id ? getCategoryById(id) : null),
    enabled: !!id,
  });
}
