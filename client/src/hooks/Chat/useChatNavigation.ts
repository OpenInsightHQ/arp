import { useState, useEffect, useCallback, useRef } from 'react';

interface UseChatNavigationOptions {
  scrollableRef: React.RefObject<HTMLDivElement | null>;
}

interface UseChatNavigationReturn {
  activeId: string | null;
  navigateTo: (messageId: string) => void;
}

/**
 * Hook for chat navigation functionality
 * Uses IntersectionObserver to detect visible user messages and provides navigation
 */
export default function useChatNavigation({
  scrollableRef,
}: UseChatNavigationOptions): UseChatNavigationReturn {
  const [activeId, setActiveId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const mutationRef = useRef<MutationObserver | null>(null);

  // Navigate to a specific message by scrolling to it
  const navigateTo = useCallback(
    (messageId: string) => {
      if (!scrollableRef.current) return;

      const messageElement = scrollableRef.current.querySelector(
        `[data-message-id="${messageId}"][data-role="user"]`,
      );

      if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [scrollableRef],
  );

  // Set up IntersectionObserver + MutationObserver
  useEffect(() => {
    const container = scrollableRef.current;
    if (!container) return;

    const observeUserMessages = () => {
      // Clean up previous observer
      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      // Create new observer
      observerRef.current = new IntersectionObserver(
        (entries) => {
          const visibleEntries = entries.filter(
            (entry) => entry.isIntersecting && entry.target instanceof HTMLElement,
          );

          if (visibleEntries.length > 0) {
            visibleEntries.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
            const messageId = visibleEntries[0].target.getAttribute('data-message-id');
            if (messageId) {
              setActiveId(messageId);
            }
          }
        },
        {
          root: container,
          rootMargin: '-40% 0px -40% 0px',
          threshold: 0,
        },
      );

      // Observe all user message elements
      const userMessages = container.querySelectorAll('[data-message-id][data-role="user"]');
      userMessages.forEach((el) => observerRef.current?.observe(el));
    };

    // Initial observe
    observeUserMessages();

    // Use MutationObserver to re-observe when DOM changes (new messages added)
    mutationRef.current = new MutationObserver(() => {
      observeUserMessages();
    });

    mutationRef.current.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      observerRef.current?.disconnect();
      mutationRef.current?.disconnect();
    };
  }, [scrollableRef]);

  return {
    activeId,
    navigateTo,
  };
}
