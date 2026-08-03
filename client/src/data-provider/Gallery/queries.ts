import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type {
  GallerySkillTask,
  GallerySkillTaskRun,
  GalleryArtifactsParams,
  GalleryArtifactsResponse,
  SkillTaskFrequency,
  SkillTaskStatus,
} from 'librechat-data-provider';
import { dataService } from 'librechat-data-provider';
import { QueryKeys } from 'librechat-data-provider';

export const galleryArtifactsQueryKey = (params?: GalleryArtifactsParams) =>
  [QueryKeys.galleryArtifacts, 'list', params] as const;

export const useGalleryArtifactsQuery = (
  params?: GalleryArtifactsParams,
  config?: UseQueryOptions<GalleryArtifactsResponse>,
): QueryObserverResult<GalleryArtifactsResponse> => {
  return useQuery<GalleryArtifactsResponse>(
    galleryArtifactsQueryKey(params),
    ({ signal }) => dataService.getArtifacts(params, { signal }),
    {
      staleTime: 5 * 60 * 1000,
      cacheTime: 30 * 60 * 1000,
      keepPreviousData: true,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

export const useGallerySkillTasksQuery = (
  params?: {
    status?: SkillTaskStatus | 'all';
    frequency?: SkillTaskFrequency | 'all';
    search?: string;
    skillName?: string;
  },
  config?: UseQueryOptions<{ tasks: GallerySkillTask[] }>,
): QueryObserverResult<{ tasks: GallerySkillTask[] }> => {
  return useQuery<{ tasks: GallerySkillTask[] }>(
    [QueryKeys.galleryArtifacts, 'skill-tasks', params],
    () => dataService.getGallerySkillTasks(params),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export const useGallerySkillRunsQuery = (
  params?: { skillName?: string },
  config?: UseQueryOptions<{ runs: GallerySkillTaskRun[] }>,
): QueryObserverResult<{ runs: GallerySkillTaskRun[] }> => {
  return useQuery<{ runs: GallerySkillTaskRun[] }>(
    [QueryKeys.galleryArtifacts, 'skill-runs', params],
    () => dataService.getGallerySkillRuns(params),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};
