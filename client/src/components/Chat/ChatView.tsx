import { memo, useCallback, useEffect, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { Spinner } from '@librechat/client';
import { useParams, useSearchParams } from 'react-router-dom';
import { Constants, buildTree } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ChatFormValues, ExtendedFile } from '~/common';
import { ChatContext, AddedChatContext, useFileMapContext, ChatFormProvider } from '~/Providers';
import {
  useAddedResponse,
  useResumeOnLoad,
  useAdaptiveSSE,
  useChatHelpers,
  useUpdateFiles,
} from '~/hooks';
import ConversationStarters from './Input/ConversationStarters';
import { useGetMessagesByConvoId } from '~/data-provider';
import { updateTaskQueueItem } from 'librechat-data-provider';
import MessagesView from './Messages/MessagesView';
import Presentation from './Presentation';
import ChatForm from './Input/ChatForm';
import Landing from './Landing';
import Header from './Header';
import Footer from './Footer';
import FreezeConfirmPanel from './FreezeSkill/FreezeConfirmPanel';
import { cn } from '~/utils';
import store from '~/store';

function LoadingSpinner() {
  return (
    <div className="relative flex-1 overflow-hidden overflow-y-auto">
      <div className="relative flex h-full items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    </div>
  );
}

function ChatView({ index = 0 }: { index?: number }) {
  const { conversationId } = useParams();
  const [searchParams] = useSearchParams();
  const fileRestored = useRef(false);

  const rootSubmission = useRecoilValue(store.submissionByIndex(index));
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);

  const fileMap = useFileMapContext();

  const { data: messagesTree = null, isLoading } = useGetMessagesByConvoId(conversationId ?? '', {
    select: useCallback(
      (data: TMessage[]) => {
        const dataTree = buildTree({ messages: data, fileMap });
        return dataTree?.length === 0 ? null : (dataTree ?? null);
      },
      [fileMap],
    ),
    enabled: !!fileMap,
  });

  const chatHelpers = useChatHelpers(index, conversationId);
  const { setFiles, files: currentFiles } = chatHelpers;
  const { addFile } = useUpdateFiles(setFiles);
  const addedChatHelpers = useAddedResponse();

  useAdaptiveSSE(rootSubmission, chatHelpers, false, index);

  // Auto-resume if navigating back to conversation with active job
  // Wait for messages to load before resuming to avoid race condition
  useResumeOnLoad(conversationId, chatHelpers.getMessages, index, !isLoading);

  // Auto-send pending task message (from Task Hub respond)
  useEffect(() => {
    const pending = sessionStorage.getItem('pendingTaskMessage');
    if (!pending) { return; }
    try {
      const { message, taskId, timestamp } = JSON.parse(pending);
      // Only send if within 30 seconds
      if (Date.now() - timestamp > 30000) {
        sessionStorage.removeItem('pendingTaskMessage');
        return;
      }
      // Only send when we have a valid conversation (new or existing)
      if (!conversationId) { return; }

      // Check if endpoint is ready
      const currentEndpoint = chatHelpers.conversation?.endpoint;

      if (currentEndpoint !== 'pi') {
        // Endpoint not ready yet, poll every 300ms
        const pollInterval = setInterval(() => {
          const ep = chatHelpers.conversation?.endpoint;
          const stored = sessionStorage.getItem('pendingTaskMessage');
          if (!stored) {
            clearInterval(pollInterval);
            return;
          }
          if (ep === 'pi') {
            clearInterval(pollInterval);
            sessionStorage.removeItem('pendingTaskMessage');
            sessionStorage.setItem('pendingTaskId', taskId);
            console.log('[ChatView] Endpoint ready, sending task message', { taskId, endpoint: ep });
            setTimeout(() => {
              chatHelpers.ask({ text: message }, {});
            }, 300);
          }
        }, 300);
        // Cleanup after 10 seconds
        setTimeout(() => clearInterval(pollInterval), 10000);
        return;
      }

      // Endpoint is already pi, send immediately
      sessionStorage.removeItem('pendingTaskMessage');
      sessionStorage.setItem('pendingTaskId', taskId);
      console.log('[ChatView] Endpoint ready (immediate), sending task message', { taskId });
      setTimeout(() => {
        chatHelpers.ask({ text: message }, {});
      }, 300);
    } catch {
      sessionStorage.removeItem('pendingTaskMessage');
    }
  }, [conversationId, chatHelpers.ask, chatHelpers.conversation?.endpoint]);

  // Write back conversationId to task after ask creates a real conversation
  useEffect(() => {
    const pendingTaskId = sessionStorage.getItem('pendingTaskId');
    if (!pendingTaskId || !conversationId || conversationId === 'new') { return; }
    // conversationId changed from 'new' to a real ID — write it back to the task
    sessionStorage.removeItem('pendingTaskId');
    console.log('[ChatView] Writing back conversationId to task', { pendingTaskId, conversationId });
    updateTaskQueueItem(pendingTaskId, {
      metadata: { conversationId },
    }).catch((err) => console.error('[ChatView] Failed to write back conversationId:', err));
  }, [conversationId]);

  // Debug: log current files state
  useEffect(() => {
    console.log('[ChatView] currentFiles:', currentFiles, 'size:', currentFiles?.size);
  }, [currentFiles]);

  // Restore file from URL parameter (file_info)
  useEffect(() => {
    const restoreFile = async () => {
      if (
        !fileRestored.current &&
        conversationId === Constants.NEW_CONVO &&
        searchParams
      ) {
        const fileInfoEncoded = searchParams.get('file_info');

        if (fileInfoEncoded) {
          fileRestored.current = true;

          try {
            // 解码文件信息 - 直接解析 JSON
            const decoded = decodeURIComponent(fileInfoEncoded);
            const fileInfo = JSON.parse(decoded);
            console.log('[ChatView] Restoring file:', fileInfo);

            // Create ExtendedFile structure for already-uploaded file
            const extendedFile: ExtendedFile = {
              file_id: fileInfo.file_id,
              temp_file_id: fileInfo.temp_file_id,
              file: undefined,
              type: fileInfo.type || 'text/html',
              preview: fileInfo.filepath,
              progress: 1,
              size: fileInfo.size || 0,
              bytes: fileInfo.bytes || 0,
              filepath: fileInfo.filepath,
              filename: fileInfo.filename,
              source: 'local',
              embedded: false,
            };

            // Use addFile from useUpdateFiles - same pattern as normal file upload
            addFile(extendedFile);
            console.log('[ChatView] File added via addFile:', extendedFile.filename);
          } catch (error) {
            console.error('[ChatView] Failed to restore file:', error);
          }
        }
      }
    };

    restoreFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, searchParams]);

  const methods = useForm<ChatFormValues>({
    defaultValues: { text: '' },
  });

  let content: JSX.Element | null | undefined;
  const isLandingPage =
    (!messagesTree || messagesTree.length === 0) &&
    (conversationId === Constants.NEW_CONVO || !conversationId);
  const isNavigating = (!messagesTree || messagesTree.length === 0) && conversationId != null;

  if (isLoading && conversationId !== Constants.NEW_CONVO) {
    content = <LoadingSpinner />;
  } else if ((isLoading || isNavigating) && !isLandingPage) {
    content = <LoadingSpinner />;
  } else if (!isLandingPage) {
    content = <MessagesView messagesTree={messagesTree} />;
  } else {
    content = <Landing centerFormOnLanding={centerFormOnLanding} />;
  }

  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <AddedChatContext.Provider value={addedChatHelpers}>
          <Presentation>
            <div className="relative flex h-full w-full flex-col">
              {!isLoading && <Header />}
              <>
                <div
                  className={cn(
                    'flex flex-col',
                    isLandingPage
                      ? 'flex-1 items-center justify-end sm:justify-center'
                      : 'h-full overflow-y-auto',
                  )}
                >
                  {content}
                  <div
                    className={cn(
                      'w-full',
                      isLandingPage && 'max-w-3xl transition-all duration-200 xl:max-w-4xl',
                    )}
                  >
                    <ChatForm index={index} />
                    {isLandingPage ? <ConversationStarters /> : <Footer />}
                  </div>
                </div>
                {isLandingPage && <Footer />}
              </>
            </div>
            <FreezeConfirmPanel />
          </Presentation>
        </AddedChatContext.Provider>
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

export default memo(ChatView);
