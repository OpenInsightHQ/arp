import { useState, useCallback } from 'react';
import { useSetRecoilState } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, request } from 'librechat-data-provider';
import type { MemoryArtifact } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

type SuggestionStatus = 'pending' | 'confirmed' | 'dismissed';

interface MemorySuggestionCardProps {
  suggestion: MemoryArtifact;
  messageId: string;
  conversationId?: string;
}

const categoryLabels: Record<string, string> = {
  profile: 'com_ui_memory_category_profile',
  preference: 'com_ui_memory_category_preference',
  constraint: 'com_ui_memory_category_constraint',
  knowledge: 'com_ui_memory_category_knowledge',
};

export default function MemorySuggestionCard({
  suggestion,
  messageId,
  conversationId,
}: MemorySuggestionCardProps) {
  const localize = useLocalize();
  const setAttachmentsMap = useSetRecoilState(store.messageAttachmentsMap);
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<SuggestionStatus>(suggestion.status ?? 'pending');

  const categoryLabel = categoryLabels[suggestion.category ?? ''] ?? suggestion.category;

  const updateRecoilStatus = useCallback(
    (newStatus: SuggestionStatus) => {
      setAttachmentsMap((prev) => {
        const newMap = { ...prev } as Record<string, unknown[]>;
        const existing = (newMap[messageId] as Array<Record<string, unknown>>) ?? [];
        newMap[messageId] = existing.map((att) => {
          const mem = att?.memory as Record<string, unknown> | undefined;
          if (mem?.type === 'suggestion' && mem?.key === suggestion.key) {
            return { ...att, memory: { ...mem, status: newStatus } };
          }
          return att;
        });
        return newMap;
      });
    },
    [messageId, suggestion.key, setAttachmentsMap],
  );

  const handleConfirm = useCallback(() => {
    if (status !== 'pending') {
      return;
    }
    // 1. Click → immediately show confirmed + update caches
    setStatus('confirmed');
    updateRecoilStatus('confirmed');

    // 2. Fire-and-forget API
    request
      .post('/api/memories/confirm', {
        messageId,
        key: suggestion.key,
        value: suggestion.value,
        category: suggestion.category,
      })
      .then(() => {
        if (conversationId) {
          queryClient.invalidateQueries([QueryKeys.messages, conversationId]);
        }
      })
      .catch(() => {});
  }, [status, messageId, suggestion.key, suggestion.value, suggestion.category, conversationId, updateRecoilStatus, queryClient]);

  const handleDismiss = useCallback(() => {
    if (status !== 'pending') {
      return;
    }
    setStatus('dismissed');
    updateRecoilStatus('dismissed');

    request
      .post('/api/memories/dismiss', {
        messageId,
        key: suggestion.key,
      })
      .then(() => {
        if (conversationId) {
          queryClient.invalidateQueries([QueryKeys.messages, conversationId]);
        }
      })
      .catch(() => {});
  }, [status, messageId, suggestion.key, conversationId, updateRecoilStatus, queryClient]);

  const isPending = status === 'pending';
  const isConfirmed = status === 'confirmed';
  const isDismissed = status === 'dismissed';

  return (
    <div
      className={cn(
        'my-2 rounded-xl border px-4 py-3 transition-all',
        'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700',
        isDismissed && 'opacity-50',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        {categoryLabel && (
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {localize(categoryLabel)}
          </span>
        )}
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {localize('com_ui_memory_suggestion_title')}
        </span>
      </div>

      <p className="mb-3 text-sm text-gray-700 dark:text-gray-200">{suggestion.value}</p>

      {isPending && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
              'bg-purple-600 text-white hover:bg-purple-700',
              'focus:outline-none',
            )}
          >
            {localize('com_ui_memory_remember')}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className={cn(
              'rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors',
              'border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800',
              'focus:outline-none',
            )}
          >
            {localize('com_ui_memory_ignore')}
          </button>
        </div>
      )}

      {isConfirmed && (
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
          ✅ {localize('com_ui_memory_remembered')}
        </p>
      )}

      {isDismissed && (
        <p className="text-sm text-gray-400 dark:text-gray-500">
          {localize('com_ui_memory_dismissed')}
        </p>
      )}
    </div>
  );
}
