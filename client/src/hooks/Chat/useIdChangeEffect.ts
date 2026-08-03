import { useEffect, useRef } from 'react';
import { useResetRecoilState } from 'recoil';
import { logger } from '~/utils';
import { useSetConvoContext } from '~/Providers/SetConvoContext';
import store from '~/store';

/**
 * Hook to reset visible artifacts and conversation state when the conversation ID changes
 * @param conversationId - The current conversation ID
 */
export default function useIdChangeEffect(conversationId: string) {
  const lastConvoId = useRef<string | null>(null);
  const resetVisibleArtifacts = useResetRecoilState(store.visibleArtifacts);
  const hasSetConversation = useSetConvoContext();

  useEffect(() => {
    if (conversationId !== lastConvoId.current) {
      logger.log('conversation', 'Conversation ID change', {
        from: lastConvoId.current,
        to: conversationId,
      });
      // 重置可见的 artifacts
      resetVisibleArtifacts();
      // 重置 hasSetConversation 标志，以便 ChatRoute 重新加载会话数据
      hasSetConversation.current = false;
    }
    lastConvoId.current = conversationId;
  }, [conversationId, resetVisibleArtifacts, hasSetConversation]);
}
