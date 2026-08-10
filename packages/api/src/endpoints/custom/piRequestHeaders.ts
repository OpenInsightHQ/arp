function buildPiForwardHeaders(
  existingHeaders: Record<string, string> | undefined,
  conversationId: string | undefined,
  handoff: boolean | undefined,
  maxContextTokens: number | undefined,
  lang?: string,
) {
  return {
    ...(existingHeaders || {}),
    'X-Conversation-Id': conversationId || '',
    'X-PI-Context-Handoff': handoff === true ? 'true' : 'false',
    'X-PI-Max-Context-Tokens': String(maxContextTokens ?? ''),
    ...(lang ? { 'Accept-Language': lang } : {}),
  };
}

export { buildPiForwardHeaders };
