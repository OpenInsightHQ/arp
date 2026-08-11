const { logger } = require('@librechat/data-schemas');
const { piChatCompletionsController } = require('~/server/controllers/pi/chatCompletions');
const db = require('~/models');

const PI_ENDPOINT = 'pi';
const PI_MODEL = 'one-pi';
const PI_AGENT_ID = 'one-pi';
const PI_CONVO_AGENT_ID = `${PI_ENDPOINT}__${PI_AGENT_ID}___${PI_MODEL}`;

/**
 * Run piChatCompletionsController (stateless translation layer) and persist
 * only the conversation record. PI messages (user + AI response) are recorded
 * by the PI backend itself, so they are NOT saved to the local messages table.
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

  try {
    await piChatCompletionsController(req, res);
  } finally {
    const statusCode = res.statusCode || 200;
    if (statusCode < 200 || statusCode >= 300) {
      return;
    }

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
  }
}

module.exports = {
  runPIChatWithPersistence,
  PI_ENDPOINT,
  PI_MODEL,
  PI_AGENT_ID,
  PI_CONVO_AGENT_ID,
};
