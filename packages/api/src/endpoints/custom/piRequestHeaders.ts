function buildPiForwardHeaders(
  existingHeaders: Record<string, string> | undefined,
  conversationId: string | undefined,
  handoff: boolean | undefined,
  maxContextTokens: number | undefined,
) {
  return {
    ...(existingHeaders || {}),
    'X-Conversation-Id': conversationId || '',
    'X-PI-Context-Handoff': handoff === true ? 'true' : 'false',
    'X-PI-Max-Context-Tokens': String(maxContextTokens ?? ''),
  };
}

export { buildPiForwardHeaders };
