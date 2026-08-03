import { useEffect, useMemo, useState, useCallback } from 'react';
import { Trans } from 'react-i18next';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, MessageSquare, Trash2 } from 'lucide-react';
import {
  Spinner,
  useToastContext,
  Button,
  TooltipAnchor,
  useMediaQuery,
  NewChatIcon,
  OGDialog,
  OGDialogTemplate,
} from '@librechat/client';
import { useLocalize, useAuthContext } from '~/hooks';
import {
  useConversationsInfiniteQuery,
  useDeleteConversationMutation,
  useUpdateConversationMutation,
  useGetStartupConfig,
  QueryKeys,
} from '~/data-provider';
import type { ConversationListParams } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import HistoryCard from '~/components/Conversations/HistoryCard';
import { groupConversationsByDate } from '~/utils/convos';
import SearchBar from '~/components/Agents/SearchBar';
import { OpenSidebar } from '~/components/Chat/Menus';
import { logger } from '~/utils';

type DeleteDialogState =
  | { type: 'single'; conversationId: string; title: string }
  | { type: 'batch'; conversationIds: string[] }
  | null;

export default function History() {
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const { data: startupConfig } = useGetStartupConfig();
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { isAuthenticated } = useAuthContext();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);

  const handleNewChat = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      window.open('/c/new', '_blank');
      return;
    }
    navigate('/c/new');
  };

  useEffect(() => {
    const stored = localStorage.getItem('historySearchHistory');
    if (stored) {
      setSearchHistory(JSON.parse(stored));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      if (searchQuery.trim() && !searchHistory.includes(searchQuery.trim())) {
        const newHistory = [searchQuery.trim(), ...searchHistory.slice(0, 4)];
        setSearchHistory(newHistory);
        localStorage.setItem('historySearchHistory', JSON.stringify(newHistory));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchHistory]);

  const params: ConversationListParams = useMemo(
    () => ({
      isArchived: false,
      sortBy: 'updatedAt',
      sortDirection: 'desc',
      search: debouncedQuery || undefined,
    }),
    [debouncedQuery],
  );

  const {
    data: conversationsData,
    isLoading,
    isError,
    fetchNextPage,
    isFetchingNextPage,
    hasNextPage,
  } = useConversationsInfiniteQuery(params, {
    enabled: isAuthenticated,
    staleTime: 30000,
    cacheTime: 300000,
  });

  const deleteConversation = useDeleteConversationMutation();
  const updateConversation = useUpdateConversationMutation('');
  const queryClient = useQueryClient();

  const handleTogglePin = useCallback(
    async (e: React.MouseEvent, conversationId: string) => {
      e.stopPropagation();
      const now = new Date().toISOString();
      try {
        await updateConversation.mutateAsync({ conversationId, updatedAt: now });
        queryClient.invalidateQueries({ queryKey: [QueryKeys.allConversations] });
        showToast({ message: localize('com_ui_convo_pin_success'), status: 'success' });
      } catch {
        showToast({ message: localize('com_ui_convo_pin_error'), status: 'error' });
      }
    },
    [updateConversation, queryClient, showToast, localize],
  );

  const conversations = useMemo(() => {
    return conversationsData?.pages.flatMap((page) => page.conversations).filter(Boolean) || [];
  }, [conversationsData?.pages]);

  const conversationIds = useMemo(
    () =>
      conversations
        .map((convo) => convo.conversationId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    [conversations],
  );

  const selectedCount = selectedIds.size;
  const allSelected =
    conversationIds.length > 0 && conversationIds.every((id) => selectedIds.has(id));

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelect = useCallback((conversationId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(conversationIds));
  }, [conversationIds]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const validIds = new Set(conversationIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [conversationIds]);

  useEffect(() => {
    exitSelectionMode();
  }, [debouncedQuery, exitSelectionMode]);

  const groupedConversations = useMemo(
    () => groupConversationsByDate(conversations),
    [conversations],
  );

  const resultsCount = conversations.length;
  const resultsAnnouncement = useMemo(() => {
    if (resultsCount === 0) {
      return localize('com_ui_nothing_found');
    }
    if (resultsCount === 1) {
      return localize('com_ui_result_found', { count: resultsCount });
    }
    return localize('com_ui_results_found', { count: resultsCount });
  }, [resultsCount, localize]);

  useEffect(() => {
    if (isError) {
      showToast({ message: localize('com_ui_history_load_error'), status: 'error' });
    }
  }, [isError, showToast, localize]);

  const handleScroll = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const scrollPosition = window.innerHeight + window.scrollY;
    const threshold = document.documentElement.scrollHeight - 500;
    if (scrollPosition >= threshold) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const handleHistoryClick = (term: string) => {
    setSearchQuery(term);
    setDebouncedQuery(term);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem('historySearchHistory');
  };

  const handleDeleteConversation = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    const conversation = conversations.find((convo) => convo.conversationId === conversationId);
    setDeleteDialog({
      type: 'single',
      conversationId,
      title: conversation?.title || localize('com_ui_untitled'),
    });
  };

  const handleBatchDeleteClick = useCallback(() => {
    if (selectedIds.size === 0 || isBatchDeleting) {
      return;
    }
    setDeleteDialog({
      type: 'batch',
      conversationIds: Array.from(selectedIds),
    });
  }, [selectedIds, isBatchDeleting]);

  const closeDeleteDialog = useCallback(() => {
    if (isBatchDeleting) {
      return;
    }
    setDeleteDialog(null);
  }, [isBatchDeleting]);

  const confirmDelete = useCallback(async () => {
    if (!deleteDialog || isBatchDeleting) {
      return;
    }

    if (deleteDialog.type === 'single') {
      try {
        await deleteConversation.mutateAsync({
          conversationId: deleteDialog.conversationId,
        });
        showToast({
          message: localize('com_ui_convo_delete_success'),
          status: 'success',
        });
        setDeleteDialog(null);
      } catch (error) {
        logger.error('Error deleting conversation', error);
        showToast({
          message: localize('com_ui_convo_delete_error'),
          status: 'error',
        });
      }
      return;
    }

    const idsToDelete = deleteDialog.conversationIds;
    setIsBatchDeleting(true);
    try {
      for (const conversationId of idsToDelete) {
        await deleteConversation.mutateAsync({ conversationId });
      }
      showToast({
        message: localize('com_ui_convo_bulk_delete_success', {
          count: idsToDelete.length,
        }),
        status: 'success',
      });
      setDeleteDialog(null);
      exitSelectionMode();
    } catch (error) {
      logger.error('Error batch deleting conversations', error);
      showToast({
        message: localize('com_ui_convo_bulk_delete_error'),
        status: 'error',
      });
    } finally {
      setIsBatchDeleting(false);
    }
  }, [
    deleteDialog,
    isBatchDeleting,
    deleteConversation,
    localize,
    showToast,
    exitSelectionMode,
  ]);

  const formatDate = (date: string, groupName: string) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

    // Today: "今天 14:30"
    if (groupName === 'com_ui_date_today') {
      return `${localize('com_ui_date_today')} ${time}`;
    }
    // Yesterday: "昨天 10:00"
    if (groupName === 'com_ui_date_yesterday') {
      return `${localize('com_ui_date_yesterday')} ${time}`;
    }
    // Previous 7 days: "周三 15:00"
    if (groupName === 'com_ui_date_previous_7_days') {
      const weekdays = localize('com_ui_date_weekdays').split(',');
      const weekday = weekdays[d.getDay()];
      return `${weekday} ${time}`;
    }
    // Previous 30 days and month groups: "3月19日 14:30"
    if (
      groupName === 'com_ui_date_previous_30_days' ||
      groupName.startsWith('com_ui_date_') && [
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'
      ].some(m => groupName.includes(m))
    ) {
      const lang = document.documentElement.lang || 'zh';
      if (lang.startsWith('zh')) {
        return `${month}月${day}日 ${time}`;
      }
      return `${month}/${day} ${time}`;
    }
    // Year groups (older): "2026年3月19日 14:30"
    const lang = document.documentElement.lang || 'zh';
    if (lang.startsWith('zh')) {
      return `${year}年${month}月${day}日 ${time}`;
    }
    return `${month}/${day}/${year} ${time}`;
  };

  const getDateGroupLabel = (groupName: string) => {
    if (groupName === 'com_ui_date_today') {
      return localize('com_ui_date_today');
    }
    if (groupName === 'com_ui_date_yesterday') {
      return localize('com_ui_date_yesterday');
    }
    if (groupName === 'com_ui_date_previous_7_days') {
      return localize('com_ui_date_previous_7_days');
    }
    if (groupName === 'com_ui_date_previous_30_days') {
      return localize('com_ui_date_previous_30_days');
    }
    // Handle month keys
    const monthMap: Record<string, string> = {
      'com_ui_date_january': localize('com_ui_date_january'),
      'com_ui_date_february': localize('com_ui_date_february'),
      'com_ui_date_march': localize('com_ui_date_march'),
      'com_ui_date_april': localize('com_ui_date_april'),
      'com_ui_date_may': localize('com_ui_date_may'),
      'com_ui_date_june': localize('com_ui_date_june'),
      'com_ui_date_july': localize('com_ui_date_july'),
      'com_ui_date_august': localize('com_ui_date_august'),
      'com_ui_date_september': localize('com_ui_date_september'),
      'com_ui_date_october': localize('com_ui_date_october'),
      'com_ui_date_november': localize('com_ui_date_november'),
      'com_ui_date_december': localize('com_ui_date_december'),
    };
    if (monthMap[groupName]) {
      return monthMap[groupName];
    }
    // Year (e.g., " 2024")
    const yearMatch = groupName.trim().match(/^\d{4}$/);
    if (yearMatch) {
      return yearMatch[0];
    }
    return groupName;
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="relative flex h-full flex-col bg-presentation">
      {!isSmallScreen && (
        <div className="sticky top-0 z-20 flex items-center justify-between bg-presentation px-4 py-2 md:h-14">
          <div className="mx-1 flex items-center gap-2">
            {!navVisible ? (
              <>
                {!startupConfig?.leftSidebarButtonHidden && (
                  <OpenSidebar setNavVisible={setNavVisible} />
                )}
                <TooltipAnchor
                  description={localize('com_ui_new_chat')}
                  render={
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label={localize('com_ui_new_chat')}
                      className="rounded-xl border border-border-light bg-surface-secondary p-2 hover:bg-surface-active-alt max-md:hidden"
                      onClick={handleNewChat}
                    >
                      <NewChatIcon />
                    </Button>
                  }
                />
              </>
            ) : (
              <div className="h-10 w-10" />
            )}
          </div>
        </div>
      )}
      <div className="sticky top-0 z-10 bg-presentation px-4 pb-6 pt-2 md:top-14">
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold text-text-primary">
              {localize('com_ui_conversation_history')}
            </h1>
            {conversations.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {isSelectionMode ? (
                  <>
                    <span className="text-sm text-text-secondary">
                      {localize('com_ui_selected_count', { count: selectedCount })}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={allSelected ? handleDeselectAll : handleSelectAll}
                      disabled={isBatchDeleting || conversationIds.length === 0}
                    >
                      {localize(allSelected ? 'com_ui_deselect_all' : 'com_ui_select_all')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleBatchDeleteClick}
                      disabled={selectedCount === 0 || isBatchDeleting}
                      aria-label={localize('com_ui_delete')}
                    >
                      {isBatchDeleting ? (
                        <Spinner className="size-4" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      <span className="ml-1.5">{localize('com_ui_delete')}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={exitSelectionMode}
                      disabled={isBatchDeleting}
                    >
                      {localize('com_ui_cancel')}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsSelectionMode(true)}
                  >
                    {localize('com_ui_select')}
                  </Button>
                )}
              </div>
            )}
          </div>
          <SearchBar value={searchQuery} onSearch={setSearchQuery} placeholder={localize('com_ui_search_conversations')} />

          {!debouncedQuery && searchHistory.length > 0 && (
            <div className="mt-4 w-full">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                    <Clock className="size-4" />
                    <span>{localize('com_ui_recent_searches')}</span>
                  </div>
                  <button
                    onClick={clearHistory}
                    className="text-xs text-text-secondary transition-colors hover:text-text-primary"
                  >
                    {localize('com_ui_clear')}
                  </button>
                </div>
                <div className="scrollbar-hide flex w-full gap-2 overflow-x-auto pb-2">
                  {searchHistory.slice(0, 5).map((term, index) => (
                    <button
                      key={index}
                      onClick={() => handleHistoryClick(term)}
                      className="max-w-[150px] flex-shrink-0 truncate rounded-full bg-[#7948ea] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#6b3dd4]"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-8">
        <div className="mx-auto max-w-6xl">
          <div className="sr-only" role="alert" aria-atomic="true">
            {resultsAnnouncement}
          </div>

          {isLoading && (
            <div className="flex h-64 items-center justify-center">
              <Spinner className="text-[#7948ea]" />
            </div>
          )}
          {!isLoading && conversations.length === 0 && (
            <div className="flex h-64 items-center justify-center">
              <div className="rounded-2xl bg-surface-secondary p-8 text-center">
                <MessageSquare className="mx-auto mb-3 size-12 text-text-secondary" />
                <p className="text-lg text-text-secondary">
                  {debouncedQuery
                    ? localize('com_ui_nothing_found')
                    : localize('com_ui_no_history')}
                </p>
              </div>
            </div>
          )}
          {!isLoading && conversations.length > 0 && (
            <div className="space-y-6">
              {groupedConversations.map(([groupName, groupConvos]) => (
                <div key={groupName}>
                  <h2 className="mb-4 text-sm font-medium text-text-secondary">
                    {getDateGroupLabel(groupName)}
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {groupConvos.map((convo) => (
                      <HistoryCard
                        key={convo.conversationId}
                        conversation={convo}
                        groupName={groupName}
                        formatDate={formatDate}
                        onTogglePin={handleTogglePin}
                        onDelete={handleDeleteConversation}
                        isSelectionMode={isSelectionMode}
                        isSelected={
                          !!convo.conversationId && selectedIds.has(convo.conversationId)
                        }
                        onToggleSelect={handleToggleSelect}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {isFetchingNextPage && (
                <div className="flex justify-center py-4">
                  <Spinner className="text-[#7948ea]" />
                </div>
              )}
              {hasNextPage && !isFetchingNextPage && !debouncedQuery && (
                <div className="flex justify-center py-4">
                  <button
                    onClick={() => fetchNextPage()}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-[#7948ea]"
                  >
                    {localize('com_ui_view_more')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <OGDialog
        open={deleteDialog != null}
        onOpenChange={(open) => {
          if (!open) {
            closeDeleteDialog();
          }
        }}
      >
        <OGDialogTemplate
          showCloseButton={false}
          title={localize(
            deleteDialog?.type === 'batch'
              ? 'com_ui_delete_conversations'
              : 'com_ui_delete_conversation',
          )}
          className="max-w-[450px]"
          main={
            deleteDialog?.type === 'batch' ? (
              <p className="text-sm text-text-primary">
                {localize('com_ui_delete_conversations_confirm', {
                  count: deleteDialog.conversationIds.length,
                })}
              </p>
            ) : (
              <p className="text-sm text-text-primary">
                <Trans
                  i18nKey="com_ui_delete_confirm_strong"
                  values={{ title: deleteDialog?.title ?? '' }}
                  components={{ strong: <strong /> }}
                />
              </p>
            )
          }
          selection={{
            selectHandler: confirmDelete,
            selectClasses: `bg-red-700 dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-800 text-white ${
              isBatchDeleting || deleteConversation.isLoading
                ? 'cursor-not-allowed opacity-80'
                : ''
            }`,
            selectText:
              isBatchDeleting || deleteConversation.isLoading ? (
                <Spinner />
              ) : (
                localize('com_ui_delete')
              ),
          }}
        />
      </OGDialog>
    </div>
  );
}
