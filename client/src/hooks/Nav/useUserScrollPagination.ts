import { useCallback, useRef } from 'react';

type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

type UseUserScrollPaginationOptions = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMore: () => void | Promise<unknown>;
};

export default function useUserScrollPagination({
  hasNextPage,
  isFetchingNextPage,
  loadMore,
}: UseUserScrollPaginationOptions) {
  const hasUserScrollIntentRef = useRef(false);
  const requestInFlightRef = useRef(false);

  const armUserScroll = useCallback(() => {
    hasUserScrollIntentRef.current = true;
  }, []);

  const handleScroll = useCallback(
    ({ clientHeight, scrollHeight, scrollTop }: ScrollMetrics) => {
      const hasScrollableContent = scrollHeight > clientHeight;
      const isNearBottom = scrollTop + clientHeight >= scrollHeight * 0.97;

      if (
        !hasUserScrollIntentRef.current ||
        !hasScrollableContent ||
        scrollTop <= 0 ||
        !isNearBottom ||
        !hasNextPage ||
        isFetchingNextPage ||
        requestInFlightRef.current
      ) {
        return;
      }

      hasUserScrollIntentRef.current = false;
      requestInFlightRef.current = true;

      Promise.resolve(loadMore()).finally(() => {
        requestInFlightRef.current = false;
      });
    },
    [hasNextPage, isFetchingNextPage, loadMore],
  );

  return { armUserScroll, handleScroll };
}
