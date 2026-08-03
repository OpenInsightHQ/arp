import React, { useState, useEffect, useRef } from 'react';
import type { TMessage } from 'librechat-data-provider';
import useVisibleUserMessages from '~/hooks/Chat/useVisibleUserMessages';
import { cn } from '~/utils';

interface ChatNavigationProps {
  messagesTree: TMessage[] | null;
  parentMessageId: string | null | undefined;
  activeId: string | null;
  onNavigate: (messageId: string) => void;
}

function getUserMessageText(message: TMessage): string {
  if (message.text) {
    return message.text;
  }
  if (message.content && Array.isArray(message.content)) {
    for (const content of message.content) {
      if (content && typeof content === 'object' && 'text' in content) {
        const text = (content as { text?: string }).text;
        if (typeof text === 'string') {
          return text;
        }
      }
    }
  }
  return '';
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '…';
}

const ChatNavigation = React.memo(function ChatNavigation({
  messagesTree,
  parentMessageId,
  activeId,
  onNavigate,
}: ChatNavigationProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [topOffset, setTopOffset] = useState('50%');
  const containerRef = useRef<HTMLDivElement>(null);
  const userMessages = useVisibleUserMessages(messagesTree, parentMessageId);

  useEffect(() => {
    const updatePosition = () => {
      const container = containerRef.current;
      const parent = container?.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        const viewportCenter = window.innerHeight / 2;
        const relativeTop = viewportCenter - parentRect.top;
        setTopOffset(`${relativeTop}px`);
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);

    const parent = containerRef.current?.parentElement;
    let observer: ResizeObserver | undefined;
    if (parent) {
      observer = new ResizeObserver(updatePosition);
      observer.observe(parent);
    }

    return () => {
      window.removeEventListener('resize', updatePosition);
      observer?.disconnect();
    };
  }, []);

  if (userMessages.length < 2) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'absolute right-[56px] -translate-y-1/2 z-5',
        'hidden md:block',
      )}
      style={{ top: topOffset }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Collapsed indicator bar - always visible */}
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-[10px]',
          'w-[34px] rounded-lg',
          'transition-all duration-200',
        )}
      >
        {userMessages.map((msg) => {
          const isActive = activeId === msg.messageId;
          return (
            <div
              key={msg.messageId}
              onClick={() => onNavigate(msg.messageId)}
              className={cn(
                'w-2 h-[2px] rounded-[4px]',
                'transition-all duration-200 cursor-pointer',
                isActive
                  ? 'bg-[#ab68ff] dark:bg-[#ab68ff] scale-150'
                  : 'bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500',
              )}
              title={truncateText(getUserMessageText(msg), 15) || '...'}
            />
          );
        })}
      </div>

      {/* Expanded panel - shows on hover */}
      <div
        className={cn(
          'absolute right-0 top-1/2 -translate-y-1/2',
          'flex flex-col items-end justify-center',
          'w-[240px] rounded-2xl',
          'bg-white/90 dark:bg-gray-800/90',
          'backdrop-blur-md',
          'border border-black/10 dark:border-white/10',
          'shadow-[0_0_1px_rgba(0,0,0,0.2),0_0_4px_rgba(0,0,0,0.02),0_12px_32px_rgba(0,0,0,0.08)]',
          'transition-all duration-200',
          isHovered ? 'opacity-100 translate-x-[42px]' : 'opacity-0 translate-x-[30px] pointer-events-none',
        )}
      >
        {/* Top gradient mask - rounded top corners to match container */}
        <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-white dark:from-gray-800 to-transparent z-10 pointer-events-none rounded-t-2xl" />

        {/* Scrollable list - height auto, max-height limited */}
        <div
          className="flex flex-col items-end gap-1 overflow-y-auto w-full max-h-[250px] py-3 px-3 overscroll-contain scrollbar-thin"
        >
          {userMessages.map((msg) => {
            const isActive = activeId === msg.messageId;
            const text = truncateText(getUserMessageText(msg), 18);
            const displayText = text || '...';

            return (
              <div
                key={msg.messageId}
                onClick={() => onNavigate(msg.messageId)}
                className={cn(
                  'flex items-center gap-2 flex-shrink-0',
                  'h-[30px] w-full justify-end',
                  'text-[13px] leading-relaxed whitespace-nowrap',
                  'transition-all duration-200 cursor-pointer',
                  isActive
                    ? 'text-[#ab68ff] dark:text-[#ab68ff] font-medium'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
                )}
              >
                {/* Text label */}
                <span
                  className={cn(
                    'overflow-hidden text-right flex-1',
                    'text-ellipsis',
                    'transition-opacity duration-100',
                    isHovered ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {displayText}
                </span>

                {/* Indicator bar */}
                <span
                  className={cn(
                    'w-2 h-[2px] rounded-[4px] flex-shrink-0',
                    'transition-all duration-200',
                    isActive
                      ? 'bg-[#ab68ff] dark:bg-[#ab68ff] scale-150'
                      : 'bg-gray-300 dark:bg-gray-600 group-hover:bg-gray-400 dark:group-hover:bg-gray-500',
                  )}
                />
              </div>
            );
          })}
        </div>

        {/* Bottom gradient mask - rounded bottom corners to match container */}
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white dark:from-gray-800 to-transparent z-10 pointer-events-none rounded-b-2xl" />
      </div>
    </div>
  );
});

export default ChatNavigation;
