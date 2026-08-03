import { useMemo, memo, type FC, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronsRight } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import { Spinner, useMediaQuery } from '@librechat/client';
import { List, AutoSizer, CellMeasurer, CellMeasurerCache } from 'react-virtualized';
import type { TConversation } from 'librechat-data-provider';
import { useLocalize, TranslationKeys, useFavorites, useShowMarketplace } from '~/hooks';
import useUserScrollPagination from '~/hooks/Nav/useUserScrollPagination';
import FavoritesList from '~/components/Nav/Favorites/FavoritesList';
import { useActiveJobs } from '~/data-provider';
import { cn } from '~/utils';
import Convo from './Convo';
import store from '~/store';

export type CellPosition = {
  columnIndex: number;
  rowIndex: number;
};

export type MeasuredCellParent = {
  invalidateCellSizeAfterRender?: ((cell: CellPosition) => void) | undefined;
  recomputeGridSize?: ((cell: CellPosition) => void) | undefined;
};

interface ConversationsProps {
  conversations: Array<TConversation | null>;
  moveToTop: () => void;
  toggleNav: () => void;
  containerRef: React.RefObject<List>;
  loadMoreConversations: () => void | Promise<unknown>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isSearchLoading: boolean;
  isChatsExpanded: boolean;
  setIsChatsExpanded: (expanded: boolean) => void;
  tags?: string[];
}

interface MeasuredRowProps {
  cache: CellMeasurerCache;
  rowKey: string;
  parent: MeasuredCellParent;
  index: number;
  style: React.CSSProperties;
  children: React.ReactNode;
}

/** Reusable wrapper for virtualized row measurement */
const MeasuredRow: FC<MeasuredRowProps> = memo(
  ({ cache, rowKey, parent, index, style, children }) => (
    <CellMeasurer cache={cache} columnIndex={0} key={rowKey} parent={parent} rowIndex={index}>
      {({ registerChild }) => (
        <div ref={registerChild as React.LegacyRef<HTMLDivElement>} style={style}>
          {children}
        </div>
      )}
    </CellMeasurer>
  ),
);

MeasuredRow.displayName = 'MeasuredRow';

const LoadingSpinner = memo(() => {
  const localize = useLocalize();

  return (
    <div className="mx-auto mt-2 flex items-center justify-center gap-2">
      <Spinner className="text-text-primary" />
      <span className="animate-pulse text-text-primary">{localize('com_ui_loading')}</span>
    </div>
  );
});

LoadingSpinner.displayName = 'LoadingSpinner';

interface ChatsHeaderProps {
  isExpanded: boolean;
  onToggle: () => void;
}

/** Collapsible header for the Chats section */
const ChatsHeader: FC<ChatsHeaderProps> = memo(({ isExpanded, onToggle }) => {
  const localize = useLocalize();
  return (
    <button
      onClick={onToggle}
      className="group flex w-full items-center justify-between rounded-lg px-1 py-2 text-[13px] font-bold text-text-secondary outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
      type="button"
    >
      <span className="select-none">{localize('com_ui_chats')}</span>
      <ChevronDown
        className={cn('h-3 w-3 transition-transform duration-200', isExpanded ? 'rotate-180' : '')}
      />
    </button>
  );
});

ChatsHeader.displayName = 'ChatsHeader';

const DateLabel: FC<{ groupName: string; isFirst?: boolean }> = memo(({ groupName, isFirst }) => {
  const localize = useLocalize();
  return (
    <h2
      className={cn('pl-1 pt-1 text-text-secondary', isFirst === true ? 'mt-0' : 'mt-2')}
      style={{ fontSize: '0.7rem' }}
    >
      {localize(groupName as TranslationKeys) || groupName}
    </h2>
  );
});

DateLabel.displayName = 'DateLabel';

type FlattenedItem =
  | { type: 'chats-header' }
  | { type: 'header'; groupName: string }
  | { type: 'convo'; convo: TConversation }
  | { type: 'loading' }
  | { type: 'view-more' };

const MemoizedConvo = memo(
  ({
    conversation,
    retainView,
    toggleNav,
    isGenerating,
  }: {
    conversation: TConversation;
    retainView: () => void;
    toggleNav: () => void;
    isGenerating: boolean;
  }) => {
    return (
      <Convo
        conversation={conversation}
        retainView={retainView}
        toggleNav={toggleNav}
        isGenerating={isGenerating}
      />
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.conversation.conversationId === nextProps.conversation.conversationId &&
      prevProps.conversation.title === nextProps.conversation.title &&
      prevProps.conversation.endpoint === nextProps.conversation.endpoint &&
      prevProps.isGenerating === nextProps.isGenerating
    );
  },
);

const Conversations: FC<ConversationsProps> = ({
  conversations: rawConversations,
  moveToTop,
  toggleNav,
  containerRef,
  loadMoreConversations,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  isSearchLoading,
  isChatsExpanded,
  setIsChatsExpanded,
  tags = [],
}) => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const search = useRecoilValue(store.search);
  const { favorites, isLoading: isFavoritesLoading } = useFavorites();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const convoHeight = isSmallScreen ? 44 : 34;
  const showAgentMarketplace = useShowMarketplace();

  // Fetch active job IDs for showing generation indicators
  const { data: activeJobsData } = useActiveJobs();
  const activeJobIds = useMemo(
    () => new Set(activeJobsData?.activeJobIds ?? []),
    [activeJobsData?.activeJobIds],
  );

  // Determine if FavoritesList will render content
  const shouldShowFavorites =
    !search.query && (isFavoritesLoading || favorites.length > 0 || showAgentMarketplace);

  const filteredConversations = useMemo(
    () => rawConversations.filter(Boolean) as TConversation[],
    [rawConversations],
  );

  const flattenedItems = useMemo(() => {
    const items: FlattenedItem[] = [];
    items.push({ type: 'chats-header' });

    if (isChatsExpanded) {
      const sortedConvos = [...filteredConversations].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      const showAllConvos = search.query || tags.length > 0;
      const MAX_VISIBLE_CONVOS = 5;
      const visibleConvos = showAllConvos
        ? sortedConvos
        : sortedConvos.slice(0, MAX_VISIBLE_CONVOS);

      for (const convo of visibleConvos) {
        items.push({ type: 'convo', convo });
      }

      if (!showAllConvos && filteredConversations.length > MAX_VISIBLE_CONVOS) {
        items.push({ type: 'view-more' });
      }

      if (isLoading) {
        items.push({ type: 'loading' } as any);
      }
    }
    return items;
  }, [filteredConversations, isLoading, isChatsExpanded, search.query, tags]);

  // Store flattenedItems in a ref for keyMapper to access without recreating cache
  const flattenedItemsRef = useRef(flattenedItems);
  flattenedItemsRef.current = flattenedItems;

  // Create a stable cache that doesn't depend on flattenedItems
  const cache = useMemo(
    () =>
      new CellMeasurerCache({
        fixedWidth: true,
        defaultHeight: convoHeight,
        keyMapper: (index) => {
          const item = flattenedItemsRef.current[index];
          if (!item) {
            return `unknown-${index}`;
          }
          if (item.type === 'chats-header') {
            return 'chats-header';
          }
          if (item.type === 'header') {
            return `header-${item.groupName}`;
          }
          if (item.type === 'convo') {
            return `convo-${item.convo.conversationId}`;
          }
          if (item.type === 'loading') {
            return 'loading';
          }
          if (item.type === 'view-more') {
            return 'view-more';
          }
          return `unknown-${index}`;
        },
      }),
    [convoHeight],
  );

  // Debounced function to clear cache and recompute heights
  const clearListCache = useCallback(() => {
    if (cache) {
      cache.clearAll();
      if (containerRef.current && 'recomputeRowHeights' in containerRef.current) {
        containerRef.current.recomputeRowHeights(0);
      }
    }
  }, [cache, containerRef]);

  // Clear cache when the virtualized conversations list changes
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      clearListCache();
    });
    return () => cancelAnimationFrame(frameId);
  }, [filteredConversations.length, isLoading, isChatsExpanded, search.query, clearListCache]);

  const rowRenderer = useCallback(
    ({ index, key, parent, style }) => {
      const item = flattenedItems[index];
      const rowProps = { cache, rowKey: key, parent, index, style };

      if (item.type === 'loading') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <LoadingSpinner />
          </MeasuredRow>
        );
      }

      if (item.type === 'chats-header') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <ChatsHeader
              isExpanded={isChatsExpanded}
              onToggle={() => setIsChatsExpanded(!isChatsExpanded)}
            />
          </MeasuredRow>
        );
      }

      if (item.type === 'header') {
        const firstHeaderIndex = 1;
        return (
          <MeasuredRow key={key} {...rowProps}>
            <DateLabel groupName={item.groupName} isFirst={index === firstHeaderIndex} />
          </MeasuredRow>
        );
      }

      if (item.type === 'convo') {
        const isGenerating = activeJobIds.has(item.convo.conversationId ?? '');
        return (
          <MeasuredRow key={key} {...rowProps}>
            <MemoizedConvo
              conversation={item.convo}
              retainView={moveToTop}
              toggleNav={toggleNav}
              isGenerating={isGenerating}
            />
          </MeasuredRow>
        );
      }

      if (item.type === 'view-more') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <button
              onClick={() => navigate('/history')}
              className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              type="button"
            >
              <ChevronsRight className="h-3 w-3" />
              <span>{localize('com_ui_view_more')}</span>
            </button>
          </MeasuredRow>
        );
      }

      return null;
    },
    [
      cache,
      flattenedItems,
      moveToTop,
      toggleNav,
      isSmallScreen,
      isChatsExpanded,
      setIsChatsExpanded,
      activeJobIds,
      navigate,
    ],
  );

  const getRowHeight = useCallback(
    ({ index }: { index: number }) => {
      return cache.getHeight(index, 0);
    },
    [cache],
  );

  const { armUserScroll, handleScroll } = useUserScrollPagination({
    hasNextPage,
    isFetchingNextPage,
    loadMore: loadMoreConversations,
  });

  const handleScrollKey = useCallback(
    (event: React.KeyboardEvent) => {
      if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) {
        armUserScroll();
      }
    },
    [armUserScroll],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col pb-2 text-[13px] text-text-primary">
      {isSearchLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-text-primary" />
          <span className="ml-2 text-text-primary">{localize('com_ui_loading')}</span>
        </div>
      ) : (
        <>
          {shouldShowFavorites ? (
            <div className="shrink-0">
              <FavoritesList isSmallScreen={isSmallScreen} toggleNav={toggleNav} />
            </div>
          ) : null}
          <div
            className="min-h-0 flex-1"
            onWheelCapture={armUserScroll}
            onTouchMoveCapture={armUserScroll}
            onPointerDownCapture={armUserScroll}
            onKeyDownCapture={handleScrollKey}
          >
            <AutoSizer>
              {({ width, height }) => (
                <List
                  ref={containerRef}
                  width={width}
                  height={height}
                  deferredMeasurementCache={cache}
                  rowCount={flattenedItems.length}
                  rowHeight={getRowHeight}
                  rowRenderer={rowRenderer}
                  overscanRowCount={10}
                  aria-readonly={false}
                  className="outline-none"
                  aria-label="Conversations"
                  onScroll={handleScroll}
                  tabIndex={-1}
                  style={{ outline: 'none', scrollbarGutter: 'stable' }}
                />
              )}
            </AutoSizer>
          </div>
        </>
      )}
    </div>
  );
};

export default memo(Conversations);
