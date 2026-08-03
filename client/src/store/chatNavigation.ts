import { atom, selector } from 'recoil';
import type { TMessage } from 'librechat-data-provider';
import { extractVisibleUserMessages } from '~/utils/messages';
import families from './families';

const { messagesSiblingIdxFamily } = families;

export type ChatNavigationContext = {
  messagesTree: TMessage[] | null;
  parentMessageId: string | null | undefined;
};

export const chatNavigationContextAtom = atom<ChatNavigationContext>({
  key: 'chatNavigationContext',
  default: {
    messagesTree: null,
    parentMessageId: null,
  },
});

export const visibleUserMessagesSelector = selector<TMessage[]>({
  key: 'visibleUserMessages',
  get: ({ get }) => {
    const { messagesTree, parentMessageId } = get(chatNavigationContextAtom);
    const messages: TMessage[] = [];
    const getSiblingIdx = (messageId: string | null | undefined) =>
      get(messagesSiblingIdxFamily(messageId));

    extractVisibleUserMessages(messagesTree, parentMessageId, getSiblingIdx, messages);
    return messages;
  },
});
