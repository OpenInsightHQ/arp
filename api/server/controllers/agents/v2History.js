const { ContentTypes } = require('librechat-data-provider');

const NO_PARENT = '00000000-0000-0000-0000-000000000000';

/**
 * Order messages root→leaf along the parent chain starting at `leafMessageId`
 * (same semantics as BaseClient.getMessagesForConversation, single-pass Map
 * lookup). Branch siblings — e.g. from frontend regenerations — are excluded.
 * @param {TMessage[]} messages
 * @param {string} leafMessageId
 * @returns {TMessage[]}
 */
function getThreadMessages(messages, leafMessageId) {
  const byId = new Map(messages.map((msg) => [msg.messageId, msg]));
  const ordered = [];
  const visited = new Set();
  let currentId = leafMessageId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const message = byId.get(currentId);
    if (!message) {
      break;
    }
    ordered.push(message);
    currentId =
      message.parentMessageId && message.parentMessageId !== NO_PARENT
        ? message.parentMessageId
        : null;
  }
  return ordered.reverse();
}

/**
 * Convert one thread message to OpenAI-format messages. User messages keep
 * their image attachments as image_url parts; assistant messages contribute
 * TEXT parts only (THINK reasoning is never replayed as plain text) plus
 * tool_calls/tool pairs when present.
 * @param {TMessage} msg
 * @param {object[] | undefined} imageUrls
 * @returns {object[]}
 */
function convertHistoryMessage(msg, imageUrls) {
  const role = msg.isCreatedByUser ? 'user' : 'assistant';
  if (role === 'user') {
    const text = msg.text ?? '';
    if (imageUrls && imageUrls.length > 0) {
      return [{ role, content: [{ type: 'text', text }, ...imageUrls] }];
    }
    return [{ role, content: text }];
  }

  if (Array.isArray(msg.content) && msg.content.length > 0) {
    const assistantParts = msg.content
      .filter((part) => part != null)
      .filter((part) => part.type === ContentTypes.TEXT);
    const toolCallParts = msg.content
      .filter((part) => part != null)
      .filter((part) => part.type === ContentTypes.TOOL_CALL && part.tool_call);
    const textContent = assistantParts.map((part) => part.text ?? '').join('');
    if (toolCallParts.length === 0) {
      return [{ role, content: textContent || (msg.text ?? '') }];
    }
    const toolCalls = toolCallParts.map((part) => {
      const tc = part.tool_call;
      return {
        id: tc.id ?? '',
        type: 'function',
        function: {
          name: tc.name ?? '',
          arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}),
        },
      };
    });
    const assistantMessage = {
      role,
      content: textContent || null,
      tool_calls: toolCalls,
    };
    const toolMessages = toolCallParts.map((part) => {
      const tc = part.tool_call;
      return {
        role: 'tool',
        tool_call_id: tc.id ?? '',
        content: typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output ?? ''),
      };
    });
    return [assistantMessage, ...toolMessages];
  }
  return [{ role, content: msg.text ?? '' }];
}

module.exports = { getThreadMessages, convertHistoryMessage };
