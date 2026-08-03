import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { dataService } from 'librechat-data-provider';
import { useGalleryArtifactsQuery } from './queries';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getArtifacts: jest.fn(),
    },
  };
});

const response = {
  artifacts: [
    {
      id: 'report-1',
      title: 'Report',
      type: 'HTML',
      content: '<html>report</html>',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
      likeCount: 0,
    },
  ],
  hasNextPage: false,
};

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

describe('useGalleryArtifactsQuery', () => {
  const getArtifacts = dataService.getArtifacts as jest.MockedFunction<
    typeof dataService.getArtifacts
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('waits for user identity and fetches once when the user remains stable', async () => {
    getArtifacts.mockResolvedValue(response);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);

    const hook = renderHook(
      ({ userId }: { userId?: string }) =>
        useGalleryArtifactsQuery(
          { type: 'HTML', ...(userId ? { userId } : {}) },
          { enabled: !!userId },
        ),
      { wrapper, initialProps: { userId: undefined as string | undefined } },
    );

    expect(getArtifacts).not.toHaveBeenCalled();

    hook.rerender({ userId: 'user-1' });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(getArtifacts).toHaveBeenCalledTimes(1);
    expect(getArtifacts).toHaveBeenCalledWith(
      { type: 'HTML', userId: 'user-1' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    hook.rerender({ userId: 'user-1' });
    expect(getArtifacts).toHaveBeenCalledTimes(1);
  });

  it('reuses a fresh report list after unmount and remount', async () => {
    getArtifacts.mockResolvedValue(response);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    const params = { type: 'HTML', userId: 'user-1' };

    const first = renderHook(() => useGalleryArtifactsQuery(params), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useGalleryArtifactsQuery(params), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(second.result.current.data).toEqual(response);
    expect(getArtifacts).toHaveBeenCalledTimes(1);
  });

  it('deduplicates simultaneous observers for the same user and params', async () => {
    let resolveRequest: ((value: typeof response) => void) | undefined;
    getArtifacts.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);

    const { result } = renderHook(
      () => {
        const first = useGalleryArtifactsQuery({ type: 'HTML', search: 'sales', userId: 'user-1' });
        const second = useGalleryArtifactsQuery({
          type: 'HTML',
          search: 'sales',
          userId: 'user-1',
        });
        return { first, second };
      },
      { wrapper },
    );

    await waitFor(() => expect(getArtifacts).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveRequest?.(response);
    });
    await waitFor(() => expect(result.current.second.isSuccess).toBe(true));

    expect(result.current.first.data).toEqual(response);
    expect(result.current.second.data).toEqual(response);
  });

  it('passes React Query cancellation to the gallery request', async () => {
    let requestSignal: NonNullable<Parameters<typeof dataService.getArtifacts>[1]>['signal'];
    getArtifacts.mockImplementation((_params, options) => {
      requestSignal = options?.signal;
      return new Promise(() => undefined);
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);

    const hook = renderHook(() => useGalleryArtifactsQuery({ type: 'HTML', userId: 'user-1' }), {
      wrapper,
    });
    await waitFor(() => expect(requestSignal).toBeDefined());

    hook.unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
