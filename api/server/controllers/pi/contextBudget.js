const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_CONTEXT_TOKENS = 90_000;
const DEFAULT_RESERVED_TOKENS = 12_000;
const DEFAULT_TAIL_TOKENS = 8_000;

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function estimateTokens(value, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return Math.ceil(text.length / Math.max(1, charsPerToken));
}

function truncateTextToTokenBudget(text, tokenBudget, options = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return text || '';
  }

  const charsPerToken = normalizePositiveInteger(
    options.charsPerToken,
    DEFAULT_CHARS_PER_TOKEN,
  );
  const normalizedBudget = Math.max(0, Math.floor(tokenBudget || 0));
  const maxChars = normalizedBudget * charsPerToken;

  if (text.length <= maxChars) {
    return text;
  }

  if (maxChars === 0) {
    return '';
  }

  const marker = options.marker || '\n\n[... context truncated to fit token budget ...]\n\n';
  if (maxChars <= marker.length) {
    return text.slice(-maxChars);
  }

  const tailTokens = normalizePositiveInteger(options.tailTokens, DEFAULT_TAIL_TOKENS);
  const tailChars = Math.min(tailTokens * charsPerToken, Math.floor((maxChars - marker.length) / 2));
  const headChars = maxChars - marker.length - tailChars;
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}

function getMessageText(message) {
  if (typeof message?.text === 'string') {
    return message.text;
  }
  if (typeof message?.content === 'string') {
    return message.content;
  }
  return JSON.stringify(message?.content ?? '');
}

function estimateMessageTokens(message, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  return estimateTokens(getMessageText(message), charsPerToken) + 12;
}

function selectHistoryMessages(messages, tokenBudget, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0 || tokenBudget <= 0) {
    return [];
  }

  const charsPerToken = normalizePositiveInteger(
    options.charsPerToken,
    DEFAULT_CHARS_PER_TOKEN,
  );
  const selected = [];
  let usedTokens = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const messageTokens = estimateMessageTokens(message, charsPerToken);
    if (usedTokens + messageTokens > tokenBudget) {
      break;
    }
    selected.push(message);
    usedTokens += messageTokens;
  }

  return selected.reverse();
}

function getPiMaxContextTokens(headerValue, env = process.env) {
  return normalizePositiveInteger(
    headerValue || env.PI_MAX_CONTEXT_TOKENS,
    DEFAULT_MAX_CONTEXT_TOKENS,
  );
}

function getPiReservedTokens(env = process.env) {
  return normalizePositiveInteger(env.PI_CONTEXT_RESERVED_TOKENS, DEFAULT_RESERVED_TOKENS);
}

function isPiContextHandoffEnabled(headerValue, endpointValue, env = process.env) {
  const value = headerValue ?? endpointValue ?? env.PI_CONTEXT_HANDOFF;
  if (value == null || value === '') {
    return true;
  }
  return !['0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
}

module.exports = {
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_RESERVED_TOKENS,
  estimateTokens,
  truncateTextToTokenBudget,
  estimateMessageTokens,
  selectHistoryMessages,
  getPiMaxContextTokens,
  getPiReservedTokens,
  isPiContextHandoffEnabled,
};
