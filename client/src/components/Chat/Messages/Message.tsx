import React from 'react';
import { useRecoilState } from 'recoil';
import { useMessageProcess } from '~/hooks';
import { useChatContext } from '~/Providers';
import type { TMessageProps } from '~/common';
import MessageRender from './ui/MessageRender';
import MultiMessage from './MultiMessage';
import { freezeModeState } from '~/store/freezeMode';

const MessageContainer = React.memo(
  ({
    handleScroll,
    messageId,
    isUser,
    children,
  }: {
    handleScroll: (event?: unknown) => void;
    messageId?: string | null;
    isUser?: boolean;
    children: React.ReactNode;
  }) => {
    return (
      <div
        className="text-token-text-primary w-full border-0 bg-transparent dark:border-0 dark:bg-transparent"
        onWheel={handleScroll}
        onTouchMove={handleScroll}
        data-message-id={messageId ?? undefined}
        data-role={isUser === true ? 'user' : 'assistant'}
      >
        {children}
      </div>
    );
  },
);

/**
 * Check if a messageId falls within the range [startMsgId, endMsgId] 
 * in the flat messages list.
 */
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
  const { conversation, handleScroll } = useMessageProcess({
    message: props.message,
  });
  const { getMessages } = useChatContext();
  const { message, currentEditId, setCurrentEditId } = props;
  const [freezeState, setFreezeState] = useRecoilState(freezeModeState);
  const { isFreezeMode, startMsgId, endMsgId } = freezeState;

  if (!message || typeof message !== 'object') {
    return null;
  }

  const { children, messageId = null } = message;

  const allMessages = getMessages();

  // Determine if this message is highlighted
  let isHighlighted = false;
  if (isFreezeMode && messageId !== null) {
    if (startMsgId && !endMsgId) {
      // Only start selected - highlight just the start message
      isHighlighted = messageId === startMsgId;
    } else if (startMsgId && endMsgId) {
      // Both selected - highlight all messages in range
      // Ensure allMessages is valid and non-empty for range calculation
      if (allMessages && allMessages.length > 0) {
        isHighlighted = isInMessageRange(messageId, startMsgId, endMsgId, allMessages);
      } else {
        // Fallback: only highlight start and end if we can't get the message list
        isHighlighted = messageId === startMsgId || messageId === endMsgId;
      }
    }
  }

  const handleClick = () => {
    if (!isFreezeMode || !messageId) {
      return;
    }

    if (!startMsgId) {
      // Select start
      setFreezeState({ ...freezeState, startMsgId: messageId });
    } else if (!endMsgId) {
      // Select end
      if (messageId === startMsgId) {
        // Clicking the same message again - deselect start
        setFreezeState({ ...freezeState, startMsgId: null });
      } else {
        setFreezeState({ ...freezeState, endMsgId: messageId });
      }
    } else {
      // Both selected, clicking a new message resets and starts over
      setFreezeState({ ...freezeState, startMsgId: messageId, endMsgId: null });
    }
  };

  return (
    <>
      <MessageContainer
        handleScroll={handleScroll}
        messageId={messageId}
        isUser={message?.isCreatedByUser}
      >
        <div
          className={
            'm-auto justify-center p-4 py-2 md:gap-6 relative' +
            (isFreezeMode ? ' cursor-pointer' : '')
          }
          onClick={isFreezeMode ? handleClick : undefined}
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
            <div className="absolute inset-0 rounded-lg transition-colors hover:bg-[rgba(121,72,234,0.06)]" />
          )}
          <MessageRender {...props} />
        </div>
      </MessageContainer>
      <MultiMessage
        key={messageId}
        messageId={messageId}
        conversation={conversation}
        messagesTree={children ?? []}
        currentEditId={currentEditId}
        setCurrentEditId={setCurrentEditId}
      />
    </>
  );
}
