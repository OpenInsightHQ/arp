import { memo, useMemo, useState, useCallback, useRef } from 'react';
import { v4 } from 'uuid';
import { Constants, isAssistantsEndpoint } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import { FolderOpen } from 'lucide-react';
import { AttachmentIcon, TooltipAnchor } from '@librechat/client';
import { useSetRecoilState } from 'recoil';
import { useLocalize } from '~/hooks';
import { usePiFileUpload } from '~/hooks/Files';
import store from '~/store';
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
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const { endpoint } = conversation ?? { endpoint: null };
  const localize = useLocalize();
  const isAssistants = useMemo(() => isAssistantsEndpoint(endpoint), [endpoint]);
  const [myFilesOpen, setMyFilesOpen] = useState(false);

  const setConversationState = useSetRecoilState(store.conversationByIndex(0));

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

  const { piAgentId, uploadFilesToPi } = usePiFileUpload();

  const isPIEndpoint = (endpoint as string) === 'pi';
  const [piUploading, setPiUploading] = useState(false);
  const piFileInputRef = useRef<HTMLInputElement>(null);

  const handlePiFileUpload = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setPiUploading(true);
      try {
        await uploadFilesToPi([file]);
      } finally {
        setPiUploading(false);
        if (piFileInputRef.current) {
          piFileInputRef.current.value = '';
        }
      }
    },
    [uploadFilesToPi],
  );

  const myFilesButton = (
    <>
      <button
        type="button"
        onClick={handleOpenMyFiles}
        title={localize('com_ui_my_files')}
        aria-label={localize('com_ui_my_files')}
        className="flex size-9 items-center justify-center rounded-full p-1 transition-colors hover:bg-surface-hover"
      >
        <FolderOpen className="h-5 w-5" />
      </button>
      {activeSessionId && (
        <MyFilesDialogContent
          agentId={piAgentId}
          sessionId={activeSessionId}
          isOpen={myFilesOpen}
          onOpenChange={handleMyFilesOpenChange}
        />
      )}
    </>
  );

  /** Assistants endpoints keep the legacy provider upload flow. */
  if (isAssistants) {
    return <AttachFile disabled={disableInputs} />;
  }

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
          description={localize('com_ui_upload_pi_file')}
          id="attach-file-pi"
          disabled={disableInputs || piUploading}
          render={
            <button
              type="button"
              aria-label={localize('com_ui_upload_pi_file')}
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
        {myFilesButton}
      </div>
    );
  }

  /** Agents and model endpoints share the unified PI attachment flow. */
  return (
    <div className="flex items-center gap-2">
      <AttachFileMenu
        endpoint={endpoint}
        disabled={disableInputs}
        conversationId={conversationId}
        agentId={conversation?.agent_id}
      />
      {myFilesButton}
    </div>
  );
}

export default memo(AttachFileChat);
