import { useCallback } from 'react';
import { useSetRecoilState } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  QueryKeys,
  Constants,
  dataService,
  getEndpointField,
  getDefaultParamsEndpoint,
} from 'librechat-data-provider';
import type {
  TEndpointsConfig,
  TStartupConfig,
  TModelsConfig,
  TConversation,
} from 'librechat-data-provider';
import {
  clearModelForNonEphemeralAgent,
  getDefaultEndpoint,
  clearMessagesCache,
  buildDefaultConvo,
  logger,
} from '~/utils';
import { useApplyModelSpecEffects } from '~/hooks/Agents';
import store from '~/store';

const useNavigateToConvo = (index = 0) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clearAllConversations = store.useClearConvoState();
  const applyModelSpecEffects = useApplyModelSpecEffects();
  const setSubmission = useSetRecoilState(store.submissionByIndex(index));
  const clearAllLatestMessages = store.useClearLatestMessages(`useNavigateToConvo ${index}`);
  const { hasSetConversation, setConversation: setConvo } = store.useCreateConversationAtom(index);

  const setConversation = useCallback(
    (conversation: TConversation) => {
      setConvo(conversation);
      if (!conversation.spec) {
        return;
      }

      const startupConfig = queryClient.getQueryData<TStartupConfig>([QueryKeys.startupConfig]);
      applyModelSpecEffects({
        startupConfig,
        specName: conversation?.spec,
        convoId: conversation.conversationId,
      });
    },
    [setConvo, queryClient, applyModelSpecEffects],
  );

  const fetchFreshData = async (conversation?: Partial<TConversation>) => {
    const conversationId = conversation?.conversationId;
    if (!conversationId) {
      return;
    }
    try {
      const data = await queryClient.fetchQuery([QueryKeys.conversation, conversationId], () =>
        dataService.getConversationById(conversationId),
      );
      logger.log('conversation', 'Fetched fresh conversation data', data);

      const convoData = { ...data };
      clearModelForNonEphemeralAgent(convoData);
      setConversation(convoData);
      navigate(`/c/${conversationId ?? Constants.NEW_CONVO}`, { state: { focusChat: true } });
    } catch (error) {
      console.error('Error fetching conversation data on navigation', error);
      if (conversation) {
        setConversation(conversation as TConversation);
        navigate(`/c/${conversationId}`, { state: { focusChat: true } });
      }
    }
  };

  const navigateToConvo = (
    conversation?: TConversation | null,
    options?: {
      resetLatestMessage?: boolean;
      currentConvoId?: string;
    },
  ) => {
    if (!conversation) {
      logger.warn('conversation', 'Conversation not provided to `navigateToConvo`');
      return;
    }
    const { resetLatestMessage = true, currentConvoId } = options || {};
    logger.log('conversation', 'Navigating to conversation', conversation);
    hasSetConversation.current = true;
    setSubmission(null);
    if (resetLatestMessage) {
      logger.log('latest_message', 'Clearing all latest messages');
      clearAllLatestMessages();
    }

    let convo = { ...conversation };
    const endpointsConfig = queryClient.getQueryData<TEndpointsConfig>([QueryKeys.endpoints]);
    if (!convo.endpoint || !endpointsConfig?.[convo.endpoint]) {
      /* undefined/removed endpoint edge case */
      const modelsConfig = queryClient.getQueryData<TModelsConfig>([QueryKeys.models]);
      const defaultEndpoint = getDefaultEndpoint({
        convoSetup: conversation,
        endpointsConfig,
      });

      const endpointType = getEndpointField(endpointsConfig, defaultEndpoint, 'type');
      if (!conversation.endpointType && endpointType) {
        conversation.endpointType = endpointType;
      }

      const models = modelsConfig?.[defaultEndpoint ?? ''] ?? [];

      const defaultParamsEndpoint = getDefaultParamsEndpoint(endpointsConfig, defaultEndpoint);
      convo = buildDefaultConvo({
        models,
        conversation,
        endpoint: defaultEndpoint,
        lastConversationSetup: conversation,
        defaultParamsEndpoint,
      });
    }
    // 切换已有对话时，先设置目标会话并导航，再异步刷新完整数据。
    // 不能先 clearAllConversations，否则 ChatRoute 会在 fetchFreshData 空档期兜底创建新会话。
    if (convo.conversationId !== Constants.NEW_CONVO && convo.conversationId) {
      setConversation(convo as TConversation);
      navigate(`/c/${convo.conversationId}`, { state: { focusChat: true } });
      queryClient.invalidateQueries([QueryKeys.conversation, convo.conversationId]);
      fetchFreshData(convo);
      return;
    }

    clearAllConversations(true);
    // 只在切换到新对话时清空 NEW_CONVO 缓存，切换已有对话时不清缓存
    // 上游的 clearMessagesCache 会无条件清空当前对话缓存，导致 SSE resume 数据丢失
    if (currentConvoId === Constants.NEW_CONVO || !currentConvoId) {
      queryClient.setQueryData([QueryKeys.messages, Constants.NEW_CONVO], []);
    }

    setConversation(convo);
    navigate(`/c/${convo.conversationId ?? Constants.NEW_CONVO}`, { state: { focusChat: true } });
  };

  return {
    navigateToConvo,
  };
};

export default useNavigateToConvo;
