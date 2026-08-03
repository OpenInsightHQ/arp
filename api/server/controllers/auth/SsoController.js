const { logger } = require('@librechat/data-schemas');
const { isEnabled } = require('@librechat/api');
const { authenticateWithSsoToken } = require('~/server/middleware/autoSso');

const ssoController = async (req, res) => {
  try {
    if (!isEnabled(process.env.AUTO_SSO)) {
      return res.status(400).json({ message: 'SSO is not enabled' });
    }

    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    const result = await authenticateWithSsoToken(token, res);

    if (result.error) {
      logger.error('[ssoController] ' + result.error);
      return res.status(401).json({ message: result.error });
    }

    return res.status(200).send({ token: result.token, user: result.user });
  } catch (err) {
    logger.error('[ssoController]', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

module.exports = { ssoController };
