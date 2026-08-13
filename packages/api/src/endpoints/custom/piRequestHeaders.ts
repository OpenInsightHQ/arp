function buildPiForwardHeaders(
  existingHeaders: Record<string, string> | undefined,
  conversationId: string | undefined,
  lang?: string,
  userMessageId?: string,
  responseMessageId?: string,
) {
  return {
    ...(existingHeaders || {}),
    'X-Conversation-Id': conversationId || '',
    ...(lang ? { 'Accept-Language': lang } : {}),
    ...(userMessageId ? { 'X-User-Message-Id': userMessageId } : {}),
    ...(responseMessageId ? { 'X-Response-Message-Id': responseMessageId } : {}),
  };
}

export { buildPiForwardHeaders };
