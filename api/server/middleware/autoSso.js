const jwt = require('jsonwebtoken');
const axios = require('axios');
const cookies = require('cookie');
const { logger } = require('@librechat/data-schemas');
const { isEnabled } = require('@librechat/api');
const { setAuthTokens } = require('~/server/services/AuthService');
const { getUserById, findUser, createUser, updateUser } = require('~/models');

const AUTH_LENGTH = 7;
const HEAD_LENGTH = 6;
const BEARER = 'bearer';

function extractToken(auth) {
  if (!auth) {
    return null;
  }
  const trimmed = auth.trim();
  if (trimmed.length > HEAD_LENGTH) {
    const headStr = trimmed.substring(0, HEAD_LENGTH).toLowerCase();
    if (headStr === BEARER) {
      return trimmed.substring(AUTH_LENGTH).trim();
    }
  }
  return trimmed || null;
}

function parseUserMapping(mappingStr) {
  if (!mappingStr) {
    return {};
  }
  const mapping = {};
  for (const pair of mappingStr.split(',')) {
    const colonIdx = pair.indexOf(':');
    const eqIdx = pair.indexOf('=');
    let sepIdx = -1;
    if (colonIdx === -1 && eqIdx === -1) {
      continue;
    } else if (colonIdx === -1) {
      sepIdx = eqIdx;
    } else if (eqIdx === -1) {
      sepIdx = colonIdx;
    } else {
      sepIdx = Math.min(colonIdx, eqIdx);
    }
    const key = pair.substring(0, sepIdx).trim();
    const value = pair.substring(sepIdx + 1).trim();
    if (key && value) {
      mapping[key] = value;
    }
  }
  return mapping;
}

function mapJwtToDmpPayload(jwtPayload, mapping) {
  const result = {};
  const mappedJwtFields = new Set();

  for (const [dmpField, jwtField] of Object.entries(mapping)) {
    if (jwtField === '__all') {
      const allFields = {};
      for (const [key, val] of Object.entries(jwtPayload)) {
        if (!mappedJwtFields.has(key) && typeof val !== 'function') {
          allFields[key] = val;
        }
      }
      result[dmpField] = JSON.stringify(allFields);
    } else if (jwtPayload[jwtField] !== undefined) {
      result[dmpField] = String(jwtPayload[jwtField]);
      mappedJwtFields.add(jwtField);
    }
  }

  return result;
}

async function findOrCreateUser(userSn, dmpData) {
  let user = null;

  try {
    user = await getUserById(userSn);
  } catch (_e) {
    // userSn may not be a valid ObjectId
  }

  if (!user) {
    user = await findUser({ idOnTheSource: userSn });
  }

  if (!user && dmpData.email) {
    user = await findUser({ email: dmpData.email });
    if (user) {
      await updateUser(user._id.toString(), {
        idOnTheSource: userSn,
        provider: 'auto_sso',
        emailVerified: true,
      });
    }
  }

  if (!user) {
    const email = dmpData.email || `${dmpData.username || 'sso-user'}@auto-sso.local`;
    const newUserId = await createUser(
      {
        email,
        username: (dmpData.username || '').toLowerCase(),
        name: dmpData.nickname || '',
        provider: 'auto_sso',
        emailVerified: true,
        idOnTheSource: userSn,
      },
      undefined,
      true,
      false,
    );
    user = await getUserById(newUserId.toString());
  }

  return user;
}

async function authenticateWithSsoToken(rawToken, res) {
  const token = extractToken(rawToken);
  if (!token) {
    return { error: 'Invalid token format' };
  }

  const secretKey = process.env.AUTO_SSO_SECRET_KEY;
  if (!secretKey) {
    return { error: 'AUTO_SSO_SECRET_KEY not configured' };
  }

  let decoded;
  try {
    const alg = process.env.AUTO_SSO_ALG || 'HS256';
    decoded = jwt.verify(token, secretKey, { algorithms: [alg] });
  } catch (err) {
    return { error: 'JWT verification failed: ' + err.message };
  }

  const mappingStr = process.env.AUTO_SSO_USER_MAPPING || '';
  const mapping = parseUserMapping(mappingStr);
  const dmpPayload = mapJwtToDmpPayload(decoded, mapping);

  const dmpHost = process.env.DMP_HOST;
  if (!dmpHost) {
    return { error: 'DMP_HOST not configured' };
  }

  const dmpApiKey = process.env.DMP_API_KEY || '';
  const registerUrl = `${dmpHost}/open-api/system/user/register-third-party-user`;

  let dmpResponse;
  try {
    const response = await axios.post(registerUrl, dmpPayload, {
      headers: { 'api-key': dmpApiKey },
      timeout: 10000,
    });
    dmpResponse = response.data;
  } catch (err) {
    return { error: 'DMP registration API failed: ' + err.message };
  }

  if (!dmpResponse || dmpResponse.code !== 0 || !dmpResponse.data?.userSn) {
    return { error: 'DMP registration API error: ' + JSON.stringify(dmpResponse) };
  }

  const userSn = dmpResponse.data.userSn;
  const user = await findOrCreateUser(userSn, dmpResponse.data);

  if (!user) {
    return { error: 'User not found after creation attempt' };
  }

  const accessToken = await setAuthTokens(user._id, res);
  const { password: _p, totpSecret: _t, __v, ...safeUser } = user;
  safeUser.id = user._id.toString();

  return { token: accessToken, user: safeUser };
}

const autoSso = async (req, res, next) => {
  try {
    if (!isEnabled(process.env.AUTO_SSO)) {
      return next();
    }

    const cookieHeader = req.headers.cookie;
    let parsedCookies = {};
    if (cookieHeader) {
      parsedCookies = cookies.parse(cookieHeader);
      if (parsedCookies.refreshToken) {
        return next();
      }
    }

    const tokenName = process.env.AUTO_SSO_TOKEN_NAME || 'ecdp-auth';
    const rawToken =
      req.headers[tokenName] ||
      req.headers[tokenName.toLowerCase()] ||
      parsedCookies[tokenName] ||
      req.query[tokenName];

    if (!rawToken) {
      return next();
    }

    const result = await authenticateWithSsoToken(rawToken, res);

    if (result.error) {
      logger.warn('[autoSso] ' + result.error);
      return next();
    }

    logger.info('[autoSso] Auto SSO login successful for user: ' + (result.user.username || result.user.email));

    req.user = result.user;
    req.user.id = result.user._id.toString();
    req.headers.authorization = 'Bearer ' + result.token;

    next();
  } catch (err) {
    logger.error('[autoSso] Unexpected error: ' + err.message);
    next();
  }
};

module.exports = autoSso;
module.exports.authenticateWithSsoToken = authenticateWithSsoToken;
