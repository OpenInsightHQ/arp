import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { LayoutGrid, WandSparkles } from 'lucide-react';
import { useDrag, useDrop } from 'react-dnd';
import { Skeleton } from '@librechat/client';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { EModelEndpoint, QueryKeys, dataService, isEphemeralAgentId } from 'librechat-data-provider';
import type { TPreset } from 'librechat-data-provider';
import type t from 'librechat-data-provider';
import { useFavorites, useLocalize, useShowMarketplace, useNewConvo } from '~/hooks';
import { useAssistantsMapContext, useAgentsMapContext } from '~/Providers';
import type { AgentQueryResult } from '~/common';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import FavoriteItem from './FavoriteItem';
import store from '~/store';

// PI Agent ID constant

// My PI Button Component - using same style as portfolio items
type MyPIButtonProps = {
  newConversation?: (params: {
    template?: Partial<t.TConversation>;
    preset?: Partial<TPreset>;
  }) => void;
};

const MyPIButton = ({ newConversation }: MyPIButtonProps) => {
  const handleClick = () => {
    if (!newConversation) {
      return;
    }
    // Create new conversation with One Pi agent
    newConversation({
      template: {
        endpoint: 'pi',
      },
      preset: {
        endpoint: 'pi',
      },
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="One Pi"
      className="group relative flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none hover:bg-surface-active-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      data-testid="nav-my-pi-button"
    >
      <div className="flex flex-1 items-center truncate pr-6">
        <div className="mr-2 h-5 w-5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5 text-text-primary"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.177A7.547 7.547 0 016.648 6.61a.75.75 0 00-1.152.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <span className="truncate">One Pi</span>
      </div>
    </div>
  );
};

const FavoriteItemSkeleton = () => (
  <div className="flex w-full items-center rounded-lg px-3 py-2">
    <Skeleton className="mr-2 h-5 w-5 rounded-full" />
    <Skeleton className="h-4 w-24" />
  </div>
);

const MarketplaceSkeleton = () => (
  <div className="flex w-full items-center rounded-lg px-3 py-2">
    <Skeleton className="mr-2 h-5 w-5" />
    <Skeleton className="h-4 w-28" />
  </div>
);

interface DraggableFavoriteItemProps {
  id: string;
  index: number;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
  onDrop: () => void;
  children: React.ReactNode;
}

const DraggableFavoriteItem = ({
  id,
  index,
  moveItem,
  onDrop,
  children,
}: DraggableFavoriteItemProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [{ handlerId }, drop] = useDrop<{ index: number; id: string }, unknown, { handlerId: any }>(
    {
      accept: 'favorite-item',
      collect(monitor) {
        return {
          handlerId: monitor.getHandlerId(),
        };
      },
      hover(item, monitor) {
        if (!ref.current) {
          return;
        }
        const dragIndex = item.index;
        const hoverIndex = index;

        if (dragIndex === hoverIndex) {
          return;
        }

        const hoverBoundingRect = ref.current?.getBoundingClientRect();
        const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) {
          return;
        }
        const hoverClientY = clientOffset.y - hoverBoundingRect.top;

        if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
          return;
        }

        if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
          return;
        }

        moveItem(dragIndex, hoverIndex);
        item.index = hoverIndex;
      },
    },
  );

  const [{ isDragging }, drag] = useDrag({
    type: 'favorite-item',
    item: () => {
      return { id, index };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: () => {
      onDrop();
    },
  });

  const opacity = isDragging ? 0 : 1;
  drag(drop(ref));

  return (
    <div ref={ref} style={{ opacity }} data-handler-id={handlerId}>
      {children}
    </div>
  );
};

export default function FavoritesList({
  isSmallScreen,
  toggleNav,
  onHeightChange,
}: {
  isSmallScreen?: boolean;
  toggleNav?: () => void;
  /** Callback when the list height might have changed (e.g., agents finished loading) */
  onHeightChange?: () => void;
}) {
  const navigate = useNavigate();
  const localize = useLocalize();
  const search = useRecoilValue(store.search);
  const { favorites, reorderFavorites, isLoading: isFavoritesLoading } = useFavorites();
  const showAgentMarketplace = useShowMarketplace();
  const { data: startupConfig } = useGetStartupConfig();

  const { newConversation } = useNewConvo();
  const assistantsMap = useAssistantsMapContext();
  const agentsMap = useAgentsMapContext();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const { data: endpointsConfig = {} as t.TEndpointsConfig } = useGetEndpointsQuery();

  const { onSelectEndpoint } = useSelectMention({
    modelSpecs: [],
    conversation,
    assistantsMap,
    endpointsConfig,
    newConversation,
    returnHandlers: true,
  });

  const marketplaceRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const handleAgentMarketplace = useCallback(() => {
    navigate('/agents');
    if (isSmallScreen && toggleNav) {
      toggleNav();
    }
  }, [navigate, isSmallScreen, toggleNav]);

  const handleArtifactsGallery = useCallback(() => {
    navigate('/artifacts');
    if (isSmallScreen && toggleNav) {
      toggleNav();
    }
  }, [navigate, isSmallScreen, toggleNav]);

  const handleRemoveFocus = useCallback(() => {
    if (marketplaceRef.current) {
      marketplaceRef.current.focus();
      return;
    }
    const nextFavorite = listContainerRef.current?.querySelector<HTMLElement>(
      '[data-testid="favorite-item"]',
    );
    if (nextFavorite) {
      nextFavorite.focus();
      return;
    }
    const newChatButton = document.querySelector<HTMLElement>(
      '[data-testid="nav-new-chat-button"]',
    );
    newChatButton?.focus();
  }, []);

  const safeFavorites = useMemo(() => (Array.isArray(favorites) ? favorites : []), [favorites]);

  const allAgentIds = useMemo(
    () => safeFavorites.map((f) => f.agentId).filter(Boolean) as string[],
    [safeFavorites],
  );

  const missingAgentIds = useMemo(() => {
    if (agentsMap === undefined) {
      return [];
    }
    return allAgentIds.filter((id) => !agentsMap[id] && !isEphemeralAgentId(id));
  }, [allAgentIds, agentsMap]);

  const missingAgentQueries = useQueries({
    queries: missingAgentIds.map((agentId) => ({
      queryKey: [QueryKeys.agent, agentId],
      queryFn: async (): Promise<AgentQueryResult> => {
        try {
          const agent = await dataService.getAgentById({ agent_id: agentId });
          return { found: true, agent };
        } catch (error) {
          if (error && typeof error === 'object' && 'response' in error) {
            const axiosError = error as { response?: { status?: number } };
            if (axiosError.response?.status === 404) {
              return { found: false };
            }
          }
          throw error;
        }
      },
      staleTime: 1000 * 60 * 5,
      enabled: missingAgentIds.length > 0,
    })),
  });

  const combinedAgentsMap = useMemo(() => {
    if (agentsMap === undefined) {
      return undefined;
    }
    const combined: Record<string, t.Agent> = {};
    for (const [key, value] of Object.entries(agentsMap)) {
      if (value) {
        combined[key] = value;
      }
    }
    missingAgentQueries.forEach((query) => {
      if (query.data?.found) {
        combined[query.data.agent.id] = query.data.agent;
      }
    });
    return combined;
  }, [agentsMap, missingAgentQueries]);

  const isAgentsLoading =
    (allAgentIds.length > 0 && agentsMap === undefined) ||
    (missingAgentIds.length > 0 && missingAgentQueries.some((q) => q.isLoading));

  useEffect(() => {
    if (!isAgentsLoading && onHeightChange) {
      onHeightChange();
    }
  }, [isAgentsLoading, onHeightChange]);

  const draggedFavoritesRef = useRef(safeFavorites);

  const moveItem = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      const newFavorites = [...draggedFavoritesRef.current];
      const [draggedItem] = newFavorites.splice(dragIndex, 1);
      newFavorites.splice(hoverIndex, 0, draggedItem);
      draggedFavoritesRef.current = newFavorites;
      reorderFavorites(newFavorites, false);
    },
    [reorderFavorites],
  );

  const handleDrop = useCallback(() => {
    // Persist the final order using the ref which has the latest state
    reorderFavorites(draggedFavoritesRef.current, true);
  }, [reorderFavorites]);

  // Keep ref in sync when favorites change from external sources
  useEffect(() => {
    draggedFavoritesRef.current = safeFavorites;
  }, [safeFavorites]);

  if (search.query) {
    return null;
  }

  if (!isFavoritesLoading && safeFavorites.length === 0 && !showAgentMarketplace) {
    return null;
  }

  if (isFavoritesLoading) {
    return (
      <div className="mb-2 flex flex-col pb-2">
        <div className="mt-1 flex flex-col gap-1">
          {showAgentMarketplace && <MarketplaceSkeleton />}
          <FavoriteItemSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 flex flex-col">
      <div ref={listContainerRef} className="mt-1 flex flex-col gap-1">
        {/* Show skeletons for ALL items while agents are still loading */}
        {isAgentsLoading ? (
          <>
            {/* Marketplace skeleton */}
            {showAgentMarketplace && <MarketplaceSkeleton />}
            {/* Favorite items skeletons */}
            {safeFavorites.map((_, index) => (
              <FavoriteItemSkeleton key={`skeleton-${index}`} />
            ))}
          </>
        ) : (
          <>
            {/* My PI Button */}
            {startupConfig?.interface?.pi === true && (
              <MyPIButton newConversation={newConversation} />
            )}
            {/* Artifacts Gallery button */}
            <div
              role="button"
              tabIndex={0}
              aria-label={localize('com_ui_artifacts_gallery')}
              className="group relative flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none hover:bg-surface-active-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
              onClick={handleArtifactsGallery}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleArtifactsGallery();
                }
              }}
              data-testid="nav-artifacts-gallery-button"
            >
              <div className="flex flex-1 items-center truncate pr-6">
                <div className="mr-2 h-4 w-4">
                  <WandSparkles className="h-4 w-4 text-text-primary" />
                </div>
                <span className="truncate">{localize('com_ui_artifacts_gallery')}</span>
              </div>
            </div>
            {/* Agent Marketplace button */}
            {showAgentMarketplace && (
              <div
                ref={marketplaceRef}
                role="button"
                tabIndex={0}
                aria-label={localize('com_agents_marketplace')}
                className="group relative flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none hover:bg-surface-active-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
                onClick={handleAgentMarketplace}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleAgentMarketplace();
                  }
                }}
                data-testid="nav-agents-marketplace-button"
              >
                <div className="flex flex-1 items-center truncate pr-6">
                  <div className="mr-2 h-4 w-4">
                    <LayoutGrid className="h-4 w-4 text-text-primary" />
                  </div>
                  <span className="truncate">{localize('com_agents_marketplace')}</span>
                </div>
              </div>
            )}
            {safeFavorites.map((fav, index) => {
              if (fav.agentId) {
                const agent = combinedAgentsMap?.[fav.agentId];
                if (!agent) {
                  return null;
                }
                return (
                  <DraggableFavoriteItem
                    key={fav.agentId}
                    id={fav.agentId}
                    index={index}
                    moveItem={moveItem}
                    onDrop={handleDrop}
                  >
                    <FavoriteItem
                      item={agent}
                      type="agent"
                      onSelectEndpoint={onSelectEndpoint}
                      onRemoveFocus={handleRemoveFocus}
                      newConversation={newConversation}
                    />
                  </DraggableFavoriteItem>
                );
              } else if (fav.model && fav.endpoint) {
                return (
                  <DraggableFavoriteItem
                    key={`${fav.endpoint}-${fav.model}`}
                    id={`${fav.endpoint}-${fav.model}`}
                    index={index}
                    moveItem={moveItem}
                    onDrop={handleDrop}
                  >
                    <FavoriteItem
                      item={{ model: fav.model, endpoint: fav.endpoint }}
                      type="model"
                      onSelectEndpoint={onSelectEndpoint}
                      onRemoveFocus={handleRemoveFocus}
                    />
                  </DraggableFavoriteItem>
                );
              }
              return null;
            })}
          </>
        )}
      </div>
    </div>
  );
}
