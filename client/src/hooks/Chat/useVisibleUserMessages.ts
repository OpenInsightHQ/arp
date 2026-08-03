import { useLayoutEffect } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import type { TMessage } from 'librechat-data-provider';
import { chatNavigationContextAtom, visibleUserMessagesSelector } from '~/store/chatNavigation';

export default function useVisibleUserMessages(
  messagesTree: TMessage[] | null,
  parentMessageId: string | null | undefined,
): TMessage[] {
  const setContext = useSetRecoilState(chatNavigationContextAtom);

  useLayoutEffect(() => {
    setContext({ messagesTree, parentMessageId });
  }, [messagesTree, parentMessageId, setContext]);

  return useRecoilValue(visibleUserMessagesSelector);
}
