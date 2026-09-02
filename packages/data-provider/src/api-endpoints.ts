import type { AssistantsEndpoint } from './schemas';
import * as q from './types/queries';
import { ResourceType } from './accessPermissions';

let BASE_URL = '';
if (
  typeof process === 'undefined' ||
  (process as typeof process & { browser?: boolean }).browser === true
) {
  const baseEl = document.querySelector('base');
  BASE_URL = baseEl?.getAttribute('href') || '/';
}

if (BASE_URL && BASE_URL.endsWith('/')) {
  BASE_URL = BASE_URL.slice(0, -1);
}

export const apiBaseUrl = () => BASE_URL;

/**
 * Builds a query string from params, INCLUDING the leading '?' if params exist.
 *
 * IMPORTANT: Returns '?key=value&...' if params exist, empty string if no params.
 * Callers should use: `${baseUrl}${buildQueryString(params)}`
 *
 * @example
 * buildQueryString({ type: 'HTML', page: 1 }) // Returns '?type=HTML&page=1'
 * buildQueryString({}) // Returns ''
 */
const buildQueryString = (params: Record<string, unknown>): string => {
  const query = Object.entries(params)
    .filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== null && value !== '';
    })
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((v) => `${key}=${encodeURIComponent(v)}`).join('&');
      }
      return `${key}=${encodeURIComponent(String(value))}`;
    })
    .join('&');
  return query ? `?${query}` : '';
};

// Legacy alias for backwards compatibility
const buildQuery = buildQueryString;

export const health = () => `${BASE_URL}/health`;
export const user = () => `${BASE_URL}/api/user`;

export const balance = () => `${BASE_URL}/api/balance`;

export const userPlugins = () => `${BASE_URL}/api/user/plugins`;

export const deleteUser = () => `${BASE_URL}/api/user/delete`;

const messagesRoot = `${BASE_URL}/api/messages`;

export const messages = (params: q.MessagesListParams) => {
  const { conversationId, messageId, ...rest } = params;

  if (conversationId && messageId) {
    return `${messagesRoot}/${conversationId}/${messageId}`;
  }

  if (conversationId) {
    return `${messagesRoot}/${conversationId}`;
  }

  return `${messagesRoot}${buildQuery(rest)}`;
};

export const messagesArtifacts = (messageId: string) => `${messagesRoot}/artifact/${messageId}`;

export const messagesBranch = () => `${messagesRoot}/branch`;

const shareRoot = `${BASE_URL}/api/share`;
export const shareMessages = (shareId: string) => `${shareRoot}/${shareId}`;
export const getSharedLink = (conversationId: string) => `${shareRoot}/link/${conversationId}`;
export const getSharedLinks = (
  pageSize: number,
  isPublic: boolean,
  sortBy: 'title' | 'createdAt',
  sortDirection: 'asc' | 'desc',
  search?: string,
  cursor?: string,
) =>
  `${shareRoot}?pageSize=${pageSize}&isPublic=${isPublic}&sortBy=${sortBy}&sortDirection=${sortDirection}${
    search ? `&search=${search}` : ''
  }${cursor ? `&cursor=${cursor}` : ''}`;
export const createSharedLink = (conversationId: string) => `${shareRoot}/${conversationId}`;
export const updateSharedLink = (shareId: string) => `${shareRoot}/${shareId}`;

const keysEndpoint = `${BASE_URL}/api/keys`;

export const keys = () => keysEndpoint;

export const userKeyQuery = (name: string) => `${keysEndpoint}${buildQuery({ name })}`;

export const revokeUserKey = (name: string) => `${keysEndpoint}/${name}`;

export const revokeAllUserKeys = () => `${keysEndpoint}?all=true`;

const apiKeysEndpoint = `${BASE_URL}/api/api-keys`;

export const apiKeys = () => apiKeysEndpoint;

export const apiKeyById = (id: string) => `${apiKeysEndpoint}/${id}`;

export const conversationsRoot = `${BASE_URL}/api/convos`;

export const conversations = (params: q.ConversationListParams) => {
  return `${conversationsRoot}${buildQuery(params)}`;
};

export const conversationById = (id: string) => `${conversationsRoot}/${id}`;

export const genTitle = (conversationId: string) =>
  `${conversationsRoot}/gen_title/${encodeURIComponent(conversationId)}`;

export const updateConversation = () => `${conversationsRoot}/update`;

export const archiveConversation = () => `${conversationsRoot}/archive`;

export const deleteConversation = () => `${conversationsRoot}`;

export const deleteAllConversation = () => `${conversationsRoot}/all`;

export const importConversation = () => `${conversationsRoot}/import`;

export const forkConversation = () => `${conversationsRoot}/fork`;

export const duplicateConversation = () => `${conversationsRoot}/duplicate`;

export const search = (q: string, cursor?: string | null) => {
  const params: Record<string, unknown> = { q };
  if (cursor) params.cursor = cursor;
  return `${BASE_URL}/api/search${buildQuery(params)}`;
};

export const searchEnabled = () => `${BASE_URL}/api/search/enable`;

export const searchVocabulary = (q: string, datasetIds: string[]) =>
  `${BASE_URL}/api/search/vocabulary${buildQuery({ q, datasetIds })}`;

export const presets = () => `${BASE_URL}/api/presets`;

export const deletePreset = () => `${BASE_URL}/api/presets/delete`;

export const aiEndpoints = () => `${BASE_URL}/api/endpoints`;

export const models = () => `${BASE_URL}/api/models`;

export const tokenizer = () => `${BASE_URL}/api/tokenizer`;

export const login = () => `${BASE_URL}/api/auth/login`;

export const logout = () => `${BASE_URL}/api/auth/logout`;

export const register = () => `${BASE_URL}/api/auth/register`;

export const loginFacebook = () => `${BASE_URL}/api/auth/facebook`;

export const loginGoogle = () => `${BASE_URL}/api/auth/google`;

export const refreshToken = (retry?: boolean) =>
  `${BASE_URL}/api/auth/refresh${retry === true ? '?retry=true' : ''}`;

export const ssoLogin = () => `${BASE_URL}/api/auth/sso`;

export const requestPasswordReset = () => `${BASE_URL}/api/auth/requestPasswordReset`;

export const resetPassword = () => `${BASE_URL}/api/auth/resetPassword`;

export const verifyEmail = () => `${BASE_URL}/api/user/verify`;

// Auth page URLs (for client-side navigation and redirects)
export const loginPage = () => `${BASE_URL}/login`;
export const registerPage = () => `${BASE_URL}/register`;

export const resendVerificationEmail = () => `${BASE_URL}/api/user/verify/resend`;

export const plugins = () => `${BASE_URL}/api/plugins`;

export const mcpReinitialize = (serverName: string) =>
  `${BASE_URL}/api/mcp/${serverName}/reinitialize`;
export const mcpConnectionStatus = () => `${BASE_URL}/api/mcp/connection/status`;
export const mcpServerConnectionStatus = (serverName: string) =>
  `${BASE_URL}/api/mcp/connection/status/${serverName}`;
export const mcpAuthValues = (serverName: string) => {
  return `${BASE_URL}/api/mcp/${serverName}/auth-values`;
};

export const cancelMCPOAuth = (serverName: string) => {
  return `${BASE_URL}/api/mcp/oauth/cancel/${serverName}`;
};

export const mcpOAuthBind = (serverName: string) => `${BASE_URL}/api/mcp/${serverName}/oauth/bind`;

export const actionOAuthBind = (actionId: string) =>
  `${BASE_URL}/api/actions/${actionId}/oauth/bind`;

export const config = () => `${BASE_URL}/api/config`;

export const prompts = () => `${BASE_URL}/api/prompts`;

export const addPromptToGroup = (groupId: string) =>
  `${BASE_URL}/api/prompts/groups/${groupId}/prompts`;

export const assistants = ({
  path = '',
  options,
  version,
  endpoint,
  isAvatar,
}: {
  path?: string;
  options?: object;
  endpoint?: AssistantsEndpoint;
  version: number | string;
  isAvatar?: boolean;
}) => {
  let url = isAvatar === true ? `${images()}/assistants` : `${BASE_URL}/api/assistants/v${version}`;

  if (path && path !== '') {
    url += `/${path}`;
  }

  if (endpoint) {
    options = {
      ...(options ?? {}),
      endpoint,
    };
  }

  if (options && Object.keys(options).length > 0) {
    const queryParams = new URLSearchParams(options as Record<string, string>).toString();
    url += `?${queryParams}`;
  }

  return url;
};

export const agents = ({ path = '', options }: { path?: string; options?: object }) => {
  let url = `${BASE_URL}/api/agents`;

  if (path && path !== '') {
    url += `/${path}`;
  }

  if (options && Object.keys(options).length > 0) {
    const queryParams = new URLSearchParams(options as Record<string, string>).toString();
    url += `?${queryParams}`;
  }

  return url;
};

export const activeJobs = () => `${BASE_URL}/api/agents/chat/active`;

export const mcp = {
  tools: `${BASE_URL}/api/mcp/tools`,
  servers: `${BASE_URL}/api/mcp/servers`,
};

export const mcpServer = (serverName: string) => `${BASE_URL}/api/mcp/servers/${serverName}`;

export const revertAgentVersion = (agent_id: string) => `${agents({ path: `${agent_id}/revert` })}`;
export const publishArtifact = () => `${BASE_URL}/api/gallery/publish`;
export const publishedArtifactStatus = (sourceArtifactId: string, targetMessageId: string) =>
  `${BASE_URL}/api/gallery/published/status?${new URLSearchParams({
    sourceArtifactId,
    targetMessageId,
  }).toString()}`;
export const gallerySkillTasks = () => `${BASE_URL}/api/gallery/skill-tasks`;
export const gallerySkillTask = (taskId: string) => `${gallerySkillTasks()}/${encodeURIComponent(taskId)}`;
export const deleteGallerySkillTask = (taskId: string) => gallerySkillTask(taskId);
export const runGallerySkillTask = (taskId: string) => `${gallerySkillTask(taskId)}/run`;
export const gallerySkillTaskRuns = (taskId: string) => `${gallerySkillTask(taskId)}/runs`;
export const gallerySkillRuns = () => `${BASE_URL}/api/gallery/skill-runs`;

// Task Queue
export const taskQueue = () => `${BASE_URL}/api/task-queue`;
export const taskQueueItem = (taskId: string) => `${taskQueue()}/${encodeURIComponent(taskId)}`;

/**
 * Get gallery artifacts URL with optional query params.
 * @example getArtifacts({ type: 'HTML' }) // Returns '/api/gallery?type=HTML'
 */
export const getArtifacts = (params?: {
  pageParam?: string;
  pageSize?: number;
  type?: string;
  search?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  userId?: string;
}) => {
  // buildQuery already includes '?' if params exist
  const queryString = params ? buildQuery(params as Record<string, unknown>) : '';
  return `${BASE_URL}/api/gallery${queryString}`;
};

export const files = () => `${BASE_URL}/api/files`;
export const fileUpload = () => `${BASE_URL}/api/files`;
export const fileDelete = () => `${BASE_URL}/api/files`;
export const fileDownload = (userId: string, fileId: string) =>
  `${BASE_URL}/api/files/download/${userId}/${fileId}`;
export const fileConfig = () => `${BASE_URL}/api/files/config`;
export const agentFiles = (agentId: string) => `${BASE_URL}/api/files/agent/${agentId}`;

export const images = () => `${files()}/images`;

export const avatar = () => `${images()}/avatar`;

export const speech = () => `${files()}/speech`;

export const speechToText = () => `${speech()}/stt`;

export const textToSpeech = () => `${speech()}/tts`;

export const textToSpeechManual = () => `${textToSpeech()}/manual`;

export const textToSpeechVoices = () => `${textToSpeech()}/voices`;

export const getCustomConfigSpeech = () => `${speech()}/config/get`;

export const getPromptGroup = (_id: string) => `${prompts()}/groups/${_id}`;

export const getPromptGroupsWithFilters = (filter: object) => {
  let url = `${prompts()}/groups`;
  // Filter out undefined/null values
  const cleanedFilter = Object.entries(filter).reduce(
    (acc, [key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  if (Object.keys(cleanedFilter).length > 0) {
    const queryParams = new URLSearchParams(cleanedFilter).toString();
    url += `?${queryParams}`;
  }
  return url;
};

export const getPromptsWithFilters = (filter: object) => {
  let url = prompts();
  if (Object.keys(filter).length > 0) {
    const queryParams = new URLSearchParams(filter as Record<string, string>).toString();
    url += `?${queryParams}`;
  }
  return url;
};

export const getPrompt = (_id: string) => `${prompts()}/${_id}`;

export const getRandomPrompts = (limit: number, skip: number) =>
  `${prompts()}/random?limit=${limit}&skip=${skip}`;

export const postPrompt = prompts;

export const updatePromptGroup = getPromptGroup;

export const updatePromptLabels = (_id: string) => `${getPrompt(_id)}/labels`;

export const updatePromptTag = (_id: string) => `${getPrompt(_id)}/tags/production`;

export const deletePromptGroup = getPromptGroup;

export const deletePrompt = ({ _id, groupId }: { _id: string; groupId: string }) => {
  return `${prompts()}/${_id}?groupId=${groupId}`;
};

export const getCategories = () => `${BASE_URL}/api/categories`;

export const getAllPromptGroups = () => `${prompts()}/all`;

/* Roles */
export const roles = () => `${BASE_URL}/api/roles`;
export const getRole = (roleName: string) => `${roles()}/${roleName.toLowerCase()}`;
export const updatePromptPermissions = (roleName: string) => `${getRole(roleName)}/prompts`;
export const updateMemoryPermissions = (roleName: string) => `${getRole(roleName)}/memories`;
export const updateAgentPermissions = (roleName: string) => `${getRole(roleName)}/agents`;
export const updatePeoplePickerPermissions = (roleName: string) =>
  `${getRole(roleName)}/people-picker`;
export const updateMCPServersPermissions = (roleName: string) => `${getRole(roleName)}/mcp-servers`;
export const updateRemoteAgentsPermissions = (roleName: string) =>
  `${getRole(roleName)}/remote-agents`;

export const updateMarketplacePermissions = (roleName: string) =>
  `${getRole(roleName)}/marketplace`;

/* Conversation Tags */
export const conversationTags = (tag?: string) =>
  `${BASE_URL}/api/tags${tag != null && tag ? `/${encodeURIComponent(tag)}` : ''}`;

export const conversationTagsList = (pageNumber: string, sort?: string, order?: string) =>
  `${conversationTags()}/list${buildQuery({ pageNumber, sort, order })}`;

export const addTagToConversation = (conversationId: string) =>
  `${conversationTags()}/convo/${conversationId}`;

export const userTerms = () => `${BASE_URL}/api/user/terms`;
export const acceptUserTerms = () => `${BASE_URL}/api/user/terms/accept`;
export const banner = () => `${BASE_URL}/api/banner`;

// Message Feedback
export const feedback = (conversationId: string, messageId: string) =>
  `${BASE_URL}/api/messages/${conversationId}/${messageId}/feedback`;

// Two-Factor Endpoints
export const enableTwoFactor = () => `${BASE_URL}/api/auth/2fa/enable`;
export const verifyTwoFactor = () => `${BASE_URL}/api/auth/2fa/verify`;
export const confirmTwoFactor = () => `${BASE_URL}/api/auth/2fa/confirm`;
export const disableTwoFactor = () => `${BASE_URL}/api/auth/2fa/disable`;
export const regenerateBackupCodes = () => `${BASE_URL}/api/auth/2fa/backup/regenerate`;
export const verifyTwoFactorTemp = () => `${BASE_URL}/api/auth/2fa/verify-temp`;

/* Memories */
export const memories = () => `${BASE_URL}/api/memories`;
export const memory = (key: string) => `${memories()}/${encodeURIComponent(key)}`;
export const memoryPreferences = () => `${memories()}/preferences`;

/* Skills */
export const skillsMy = () => `${BASE_URL}/api/skills/my`;
export const skillUpload = () => `${BASE_URL}/api/skills/my/upload`;
export const skillByName = (skillName: string) =>
  `${BASE_URL}/api/skills/my/${encodeURIComponent(skillName)}`;

/* Credentials */
export const credentials = () => `${BASE_URL}/api/credential`;
export const credentialByName = (resourceType: string, resourceName: string) =>
  `${BASE_URL}/api/credential/${resourceType}/${encodeURIComponent(resourceName)}`;
export const credentialVerify = (resourceType: string, resourceName: string) =>
  `${BASE_URL}/api/credential/${resourceType}/${encodeURIComponent(resourceName)}/verify`;

/* Skills catalog */
export const skillsCatalog = () => `${BASE_URL}/api/skills/catalog`;
export const skillsCreateHttp = () => `${BASE_URL}/api/skills/create-http`;
export const skillsTestConnection = () => `${BASE_URL}/api/skills/test-connection`;
export const skillDetail = (skillName: string) =>
  `${skillByName(skillName)}/detail`;

export const searchPrincipals = (params: q.PrincipalSearchParams) => {
  const { q: query, limit, types } = params;
  let url = `${BASE_URL}/api/permissions/search-principals?q=${encodeURIComponent(query)}`;

  if (limit !== undefined) {
    url += `&limit=${limit}`;
  }

  if (types && types.length > 0) {
    url += `&types=${types.join(',')}`;
  }

  return url;
};

export const getAccessRoles = (resourceType: ResourceType) =>
  `${BASE_URL}/api/permissions/${resourceType}/roles`;

export const getResourcePermissions = (resourceType: ResourceType, resourceId: string) =>
  `${BASE_URL}/api/permissions/${resourceType}/${resourceId}`;

export const updateResourcePermissions = (resourceType: ResourceType, resourceId: string) =>
  `${BASE_URL}/api/permissions/${resourceType}/${resourceId}`;

export const getEffectivePermissions = (resourceType: ResourceType, resourceId: string) =>
  `${BASE_URL}/api/permissions/${resourceType}/${resourceId}/effective`;

export const getAllEffectivePermissions = (resourceType: ResourceType) =>
  `${BASE_URL}/api/permissions/${resourceType}/effective/all`;

// SharePoint Graph API Token
export const graphToken = (scopes: string) =>
  `${BASE_URL}/api/auth/graph-token?scopes=${encodeURIComponent(scopes)}`;

// PI Agent Files
export const filesList = (agentId: string, sessionId: string, path?: string) => {
  const queryParams = new URLSearchParams({
    agentId: encodeURIComponent(agentId),
    sessionId: encodeURIComponent(sessionId),
  });
  if (path) queryParams.set('path', path);
  return `${BASE_URL}/api/pi/files?${queryParams.toString()}`;
};

export const filesDetails = (agentId: string, sessionId: string, filePath: string) => {
  const queryParams = new URLSearchParams({
    agentId: encodeURIComponent(agentId),
    sessionId: encodeURIComponent(sessionId),
    path: filePath,
  });
  return `${BASE_URL}/api/pi/files/details?${queryParams.toString()}`;
};

export const filesSearch = (
  agentId: string,
  sessionId: string,
  path?: string,
  pattern?: string,
  type?: string,
) => {
  const queryParams = new URLSearchParams({
    agentId: encodeURIComponent(agentId),
    sessionId: encodeURIComponent(sessionId),
  });
  if (path) queryParams.set('path', path);
  if (pattern) queryParams.set('pattern', pattern);
  if (type) queryParams.set('type', type);
  return `${BASE_URL}/api/pi/files/search?${queryParams.toString()}`;
};

export const filesMkdir = () => `${BASE_URL}/api/pi/files/mkdir`;

export const filesRename = () => `${BASE_URL}/api/pi/files/rename`;

export const filesMove = () => `${BASE_URL}/api/pi/files/move`;

export const filesDelete = () => `${BASE_URL}/api/pi/files`;

export const filesBatchDelete = () => `${BASE_URL}/api/pi/files/batch-delete`;

export const filesDownload = (agentId: string, sessionId: string, path: string) => {
  const queryParams = new URLSearchParams({
    agentId: encodeURIComponent(agentId),
    sessionId: encodeURIComponent(sessionId),
    path: path,
  });
  return `${BASE_URL}/api/pi/files/download?${queryParams.toString()}`;
};

export const filesBatchDownload = () => `${BASE_URL}/api/pi/files/batch-download`;

export const filesUnzip = () => `${BASE_URL}/api/pi/files/unzip`;

export const filesUploadLimits = () => `${BASE_URL}/api/pi/files/upload-limits`;

export const filesUpload = () => `${BASE_URL}/api/pi/files/upload`;
export const filesUploadInit = () => `${BASE_URL}/api/pi/files/upload/init`;
export const filesUploadChunk = () => `${BASE_URL}/api/pi/files/upload/chunk`;
export const filesUploadComplete = () => `${BASE_URL}/api/pi/files/upload/complete`;

// Aliases for backwards compatibility
export const piFiles = filesList;
export const piFileDownload = filesDownload;
export const piFileDelete = filesDelete;
