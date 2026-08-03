import React from 'react';
import { useRecoilState } from 'recoil';
import { useMessageProcess } from '~/hooks';
import { useChatContext } from '~/Providers';
import type { TMessageProps } from '~/common';
import { freezeModeState } from '~/store/freezeMode';

import MultiMessage from '~/components/Chat/Messages/MultiMessage';
import ContentRender from './ContentRender';

const MessageContainer = React.memo(
  ({
    handleScroll,
    children,
  }: {
    handleScroll: (event?: unknown) => void;
    children: React.ReactNode;
  }) => {
    return (
      <div
        className="text-token-text-primary w-full border-0 bg-transparent dark:border-0 dark:bg-transparent"
        onWheel={handleScroll}
        onTouchMove={handleScroll}
      >
        {children}
      </div>
    );
  },
);

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

export default function MessageContent(props: TMessageProps) {
  const { conversation, handleScroll, isSubmitting } = useMessageProcess({
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

  return (
    <>
      <MessageContainer handleScroll={handleScroll}>
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
          <ContentRender {...props} isSubmitting={isSubmitting} />
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
