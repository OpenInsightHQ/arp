const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { isEnabled, getBalanceConfig } = require('@librechat/api');
const { Constants, CacheKeys, defaultSocialLogins } = require('librechat-data-provider');
const { getLdapConfig } = require('~/server/services/Config/ldap');
const { getAppConfig } = require('~/server/services/Config/app');
const { getProjectByName } = require('~/models/Project');
const { getLogStores } = require('~/cache');

const router = express.Router();
const emailLoginEnabled =
  process.env.ALLOW_EMAIL_LOGIN === undefined || isEnabled(process.env.ALLOW_EMAIL_LOGIN);

const sharedLinksEnabled =
  process.env.ALLOW_SHARED_LINKS === undefined || isEnabled(process.env.ALLOW_SHARED_LINKS);

const publicSharedLinksEnabled =
  sharedLinksEnabled &&
  (process.env.ALLOW_SHARED_LINKS_PUBLIC === undefined ||
    isEnabled(process.env.ALLOW_SHARED_LINKS_PUBLIC));

const sharePointFilePickerEnabled = isEnabled(process.env.ENABLE_SHAREPOINT_FILEPICKER);
const openidReuseTokens = isEnabled(process.env.OPENID_REUSE_TOKENS);
const leftSidebarHidden = isEnabled(process.env.UI_LEFT_SIDEBAR_HIDDEN);
const leftSidebarButtonHidden = isEnabled(process.env.UI_LEFT_SIDEBAR_BUTTON_HIDDEN);
const previewCodeHidden = isEnabled(process.env.UI_PREVIEW_CODE_HIDDEN);
const previewAutoRefresh = isEnabled(process.env.UI_PREVIEW_AUTO_REFRESH);
const footerHidden = isEnabled(process.env.UI_FOOTER_HIDDEN);

const watermarkChatEnabled = isEnabled(process.env.WATERMARK_CHAT_ENABLED);
const watermarkArtifactsEnabled = isEnabled(process.env.WATERMARK_ARTIFACTS_ENABLED);
const watermarkTemplate =
  typeof process.env.WATERMARK_TEMPLATE === 'string' && process.env.WATERMARK_TEMPLATE.trim() !== ''
    ? process.env.WATERMARK_TEMPLATE
    : undefined;

/**
 * Parse a numeric env var, returning `undefined` when missing/invalid so the
 * frontend can fall back to its own defaults.
 * @param {string | undefined} value - The raw environment variable value
 * @param {number} min - Inclusive lower bound
 * @param {number} max - Inclusive upper bound
 * @returns {number | undefined}
 */
const parseNumericEnv = (value, min, max) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return undefined;
  }
  return parsed;
};

const watermarkOpacity = parseNumericEnv(process.env.WATERMARK_OPACITY, 0, 1);
const watermarkFontSize = parseNumericEnv(process.env.WATERMARK_FONT_SIZE, 1, 200);
const watermarkDensity = parseNumericEnv(process.env.WATERMARK_DENSITY, 1, 10);
const watermarkRotation = parseNumericEnv(process.env.WATERMARK_ROTATION, -90, 90);

/**
 * Sanitizes a URL from environment variables, validating it is well-formed.
 * @param {string | undefined} value - The raw environment variable value
 * @param {string} [fallback] - Default value when invalid or empty
 * @returns {string | undefined}
 */
const sanitizePublicUrl = (value, fallback) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  try {
    return new URL(value.trim()).toString();
  } catch {
    return fallback;
  }
};

router.get('/', async function (req, res) {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const refresh = req.query.refresh === 'true';

  if (refresh) {
    await cache.delete(CacheKeys.STARTUP_CONFIG);
    await cache.delete(CacheKeys.MODELS_CONFIG);
  }

  const cachedStartupConfig = await cache.get(CacheKeys.STARTUP_CONFIG);
  if (cachedStartupConfig && !refresh) {
    res.send(cachedStartupConfig);
    return;
  }

  const isBirthday = () => {
    const today = new Date();
    return today.getMonth() === 1 && today.getDate() === 11;
  };

  const instanceProject = await getProjectByName(Constants.GLOBAL_PROJECT_NAME, '_id');

  const ldap = getLdapConfig();

  try {
    const appConfig = await getAppConfig({ role: req.user?.role, refresh });

    const isOpenIdEnabled =
      !!process.env.OPENID_CLIENT_ID &&
      !!process.env.OPENID_CLIENT_SECRET &&
      !!process.env.OPENID_ISSUER &&
      !!process.env.OPENID_SESSION_SECRET;

    const isSamlEnabled =
      !!process.env.SAML_ENTRY_POINT &&
      !!process.env.SAML_ISSUER &&
      !!process.env.SAML_CERT &&
      !!process.env.SAML_SESSION_SECRET;

    const balanceConfig = getBalanceConfig(appConfig);

    /** @type {TStartupConfig} */
    const payload = {
      appTitle: process.env.APP_TITLE,
      appVersion: '3.0.2',
      socialLogins: appConfig?.registration?.socialLogins ?? defaultSocialLogins,
      discordLoginEnabled: !!process.env.DISCORD_CLIENT_ID && !!process.env.DISCORD_CLIENT_SECRET,
      facebookLoginEnabled:
        !!process.env.FACEBOOK_CLIENT_ID && !!process.env.FACEBOOK_CLIENT_SECRET,
      githubLoginEnabled: !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET,
      googleLoginEnabled: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      appleLoginEnabled:
        !!process.env.APPLE_CLIENT_ID &&
        !!process.env.APPLE_TEAM_ID &&
        !!process.env.APPLE_KEY_ID &&
        !!process.env.APPLE_PRIVATE_KEY_PATH,
      openidLoginEnabled: isOpenIdEnabled,
      openidAutoRedirect: isEnabled(process.env.OPENID_AUTO_REDIRECT),
      samlLoginEnabled: !isOpenIdEnabled && isSamlEnabled,
      serverDomain: sanitizePublicUrl(process.env.DOMAIN_SERVER, 'http://localhost:3080'),
      emailLoginEnabled,
      registrationEnabled: !ldap?.enabled && isEnabled(process.env.ALLOW_REGISTRATION),
      socialLoginEnabled: isEnabled(process.env.ALLOW_SOCIAL_LOGIN),
      emailEnabled:
        (!!process.env.EMAIL_SERVICE || !!process.env.EMAIL_HOST) &&
        !!process.env.EMAIL_USERNAME &&
        !!process.env.EMAIL_PASSWORD &&
        !!process.env.EMAIL_FROM,
      showBirthdayIcon:
        isBirthday() ||
        isEnabled(process.env.SHOW_BIRTHDAY_ICON) ||
        process.env.SHOW_BIRTHDAY_ICON === '',
      helpAndFaqURL: sanitizePublicUrl(process.env.HELP_AND_FAQ_URL, 'https://librechat.ai'),
      interface: appConfig?.interfaceConfig,
      turnstile: appConfig?.turnstileConfig,
      modelSpecs: appConfig?.modelSpecs,
      balance: balanceConfig,
      sharedLinksEnabled,
      publicSharedLinksEnabled,
      instanceProjectId: instanceProject._id.toString(),
      bundlerURL: sanitizePublicUrl(process.env.SANDPACK_BUNDLER_URL),
      staticBundlerURL: sanitizePublicUrl(process.env.SANDPACK_STATIC_BUNDLER_URL),
      sharePointFilePickerEnabled,
      sharePointBaseUrl: sanitizePublicUrl(process.env.SHAREPOINT_BASE_URL),
      openidReuseTokens,
      leftSidebarHidden,
      leftSidebarButtonHidden,
      previewCodeHidden,
      previewAutoRefresh,
      footerHidden,
      watermark: {
        chat: watermarkChatEnabled,
        artifacts: watermarkArtifactsEnabled,
        template: watermarkTemplate,
        opacity: watermarkOpacity,
        fontSize: watermarkFontSize,
        density: watermarkDensity,
        rotation: watermarkRotation,
      },
    };

    const webSearchConfig = appConfig?.webSearch;
    if (
      webSearchConfig != null &&
      (webSearchConfig.searchProvider ||
        webSearchConfig.scraperProvider ||
        webSearchConfig.rerankerType)
    ) {
      payload.webSearch = {};
    }

    if (webSearchConfig?.searchProvider) {
      payload.webSearch.searchProvider = webSearchConfig.searchProvider;
    }
    if (webSearchConfig?.scraperProvider) {
      payload.webSearch.scraperProvider = webSearchConfig.scraperProvider;
    }
    if (webSearchConfig?.rerankerType) {
      payload.webSearch.rerankerType = webSearchConfig.rerankerType;
    }

    if (ldap) {
      payload.ldap = ldap;
    }

    await cache.set(CacheKeys.STARTUP_CONFIG, payload);
    return res.status(200).send(payload);
  } catch (err) {
    logger.error('Error in startup config', err);
    return res.status(500).send({ error: err.message });
  }
});

module.exports = router;
