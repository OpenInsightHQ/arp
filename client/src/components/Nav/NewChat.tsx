import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { TooltipAnchor, NewChatIcon, MobileSidebar, Sidebar, Button } from '@librechat/client';
import { CLOSE_SIDEBAR_ID, OPEN_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import { useLocalize, useNewConvo } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import { clearMessagesCache } from '~/utils';
import store from '~/store';

export default function NewChat({
  index = 0,
  toggleNav,
  subHeaders,
  isSmallScreen,
  headerButtons,
}: {
  index?: number;
  toggleNav: () => void;
  isSmallScreen?: boolean;
  subHeaders?: React.ReactNode;
  headerButtons?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const { data: startupConfig } = useGetStartupConfig();
  const { newConversation: newConvo } = useNewConvo(index);
  const localize = useLocalize();
  const { conversation } = store.useCreateConversationAtom(index);

  const handleToggleNav = useCallback(() => {
    toggleNav();
    setTimeout(() => {
      document.getElementById(OPEN_SIDEBAR_ID)?.focus();
    }, 250);
  }, [toggleNav]);

  const clickHandler: React.MouseEventHandler<HTMLAnchorElement> = useCallback(
    (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }

      e.preventDefault();
      clearMessagesCache(queryClient, conversation?.conversationId);
      queryClient.invalidateQueries([QueryKeys.messages]);
      newConvo();
      if (isSmallScreen) {
        toggleNav();
      }
    },
    [queryClient, conversation, newConvo, toggleNav, isSmallScreen],
  );

  return (
    <>
      <div className="flex items-center justify-between px-0.5 py-[2px] md:py-2">
        {!startupConfig?.leftSidebarButtonHidden && (
          <TooltipAnchor
            description={localize('com_nav_close_sidebar')}
            render={
              <Button
                id={CLOSE_SIDEBAR_ID}
                size="icon"
                variant="outline"
                data-testid="close-sidebar-button"
                aria-label={localize('com_nav_close_sidebar')}
                aria-expanded={true}
                className="rounded-full border-none bg-transparent duration-0 hover:bg-surface-active-alt focus-visible:ring-inset focus-visible:ring-black focus-visible:ring-offset-0 dark:focus-visible:ring-white md:rounded-xl"
                onClick={handleToggleNav}
              >
                <Sidebar aria-hidden="true" className="max-md:hidden" />
                <MobileSidebar
                  aria-hidden="true"
                  className="icon-lg m-1 inline-flex items-center justify-center md:hidden"
                />
              </Button>
            }
          />
        )}
        <div className="flex-1 text-center">
          <span className="text-sm font-semibold text-text-primary">
            Open Insight
          </span>
        </div>
        <div className="flex gap-0.5">
          {headerButtons}

          <TooltipAnchor
            description={localize('com_ui_new_chat')}
            render={
              <Button
                asChild
                size="icon"
                variant="outline"
                data-testid="nav-new-chat-button"
                aria-label={localize('com_ui_new_chat')}
                className="rounded-full border-none bg-transparent duration-0 hover:bg-surface-active-alt focus-visible:ring-inset focus-visible:ring-black focus-visible:ring-offset-0 dark:focus-visible:ring-white md:rounded-xl"
              >
                <Link to="/c/new" state={{ focusChat: true }} onClick={clickHandler}>
                  <NewChatIcon className="icon-lg text-text-primary" />
                </Link>
              </Button>
            }
          />
        </div>
      </div>
      {subHeaders != null ? subHeaders : null}
    </>
  );
}
