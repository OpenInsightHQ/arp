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
  V2ChatCompletionController,
  v2PIChatCompletionController,
} = require('~/server/controllers/agents/v2');
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
// PI is not a regular LangGraph agent: it is backed by an external PI service
// with its own logic (memory injection, conversation history, artifact
// solidification). When model === 'one-pi':
//   - skip ALL permission/agent-record checks (no DB agent exists for PI)
//   - reuse the same OpenAI-format validation as the normal agent flow
//   - v2PIChatCompletionController resolves v2 context (DMP userSn, conversation
//     ID), calls piChatCompletionsController (stateless translation layer),
//     then persists user message + AI response + conversation — mirroring
//     V2ChatCompletionController's persistence for normal agent flows.
//   - does NOT affect frontend PI chat (which goes through /api/agents/chat/pi
//     → ResumableAgentController, a separate code path with its own persistence).
router.post('/chat/completions', async (req, res, next) => {
  const model = req.body?.model || req.params?.model;
  if (model !== PI_AGENT_ID) {
    return next();
  }

  const validation = validateRequest(req.body);
  if (isChatCompletionValidationFailure(validation)) {
    return sendErrorResponse(res, 400, validation.error);
  }

  return v2PIChatCompletionController(req, res);
});

// Normal agent routes — require permission checks
router.use(checkRemoteAgentsFeature);
router.post('/chat/completions', checkAgentPermission, V2ChatCompletionController);

module.exports = router;
