const { nanoid } = require('nanoid');
const { logger } = require('@librechat/data-schemas');
const { piChatCompletionsController } = require('~/server/controllers/pi/chatCompletions');
const { appendFooterToResponse } = require('~/server/services/PiFileFooter');
const db = require('~/models');

const PI_ENDPOINT = 'pi';
const PI_MODEL = 'one-pi';
const PI_AGENT_ID = 'one-pi';
const PI_CONVO_AGENT_ID = `${PI_ENDPOINT}__${PI_AGENT_ID}___${PI_MODEL}`;

/**
 * Append the file-links footer (staged on req by the compat layer) to the
 * pi-persisted assistant message. The footer is synthesized on the arp side
 * (links point at arp download routes) AFTER pi finalized its document
 * writes, so it can only be added by a post-stream update. Idempotent-ish:
 * skipped when pi did not persist the pinned response message.
 * @param {string} userId
 * @param {string} responseMessageId
 * @param {string} footer
 */
async function appendFooterToPiMessage(userId, responseMessageId, footer) {
  let message;
  try {
    message = await db.getMessage({ user: userId, messageId: responseMessageId });
  } catch (err) {
    logger.warn('[PI Persistence] Error loading message for footer append:', err?.message);
    return;
  }
  if (!message) {
    logger.warn(
      `[PI Persistence] Message ${responseMessageId} not found; skipping file-links footer append`,
    );
    return;
  }

  const response = {
    text: message.text ?? '',
    ...(Array.isArray(message.content) && { content: [...message.content] }),
  };
  appendFooterToResponse(response, footer);

  try {
    await db.updateMessage(
      { user: { id: userId } },
      { messageId: responseMessageId, text: response.text, content: response.content },
      { context: 'api/server/controllers/agents/piPersistence.js - pi file-links footer' },
    );
  } catch (err) {
    logger.error('[PI Persistence] Error appending file-links footer:', err);
  }
}

/**
 * Run piChatCompletionsController (stateless translation layer) and persist
 * only the conversation record. PI messages (user + AI response) are recorded
 * by the PI backend itself, so they are NOT saved to the local messages table.
 *
 * The user/response message ids are pinned via headers so pi persists its
 * documents under known ids; after the stream ends, the arp-side file-links
 * footer (staged on req by the compat layer) is appended to the persisted
 * assistant message — otherwise the download links would only ever exist in
 * the live SSE stream, never in stored history.
 *
 * Used by both v2 and openai PI bypass controllers.
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

  const userMessageId = nanoid();
  const responseMessageId = `chatcmpl-${nanoid()}`;
  req.headers['x-user-message-id'] = userMessageId;
  req.headers['x-response-message-id'] = responseMessageId;

  try {
    await piChatCompletionsController(req, res);
  } finally {
    const footer = req._piStreamedFileFooter;
    delete req._piStreamedFileFooter;

    const statusCode = res.statusCode || 200;
    if (statusCode >= 200 && statusCode < 300) {
      const fakeReq = { user: { id: userId }, config: appConfig };

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

      if (footer) {
        appendFooterToPiMessage(userId, responseMessageId, footer).catch(() => {});
      }
    }
  }
}

module.exports = {
  runPIChatWithPersistence,
  PI_ENDPOINT,
  PI_MODEL,
  PI_AGENT_ID,
  PI_CONVO_AGENT_ID,
};
