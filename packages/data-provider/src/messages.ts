import type { TFile } from './types/files';
import type { TMessage } from './types';

export type ParentMessage = TMessage & { children: TMessage[]; depth: number };
export function buildTree({
  messages,
  fileMap,
}: {
  messages: (TMessage | undefined)[] | null;
  fileMap?: Record<string, TFile>;
}) {
  if (messages === null) {
    return null;
  }

  const messageMap: Record<string, ParentMessage> = {};
  const rootMessages: TMessage[] = [];
  const childrenCount: Record<string, number> = {};
  const orderedMessages: ParentMessage[] = [];

  messages.forEach((message) => {
    if (!message) {
      return;
    }
    // Hide machine-injected / subagent messages from the rendered tree.
    // The server message routes already filter these; this is a client-side
    // safety net for messages that arrive via realtime paths (SSE handlers,
    // cached queries) before server filtering applies. Hidden turns hide
    // every message in the chain, so filtered nodes have no visible children.
    const meta = message.metadata as Record<string, unknown> | undefined;
    if (meta?.hiddenFromTree === true || meta?.isSubagentTrace === true) {
      return;
    }
    const parentId = message.parentMessageId ?? '';
    childrenCount[parentId] = (childrenCount[parentId] || 0) + 1;

    const extendedMessage: ParentMessage = {
      ...message,
      children: [],
      depth: 0,
      siblingIndex: childrenCount[parentId] - 1,
    };

    if (message.files && fileMap) {
      extendedMessage.files = message.files.map((file) => fileMap[file.file_id ?? ''] ?? file);
    }

    messageMap[message.messageId] = extendedMessage;
    orderedMessages.push(extendedMessage);
  });

  // Memoized depth; entries on a cyclic parent chain resolve to 0
  const depthCache = new Map<string, number>();
  const resolveDepth = (messageId: string): number => {
    const cached = depthCache.get(messageId);
    if (cached != null) {
      return cached;
    }
    depthCache.set(messageId, 0);
    const message = messageMap[messageId];
    const parentId = message?.parentMessageId ?? '';
    const parent = parentId ? messageMap[parentId] : undefined;
    const depth = parent && parent.messageId !== messageId ? resolveDepth(parentId) + 1 : 0;
    depthCache.set(messageId, depth);
    return depth;
  };

  // Cyclic parent links would drop every member of the cycle from the tree;
  // treat cycle members as roots so no message is lost
  const createsCycle = (message: ParentMessage, parent: ParentMessage): boolean => {
    const seen = new Set<string>([message.messageId]);
    let current: ParentMessage | undefined = parent;
    while (current != null) {
      if (seen.has(current.messageId)) {
        return true;
      }
      seen.add(current.messageId);
      const nextId: string = current.parentMessageId ?? '';
      current = nextId ? messageMap[nextId] : undefined;
    }
    return false;
  };

  // Two-pass linking: register every message first, then attach children.
  // Messages may arrive out of parent-first order (dual-writer persistence
  // can race `createdAt`, which the messages route sorts by); linking after
  // registration keeps late-ordered parents attached instead of forking
  // extra roots (which render as phantom branches and hide replies).
  orderedMessages.forEach((extendedMessage) => {
    extendedMessage.depth = resolveDepth(extendedMessage.messageId);
    const parentId = extendedMessage.parentMessageId ?? '';
    const parentMessage = messageMap[parentId];
    if (
      parentMessage &&
      parentMessage.messageId !== extendedMessage.messageId &&
      !createsCycle(extendedMessage, parentMessage)
    ) {
      parentMessage.children.push(extendedMessage);
      return;
    }
    rootMessages.push(extendedMessage);
  });

  return rootMessages;
}
