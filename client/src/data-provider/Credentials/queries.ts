/* Credentials */
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type {
  UseQueryOptions,
  UseMutationOptions,
  QueryObserverResult,
} from '@tanstack/react-query';
import type { CredentialsListResponse } from 'librechat-data-provider';

export const useCredentialResourcesQuery = (
  config?: UseQueryOptions<CredentialsListResponse>,
): QueryObserverResult<CredentialsListResponse> => {
  return useQuery<CredentialsListResponse>(
    [QueryKeys.credentials],
    () => dataService.getCredentialResources(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

type BindCredentialPayload = {
  resourceType: string;
  resourceName: string;
  values: Record<string, string>;
};

export const useBindCredentialMutation = (
  options?: UseMutationOptions<unknown, Error, BindCredentialPayload>,
) => {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, BindCredentialPayload>(
    (payload) =>
      dataService.bindCredential(payload.resourceType, payload.resourceName, payload.values),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.credentials]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

type ResourceIdentifier = {
  resourceType: string;
  resourceName: string;
};

export const useUnbindCredentialMutation = (
  options?: UseMutationOptions<unknown, Error, ResourceIdentifier>,
) => {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, ResourceIdentifier>(
    (payload) => dataService.unbindCredential(payload.resourceType, payload.resourceName),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.credentials]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useVerifyCredentialMutation = (
  options?: UseMutationOptions<unknown, Error, ResourceIdentifier>,
) => {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, ResourceIdentifier>(
    (payload) => dataService.verifyCredential(payload.resourceType, payload.resourceName),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.credentials]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

/* Skills catalog */
import type {
  SkillsCatalogResponse,
  CreateHttpSkillPayload,
  TestConnectionPayload,
  TestConnectionResponse,
} from 'librechat-data-provider';

export const useSkillsCatalogQuery = (
  type: string,
  source: string,
  config?: UseQueryOptions<SkillsCatalogResponse>,
): QueryObserverResult<SkillsCatalogResponse> => {
  return useQuery<SkillsCatalogResponse>(
    [QueryKeys.skillsCatalog, type, source],
    () => dataService.getSkillsCatalog(type, source),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

export const useCreateHttpSkillMutation = (
  options?: UseMutationOptions<unknown, Error, CreateHttpSkillPayload>,
) => {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, CreateHttpSkillPayload>(
    (payload) => dataService.createHttpSkill(payload),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.skillsCatalog]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useTestSkillConnectionMutation = (
  options?: UseMutationOptions<TestConnectionResponse, Error, TestConnectionPayload>,
) => {
  return useMutation<TestConnectionResponse, Error, TestConnectionPayload>(
    (payload) => dataService.testSkillConnection(payload),
    options,
  );
};
