function buildPiForwardHeaders(
  existingHeaders: Record<string, string> | undefined,
  conversationId: string | undefined,
  lang?: string,
  userMessageId?: string,
  responseMessageId?: string,
  parentMessageId?: string,
) {
  return {
    ...(existingHeaders || {}),
    'X-Conversation-Id': conversationId || '',
    ...(lang ? { 'Accept-Language': lang } : {}),
    ...(userMessageId ? { 'X-User-Message-Id': userMessageId } : {}),
    ...(responseMessageId ? { 'X-Response-Message-Id': responseMessageId } : {}),
    // Message-tree mount point known to the frontend. Forwarded so pi pins
    // persistence to the correct parent instead of inferring "last message"
    // (which can race/fork the tree, e.g. after an aborted turn).
    ...(parentMessageId ? { 'X-Parent-Message-Id': parentMessageId } : {}),
  };
}

export { buildPiForwardHeaders };
