const accessPermissions = require('./accessPermissions');
const assistants = require('./assistants');
const categories = require('./categories');
const adminAuth = require('./admin/auth');
const endpoints = require('./endpoints');
const staticRoute = require('./static');
const messages = require('./messages');
const messagesV2 = require('./messagesV2');
const memories = require('./memories');
const presets = require('./presets');
const prompts = require('./prompts');
const balance = require('./balance');
const actions = require('./actions');
const apiKeys = require('./apiKeys');
const banner = require('./banner');
const search = require('./search');
const models = require('./models');
const convos = require('./convos');
const config = require('./config');
const agents = require('./agents');
const gallery = require('./gallery');
const galleryShare = require('./galleryShare');
const roles = require('./roles');
const oauth = require('./oauth');
const files = require('./files');
const share = require('./share');
const tags = require('./tags');
const auth = require('./auth');
const keys = require('./keys');
const user = require('./user');
const skills = require('./skills');
const mcp = require('./mcp');
const credential = require('./credential');
const taskQueue = require('./taskQueue');

module.exports = {
  mcp,
  auth,
  adminAuth,
  keys,
  apiKeys,
  user,
  tags,
  roles,
  oauth,
  files,
  share,
  banner,
  agents,
  gallery,
  galleryShare,
  convos,
  search,
  config,
  models,
  prompts,
  actions,
  presets,
  balance,
  messages,
  messagesV2,
  memories,
  skills,
  endpoints,
  assistants,
  categories,
  staticRoute,
  accessPermissions,
  taskQueue,
  credential,
};
