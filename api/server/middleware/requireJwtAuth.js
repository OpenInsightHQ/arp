const cookies = require('cookie');
const passport = require('passport');
const { isEnabled } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');

/**
 * Custom Middleware to handle JWT authentication, with support for OpenID token reuse
 * Switches between JWT and OpenID authentication based on cookies and environment settings
 */
const requireJwtAuth = (req, res, next) => {
  const cookieHeader = req.headers.cookie;
  const tokenProvider = cookieHeader ? cookies.parse(cookieHeader).token_provider : null;

  const authHandler = (err, user, info) => {
    if (err) {
      logger.error('[requireJwtAuth] Authentication error:', err.message, err.stack);
      return res.status(500).json({ error: 'Authentication error' });
    }
    if (!user) {
      logger.warn('[requireJwtAuth] Authentication failed:', info?.message || 'Invalid token');
      return res.status(401).json({ error: 'Unauthorized - ' + (info?.message || 'invalid token') });
    }
    req.user = user;
    next();
  };

  if (tokenProvider === 'openid' && isEnabled(process.env.OPENID_REUSE_TOKENS)) {
    return passport.authenticate('openidJwt', { session: false }, authHandler)(req, res, next);
  }

  return passport.authenticate('jwt', { session: false }, authHandler)(req, res, next);
};

module.exports = requireJwtAuth;
