import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import type { TAttachment } from 'librechat-data-provider';
import { Tools } from 'librechat-data-provider';
import { useSearchResultsByTurn } from './useSearchResultsByTurn';
import store from '~/store';

export default function useAttachments({
  messageId,
  attachments,
}: {
  messageId?: string;
  attachments?: TAttachment[];
  messageId?: string;
}) {
  const messageAttachmentsMap = useRecoilValue(store.messageAttachmentsMap);
  const messageAttachments = useMemo(() => {
    const base = attachments ?? messageAttachmentsMap[messageId ?? ''] ?? [];
    // If message.attachments exists (SSE finished, data from MongoDB),
    // merge any user-updated memory suggestion statuses from Recoil map.
    // Otherwise, when the SSE stream ends and message.attachments arrives with
    // status:'pending', it would overwrite the user's confirmed/dismissed action.
    if (attachments && messageId) {
      const recoilAtts = messageAttachmentsMap[messageId];
      if (recoilAtts && recoilAtts.length > 0) {
        return base.map((att) => {
          const mem = (att as Record<string, unknown>)?.[Tools.memory] as Record<string, unknown> | undefined;
          if (!mem || mem.type !== 'suggestion') {
            return att;
          }
          // Find matching attachment in Recoil map to get the most recent status
          const recoilMatch = (recoilAtts as Array<Record<string, unknown>>).find((r) => {
            const rm = r?.[Tools.memory] as Record<string, unknown> | undefined;
            return rm?.type === 'suggestion' && rm?.key === mem.key;
          });
          if (recoilMatch) {
            const recoilMem = (recoilMatch as Record<string, unknown>)?.[Tools.memory] as Record<string, unknown> | undefined;
            const recoilStatus = recoilMem?.status;
            if (recoilStatus && recoilStatus !== 'pending') {
              return { ...att, [Tools.memory]: { ...mem, status: recoilStatus } };
            }
          }
          return att;
        });
      }
    }
    return base;
  }, [attachments, messageAttachmentsMap, messageId]);

  const searchResults = useSearchResultsByTurn(messageAttachments);

  return {
    attachments: messageAttachments,
    searchResults,
  };
}
