import { useCallback } from 'react';
import { Constants } from 'librechat-data-provider';
import { useUpdateConversationMutation } from '~/data-provider';
import { useChatContext } from '~/Providers';
import useLocalStorage from '~/hooks/useLocalStorageAlt';

const PIN_ECHARTS_KEY = 'PIN_ECHARTS_';

export default function useEchartsPrompt() {
  const { conversation, setConversation } = useChatContext();
  const conversationId = conversation?.conversationId ?? '';
  const updateConversation = useUpdateConversationMutation(conversationId);
  const [isPinned, setIsPinned] = useLocalStorage<boolean>(PIN_ECHARTS_KEY, false);

  const enabled = Boolean(conversation?.echartsPrompt);

  const setEnabled = useCallback(
    (value: boolean) => {
      const resolvedConversationId = conversationId || Constants.NEW_CONVO;
      setConversation((prev) => ({
        ...(prev ?? { conversationId: resolvedConversationId }),
        echartsPrompt: value,
      }));

      if (conversationId && conversationId !== Constants.NEW_CONVO) {
        updateConversation.mutate({ conversationId, echartsPrompt: value });
      }
    },
    [conversationId, setConversation, updateConversation],
  );

  const toggle = useCallback(() => {
    setEnabled(!enabled);
  }, [enabled, setEnabled]);

  return { enabled, setEnabled, toggle, isPinned, setIsPinned };
}
