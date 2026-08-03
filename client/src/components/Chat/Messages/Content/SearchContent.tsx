import { Suspense, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { DelayedRender } from '@librechat/client';
import { ContentTypes } from 'librechat-data-provider';
import type {
  Agents,
  TMessage,
  TAttachment,
  SearchResultData,
  TMessageContentParts,
} from 'librechat-data-provider';
import { UnfinishedMessage } from './MessageContent';
import Sources from '~/components/Web/Sources';
import { cn, mapAttachments } from '~/utils';
import { SearchContext } from '~/Providers';
import MarkdownLite from './MarkdownLite';
import store from '~/store';
import Part from './Part';
import ThinkingProcess from './Parts/ThinkingProcess';

const SearchContent = ({
  message,
  attachments,
  searchResults,
}: {
  message: TMessage;
  attachments?: TAttachment[];
  searchResults?: { [key: string]: SearchResultData };
}) => {
  const enableUserMsgMarkdown = useRecoilValue(store.enableUserMsgMarkdown);
  const { messageId } = message;

  const attachmentMap = useMemo(() => mapAttachments(attachments ?? []), [attachments]);

  if (Array.isArray(message.content) && message.content.length > 0) {
    // Same grouping logic as ContentParts: THINK + TOOL_CALL → ThinkingProcess, others → body
    const thinkingParts: TMessageContentParts[] = [];
    const bodyParts: { part: TMessageContentParts; idx: number }[] = [];

    message.content.forEach((part: TMessageContentParts | undefined, idx: number) => {
      if (!part) {
        return;
      }
      if (part.type === ContentTypes.THINK || part.type === ContentTypes.TOOL_CALL) {
        thinkingParts.push(part);
      } else {
        bodyParts.push({ part, idx });
      }
    });

    return (
      <SearchContext.Provider value={{ searchResults }}>
        <Sources />
        {thinkingParts.length > 0 && (
          <ThinkingProcess
            parts={thinkingParts}
            isSubmitting={false}
            isLatestMessage={false}
          />
        )}
        {bodyParts.map(({ part, idx }) => {
          const toolCallId =
            (part?.[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined)?.id ?? '';
          const attachments = attachmentMap[toolCallId];
          return (
            <Part
              key={`display-${messageId}-${idx}`}
              showCursor={false}
              isSubmitting={false}
              isCreatedByUser={message.isCreatedByUser}
              attachments={attachments}
              part={part}
            />
          );
        })}
        {message.unfinished === true && (
          <Suspense>
            <DelayedRender delay={250}>
              <UnfinishedMessage message={message} key={`unfinished-${messageId}`} />
            </DelayedRender>
          </Suspense>
        )}
      </SearchContext.Provider>
    );
  }

  return (
    <div
      className={cn(
        'markdown prose dark:prose-invert light w-full break-words',
        message.isCreatedByUser && !enableUserMsgMarkdown && 'whitespace-pre-wrap',
        message.isCreatedByUser ? 'dark:text-gray-20' : 'dark:text-gray-70',
      )}
      dir="auto"
    >
      <MarkdownLite content={message.text || ''} />
    </div>
  );
};

export default SearchContent;
