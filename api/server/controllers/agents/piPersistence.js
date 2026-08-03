const { nanoid } = require('nanoid');
const { logger } = require('@librechat/data-schemas');
const { ContentTypes } = require('librechat-data-provider');
const {
  filterMalformedContentParts,
  healMessagePayload,
} = require('@librechat/api');
const {
  isStreamLogEnabled,
  createStreamLogCollector,
} = require('~/server/services/StreamLog');
const { piChatCompletionsController } = require('~/server/controllers/pi/chatCompletions');
const db = require('~/models');

const PI_ENDPOINT = 'pi';
const PI_MODEL = 'one-pi';
const PI_AGENT_ID = 'one-pi';
const PI_CONVO_AGENT_ID = `${PI_ENDPOINT}__${PI_AGENT_ID}___${PI_MODEL}`;
const PI_MAX_RECURSION = 50;
const NO_PARENT = '00000000-0000-0000-0000-000000000000';

function extractTextFromMessages(messages) {
  return (messages || [])
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
}

/**
 * Extract content, reasoning, and usage from an SSE chunk emitted by
 * piChatCompletionsController.
 *
 * Chunks are OpenAI-format:
 *   - text/reasoning: `data: {"choices":[{"delta":{"content":"..."|"reasoning_content":"..."}}]}`
 *   - usage (final):  `data: {"choices":[],"usage":{"prompt_tokens":N,"completion_tokens":M,"total_tokens":T}}`
 *
 * @returns {{ content: string, reasoning: string, usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number } | null }}
 */
function extractPIResponseContent(chunk) {
  const text =
    typeof chunk === 'string'
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : '';
  let content = '';
  let reasoning = '';
  let usage = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) {
      continue;
    }
    const data = trimmed.slice(6);
    if (data === '[DONE]') {
      continue;
    }
    try {
      const parsed = JSON.parse(data);
      const choices = parsed?.choices;
      const delta = choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
      }
      if (delta?.reasoning_content) {
        reasoning += delta.reasoning_content;
      }
      if (parsed?.usage) {
        usage = {
          prompt_tokens: parsed.usage.prompt_tokens || 0,
          completion_tokens: parsed.usage.completion_tokens || 0,
          total_tokens: parsed.usage.total_tokens || 0,
        };
      }
    } catch (e) {
      // skip non-JSON lines
    }
  }
  return { content, reasoning, usage };
}

/**
 * Build structured content parts from captured text and reasoning,
 * matching the format used by V2ChatCompletionController:
 *   [{ type: 'think', think: '...' }, { type: 'text', text: '...' }]
 *
 * THINK comes first (reasoning happens before the answer).
 */
function buildPIContentParts(text, reasoning) {
  const parts = [];
  if (reasoning) {
    parts.push({ type: ContentTypes.THINK, think: reasoning });
  }
  if (text) {
    parts.push({ type: ContentTypes.TEXT, text });
  }
  return parts;
}

/**
 * Run piChatCompletionsController (stateless translation layer) and persist
 * the user message, AI response, and conversation record.
 *
 * Used by both v2 and openai PI bypass controllers. The translation layer
 * itself is not modified — persistence is layered on top by intercepting
 * res.write (streaming) / res.json (non-streaming) to capture AI response
 * text, reasoning, and the raw SSE stream log.
 *
 * Does NOT affect the frontend PI chat, which goes through
 * /api/agents/chat/pi → ResumableAgentController (a separate code path with
 * its own persistence).
 *
 * Saved records use:
 *   - endpoint: 'pi'
 *   - model: 'one-pi'
 *   - agent_id: 'pi__one-pi___one-pi' (on conversation only)
 *   - content: [{type:'think',...},{type:'text',...}] (on AI message)
 *   - tokenCount / inputTokenCount: from PI usage event (on AI message)
 *   - recursionLimit: '0/50' (placeholder; PI has no recursion steps)
 *   - streamLog: raw SSE wire format (when LOG_LLM_STREAM=true)
 *
 * @param {Object} params
 * @param {string} params.userId - Resolved user identifier (v2: DMP userSn, openai: req.user.id)
 * @param {string} params.conversationId - Resolved conversation ID
 * @param {Object} params.appConfig - App config (req.config)
 * @param {import('express').Request} params.req
 * @param {import('express').Response} params.res
 */
async function runPIChatWithPersistence({ userId, conversationId, appConfig, req, res }) {
  req.user = { ...req.user, id: userId };
  req.headers['x-conversation-id'] = conversationId;

  let capturedContent = '';
  let capturedReasoning = '';
  let capturedUsage = null;

  const streamLogCollector = isStreamLogEnabled() ? createStreamLogCollector() : null;
  const origWrite = res.write.bind(res);
  const origJson = res.json.bind(res);

  res.write = (chunk, ...args) => {
    if (streamLogCollector) {
      const raw =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf8')
            : String(chunk ?? '');
      streamLogCollector.append(raw);
    }
    const extracted = extractPIResponseContent(chunk);
    capturedContent += extracted.content;
    capturedReasoning += extracted.reasoning;
    if (extracted.usage) {
      capturedUsage = extracted.usage;
    }
    return origWrite(chunk, ...args);
  };

  res.json = (data) => {
    const msg = data?.choices?.[0]?.message;
    if (typeof msg?.content === 'string') {
      capturedContent = msg.content;
    }
    if (typeof msg?.reasoning_content === 'string') {
      capturedReasoning = msg.reasoning_content;
    }
    if (data?.usage) {
      capturedUsage = {
        prompt_tokens: data.usage.prompt_tokens || 0,
        completion_tokens: data.usage.completion_tokens || 0,
        total_tokens: data.usage.total_tokens || 0,
      };
    }
    return origJson(data);
  };

  const userMessageId = nanoid();
  const responseMessageId = `chatcmpl-${nanoid()}`;
  const userMessageText = extractTextFromMessages(req.body?.messages);

  try {
    await piChatCompletionsController(req, res);
  } finally {
    res.write = origWrite;
    res.json = origJson;

    const statusCode = res.statusCode || 200;
    if (statusCode < 200 || statusCode >= 300) {
      return;
    }

    const rawContentParts = buildPIContentParts(capturedContent, capturedReasoning);
    const filteredParts = filterMalformedContentParts(rawContentParts);
    const healed = healMessagePayload({
      text: capturedContent,
      content: filteredParts.length > 0 ? filteredParts : undefined,
    });
    const responseContent = healed.content.length > 0 ? healed.content : undefined;
    const healedText = healed.text ?? '';
    const streamLogValue = streamLogCollector ? streamLogCollector.getLog() : undefined;

    const fakeReq = { user: { id: userId }, config: appConfig };

    if (userMessageText) {
      db.saveMessage(
        fakeReq,
        {
          messageId: userMessageId,
          conversationId,
          parentMessageId: NO_PARENT,
          text: userMessageText,
          sender: 'user',
          isCreatedByUser: true,
          endpoint: PI_ENDPOINT,
          model: PI_MODEL,
        },
        { context: 'api/server/controllers/agents/piPersistence.js - PI user message' },
      ).catch((err) => logger.error('[PI Persistence] Error saving user message:', err));
    }

    if (healedText || responseContent || streamLogValue !== undefined) {
      db.saveMessage(
        fakeReq,
        {
          messageId: responseMessageId,
          conversationId,
          parentMessageId: userMessageId,
          text: healedText,
          content: responseContent,
          sender: 'AI',
          isCreatedByUser: false,
          endpoint: PI_ENDPOINT,
          model: PI_MODEL,
          finish_reason: 'stop',
          tokenCount: capturedUsage?.completion_tokens,
          inputTokenCount: capturedUsage?.prompt_tokens,
          recursionLimit: `0/${PI_MAX_RECURSION}`,
          ...(streamLogValue !== undefined && { streamLog: streamLogValue }),
        },
        { context: 'api/server/controllers/agents/piPersistence.js - PI AI response' },
      ).catch((err) => logger.error('[PI Persistence] Error saving AI response:', err));
    }

    db.saveConvo(
      fakeReq,
      {
        conversationId,
        endpoint: PI_ENDPOINT,
        endpointType: PI_ENDPOINT,
        agent_id: PI_CONVO_AGENT_ID,
        model: PI_MODEL,
        finish_reason: 'stop',
      },
      { context: 'api/server/controllers/agents/piPersistence.js - PI conversation' },
    ).catch((err) => logger.error('[PI Persistence] Error saving conversation:', err));
  }
}

module.exports = {
  runPIChatWithPersistence,
  PI_ENDPOINT,
  PI_MODEL,
  PI_AGENT_ID,
  PI_CONVO_AGENT_ID,
};
