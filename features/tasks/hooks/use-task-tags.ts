import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createTag, deleteTag } from '@/features/notes/services/notes-repository';
import { listTagsForTask, setTagsForTask } from '@/features/tasks/services/task-tags-repository';

// The tag vocabulary itself is read with `useNoteTags` from the notes module,
// which already owns it. A second hook here would have been a second cache key
// over the same rows, so a tag created on this screen would not have appeared
// on the notes screen until something else invalidated it.

export function useTaskTags(taskId: string | undefined) {
  return useQuery({
    queryKey: ['tasks', 'tags', taskId],
    queryFn: async () => (taskId ? listTagsForTask(taskId) : []),
    enabled: !!taskId,
  });
}

export function useTaskTagMutations(taskId: string | undefined) {
  const queryClient = useQueryClient();

  // Both namespaces: the links live under `tasks`, the vocabulary under
  // `notes`, and creating a tag from this screen has to show up on the notes
  // screen too.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['note-tags'] });
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const setTags = useMutation({
    mutationFn: async (tagIds: string[]) => {
      if (!taskId) return;
      setTagsForTask(taskId, tagIds);
    },
    onSuccess: invalidate,
  });

  const addTag = useMutation({
    mutationFn: async (name: string) => createTag(name),
    onSuccess: invalidate,
  });

  const removeTag = useMutation({
    mutationFn: async (tagId: string) => {
      deleteTag(tagId);
    },
    onSuccess: invalidate,
  });

  return { setTags, addTag, removeTag };
}
