import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useRecoilCallback, useRecoilValue, useSetRecoilState } from 'recoil';
import { Spinner, useToastContext } from '@librechat/client';
import { Constants, EModelEndpoint } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import type { TPreset } from 'librechat-data-provider';
import {
  useNewConvo,
  useAppStartup,
  useAssistantListMap,
  useIdChangeEffect,
  useLocalize,
} from '~/hooks';
import { useGetConvoIdQuery, useGetStartupConfig, useGetEndpointsQuery } from '~/data-provider';
import { getDefaultModelSpec, getModelSpecPreset, logger, isNotFoundError } from '~/utils';
import { ToolCallsMapProvider } from '~/Providers';
import ChatView from '~/components/Chat/ChatView';
import { NotificationSeverity, type ExtendedFile } from '~/common';
import useAuthRedirect from './useAuthRedirect';
import temporaryStore from '~/store/temporary';
import store from '~/store';

export default function ChatRoute() {
  const { data: startupConfig } = useGetStartupConfig();
  const { isAuthenticated, user, roles } = useAuthRedirect();

  const defaultTemporaryChat = useRecoilValue(temporaryStore.defaultTemporaryChat);
  const setIsTemporary = useRecoilCallback(
    ({ set }) =>
      (value: boolean) => {
        set(temporaryStore.isTemporary, value);
      },
    [],
  );
  useAppStartup({ startupConfig, user });

  const index = 0;
  const { conversationId = '' } = useParams();
  const [searchParams] = useSearchParams();
  useIdChangeEffect(conversationId);
  const setFiles = useSetRecoilState(store.filesByIndex(index));
  const fileRestored = useRef(false);
  const { hasSetConversation, conversation } = store.useCreateConversationAtom(index);
  const { newConversation } = useNewConvo();
  const { showToast } = useToastContext();
  const localize = useLocalize();

  const modelsQuery = useGetModelsQuery({
    enabled: isAuthenticated,
    refetchOnMount: 'always',
  });
  const initialConvoQuery = useGetConvoIdQuery(conversationId, {
    enabled:
      isAuthenticated && conversationId !== Constants.NEW_CONVO && !hasSetConversation.current,
  });
  const endpointsQuery = useGetEndpointsQuery({ enabled: isAuthenticated });
  const assistantListMap = useAssistantListMap();

  const isTemporaryChat = conversation && conversation.expiredAt ? true : false;

  useEffect(() => {
    if (conversationId === Constants.NEW_CONVO) {
      setIsTemporary(defaultTemporaryChat);
    } else if (isTemporaryChat) {
      setIsTemporary(isTemporaryChat);
    } else {
      setIsTemporary(false);
    }
  }, [conversationId, isTemporaryChat, setIsTemporary, defaultTemporaryChat]);

  /** This effect is mainly for the first conversation state change on first load of the page.
   *  Adjusting this may have unintended consequences on the conversation state.
   */
  useEffect(() => {
    // Wait for roles to load so hasAgentAccess has a definitive value in useNewConvo
    const rolesLoaded = roles?.USER != null;
    const shouldSetConvo =
      (startupConfig && rolesLoaded && !hasSetConversation.current && !modelsQuery.data?.initial) ??
      false;
    /* Early exit if startupConfig is not loaded and conversation is already set and only initial models have loaded */
    if (!shouldSetConvo) {
      return;
    }

    if (conversationId === Constants.NEW_CONVO && endpointsQuery.data && modelsQuery.data) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      logger.log('conversation', 'ChatRoute, new convo effect', conversation);

      // 从 URL 参数读取 agent_id 和 file_id
      const agentIdFromUrl = searchParams.get('agent_id');
      const fileIdFromUrl = searchParams.get('file_id');

      // 构建 template 对象，包含从 URL 参数读取的 agent_id 和 file_id
      const template = conversation
        ? { ...conversation, ...(agentIdFromUrl && { agent_id: agentIdFromUrl }), ...(fileIdFromUrl && { file_id: fileIdFromUrl }) }
        : { ...(agentIdFromUrl && { agent_id: agentIdFromUrl }), ...(fileIdFromUrl && { file_id: fileIdFromUrl }) };

      newConversation({
        modelsData: modelsQuery.data,
        template: Object.keys(template).length > 0 ? template : undefined,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });

      hasSetConversation.current = true;
    } else if (initialConvoQuery.data && endpointsQuery.data && modelsQuery.data) {
      logger.log('conversation', 'ChatRoute initialConvoQuery', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        /* this is necessary to load all existing settings */
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        buildDefault: false, // Don't rebuild conversation config for existing conversations
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    } else if (
      conversationId &&
      endpointsQuery.data &&
      modelsQuery.data &&
      initialConvoQuery.isError &&
      isNotFoundError(initialConvoQuery.error)
    ) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      showToast({
        message: localize('com_ui_conversation_not_found'),
        severity: NotificationSeverity.WARNING,
      });
      logger.log(
        'conversation',
        'ChatRoute initialConvoQuery isNotFoundError',
        initialConvoQuery.error,
      );
      newConversation({
        modelsData: modelsQuery.data,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });
      hasSetConversation.current = true;
    } else if (
      conversationId === Constants.NEW_CONVO &&
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      logger.log('conversation', 'ChatRoute new convo, assistants effect', conversation);

      // 从 URL 参数读取 agent_id 和 file_id
      const agentIdFromUrl = searchParams.get('agent_id');
      const fileIdFromUrl = searchParams.get('file_id');

      // 构建 template 对象，包含从 URL 参数读取的 agent_id 和 file_id
      const template = conversation
        ? { ...conversation, ...(agentIdFromUrl && { agent_id: agentIdFromUrl }), ...(fileIdFromUrl && { file_id: fileIdFromUrl }) }
        : { ...(agentIdFromUrl && { agent_id: agentIdFromUrl }), ...(fileIdFromUrl && { file_id: fileIdFromUrl }) };

      newConversation({
        modelsData: modelsQuery.data,
        template: Object.keys(template).length > 0 ? template : undefined,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });
      hasSetConversation.current = true;
    } else if (
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      logger.log('conversation', 'ChatRoute convo, assistants effect', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    }
    /* Creates infinite render if all dependencies included due to newConversation invocations exceeding call stack before hasSetConversation.current becomes truthy */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    roles,
    startupConfig,
    initialConvoQuery.data,
    initialConvoQuery.isError,
    endpointsQuery.data,
    modelsQuery.data,
    assistantListMap,
  ]);

  // 从 URL 参数恢复 file_id 对应的文件到 files state
  useEffect(() => {
    if (fileRestored.current) {
      return;
    }

    const fileIdFromUrl = searchParams.get('file_id');
    if (!fileIdFromUrl || !conversation?.conversationId) {
      return;
    }

    // 标记为已处理，避免重复恢复
    fileRestored.current = true;

    // 调用 API 获取文件信息
    fetch(`/api/files/${fileIdFromUrl}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error('Failed to fetch file');
        }
        return res.json();
      })
      .then((file: ExtendedFile) => {
        // 将文件恢复到 files state
        setFiles(new Map([[file.file_id, file]]));
      })
      .catch((error) => {
        console.error('Failed to restore file from URL:', error);
      });
  }, [conversation, searchParams, setFiles]);

  if (endpointsQuery.isLoading || modelsQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center" aria-live="polite" role="status">
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // if not a conversation
  if (conversation?.conversationId === Constants.SEARCH) {
    return null;
  }
  // if conversationId not match
  if (conversation?.conversationId !== conversationId && !conversation) {
    return null;
  }
  // if conversationId is null
  if (!conversationId) {
    return null;
  }

  return (
    <ToolCallsMapProvider conversationId={conversation.conversationId ?? ''}>
      <ChatView index={index} />
    </ToolCallsMapProvider>
  );
}
