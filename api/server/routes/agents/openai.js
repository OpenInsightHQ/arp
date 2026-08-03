/**
 * OpenAI-compatible API routes for LibreChat agents.
 *
 * Provides a /v1/chat/completions compatible interface for
 * interacting with LibreChat agents remotely via API.
 *
 * Usage:
 *   POST /v1/chat/completions - Chat with an agent
 *   GET /v1/models - List available agents
 *   GET /v1/models/:model - Get agent details
 *
 * Request format:
 *   {
 *     "model": "agent_id_here",
 *     "messages": [{"role": "user", "content": "Hello!"}],
 *     "stream": true
 *   }
 */
const express = require('express');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  generateCheckAccess,
  createRequireApiKeyAuth,
  createCheckRemoteAgentAccess,
  validateRequest,
  isChatCompletionValidationFailure,
  sendErrorResponse,
} = require('@librechat/api');
const {
  OpenAIChatCompletionController,
  ListModelsController,
  GetModelController,
  openaiPIChatCompletionController,
} = require('~/server/controllers/agents/openai');
const { PI_AGENT_ID } = require('~/server/controllers/agents/piPersistence');
const { getEffectivePermissions } = require('~/server/services/PermissionService');
const { validateAgentApiKey, findUser } = require('~/models');
const { configMiddleware } = require('~/server/middleware');
const { getRoleByName } = require('~/models/Role');
const { getAgent } = require('~/models/Agent');

const router = express.Router();

const requireApiKeyAuth = createRequireApiKeyAuth({
  validateAgentApiKey,
  findUser,
});

const checkRemoteAgentsFeature = generateCheckAccess({
  permissionType: PermissionTypes.REMOTE_AGENTS,
  permissions: [Permissions.USE],
  getRoleByName,
});

const checkAgentPermission = createCheckRemoteAgentAccess({
  getAgent,
  getEffectivePermissions,
});

router.use(requireApiKeyAuth);
router.use(configMiddleware);

// ===== PI Agent bypass =====
// Mounted BEFORE checkRemoteAgentsFeature so that model === PI_AGENT_ID
// skips ALL permission/agent-record checks (PI has no DB agent record).
// Reuses the same OpenAI-format validation as the normal agent flow and
// delegates to openaiPIChatCompletionController, which wraps the stateless
// piChatCompletionsController to add message/conversation persistence.
router.post('/chat/completions', async (req, res, next) => {
  const model = req.body?.model || req.params?.model;
  if (model !== PI_AGENT_ID) {
    return next();
  }

  const validation = validateRequest(req.body);
  if (isChatCompletionValidationFailure(validation)) {
    return sendErrorResponse(res, 400, validation.error);
  }

  return openaiPIChatCompletionController(req, res);
});

// Normal agent routes — require permission checks
router.use(checkRemoteAgentsFeature);
router.post('/chat/completions', checkAgentPermission, OpenAIChatCompletionController);

/**
 * @route GET /v1/models
 * @desc List available agents as models
 * @access Private (API key auth required)
 */
router.get('/models', ListModelsController);

/**
 * @route GET /v1/models/:model
 * @desc Get details for a specific agent/model
 * @access Private (API key auth required)
 */
router.get('/models/:model', GetModelController);

module.exports = router;
