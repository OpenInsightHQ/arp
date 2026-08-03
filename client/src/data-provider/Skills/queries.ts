/* Skills */
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type {
  UseQueryOptions,
  UseMutationOptions,
  QueryObserverResult,
} from '@tanstack/react-query';
import type { SkillsListResponse, SkillDetailResponse } from 'librechat-data-provider';

export const useMySkillsQuery = (
  config?: UseQueryOptions<SkillsListResponse>,
): QueryObserverResult<SkillsListResponse> => {
  return useQuery<SkillsListResponse>([QueryKeys.skills], () => dataService.getMySkills(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    ...config,
  });
};

export const useSkillDetailQuery = (
  skillName: string,
  config?: UseQueryOptions<SkillDetailResponse>,
): QueryObserverResult<SkillDetailResponse> => {
  return useQuery<SkillDetailResponse>(
    [QueryKeys.skills, 'detail', skillName],
    () => dataService.getSkillDetail(skillName),
    {
      enabled: Boolean(skillName),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

export const useUploadSkillMutation = (
  options?: UseMutationOptions<unknown, Error, FormData>,
) => {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, FormData>(
    [MutationKeys.skillUpload],
    (formData: FormData) => dataService.uploadSkill(formData),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.skills]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useDeleteSkillMutation = (
  options?: UseMutationOptions<void, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>(
    [MutationKeys.skillDelete],
    (skillName: string) => dataService.deleteSkill(skillName),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.skills]);
        options?.onSuccess?.(...params);
      },
    },
  );
};
