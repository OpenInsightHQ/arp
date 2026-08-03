import React, { memo, useState, useMemo, useCallback } from 'react';
import { v4 } from 'uuid';
import { TerminalSquareIcon, FolderIcon } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import {
  PermissionTypes,
  Permissions,
  isEphemeralAgentId,
  encodeEphemeralAgentId,
  QueryKeys,
  Constants,
  type TEndpointsConfig,
} from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import store from '~/store';
import MyFilesDialogContent from './CodeInterpreter/MyFilesDialog';

function CodeInterpreter() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { codeInterpreter, codeApiKeyForm } = useBadgeRowContext();
  const { toggleState: runCode, debouncedChange, isPinned } = codeInterpreter;
  const { badgeTriggerRef } = codeApiKeyForm;
  const [myFilesOpen, setMyFilesOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const conversation = useRecoilValue(store.conversationByIndex(0));
  const setConversation = useSetRecoilState(store.conversationByIndex(0));

  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });

  const getConversationId = useCallback((): string | null => {
    const cid = conversation?.conversationId;
    if (cid && cid !== Constants.NEW_CONVO && cid !== Constants.PENDING_CONVO) {
      return cid;
    }
    if (!conversation) {
      return null;
    }
    const newId = v4();
    setConversation({
      ...conversation,
      conversationId: newId,
    });
    return newId;
  }, [conversation, setConversation]);

  const piFilesAgentId = useMemo((): string => {
    if (!conversation) {
      return 'default';
    }
    const agentId = conversation.agent_id;
    if (agentId && !isEphemeralAgentId(agentId)) {
      return agentId;
    }
    if (conversation?.model) {
      const { data: endpointsConfig } = queryClient.getQueryState([QueryKeys.endpoints]) ?? {};
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

  const handleOpenMyFiles = useCallback(() => {
    const cid = conversation?.conversationId;
    if (cid && cid !== Constants.NEW_CONVO && cid !== Constants.PENDING_CONVO) {
      setActiveSessionId(cid);
      setMyFilesOpen(true);
      return;
    }
    const newId = getConversationId();
    if (newId) {
      setActiveSessionId(newId);
      setMyFilesOpen(true);
    }
  }, [conversation, getConversationId]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setActiveSessionId(null);
    }
    setMyFilesOpen(open);
  }, []);

  if (!canRunCode) {
    return null;
  }

  if (runCode || isPinned) {
    return (
      <div className="flex items-center gap-2">
        <CheckboxButton
          ref={badgeTriggerRef}
          className="max-w-fit"
          checked={runCode}
          setValue={debouncedChange}
          label={localize('com_assistants_code_interpreter')}
          isCheckedClassName="border-purple-600/40 bg-purple-500/10 hover:bg-purple-700/10"
          icon={<TerminalSquareIcon className="icon-md" aria-hidden="true" />}
        />
        {false && (
          <>
            <button
              type="button"
              onClick={handleOpenMyFiles}
              className="flex items-center gap-1.5 rounded-full border border-border-medium bg-transparent px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover"
              title={localize('com_ui_my_files')}
            >
              <FolderIcon className="icon-md" aria-hidden="true" />
              <span className="hidden md:block">{localize('com_ui_my_files')}</span>
            </button>
            {activeSessionId && (
              <MyFilesDialogContent
                agentId={piFilesAgentId}
                sessionId={activeSessionId}
                isOpen={myFilesOpen}
                onOpenChange={handleOpenChange}
              />
            )}
          </>
        )}
      </div>
    );
  }

  return null;
}

export default memo(CodeInterpreter);
