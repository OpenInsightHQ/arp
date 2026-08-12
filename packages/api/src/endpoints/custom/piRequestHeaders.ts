function buildPiForwardHeaders(
  existingHeaders: Record<string, string> | undefined,
  conversationId: string | undefined,
  lang?: string,
) {
  return {
    ...(existingHeaders || {}),
    'X-Conversation-Id': conversationId || '',
    ...(lang ? { 'Accept-Language': lang } : {}),
  };
}

export { buildPiForwardHeaders };
