function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 1.5);
}

function getPiMaxContextTokens(headers = {}) {
  const value = Number(headers['x-pi-max-context-tokens']);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 100000;
}

function getMessageContent(message) {
  if (!Array.isArray(message.content)) {
    return message.text || '';
  }

  let content = '';
  for (const part of message.content) {
    if (part.type === 'text') {
      content += part.text || '';
    } else if (part.type === 'think') {
      content += part.think || '';
    } else if (part.type === 'tool_call' && part.tool_call) {
      const toolCall = part.tool_call;
      content += `\n[调用工具: ${toolCall.name || 'unknown'}]`;
      if (toolCall.args) {
        content += `\n参数: ${typeof toolCall.args === 'string' ? toolCall.args : JSON.stringify(toolCall.args)}`;
      }
      if (toolCall.output) {
        const output =
          typeof toolCall.output === 'string' ? toolCall.output : JSON.stringify(toolCall.output);
        content += `\n输出: ${output.substring(0, 500)}`;
      }
    }
  }
  return content;
}

function selectHistoryMessages(messages, currentUserMessage, maxContextTokens) {
  const inputBudget = Math.floor(maxContextTokens * 0.9);
  const historyBudget = Math.max(0, inputBudget - estimateTokens(currentUserMessage));

  let latestPiReplyIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.isCreatedByUser !== true && message.endpoint === 'pi') {
      latestPiReplyIndex = index;
      break;
    }
  }

  let historyEndIndex = messages.length - 1;
  const lastMessage = messages[historyEndIndex];
  if (
    lastMessage?.isCreatedByUser === true &&
    String(lastMessage.text || '').trim() === String(currentUserMessage || '').trim()
  ) {
    historyEndIndex--;
  }

  const lines = [];
  let usedTokens = 0;
  for (let index = historyEndIndex; index > latestPiReplyIndex; index--) {
    const message = messages[index];
    const content = getMessageContent(message);
    if (!content) {
      continue;
    }
    const role = message.isCreatedByUser === true ? '用户' : message.sender || 'PI助手';
    const line = `[${role}]: ${content}`;
    const lineTokens = estimateTokens(line);
    if (usedTokens + lineTokens > historyBudget) {
      break;
    }
    lines.unshift(line);
    usedTokens += lineTokens;
  }

  return { lines, usedTokens, historyBudget, inputBudget };
}

module.exports = {
  estimateTokens,
  getPiMaxContextTokens,
  selectHistoryMessages,
};
