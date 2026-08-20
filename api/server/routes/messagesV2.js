/**
 * V2 Messages API routes for third-party consumption.
 *
 * Provides a stable, API-key-authenticated interface for retrieving the
 * full chat history of a conversation by its ID.
 *
 * Usage:
 *   GET /v2/messages/:conversationId - List all messages of a conversation
 *
 * Auth:
 *   Authorization: Bearer <api_key>
 */
const express = require('express');
const { z } = require('zod');
const { SystemRoles } = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const { createRequireApiKeyAuth } = require('@librechat/api');
const { getMessages, validateAgentApiKey, findUser } = require('~/models');
const { configMiddleware } = require('~/server/middleware');

const router = express.Router();
const idSchema = z.string().uuid();

const requireApiKeyAuth = createRequireApiKeyAuth({
  validateAgentApiKey,
  findUser,
});

router.use(requireApiKeyAuth);
router.use(configMiddleware);

/**
 * @route GET /:conversationId
 * @desc Get all messages for a conversation by ID, scoped to the API key's user.
 * @access Private (API key auth required)
 *
 * Headers:
 *   Authorization: Bearer <api_key>
 *
 * Response:
 *   200 -> TMessage[] (sorted by createdAt ascending)
 *   400 -> { error } invalid conversationId
 *   401 -> { error } missing/invalid API key
 *   500 -> { error } internal server error
 */
router.get('/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;

    const parsed = idSchema.safeParse(conversationId);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          message: 'Invalid conversationId: must be a valid UUID',
          type: 'invalid_request_error',
          code: 'invalid_conversation_id',
        },
      });
    }

    const filter =
      req.user.role === SystemRoles.ADMIN ? { conversationId } : { conversationId, user: req.user.id };

    const messages = await getMessages(filter, '-_id -__v -user -streamLog');
    return res.status(200).json(messages);
  } catch (error) {
    logger.error('[messagesV2] Error fetching messages by conversationId:', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error',
        code: 'internal_error',
      },
    });
  }
});

module.exports = router;
