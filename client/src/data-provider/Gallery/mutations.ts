import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseMutationOptions } from '@tanstack/react-query';
import type {
  CreateGallerySkillTaskPayload,
  GallerySkillTask,
  SkillTaskFrequency,
  SkillTaskStatus,
} from 'librechat-data-provider';
import { dataService, QueryKeys } from 'librechat-data-provider';

type SkillTasksQueryData = { tasks: GallerySkillTask[] };
type UpdateGallerySkillTaskVariables = {
  taskId: string;
  payload: Partial<
    Pick<GallerySkillTask, 'enabled' | 'status' | 'frequency' | 'interval' | 'scheduleTime' | 'taskName'>
  >;
};

const skillTasksQueryKey: QueryKey = [QueryKeys.galleryArtifacts, 'skill-tasks'];

const updateSkillTaskCaches = (
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (tasks: GallerySkillTask[]) => GallerySkillTask[],
) => {
  queryClient.setQueriesData<SkillTasksQueryData>(skillTasksQueryKey, (current) => {
    if (!current?.tasks) {
      return current;
    }
    return { ...current, tasks: updater(current.tasks) };
  });
};

export const useCreateGallerySkillTaskMutation = (
  config?: UseMutationOptions<{ task: GallerySkillTask }, unknown, CreateGallerySkillTaskPayload>,
) => {
  const queryClient = useQueryClient();

  return useMutation<{ task: GallerySkillTask }, unknown, CreateGallerySkillTaskPayload>(
    (payload) => dataService.createGallerySkillTask(payload),
    {
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'skill-tasks']);
        config?.onSuccess?.(...args);
      },
      ...config,
    },
  );
};

export const useUpdateGallerySkillTaskMutation = (
  config?: UseMutationOptions<{ task: GallerySkillTask }, unknown, UpdateGallerySkillTaskVariables>,
) => {
  const queryClient = useQueryClient();

  return useMutation<{ task: GallerySkillTask }, unknown, UpdateGallerySkillTaskVariables>(
    ({ taskId, payload }) => dataService.updateGallerySkillTask(taskId, payload),
    {
      onMutate: ({ taskId, payload }) => {
        updateSkillTaskCaches(queryClient, (tasks) =>
          tasks.map((task) => (task.id === taskId ? { ...task, ...payload } : task)),
        );
      },
      onSuccess: (data, variables, context) => {
        updateSkillTaskCaches(queryClient, (tasks) =>
          tasks.map((task) => (task.id === data.task.id ? data.task : task)),
        );
        queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'skill-tasks']);
        config?.onSuccess?.(data, variables, context);
      },
      onError: (error, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'skill-tasks']);
        config?.onError?.(error, variables, context);
      },
      ...config,
    },
  );
};

export const useRunGallerySkillTaskMutation = (
  config?: UseMutationOptions<{ task: GallerySkillTask; run: unknown }, unknown, string>,
) => {
  const queryClient = useQueryClient();

  return useMutation<{ task: GallerySkillTask; run: unknown }, unknown, string>(
    (taskId) => dataService.runGallerySkillTask(taskId),
    {
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'skill-tasks']);
        queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'skill-runs']);
        config?.onSuccess?.(...args);
      },
      ...config,
    },
  );
};

export const useDeleteGallerySkillTaskMutation = (
  config?: UseMutationOptions<{ success: boolean }, unknown, string>,
) => {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, unknown, string>(
    (taskId) => dataService.deleteGallerySkillTask(taskId),
    {
      onMutate: (taskId) => {
        updateSkillTaskCaches(queryClient, (tasks) => tasks.filter((task) => task.id !== taskId));
      },
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'skill-tasks']);
        queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'skill-runs']);
        config?.onSuccess?.(data, variables, context);
      },
      onError: (error, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'skill-tasks']);
        config?.onError?.(error, variables, context);
      },
      ...config,
    },
  );
};

export type { CreateGallerySkillTaskPayload, GallerySkillTask, SkillTaskFrequency, SkillTaskStatus };
