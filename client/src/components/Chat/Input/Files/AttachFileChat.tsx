import { memo, useMemo, useState, useCallback } from 'react';
import { v4 } from 'uuid';
import { useRef } from 'react';
import {
  Constants,
  supportsFiles,
  EModelEndpoint,
  mergeFileConfig,
  isAgentsEndpoint,
  getEndpointField,
  isAssistantsEndpoint,
  getEndpointFileConfig,
  isEphemeralAgentId,
  encodeEphemeralAgentId,
  QueryKeys,
  Tools,
  uploadFileSimple,
  type TEndpointsConfig,
} from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import { useGetFileConfig, useGetEndpointsQuery, useGetAgentByIdQuery } from '~/data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentsMapContext, useChatContext } from '~/Providers';
import { FolderOpen } from 'lucide-react';
import { AttachmentIcon, TooltipAnchor } from '@librechat/client';
import { Button } from '@librechat/client';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import store from '~/store';
import { ephemeralAgentByConvoId } from '~/store';
import AttachFileMenu from './AttachFileMenu';
import AttachFile from './AttachFile';
import MyFilesDialogContent from '../CodeInterpreter/MyFilesDialog';

function AttachFileChat({
  disableInputs,
  conversation,
}: {
  disableInputs: boolean;
  conversation: TConversation | null;
}) {
  const queryClient = useQueryClient();
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const { endpoint } = conversation ?? { endpoint: null };
  const isAgents = useMemo(() => isAgentsEndpoint(endpoint), [endpoint]);
  const isAssistants = useMemo(() => isAssistantsEndpoint(endpoint), [endpoint]);
  const [myFilesOpen, setMyFilesOpen] = useState(false);

  const piFilesAgentId = useMemo(() => {
    if (!conversation) {
      return 'default';
    }
    const agentId = conversation.agent_id;
    if (agentId && !isEphemeralAgentId(agentId)) {
      return agentId;
    }
    if (conversation?.model) {
      const endpointsConfig = queryClient.getQueryData<TEndpointsConfig>([QueryKeys.endpoints]);
      const modelLabel = conversation.modelLabel ?? '';
      const modelDisplayLabel =
        endpointsConfig?.[conversation.endpoint ?? '']?.modelDisplayLabel ?? '';
      const sender = modelLabel || modelDisplayLabel || undefined;
      return encodeEphemeralAgentId({
        endpoint: conversation.endpoint ?? '',
        model: conversation.model,
        sender,
      });
    }
    return 'default';
  }, [conversation, queryClient]);

  const agentsMap = useAgentsMapContext();

  const needsAgentFetch = useMemo(() => {
    if (!conversation?.agent_id) {
      return false;
    }
    const agent = agentsMap?.[conversation.agent_id];
    return !agent?.model_parameters;
  }, [conversation?.agent_id, agentsMap]);

  const { data: agentData } = useGetAgentByIdQuery(conversation?.agent_id, {
    enabled: needsAgentFetch,
  });

  const useResponsesApi = useMemo(() => {
    if (!isAgents || !conversation?.agent_id || conversation?.useResponsesApi) {
      return conversation?.useResponsesApi;
    }
    const agent = agentData || agentsMap?.[conversation.agent_id];
    return agent?.model_parameters?.useResponsesApi;
  }, [isAgents, conversation?.agent_id, conversation?.useResponsesApi, agentData, agentsMap]);

  const { data: fileConfig = null } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });

  const { data: endpointsConfig } = useGetEndpointsQuery();

  const endpointType = useMemo(() => {
    return (
      getEndpointField(endpointsConfig, endpoint, 'type') ||
      (endpoint as EModelEndpoint | undefined)
    );
  }, [endpoint, endpointsConfig]);

  const endpointFileConfig = useMemo(
    () =>
      getEndpointFileConfig({
        endpoint,
        fileConfig,
        endpointType,
      }),
    [endpoint, fileConfig, endpointType],
  );
  const endpointSupportsFiles: boolean = useMemo(
    () => supportsFiles[endpointType ?? endpoint ?? ''] ?? false,
    [endpointType, endpoint],
  );
  const isUploadDisabled = useMemo(
    () => (disableInputs || endpointFileConfig?.disabled) ?? false,
    [disableInputs, endpointFileConfig?.disabled],
  );

  const setConversationState = useSetRecoilState(store.conversationByIndex(0));
  const ephemeralAgent = useRecoilValue(ephemeralAgentByConvoId(conversationId));

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const handleOpenMyFiles = useCallback(() => {
    const cid = conversation?.conversationId;
    if (cid && cid !== Constants.NEW_CONVO && cid !== Constants.PENDING_CONVO) {
      setActiveSessionId(cid);
      setMyFilesOpen(true);
      return;
    }
    if (!conversation) {
      return;
    }
    const newId = v4();
    setConversationState({
      ...conversation,
      conversationId: newId,
    });
    setActiveSessionId(newId);
    setMyFilesOpen(true);
  }, [conversation, setConversationState]);

  const handleMyFilesOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setActiveSessionId(null);
    }
    setMyFilesOpen(open);
  }, []);

  const { files: _files, setFiles } = useChatContext();

  const agent = agentData || agentsMap?.[conversation?.agent_id ?? ''];
  const isPIEndpoint = (endpoint as string) === 'pi';
  const [piUploading, setPiUploading] = useState(false);
  const piFileInputRef = useRef<HTMLInputElement>(null);

  const handlePiFileUpload = useCallback(async (file: File) => {
    if (!file || !conversation) return;
    setPiUploading(true);
    const preview = URL.createObjectURL(file);
    const file_id = v4();
    let sid = conversation.conversationId;
    if (!sid || sid === Constants.NEW_CONVO || sid === Constants.PENDING_CONVO) {
      const newId = v4();
      setConversationState({ ...conversation, conversationId: newId });
      sid = newId;
    }
    const baseFile = {
      file_id,
      file,
      type: file.type,
      preview,
      progress: 0.5,
      size: file.size,
      filename: file.name,
      endpoint: 'pi' as const,
      pi_session_id: sid,
      pi_agent_id: piFilesAgentId,
    };
    setFiles((prev: Map<string, any>) => {
      const next = new Map(prev);
      next.set(file_id, baseFile);
      return next;
    });
    uploadFileSimple(piFilesAgentId, sid, file)
      .then((res) => {
        const basePath = (res.path ?? '').replace(/\/+$/, '');
        const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
        setFiles((prev: Map<string, any>) => {
          const next = new Map(prev);
          next.set(file_id, {
            ...baseFile,
            progress: 1,
            filepath: fullPath,
          });
          return next;
        });
      })
      .catch((err) => {
        console.error('PI file upload failed:', err);
        setFiles((prev: Map<string, any>) => {
          const next = new Map(prev);
          next.delete(file_id);
          return next;
        });
      })
      .finally(() => {
        setPiUploading(false);
        if (piFileInputRef.current) {
          piFileInputRef.current.value = '';
        }
      });
  }, [conversation, piFilesAgentId, setConversationState, setFiles]);

  if (isPIEndpoint) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={piFileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              handlePiFileUpload(file);
            }
          }}
        />
        <TooltipAnchor
          description="上传文件"
          id="attach-file-pi"
          disabled={disableInputs || piUploading}
          render={
            <button
              type="button"
              aria-label="上传文件"
              disabled={disableInputs || piUploading}
              className="flex size-9 items-center justify-center rounded-full p-1 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-50"
              onClick={() => {
                if (piFileInputRef.current) {
                  piFileInputRef.current.value = '';
                  piFileInputRef.current.click();
                }
              }}
            >
              <div className="flex w-full items-center justify-center gap-2">
                <AttachmentIcon />
              </div>
            </button>
          }
        />
        <button type="button" onClick={handleOpenMyFiles} title="我的文件" className="flex size-9 items-center justify-center rounded-full p-1 transition-colors hover:bg-surface-hover">
          <FolderOpen className="h-5 w-5" />
        </button>
        {activeSessionId && (
          <MyFilesDialogContent
            agentId={piFilesAgentId}
            sessionId={activeSessionId}
            isOpen={myFilesOpen}
            onOpenChange={handleMyFilesOpenChange}
          />
        )}
      </div>
    );
  }

  if (isAssistants && endpointSupportsFiles && !isUploadDisabled) {
    return (
      <div className="flex items-center gap-2">
        <AttachFile disabled={disableInputs} />
      </div>
    );
  } else if (isAgents || (endpointSupportsFiles && !isUploadDisabled)) {
    return (
      <div className="flex items-center gap-2">
        <AttachFileMenu
          endpoint={endpoint}
          disabled={disableInputs}
          endpointType={endpointType}
          conversationId={conversationId}
          agentId={conversation?.agent_id}
          endpointFileConfig={endpointFileConfig}
          useResponsesApi={useResponsesApi}
        />
      </div>
    );
  }
  return null;
}

export default memo(AttachFileChat);
