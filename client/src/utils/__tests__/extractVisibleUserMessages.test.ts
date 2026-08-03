import type { TMessage } from 'librechat-data-provider';
import { extractVisibleUserMessages } from '~/utils/messages';

function createUserMessage(
  messageId: string,
  text: string,
  children: TMessage[] = [],
): TMessage {
  return {
    messageId,
    text,
    isCreatedByUser: true,
    children,
  } as TMessage;
}

function createAssistantMessage(
  messageId: string,
  children: TMessage[] = [],
): TMessage {
  return {
    messageId,
    text: 'response',
    isCreatedByUser: false,
    children,
  } as TMessage;
}

describe('extractVisibleUserMessages', () => {
  it('follows the active sibling branch instead of collecting all branches', () => {
    const oldBranch = createUserMessage('user-old', 'old question', [
      createAssistantMessage('assistant-old', [
        createUserMessage('user-follow-up', 'follow up'),
      ]),
    ]);
    const newBranch = createUserMessage('user-new', 'edited question', [
      createAssistantMessage('assistant-new'),
    ]);

    const tree = [oldBranch, newBranch];
    const siblingIdxByParent: Record<string, number> = { root: 0 };
    const getSiblingIdx = (parentMessageId: string | null | undefined) =>
      siblingIdxByParent[parentMessageId ?? 'root'] ?? 0;

    const messages: TMessage[] = [];
    extractVisibleUserMessages(tree, 'root', getSiblingIdx, messages);

    expect(messages.map((message) => message.messageId)).toEqual(['user-new']);
  });

  it('respects sibling selection at nested levels', () => {
    const firstQuestion = createUserMessage('user-1', 'first', [
      createAssistantMessage('assistant-1', [
        createUserMessage('user-2-old', 'old second'),
        createUserMessage('user-2-new', 'new second'),
      ]),
    ]);

    const siblingIdxByParent: Record<string, number> = {
      root: 0,
      'assistant-1': 0,
    };
    const getSiblingIdx = (parentMessageId: string | null | undefined) =>
      siblingIdxByParent[parentMessageId ?? 'root'] ?? 0;

    const messages: TMessage[] = [];
    extractVisibleUserMessages([firstQuestion], 'root', getSiblingIdx, messages);

    expect(messages.map((message) => message.messageId)).toEqual(['user-1', 'user-2-new']);
  });
});
