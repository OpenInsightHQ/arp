require('dns').setDefaultResultOrder('ipv4first');
require('net').setDefaultAutoSelectFamily(false);
require('dotenv').config();
const fs = require('fs');
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..') });
const cors = require('cors');
const axios = require('axios');
const express = require('express');
const passport = require('passport');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { logger } = require('@librechat/data-schemas');
const mongoSanitize = require('express-mongo-sanitize');
const {
  isEnabled,
  ErrorController,
  performStartupChecks,
  handleJsonParseError,
  initializeFileStorage,
  GenerationJobManager,
  createStreamServices,
} = require('@librechat/api');
const { connectDb, indexSync } = require('~/db');
const initializeOAuthReconnectManager = require('./services/initializeOAuthReconnectManager');
const createValidateImageRequest = require('./middleware/validateImageRequest');
const { jwtLogin, ldapLogin, passportLogin } = require('~/strategies');
const { updateInterfacePermissions } = require('~/models/interface');
const { checkMigrations } = require('./services/start/migration');
const initializeMCPs = require('./services/initializeMCPs');
const configureSocialLogins = require('./socialLogins');
const { getAppConfig } = require('./services/Config');
const staticCache = require('./utils/staticCache');
const noIndex = require('./middleware/noIndex');
const autoSso = require('./middleware/autoSso');
const { seedDatabase } = require('~/models');
const routes = require('./routes');

const { PORT, HOST, ALLOW_SOCIAL_LOGIN, DISABLE_COMPRESSION, TRUST_PROXY } = process.env ?? {};

// Allow PORT=0 to be used for automatic free port assignment
const port = isNaN(Number(PORT)) ? 3080 : Number(PORT);
const host = HOST || 'localhost';
const trusted_proxy = Number(TRUST_PROXY) || 1; /* trust first proxy by default */

const app = express();

const startServer = async () => {
  if (typeof Bun !== 'undefined') {
    axios.defaults.headers.common['Accept-Encoding'] = 'gzip';
  }
  await connectDb();

  logger.info('Connected to MongoDB');
  indexSync().catch((err) => {
    logger.error('[indexSync] Background sync failed:', err);
  });

  app.disable('x-powered-by');
  app.set('trust proxy', trusted_proxy);

  await seedDatabase();
  const appConfig = await getAppConfig();
  initializeFileStorage(appConfig);
  await performStartupChecks(appConfig);
  await updateInterfacePermissions(appConfig);

  const indexPath = path.join(appConfig.paths.dist, 'index.html');
  let indexHTML = fs.readFileSync(indexPath, 'utf8');

  if (!indexHTML.includes('base href="/arp/"')) {
    logger.info('Setting base href to /arp/');
    indexHTML = indexHTML.replace(/base href="[^"]*"/, 'base href="/arp/"');
  }

  app.get('/health', (_req, res) => res.status(200).send('OK'));

  /* Middleware */
  app.use(noIndex);

// Fix CSP error: Set a proper Content Security Policy header
  const cspFrameSrc = process.env.CSP_FRAME_SRC || '';
  const cspConnectSrc = process.env.CSP_CONNECT_SRC || '';
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      `connect-src 'self'${cspConnectSrc ? ' ' + cspConnectSrc : ''}`,
      `frame-src 'self' blob:${cspFrameSrc ? ' ' + cspFrameSrc : ''}`,
      `child-src 'self' blob:${cspFrameSrc ? ' ' + cspFrameSrc : ''}`,
    ].join(';'));
    next();
  });
  app.use(express.urlencoded({ extended: true, limit: '3mb' }));
  app.use(express.json({ limit: '3mb' }));
  app.use(handleJsonParseError);

  /**
   * Express 5 Compatibility: Make req.query writable for mongoSanitize
   * In Express 5, req.query is read-only by default, but express-mongo-sanitize needs to modify it
   */
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'query', {
      ...Object.getOwnPropertyDescriptor(req, 'query'),
      value: req.query,
      writable: true,
    });
    next();
  });

  app.use(mongoSanitize());
  app.use(cors({
    origin: [
      'https://lightclaw.cloud.tencent.com',
      'http://localhost:3000',
      'http://localhost:3080',
      process.env.DOMAIN_CLIENT
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      process.env.AUTO_SSO_TOKEN_NAME,
    ].filter(Boolean)
  }));
  app.use(cookieParser());
  app.use(autoSso);

  if (!isEnabled(DISABLE_COMPRESSION)) {
    app.use(compression());
  } else {
    console.warn('Response compression has been disabled via DISABLE_COMPRESSION.');
  }

  app.use('/arp', staticCache(appConfig.paths.dist));
  app.use('/arp/assets', staticCache(appConfig.paths.assets));
  app.use('/arp/fonts', staticCache(appConfig.paths.fonts));

  // Return 404 for missing static files instead of falling back to index.html
  app.use('/arp/assets/', (_req, res) => res.status(404).send('Not Found'));
  app.use('/arp/fonts/', (_req, res) => res.status(404).send('Not Found'));

  if (!ALLOW_SOCIAL_LOGIN) {
    console.warn('Social logins are disabled. Set ALLOW_SOCIAL_LOGIN=true to enable them.');
  }

  /* OAUTH */
  app.use(passport.initialize());
  passport.use(jwtLogin());
  passport.use(passportLogin());

  /* LDAP Auth */
  if (process.env.LDAP_URL && process.env.LDAP_USER_SEARCH_BASE) {
    passport.use(ldapLogin);
  }

  if (isEnabled(ALLOW_SOCIAL_LOGIN)) {
    await configureSocialLogins(app);
  }

  app.use('/oauth', routes.oauth);
  app.use('/arp/oauth', routes.oauth);
  /* API Endpoints */
  app.use('/api/auth', routes.auth);
  app.use('/api/admin', routes.adminAuth);
  app.use('/api/actions', routes.actions);
  app.use('/api/keys', routes.keys);
  app.use('/api/api-keys', routes.apiKeys);
  app.use('/api/user', routes.user);
  app.use('/api/search', routes.search);
  app.use('/api/messages', routes.messages);
  app.use('/api/v2/messages', routes.messagesV2);
  app.use('/api/convos', routes.convos);
  app.use('/api/presets', routes.presets);
  app.use('/api/prompts', routes.prompts);
  app.use('/api/categories', routes.categories);
  app.use('/api/endpoints', routes.endpoints);
  app.use('/api/balance', routes.balance);
  app.use('/api/models', routes.models);
  app.use('/api/config', routes.config);
  app.use('/api/assistants', routes.assistants);
  app.use('/api/files', await routes.files.initialize());
  app.use('/images/', createValidateImageRequest(appConfig.secureImageLinks), routes.staticRoute);
  app.use('/api/share', routes.share);
  app.use('/api/roles', routes.roles);
  app.use('/api/agents', routes.agents);
  app.use('/api/gallery', routes.gallery);
  app.use('/api/gallery', routes.galleryShare);
  app.use('/api/banner', routes.banner);
  app.use('/api/memories', routes.memories);
  app.use('/api/skills', routes.skills);
  app.use('/api/permissions', routes.accessPermissions);

  app.use('/api/tags', routes.tags);
  app.use('/api/mcp', routes.mcp);
  app.use('/api/pi', require('./routes/pi'));
  app.use('/api/task-queue', routes.taskQueue);

  /* /arp prefixed API Endpoints */
  app.use('/arp/api/task-queue', routes.taskQueue);
  app.use('/arp/api/auth', routes.auth);
  app.use('/arp/api/admin', routes.adminAuth);
  app.use('/arp/api/actions', routes.actions);
  app.use('/arp/api/keys', routes.keys);
  app.use('/arp/api/api-keys', routes.apiKeys);
  app.use('/arp/api/user', routes.user);
  app.use('/arp/api/search', routes.search);
  app.use('/arp/api/messages', routes.messages);
  app.use('/arp/api/v2/messages', routes.messagesV2);
  app.use('/arp/api/convos', routes.convos);
  app.use('/arp/api/presets', routes.presets);
  app.use('/arp/api/prompts', routes.prompts);
  app.use('/arp/api/categories', routes.categories);
  app.use('/arp/api/endpoints', routes.endpoints);
  app.use('/arp/api/balance', routes.balance);
  app.use('/arp/api/models', routes.models);
  app.use('/arp/api/config', routes.config);
  app.use('/arp/api/assistants', routes.assistants);
  app.use('/arp/api/files', await routes.files.initialize());
  app.use('/arp/images/', createValidateImageRequest(appConfig.secureImageLinks), routes.staticRoute);
  app.use('/arp/api/share', routes.share);
  app.use('/arp/api/roles', routes.roles);
  app.use('/arp/api/agents', routes.agents);
  app.use('/arp/api/gallery', routes.gallery);
  app.use('/arp/api/gallery', routes.galleryShare);
  app.use('/arp/api/banner', routes.banner);
  app.use('/arp/api/memories', routes.memories);
  app.use('/arp/api/skills', routes.skills);
  app.use('/arp/api/permissions', routes.accessPermissions);

  app.use('/arp/api/tags', routes.tags);
  app.use('/arp/api/mcp', routes.mcp);
  app.use('/arp/api/pi', require('./routes/pi'));

  app.use(ErrorController);

  app.get('/', (_req, res) => {
    res.redirect('/arp/');
  });

  app.use('/arp', (req, res) => {
    res.set({
      'Cache-Control': process.env.INDEX_CACHE_CONTROL || 'no-cache, no-store, must-revalidate',
      Pragma: process.env.INDEX_PRAGMA || 'no-cache',
      Expires: process.env.INDEX_EXPIRES || '0',
    });

    const lang = req.cookies.lang || req.headers['accept-language']?.split(',')[0] || 'en-US';
    const saneLang = lang.replace(/"/g, '&quot;');
    let updatedIndexHtml = indexHTML.replace(/lang="en-US"/g, `lang="${saneLang}"`);

    res.type('html');
    res.send(updatedIndexHtml);
  });

  app.listen(port, host, async (err) => {
    if (err) {
      logger.error('Failed to start server:', err);
      process.exit(1);
    }

    if (host === '0.0.0.0') {
      logger.info(
        `Server listening on all interfaces at port ${port}. Use http://localhost:${port} to access it`,
      );
    } else {
      logger.info(`Server listening at http://${host == '0.0.0.0' ? 'localhost' : host}:${port}`);
    }

    await initializeMCPs();
    await initializeOAuthReconnectManager();
    await checkMigrations();

    // Configure stream services (auto-detects Redis from USE_REDIS env var)
    const streamServices = createStreamServices();
    GenerationJobManager.configure(streamServices);
    GenerationJobManager.initialize();
  });
};

startServer();

let messageCount = 0;
process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    logger.error('There was an uncaught error:', err);
  }

  if (err.message && err.message?.toLowerCase()?.includes('abort')) {
    logger.warn('There was an uncatchable abort error.');
    return;
  }

  if (err.message.includes('GoogleGenerativeAI')) {
    logger.warn(
      '\n\n`GoogleGenerativeAI` errors cannot be caught due to an upstream issue, see: https://github.com/google-gemini/generative-ai-js/issues/303',
    );
    return;
  }

  if (err.message.includes('fetch failed')) {
    if (messageCount === 0) {
      logger.warn('Meilisearch error, search will be disabled');
      messageCount++;
    }

    return;
  }

  if (err.message.includes('OpenAIError') || err.message.includes('ChatCompletionMessage')) {
    logger.error(
      '\n\nAn Uncaught `OpenAIError` error may be due to your reverse-proxy setup or stream configuration, or a bug in the `openai` node package.',
    );
    return;
  }

  if (err.stack && err.stack.includes('@librechat/agents')) {
    logger.error(
      '\n\nAn error occurred in the agents system. The error has been logged and the app will continue running.',
      {
        message: err.message,
        stack: err.stack,
      },
    );
    return;
  }

  if (isEnabled(process.env.CONTINUE_ON_UNCAUGHT_EXCEPTION)) {
    logger.error('Unhandled error encountered. The app will continue running.', {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });
    return;
  }

  process.exit(1);
});

/** Export app for easier testing purposes */
module.exports = app;
