import { act, renderHook } from '@testing-library/react';
import useUserScrollPagination from '../useUserScrollPagination';

const nearBottom = {
  clientHeight: 300,
  scrollHeight: 600,
  scrollTop: 290,
};

describe('useUserScrollPagination', () => {
  it('does not load from an initial short-list render without user scroll intent', () => {
    const loadMore = jest.fn();
    const { result } = renderHook(() =>
      useUserScrollPagination({
        hasNextPage: true,
        isFetchingNextPage: false,
        loadMore,
      }),
    );

    act(() => {
      result.current.handleScroll({
        clientHeight: 300,
        scrollHeight: 300,
        scrollTop: 0,
      });
      result.current.handleScroll(nearBottom);
    });

    expect(loadMore).not.toHaveBeenCalled();
  });

  it('loads once for an actual near-bottom user scroll and deduplicates repeated callbacks', async () => {
    let resolveRequest: (() => void) | undefined;
    const loadMore = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useUserScrollPagination({
        hasNextPage: true,
        isFetchingNextPage: false,
        loadMore,
      }),
    );

    act(() => {
      result.current.armUserScroll();
      result.current.handleScroll(nearBottom);
      result.current.handleScroll(nearBottom);
    });

    expect(loadMore).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest?.();
      await Promise.resolve();
      result.current.handleScroll(nearBottom);
    });

    expect(loadMore).toHaveBeenCalledTimes(1);
  });
});
