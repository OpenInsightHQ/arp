const { logger } = require('@librechat/data-schemas');

const RECURSION_LIMIT_REGEX = /recursion limit|max agent steps|max recursion limit/i;
const CONTENT_FILTER_REGEX =
  /content_filter|content policy|content management policy|moderation|DataInspectionFailed|flagged by our moderation/i;
const LENGTH_LIMIT_REGEX = /maximum context|context length|token limit|maximum number of tokens/i;
/*
 * Rate-limit detection covers both structured status codes and the common
 * upstream-wrapped text shapes (e.g. LangChain flattens a 429 into a plain
 * Error whose `status` is lost). Matches:
 * - English: "429", "rate limit", "too many requests"
 * - Chinese upstream saturation messages emitted by some proxies/gateways
 */
const RATE_LIMIT_REGEX =
  /\b429\b|rate[ _-]?limit|too many requests|负载已饱和|上游负载|上游已饱和|请求过于频繁|限流/i;

const RATE_LIMIT_STATUS = 429;

const FinishReason = Object.freeze({
  STOP: 'stop',
  TOOL_CALLS: 'tool_calls',
  LENGTH: 'length',
  CONTENT_FILTER: 'content_filter',
  INCOMPLETE: 'incomplete',
  /**
   * Recursion limit reached. Generic value kept for backward compatibility;
   * new code emits the more specific `_PARTIAL` / `_SUMMARY` variants below.
   */
  RECURSION_LIMIT: 'recursion_limit',
  /** Partial assistant message persisted when a recursion limit was hit. */
  RECURSION_LIMIT_PARTIAL: 'recursion_limit_partial',
  /** Standalone summary message persisted after a recursion limit was hit. */
  RECURSION_LIMIT_SUMMARY: 'recursion_limit_summary',
  RATE_LIMIT: 'rate_limit',
  ERROR: 'error',
});

function isRecursionLimitError(error) {
  const message = error instanceof Error ? error.message : '';
  return typeof message === 'string' && RECURSION_LIMIT_REGEX.test(message);
}

function getErrorFinishReason(error) {
  if (isRecursionLimitError(error)) {
    return FinishReason.RECURSION_LIMIT;
  }

  const message = error instanceof Error ? error.message : '';

  if (
    error?.status === RATE_LIMIT_STATUS ||
    error?.statusCode === RATE_LIMIT_STATUS ||
    (typeof message === 'string' && RATE_LIMIT_REGEX.test(message))
  ) {
    return FinishReason.RATE_LIMIT;
  }

  if (typeof message === 'string') {
    if (CONTENT_FILTER_REGEX.test(message)) {
      return FinishReason.CONTENT_FILTER;
    }
    if (LENGTH_LIMIT_REGEX.test(message)) {
      return FinishReason.LENGTH;
    }
  }

  return FinishReason.ERROR;
}

function getSuccessFinishReason({ hasToolCalls = false } = {}) {
  return hasToolCalls ? FinishReason.TOOL_CALLS : FinishReason.STOP;
}

/** Maximum characters of an error stack preserved in metadata. */
const STACK_HEAD_LIMIT = 2048;

/**
 * Truncates a stack trace to its first `limit` characters while preserving a
 * marker that indicates how much was elided. Returns undefined for non-strings.
 * @param {string} [stack]
 * @param {number} [limit]
 * @returns {string | undefined}
 */
function truncateStack(stack, limit = STACK_HEAD_LIMIT) {
  if (typeof stack !== 'string' || stack.length === 0) {
    return undefined;
  }
  if (stack.length <= limit) {
    return stack;
  }
  return `${stack.slice(0, limit)}\n... [truncated, ${stack.length - limit} more chars]`;
}

/**
 * Builds structured error metadata suitable for persisting on a message's
 * `metadata.error` field. Captures the most useful diagnostic fields without
 * storing the entire error object. Stack traces are head-truncated.
 *
 * @param {unknown} error - The error to introspect.
 * @returns {{ error: Record<string, unknown> } | undefined}
 */
function buildErrorMetadata(error) {
  if (!error) {
    return undefined;
  }

  /** @type {Record<string, unknown>} */
  const detail = {};

  const message = error instanceof Error ? error.message : String(error);
  if (message) {
    detail.message = message;
  }

  const name = error?.name || error?.constructor?.name;
  if (typeof name === 'string' && name && name !== 'Error' && name !== 'Object') {
    detail.name = name;
  }

  if (typeof error?.type === 'string' && error.type) {
    detail.type = error.type;
  }

  const status = error?.status ?? error?.statusCode;
  if (typeof status === 'number') {
    detail.status = status;
  }

  if (typeof error?.code === 'string' && error.code) {
    detail.code = error.code;
  }

  if (typeof error?.provider === 'string' && error.provider) {
    detail.provider = error.provider;
  }

  const causeMessage =
    error?.cause instanceof Error
      ? error.cause.message
      : typeof error?.cause === 'string'
        ? error.cause
        : null;
  if (causeMessage) {
    detail.cause = causeMessage;
  }

  const stackHead = truncateStack(error?.stack);
  if (stackHead) {
    detail.stack_head = stackHead;
  }

  if (Object.keys(detail).length === 0) {
    return undefined;
  }

  return { error: detail };
}

function contentPartsContainToolCall(contentParts) {
  if (!Array.isArray(contentParts)) {
    return false;
  }
  for (const part of contentParts) {
    if (part && part.type === 'tool_call') {
      return true;
    }
  }
  return false;
}

function logFinishReason({ finishReason, context, error }) {
  const detail = error ? ` | error: ${error?.message ?? error}` : '';
  logger.debug(`[finishReason] ${context ?? 'unknown'} -> ${finishReason}${detail}`);
}

module.exports = {
  FinishReason,
  isRecursionLimitError,
  getErrorFinishReason,
  getSuccessFinishReason,
  buildErrorMetadata,
  contentPartsContainToolCall,
  logFinishReason,
};
