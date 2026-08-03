const { createRequireJwtOrApiKeyAuth } = require('@librechat/api');
const { validateAgentApiKey, findUser } = require('~/models');
const requireJwtAuth = require('./requireJwtAuth');

/**
 * Combined auth middleware: accepts either a JWT (cookie/Bearer `eyJ...`)
 * or an Agent API key (`Bearer sk-...`). See `createRequireJwtOrApiKeyAuth`
 * in `@librechat/api` for routing details.
 */
const requireJwtOrApiKey = createRequireJwtOrApiKeyAuth({
  jwtAuth: requireJwtAuth,
  validateAgentApiKey,
  findUser,
});

module.exports = requireJwtOrApiKey;
