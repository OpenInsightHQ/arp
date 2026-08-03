import React, { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useRecoilState, useRecoilValue } from 'recoil';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { TMessageProps, TMessageIcon } from '~/common';
import { useMessageHelpers, useLocalize, useAttachments, useContentMetadata } from '~/hooks';
import MessageIcon from '~/components/Chat/Messages/MessageIcon';
import ContentParts from './Content/ContentParts';
import { AgentConfigProvider } from '~/context/AgentConfigContext';
import { fontSizeAtom } from '~/store/fontSize';
import SiblingSwitch from './SiblingSwitch';
import MultiMessage from './MultiMessage';
import HoverButtons from './HoverButtons';
import SubRow from './SubRow';
import { freezeModeState } from '~/store/freezeMode';
import { useChatContext } from '~/Providers';
import { cn, getMessageAriaLabel } from '~/utils';
import store from '~/store';

function isInMessageRange(
  messageId: string,
  startMsgId: string,
  endMsgId: string,
  messages: { messageId: string }[] | undefined,
): boolean {
  if (!messages) {
    return messageId === startMsgId || messageId === endMsgId;
  }
  const startIdx = messages.findIndex((m) => m.messageId === startMsgId);
  const endIdx = messages.findIndex((m) => m.messageId === endMsgId);
  const currentIdx = messages.findIndex((m) => m.messageId === messageId);
  if (startIdx === -1 || endIdx === -1 || currentIdx === -1) {
    return false;
  }
  const minIdx = Math.min(startIdx, endIdx);
  const maxIdx = Math.max(startIdx, endIdx);
  return currentIdx >= minIdx && currentIdx <= maxIdx;
}

export default function Message(props: TMessageProps) {
  const localize = useLocalize();
  const { message, siblingIdx, siblingCount, setSiblingIdx, currentEditId, setCurrentEditId } =
    props;
  const { attachments, searchResults } = useAttachments({
    messageId: message?.messageId,
    attachments: message?.attachments,
  });
  const {
    edit,
    index,
    agent,
    isLast,
    enterEdit,
    assistant,
    handleScroll,
    conversation,
    isSubmitting,
    latestMessage,
    handleContinue,
    copyToClipboard,
    regenerateMessage,
  } = useMessageHelpers(props);

  const fontSize = useAtomValue(fontSizeAtom);
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const { children, messageId = null, isCreatedByUser } = message ?? {};

  const { getMessages } = useChatContext();
  const [freezeState, setFreezeState] = useRecoilState(freezeModeState);
  const { isFreezeMode, startMsgId, endMsgId } = freezeState;

  const allMessages = getMessages();

  let isHighlighted = false;
  if (isFreezeMode && messageId !== null) {
    if (startMsgId && !endMsgId) {
      isHighlighted = messageId === startMsgId;
    } else if (startMsgId && endMsgId) {
      isHighlighted = isInMessageRange(messageId, startMsgId, endMsgId, allMessages);
    }
  }

  const handleFreezeClick = () => {
    if (!isFreezeMode || !messageId) return;
    if (!startMsgId) {
      setFreezeState({ ...freezeState, startMsgId: messageId });
    } else if (!endMsgId) {
      if (messageId === startMsgId) {
        setFreezeState({ ...freezeState, startMsgId: null });
      } else {
        setFreezeState({ ...freezeState, endMsgId: messageId });
      }
    } else {
      setFreezeState({ ...freezeState, startMsgId: messageId, endMsgId: null });
    }
  };

  const name = useMemo(() => {
    let result = '';
    if (isCreatedByUser === true) {
      result = localize('com_user_message');
    } else if (assistant) {
      result = assistant.name ?? localize('com_ui_assistant');
    } else if (agent) {
      result = agent.name ?? localize('com_ui_agent');
    }

    return result;
  }, [assistant, agent, isCreatedByUser, localize]);

  const iconData: TMessageIcon = useMemo(
    () => ({
      endpoint: message?.endpoint ?? conversation?.endpoint,
      model: message?.model ?? conversation?.model,
      iconURL: message?.iconURL ?? conversation?.iconURL,
      modelLabel: name,
      isCreatedByUser: message?.isCreatedByUser,
    }),
    [
      name,
      conversation?.endpoint,
      conversation?.iconURL,
      conversation?.model,
      message?.model,
      message?.iconURL,
      message?.endpoint,
      message?.isCreatedByUser,
    ],
  );

  const { hasParallelContent } = useContentMetadata(message);

  if (!message) {
    return null;
  }

  const getChatWidthClass = () => {
    if (maximizeChatSpace) {
      return 'w-full max-w-full md:px-5 lg:px-1 xl:px-5';
    }
    if (hasParallelContent) {
      return 'md:max-w-[58rem] xl:max-w-[70rem]';
    }
    return 'md:max-w-[47rem] xl:max-w-[55rem]';
  };

  const baseClasses = {
    common: 'group mx-auto flex flex-1 gap-3 transition-all duration-300 transform-gpu',
    chat: getChatWidthClass(),
  };

  return (
    <AgentConfigProvider agentId={conversation?.agent_id ?? message?.agent_id}>
    <>
      <div
        className="w-full border-0 bg-transparent dark:border-0 dark:bg-transparent"
        onWheel={handleScroll}
        onTouchMove={handleScroll}
      >
        <div
          className={
            'm-auto justify-center p-4 py-2 md:gap-6 relative' +
            (isFreezeMode ? ' cursor-pointer' : '')
          }
          onClick={isFreezeMode ? handleFreezeClick : undefined}
          style={
            isHighlighted
              ? {
                  backgroundColor: 'rgba(121, 72, 234, 0.06)',
                  borderLeft: '2px solid #7948ea',
                  marginLeft: '-2px',
                  borderRadius: '8px',
                }
              : undefined
          }
        >
          {isFreezeMode && !isHighlighted && (
            <div className="absolute inset-0 rounded-lg transition-colors hover:bg-[rgba(121,72,234,0.04)]" />
          )}
          <div
            id={messageId ?? ''}
            aria-label={getMessageAriaLabel(message, localize)}
            className={cn(baseClasses.common, baseClasses.chat, 'message-render')}
          >
            {!hasParallelContent && (
              <div className="relative flex flex-shrink-0 flex-col items-center">
                <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full pt-0.5">
                  <MessageIcon iconData={iconData} assistant={assistant} agent={agent} />
                </div>
              </div>
            )}
            <div
              className={cn(
                'relative flex flex-col',
                hasParallelContent ? 'w-full' : 'w-11/12',
                isCreatedByUser ? 'user-turn' : 'agent-turn',
              )}
            >
              {!hasParallelContent && (
                <h2 className={cn('select-none font-semibold text-text-primary', fontSize)}>
                  {name}
                </h2>
              )}
              <div className="flex flex-col gap-1">
                <div className="flex max-w-full flex-grow flex-col gap-0">
                  <ContentParts
                    edit={edit}
                    isLast={isLast}
                    enterEdit={enterEdit}
                    siblingIdx={siblingIdx}
                    attachments={attachments}
                    isSubmitting={isSubmitting}
                    searchResults={searchResults}
                    messageId={message.messageId}
                    setSiblingIdx={setSiblingIdx}
                    isCreatedByUser={message.isCreatedByUser}
                    conversationId={conversation?.conversationId}
                    isLatestMessage={messageId === latestMessage?.messageId}
                    content={message.content as Array<TMessageContentParts | undefined>}
                  />
                </div>
                {isLast && isSubmitting ? (
                  <div className="mt-1 h-[27px] bg-transparent" />
                ) : (
                  <SubRow classes="text-xs">
                    <SiblingSwitch
                      siblingIdx={siblingIdx}
                      siblingCount={siblingCount}
                      setSiblingIdx={setSiblingIdx}
                    />
                    <HoverButtons
                      index={index}
                      isEditing={edit}
                      message={message}
                      enterEdit={enterEdit}
                      isSubmitting={isSubmitting}
                      conversation={conversation ?? null}
                      regenerate={() => regenerateMessage()}
                      copyToClipboard={copyToClipboard}
                      handleContinue={handleContinue}
                      latestMessage={latestMessage}
                      isLast={isLast}
                    />
                  </SubRow>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <MultiMessage
        key={messageId}
        messageId={messageId}
        conversation={conversation}
        messagesTree={children ?? []}
        currentEditId={currentEditId}
        setCurrentEditId={setCurrentEditId}
      />
    </>
    </AgentConfigProvider>
  );
}
