import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type * as t from './types';
import * as endpoints from './api-endpoints';
import * as a from './types/assistants';
import * as ag from './types/agents';
import * as m from './types/mutations';
import * as q from './types/queries';
import * as f from './types/files';
import * as mcp from './types/mcpServers';
import * as config from './config';
import request from './request';
import * as s from './schemas';
import * as r from './roles';
import * as permissions from './accessPermissions';

export function revokeUserKey(name: string): Promise<unknown> {
  return request.delete(endpoints.revokeUserKey(name));
}

export function revokeAllUserKeys(): Promise<unknown> {
  return request.delete(endpoints.revokeAllUserKeys());
}

export function deleteUser(): Promise<s.TPreset> {
  return request.delete(endpoints.deleteUser());
}

export type FavoriteItem = {
  agentId?: string;
  model?: string;
  endpoint?: string;
};

export function getFavorites(): Promise<FavoriteItem[]> {
  return request.get(`${endpoints.apiBaseUrl()}/api/user/settings/favorites`);
}

export function updateFavorites(favorites: FavoriteItem[]): Promise<FavoriteItem[]> {
  return request.post(`${endpoints.apiBaseUrl()}/api/user/settings/favorites`, { favorites });
}

export function getSharedMessages(shareId: string): Promise<t.TSharedMessagesResponse> {
  return request.get(endpoints.shareMessages(shareId));
}

export const listSharedLinks = async (
  params: q.SharedLinksListParams,
): Promise<q.SharedLinksResponse> => {
  const { pageSize, isPublic, sortBy, sortDirection, search, cursor } = params;

  return request.get(
    endpoints.getSharedLinks(pageSize, isPublic, sortBy, sortDirection, search, cursor),
  );
};

export function getSharedLink(conversationId: string): Promise<t.TSharedLinkGetResponse> {
  return request.get(endpoints.getSharedLink(conversationId));
}

export function createSharedLink(
  conversationId: string,
  targetMessageId?: string,
): Promise<t.TSharedLinkResponse> {
  return request.post(endpoints.createSharedLink(conversationId), { targetMessageId });
}

export function updateSharedLink(shareId: string): Promise<t.TSharedLinkResponse> {
  return request.patch(endpoints.updateSharedLink(shareId));
}

export type PublishArtifactPayload = {
  title: string;
  type?: string;
  sourceArtifactId: string;
  conversationId: string;
  messageId?: string;
  targetMessageId: string;
  content?: string;
  autoUpdate?: boolean;
  updateFrequency?: 'daily' | 'weekly' | 'monthly' | null;
  updateTime?: string | null;
  isPublic?: boolean;
  agentId?: string | null;
  agentName?: string | null;
};

export type PublishedArtifactStatus = {
  id: string;
  sourceArtifactId: string;
  targetMessageId: string;
  autoUpdate: boolean;
  updateFrequency: 'daily' | 'weekly' | 'monthly' | null;
  updateTime: string | null;
};

export function publishArtifact(payload: PublishArtifactPayload): Promise<{
  id: string;
  title: string;
  createdAt: string;
  sqlResult?: { success: boolean; count?: number; reason?: string } | null;
}> {
  return request.post(endpoints.publishArtifact(), payload);
}

export function getPublishedArtifactStatus(
  sourceArtifactId: string,
  targetMessageId: string,
): Promise<PublishedArtifactStatus | null> {
  return request.get(endpoints.publishedArtifactStatus(sourceArtifactId, targetMessageId));
}

export type SkillTaskFrequency = 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly';
export type SkillTaskStatus = 'not_started' | 'paused' | 'running' | 'success' | 'failed' | 'failed_paused';

export type GallerySkillTask = {
  id: string;
  taskName: string;
  description?: string;
  skillName: string;
  skillAuthor?: string | null;
  skillSource?: string;
  skillMetadataSnapshot?: Record<string, unknown>;
  parameters?: Record<string, string>;
  frequency: SkillTaskFrequency;
  interval?: number | null;
  scheduleTime?: string;
  timezone?: string;
  enabled: boolean;
  status: SkillTaskStatus;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastDurationMs?: number | null;
  lastError?: string | null;
  failureCount?: number;
  maxRetries?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateGallerySkillTaskPayload = {
  taskName: string;
  description?: string;
  skillName: string;
  skillAuthor?: string | null;
  skillSource?: 'my' | 'repo' | 'enterprise';
  skillMetadataSnapshot?: Record<string, unknown>;
  parameters?: Record<string, string>;
  frequency: SkillTaskFrequency;
  interval?: number | null;
  scheduleTime?: string;
  timezone?: string;
};

export function createGallerySkillTask(
  payload: CreateGallerySkillTaskPayload,
): Promise<{ task: GallerySkillTask }> {
  return request.post(endpoints.gallerySkillTasks(), payload);
}

export function getGallerySkillTasks(params?: {
  status?: SkillTaskStatus | 'all';
  frequency?: SkillTaskFrequency | 'all';
  search?: string;
  skillName?: string;
}): Promise<{ tasks: GallerySkillTask[] }> {
  const query = params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : '';
  return request.get(`${endpoints.gallerySkillTasks()}${query}`);
}

export function updateGallerySkillTask(
  taskId: string,
  payload: Partial<Pick<GallerySkillTask, 'enabled' | 'status' | 'frequency' | 'interval' | 'scheduleTime' | 'taskName'>>,
): Promise<{ task: GallerySkillTask }> {
  return request.patch(endpoints.gallerySkillTask(taskId), payload);
}

export function deleteGallerySkillTask(taskId: string): Promise<{ success: boolean }> {
  return request.delete(endpoints.deleteGallerySkillTask(taskId));
}

export type GallerySkillTaskRun = {
  id: string;
  taskId: string;
  skillName: string;
  taskNameSnapshot?: string;
  triggeredBy: 'auto' | 'manual';
  status: 'running' | 'success' | 'failed' | 'cancelled';
  parameters?: Record<string, string>;
  textOutput?: string;
  files?: Array<{
    name: string;
    path?: string | null;
    url?: string | null;
    mimeType?: string | null;
    size?: number | null;
  }>;
  logs?: Array<{
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    timestamp: string;
  }>;
  error?: {
    message?: string | null;
    stack?: string | null;
    code?: string | null;
  } | null;
  sessionId?: string | null;
  conversationId?: string | null;
  agentId?: string | null;
  prompt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export function getGallerySkillTaskRuns(taskId: string): Promise<{ runs: GallerySkillTaskRun[] }> {
  return request.get(endpoints.gallerySkillTaskRuns(taskId));
}

export function getGallerySkillRuns(params?: { skillName?: string }): Promise<{ runs: GallerySkillTaskRun[] }> {
  const query = params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : '';
  return request.get(`${endpoints.gallerySkillRuns()}${query}`);
}

export function runGallerySkillTask(taskId: string): Promise<{
  task: GallerySkillTask;
  run: GallerySkillTaskRun;
}> {
  return request.post(endpoints.runGallerySkillTask(taskId));
}

export type GalleryArtifactItem = {
  id: string;
  title: string;
  type: string;
  content: string;
  preview?: string;
  createdAt: string;
  updatedAt: string;
  conversationId?: string;
  sourceArtifactId?: string;
  messageId?: string;
  targetMessageId?: string;
  isPublic?: boolean;
  viewCount?: number;
  likes?: number;
  likeCount: number;
  schedule?: {
    enabled?: boolean;
    runStatus?: string;
    consecutiveFailures?: number;
    disabledReason?: string;
    lastError?: string;
    nextRunAt?: string;
  } | null;
  user?: {
    id?: string;
    username?: string;
    name?: string;
    avatar?: string;
  };
};

export type GalleryArtifactsParams = {
  pageParam?: string;
  pageSize?: number;
  type?: string;
  search?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  userId?: string;
};

export type GalleryArtifactsResponse = {
  artifacts: GalleryArtifactItem[];
  nextCursor?: string;
  hasNextPage: boolean;
};

export function getArtifacts(
  params?: GalleryArtifactsParams,
  options?: Pick<AxiosRequestConfig, 'signal'>,
): Promise<GalleryArtifactsResponse> {
  return request.get(endpoints.getArtifacts(params), options);
}

export function deleteSharedLink(shareId: string): Promise<m.TDeleteSharedLinkResponse> {
  return request.delete(endpoints.shareMessages(shareId));
}

export function updateUserKey(payload: t.TUpdateUserKeyRequest) {
  const { value } = payload;
  if (!value) {
    throw new Error('value is required');
  }

  return request.put(endpoints.keys(), payload);
}

export function getAgentApiKeys(): Promise<t.TAgentApiKeyListResponse> {
  return request.get(endpoints.apiKeys());
}

export function createAgentApiKey(
  payload: t.TAgentApiKeyCreateRequest,
): Promise<t.TAgentApiKeyCreateResponse> {
  return request.post(endpoints.apiKeys(), payload);
}

export function deleteAgentApiKey(id: string): Promise<void> {
  return request.delete(endpoints.apiKeyById(id));
}

export function getPresets(): Promise<s.TPreset[]> {
  return request.get(endpoints.presets());
}

export function createPreset(payload: s.TPreset): Promise<s.TPreset> {
  return request.post(endpoints.presets(), payload);
}

export function updatePreset(payload: s.TPreset): Promise<s.TPreset> {
  return request.post(endpoints.presets(), payload);
}

export function deletePreset(arg: s.TPreset | undefined): Promise<m.PresetDeleteResponse> {
  return request.post(endpoints.deletePreset(), arg);
}

export function getSearchEnabled(): Promise<boolean> {
  return request.get(endpoints.searchEnabled());
}

export interface VocabularyHit {
  name: string;
  tableName: string;
  columnName: string;
  desc: string | null;
  definition: string;
  datasetId: string;
  datasetName: string;
}

export interface VocabularySearchResponse {
  hits: VocabularyHit[];
}

export function searchVocabulary(
  q: string,
  datasetIds: string[],
): Promise<VocabularySearchResponse> {
  return request.get(endpoints.searchVocabulary(q, datasetIds));
}

export function getUser(): Promise<t.TUser> {
  return request.get(endpoints.user());
}

export function getUserBalance(): Promise<t.TBalanceResponse> {
  return request.get(endpoints.balance());
}

export const updateTokenCount = (text: string) => {
  return request.post(endpoints.tokenizer(), { arg: text });
};

export const login = (payload: t.TLoginUser): Promise<t.TLoginResponse> => {
  return request.post(endpoints.login(), payload);
};

export const ssoLogin = (token: string): Promise<t.TLoginResponse> => {
  return request.post(endpoints.ssoLogin(), { token });
};

export const logout = (): Promise<m.TLogoutResponse> => {
  return request.post(endpoints.logout());
};

export const register = (payload: t.TRegisterUser) => {
  return request.post(endpoints.register(), payload);
};

export const userKeyQuery = (name: string): Promise<t.TCheckUserKeyResponse> =>
  request.get(endpoints.userKeyQuery(name));

export const getLoginGoogle = () => {
  return request.get(endpoints.loginGoogle());
};

export const requestPasswordReset = (
  payload: t.TRequestPasswordReset,
): Promise<t.TRequestPasswordResetResponse> => {
  return request.post(endpoints.requestPasswordReset(), payload);
};

export const resetPassword = (payload: t.TResetPassword) => {
  return request.post(endpoints.resetPassword(), payload);
};

export const verifyEmail = (payload: t.TVerifyEmail): Promise<t.VerifyEmailResponse> => {
  return request.post(endpoints.verifyEmail(), payload);
};

export const resendVerificationEmail = (
  payload: t.TResendVerificationEmail,
): Promise<t.VerifyEmailResponse> => {
  return request.post(endpoints.resendVerificationEmail(), payload);
};

export const getAvailablePlugins = (): Promise<s.TPlugin[]> => {
  return request.get(endpoints.plugins());
};

export const updateUserPlugins = (payload: t.TUpdateUserPlugins) => {
  return request.post(endpoints.userPlugins(), payload);
};

export const reinitializeMCPServer = (serverName: string) => {
  return request.post(endpoints.mcpReinitialize(serverName));
};

export const bindMCPOAuth = (serverName: string): Promise<{ success: boolean }> => {
  return request.post(endpoints.mcpOAuthBind(serverName));
};

export const bindActionOAuth = (actionId: string): Promise<{ success: boolean }> => {
  return request.post(endpoints.actionOAuthBind(actionId));
};

export const getMCPConnectionStatus = (): Promise<q.MCPConnectionStatusResponse> => {
  return request.get(endpoints.mcpConnectionStatus());
};

export const getMCPServerConnectionStatus = (
  serverName: string,
): Promise<q.MCPServerConnectionStatusResponse> => {
  return request.get(endpoints.mcpServerConnectionStatus(serverName));
};

export const getMCPAuthValues = (serverName: string): Promise<q.MCPAuthValuesResponse> => {
  return request.get(endpoints.mcpAuthValues(serverName));
};

export function cancelMCPOAuth(serverName: string): Promise<m.CancelMCPOAuthResponse> {
  return request.post(endpoints.cancelMCPOAuth(serverName), {});
}

/* Config */

export const getStartupConfig = (): Promise<
  config.TStartupConfig & {
    mcpCustomUserVars?: Record<string, { title: string; description: string }>;
  }
> => {
  return request.get(endpoints.config());
};

export const getAIEndpoints = (): Promise<t.TEndpointsConfig> => {
  return request.get(endpoints.aiEndpoints());
};

export const getModels = async (): Promise<t.TModelsConfig> => {
  return request.get(endpoints.models());
};

/* Assistants */

export const createAssistant = ({
  version,
  ...data
}: a.AssistantCreateParams): Promise<a.Assistant> => {
  return request.post(endpoints.assistants({ version }), data);
};

export const getAssistantById = ({
  endpoint,
  assistant_id,
  version,
}: {
  endpoint: s.AssistantsEndpoint;
  assistant_id: string;
  version: number | string | number;
}): Promise<a.Assistant> => {
  return request.get(
    endpoints.assistants({
      path: assistant_id,
      endpoint,
      version,
    }),
  );
};

export const updateAssistant = ({
  assistant_id,
  data,
  version,
}: {
  assistant_id: string;
  data: a.AssistantUpdateParams;
  version: number | string;
}): Promise<a.Assistant> => {
  return request.patch(
    endpoints.assistants({
      path: assistant_id,
      version,
    }),
    data,
  );
};

export const deleteAssistant = ({
  assistant_id,
  model,
  endpoint,
  version,
}: m.DeleteAssistantBody & { version: number | string }): Promise<void> => {
  return request.delete(
    endpoints.assistants({
      path: assistant_id,
      options: { model, endpoint },
      version,
    }),
  );
};

export const listAssistants = (
  params: a.AssistantListParams,
  version: number | string,
): Promise<a.AssistantListResponse> => {
  return request.get(
    endpoints.assistants({
      version,
      options: params,
    }),
  );
};

export function getAssistantDocs({
  endpoint,
  version,
}: {
  endpoint: s.AssistantsEndpoint | string;
  version: number | string;
}): Promise<a.AssistantDocument[]> {
  if (!s.isAssistantsEndpoint(endpoint)) {
    return Promise.resolve([]);
  }
  return request.get(
    endpoints.assistants({
      path: 'documents',
      version,
      options: { endpoint },
      endpoint: endpoint as s.AssistantsEndpoint,
    }),
  );
}

/* Tools */

export const getAvailableTools = (
  _endpoint: s.AssistantsEndpoint | s.EModelEndpoint.agents,
  version?: number | string,
): Promise<s.TPlugin[]> => {
  let path = '';
  if (s.isAssistantsEndpoint(_endpoint)) {
    const endpoint = _endpoint as s.AssistantsEndpoint;
    path = endpoints.assistants({
      path: 'tools',
      endpoint: endpoint,
      version: version ?? config.defaultAssistantsVersion[endpoint],
    });
  } else {
    path = endpoints.agents({
      path: 'tools',
    });
  }

  return request.get(path);
};

/* MCP Tools - Decoupled from regular tools */

export const getMCPTools = (): Promise<q.MCPServersResponse> => {
  return request.get(endpoints.mcp.tools);
};

export const getVerifyAgentToolAuth = (
  params: q.VerifyToolAuthParams,
): Promise<q.VerifyToolAuthResponse> => {
  return request.get(
    endpoints.agents({
      path: `tools/${params.toolId}/auth`,
    }),
  );
};

export const callTool = <T extends m.ToolId>({
  toolId,
  toolParams,
}: {
  toolId: T;
  toolParams: m.ToolParams<T>;
}): Promise<m.ToolCallResponse> => {
  return request.post(
    endpoints.agents({
      path: `tools/${toolId}/call`,
    }),
    toolParams,
  );
};

export const getToolCalls = (params: q.GetToolCallParams): Promise<q.ToolCallResults> => {
  return request.get(
    endpoints.agents({
      path: 'tools/calls',
      options: params,
    }),
  );
};

/* Files */

export const getFiles = (): Promise<f.TFile[]> => {
  return request.get(endpoints.files());
};

export const getAgentFiles = (agentId: string): Promise<f.TFile[]> => {
  return request.get(endpoints.agentFiles(agentId));
};

export const getFileConfig = (): Promise<f.FileConfig> => {
  return request.get(`${endpoints.files()}/config`);
};

export const uploadImage = (
  data: FormData,
  signal?: AbortSignal | null,
): Promise<f.TFileUpload> => {
  const requestConfig = signal ? { signal } : undefined;
  return request.postMultiPart(endpoints.images(), data, requestConfig);
};

export const uploadFile = (data: FormData, signal?: AbortSignal | null): Promise<f.TFileUpload> => {
  const requestConfig = signal ? { signal } : undefined;
  return request.postMultiPart(endpoints.files(), data, requestConfig);
};

/* actions */

export const updateAction = (data: m.UpdateActionVariables): Promise<m.UpdateActionResponse> => {
  const { assistant_id, version, ...body } = data;
  return request.post(
    endpoints.assistants({
      path: `actions/${assistant_id}`,
      version,
    }),
    body,
  );
};

export function getActions(): Promise<ag.Action[]> {
  return request.get(
    endpoints.agents({
      path: 'actions',
    }),
  );
}

export const deleteAction = async ({
  assistant_id,
  action_id,
  model,
  version,
  endpoint,
}: m.DeleteActionVariables & { version: number | string }): Promise<void> =>
  request.delete(
    endpoints.assistants({
      path: `actions/${assistant_id}/${action_id}/${model}`,
      version,
      endpoint,
    }),
  );

/**
 * Agents
 */

export const createAgent = ({ ...data }: a.AgentCreateParams): Promise<a.Agent> => {
  return request.post(endpoints.agents({}), data);
};

export const getAgentById = ({ agent_id }: { agent_id: string }): Promise<a.Agent> => {
  return request.get(
    endpoints.agents({
      path: agent_id,
    }),
  );
};

export const getExpandedAgentById = ({ agent_id }: { agent_id: string }): Promise<a.Agent> => {
  return request.get(
    endpoints.agents({
      path: `${agent_id}/expanded`,
    }),
  );
};

export const updateAgent = ({
  agent_id,
  data,
}: {
  agent_id: string;
  data: a.AgentUpdateParams;
}): Promise<a.Agent> => {
  return request.patch(
    endpoints.agents({
      path: agent_id,
    }),
    data,
  );
};

export const duplicateAgent = ({
  agent_id,
}: m.DuplicateAgentBody): Promise<{ agent: a.Agent; actions: ag.Action[] }> => {
  return request.post(
    endpoints.agents({
      path: `${agent_id}/duplicate`,
    }),
  );
};

export const deleteAgent = ({ agent_id }: m.DeleteAgentBody): Promise<void> => {
  return request.delete(
    endpoints.agents({
      path: agent_id,
    }),
  );
};

export const listAgents = (params: a.AgentListParams): Promise<a.AgentListResponse> => {
  return request.get(
    endpoints.agents({
      options: params,
    }),
  );
};

export const revertAgentVersion = ({
  agent_id,
  version_index,
}: {
  agent_id: string;
  version_index: number;
}): Promise<a.Agent> => request.post(endpoints.revertAgentVersion(agent_id), { version_index });

/* Marketplace */

/**
 * Get agent categories with counts for marketplace tabs
 */
export const getAgentCategories = (): Promise<t.TMarketplaceCategory[]> => {
  return request.get(endpoints.agents({ path: 'categories' }));
};

/**
 * Unified marketplace agents endpoint with query string controls
 */
export const getMarketplaceAgents = (params: {
  requiredPermission: number;
  category?: string;
  search?: string;
  limit?: number;
  cursor?: string;
  promoted?: 0 | 1;
}): Promise<a.AgentListResponse> => {
  return request.get(
    endpoints.agents({
      // path: 'marketplace',
      options: params,
    }),
  );
};

/* Tools */

export const getAvailableAgentTools = (): Promise<s.TPlugin[]> => {
  return request.get(
    endpoints.agents({
      path: 'tools',
    }),
  );
};

/* Actions */

export const updateAgentAction = (
  data: m.UpdateAgentActionVariables,
): Promise<m.UpdateAgentActionResponse> => {
  const { agent_id, ...body } = data;
  return request.post(
    endpoints.agents({
      path: `actions/${agent_id}`,
    }),
    body,
  );
};

export const deleteAgentAction = async ({
  agent_id,
  action_id,
}: m.DeleteAgentActionVariables): Promise<void> =>
  request.delete(
    endpoints.agents({
      path: `actions/${agent_id}/${action_id}`,
    }),
  );

/**
 * MCP Servers
 */

/**
 *
 * Ensure and List loaded mcp server configs from the cache Enriched with effective permissions.
 */
export const getMCPServers = async (): Promise<mcp.MCPServersListResponse> => {
  return request.get(endpoints.mcp.servers);
};

/**
 * Get a single MCP server by ID
 */
export const getMCPServer = async (serverName: string): Promise<mcp.MCPServerDBObjectResponse> => {
  return request.get(endpoints.mcpServer(serverName));
};

/**
 * Create a new MCP server
 */
export const createMCPServer = async (
  data: mcp.MCPServerCreateParams,
): Promise<mcp.MCPServerDBObjectResponse> => {
  return request.post(endpoints.mcp.servers, data);
};

/**
 * Update an existing MCP server
 */
export const updateMCPServer = async (
  serverName: string,
  data: mcp.MCPServerUpdateParams,
): Promise<mcp.MCPServerDBObjectResponse> => {
  return request.patch(endpoints.mcpServer(serverName), data);
};

/**
 * Delete an MCP server
 */
export const deleteMCPServer = async (serverName: string): Promise<{ success: boolean }> => {
  return request.delete(endpoints.mcpServer(serverName));
};

/**
 * Imports a conversations file.
 *
 * @param data - The FormData containing the file to import.
 * @returns A Promise that resolves to the import start response.
 */
export const importConversationsFile = (data: FormData): Promise<t.TImportResponse> => {
  return request.postMultiPart(endpoints.importConversation(), data);
};

export const uploadAvatar = (data: FormData): Promise<f.AvatarUploadResponse> => {
  return request.postMultiPart(endpoints.avatar(), data);
};

export const uploadAssistantAvatar = (data: m.AssistantAvatarVariables): Promise<a.Assistant> => {
  return request.postMultiPart(
    endpoints.assistants({
      isAvatar: true,
      path: `${data.assistant_id}/avatar`,
      options: { model: data.model, endpoint: data.endpoint },
      version: data.version,
    }),
    data.formData,
  );
};

export const uploadAgentAvatar = (data: m.AgentAvatarVariables): Promise<a.Agent> => {
  return request.postMultiPart(
    `${endpoints.images()}/agents/${data.agent_id}/avatar`,
    data.formData,
  );
};

export const getFileDownload = async (userId: string, file_id: string): Promise<AxiosResponse> => {
  return request.getResponse(`${endpoints.files()}/download/${userId}/${file_id}`, {
    responseType: 'blob',
    headers: {
      Accept: 'application/octet-stream',
    },
  });
};

export const getCodeOutputDownload = async (url: string): Promise<AxiosResponse> => {
  return request.getResponse(url, {
    responseType: 'blob',
    headers: {
      Accept: 'application/octet-stream',
    },
  });
};

export const deleteFiles = async (payload: {
  files: f.BatchFile[];
  agent_id?: string;
  assistant_id?: string;
  tool_resource?: a.EToolResources;
}): Promise<f.DeleteFilesResponse> =>
  request.deleteWithOptions(endpoints.files(), {
    data: payload,
  });

/* Speech */

export const speechToText = (data: FormData): Promise<f.SpeechToTextResponse> => {
  return request.postMultiPart(endpoints.speechToText(), data);
};

export const textToSpeech = (data: FormData): Promise<ArrayBuffer> => {
  return request.postTTS(endpoints.textToSpeechManual(), data);
};

export const getVoices = (): Promise<f.VoiceResponse> => {
  return request.get(endpoints.textToSpeechVoices());
};

export const getCustomConfigSpeech = (): Promise<t.TCustomConfigSpeechResponse> => {
  return request.get(endpoints.getCustomConfigSpeech());
};

/* conversations */

export function duplicateConversation(
  payload: t.TDuplicateConvoRequest,
): Promise<t.TDuplicateConvoResponse> {
  return request.post(endpoints.duplicateConversation(), payload);
}

export function forkConversation(payload: t.TForkConvoRequest): Promise<t.TForkConvoResponse> {
  return request.post(endpoints.forkConversation(), payload);
}

export function deleteConversation(payload: t.TDeleteConversationRequest) {
  return request.deleteWithOptions(endpoints.deleteConversation(), { data: { arg: payload } });
}

export function clearAllConversations(): Promise<unknown> {
  return request.delete(endpoints.deleteAllConversation());
}

export const listConversations = (
  params?: q.ConversationListParams,
): Promise<q.ConversationListResponse> => {
  return request.get(endpoints.conversations(params ?? {}));
};

export function getConversations(cursor: string): Promise<t.TGetConversationsResponse> {
  return request.get(endpoints.conversations({ cursor }));
}

export function getConversationById(id: string): Promise<s.TConversation> {
  return request.get(endpoints.conversationById(id));
}

export function updateConversation(
  payload: t.TUpdateConversationRequest,
): Promise<t.TUpdateConversationResponse> {
  return request.post(endpoints.updateConversation(), { arg: payload });
}

export function archiveConversation(
  payload: t.TArchiveConversationRequest,
): Promise<t.TArchiveConversationResponse> {
  return request.post(endpoints.archiveConversation(), { arg: payload });
}

export function genTitle(payload: m.TGenTitleRequest): Promise<m.TGenTitleResponse> {
  return request.get(endpoints.genTitle(payload.conversationId));
}

export const listMessages = (params?: q.MessagesListParams): Promise<q.MessagesListResponse> => {
  return request.get(endpoints.messages(params ?? {}));
};

export function updateMessage(payload: t.TUpdateMessageRequest): Promise<unknown> {
  const { conversationId, messageId, text } = payload;
  if (!conversationId) {
    throw new Error('conversationId is required');
  }

  return request.put(endpoints.messages({ conversationId, messageId }), { text });
}

export function updateMessageContent(payload: t.TUpdateMessageContent): Promise<unknown> {
  const { conversationId, messageId, index, text } = payload;
  if (!conversationId) {
    throw new Error('conversationId is required');
  }

  return request.put(endpoints.messages({ conversationId, messageId }), { text, index });
}

export const editArtifact = async ({
  messageId,
  ...params
}: m.TEditArtifactRequest): Promise<m.TEditArtifactResponse> => {
  return request.post(endpoints.messagesArtifacts(messageId), params);
};

export const branchMessage = async (
  payload: m.TBranchMessageRequest,
): Promise<m.TBranchMessageResponse> => {
  return request.post(endpoints.messagesBranch(), payload);
};

export function getMessagesByConvoId(conversationId: string): Promise<s.TMessage[]> {
  if (
    conversationId === config.Constants.NEW_CONVO ||
    conversationId === config.Constants.PENDING_CONVO
  ) {
    return Promise.resolve([]);
  }
  return request.get(endpoints.messages({ conversationId }));
}

export function getPrompt(id: string): Promise<{ prompt: t.TPrompt }> {
  return request.get(endpoints.getPrompt(id));
}

export function getPrompts(filter: t.TPromptsWithFilterRequest): Promise<t.TPrompt[]> {
  return request.get(endpoints.getPromptsWithFilters(filter));
}

export function getAllPromptGroups(): Promise<q.AllPromptGroupsResponse> {
  return request.get(endpoints.getAllPromptGroups());
}

export function getPromptGroups(
  filter: t.TPromptGroupsWithFilterRequest,
): Promise<t.PromptGroupListResponse> {
  return request.get(endpoints.getPromptGroupsWithFilters(filter));
}

export function getPromptGroup(id: string): Promise<t.TPromptGroup> {
  return request.get(endpoints.getPromptGroup(id));
}

export function createPrompt(payload: t.TCreatePrompt): Promise<t.TCreatePromptResponse> {
  return request.post(endpoints.postPrompt(), payload);
}

export function addPromptToGroup(
  groupId: string,
  payload: t.TCreatePrompt,
): Promise<t.TCreatePromptResponse> {
  return request.post(endpoints.addPromptToGroup(groupId), payload);
}

export function updatePromptGroup(
  variables: t.TUpdatePromptGroupVariables,
): Promise<t.TUpdatePromptGroupResponse> {
  return request.patch(endpoints.updatePromptGroup(variables.id), variables.payload);
}

export function deletePrompt(payload: t.TDeletePromptVariables): Promise<t.TDeletePromptResponse> {
  return request.delete(endpoints.deletePrompt(payload));
}

export function makePromptProduction(id: string): Promise<t.TMakePromptProductionResponse> {
  return request.patch(endpoints.updatePromptTag(id));
}

export function updatePromptLabels(
  variables: t.TUpdatePromptLabelsRequest,
): Promise<t.TUpdatePromptLabelsResponse> {
  return request.patch(endpoints.updatePromptLabels(variables.id), variables.payload);
}

export function deletePromptGroup(id: string): Promise<t.TDeletePromptGroupResponse> {
  return request.delete(endpoints.deletePromptGroup(id));
}

export function getCategories(): Promise<t.TGetCategoriesResponse> {
  return request.get(endpoints.getCategories());
}

export function getRandomPrompts(
  variables: t.TGetRandomPromptsRequest,
): Promise<t.TGetRandomPromptsResponse> {
  return request.get(endpoints.getRandomPrompts(variables.limit, variables.skip));
}

/* Roles */
export function getRole(roleName: string): Promise<r.TRole> {
  return request.get(endpoints.getRole(roleName));
}

export function updatePromptPermissions(
  variables: m.UpdatePromptPermVars,
): Promise<m.UpdatePermResponse> {
  return request.put(endpoints.updatePromptPermissions(variables.roleName), variables.updates);
}

export function updateAgentPermissions(
  variables: m.UpdateAgentPermVars,
): Promise<m.UpdatePermResponse> {
  return request.put(endpoints.updateAgentPermissions(variables.roleName), variables.updates);
}

export function updateMemoryPermissions(
  variables: m.UpdateMemoryPermVars,
): Promise<m.UpdatePermResponse> {
  return request.put(endpoints.updateMemoryPermissions(variables.roleName), variables.updates);
}

export function updatePeoplePickerPermissions(
  variables: m.UpdatePeoplePickerPermVars,
): Promise<m.UpdatePermResponse> {
  return request.put(
    endpoints.updatePeoplePickerPermissions(variables.roleName),
    variables.updates,
  );
}

export function updateMCPServersPermissions(
  variables: m.UpdateMCPServersPermVars,
): Promise<m.UpdatePermResponse> {
  return request.put(endpoints.updateMCPServersPermissions(variables.roleName), variables.updates);
}

export function updateRemoteAgentsPermissions(
  variables: m.UpdateRemoteAgentsPermVars,
): Promise<m.UpdatePermResponse> {
  return request.put(
    endpoints.updateRemoteAgentsPermissions(variables.roleName),
    variables.updates,
  );
}

export function updateMarketplacePermissions(
  variables: m.UpdateMarketplacePermVars,
): Promise<m.UpdatePermResponse> {
  return request.put(endpoints.updateMarketplacePermissions(variables.roleName), variables.updates);
}

/* Tags */
export function getConversationTags(): Promise<t.TConversationTagsResponse> {
  return request.get(endpoints.conversationTags());
}

export function createConversationTag(
  payload: t.TConversationTagRequest,
): Promise<t.TConversationTagResponse> {
  return request.post(endpoints.conversationTags(), payload);
}

export function updateConversationTag(
  tag: string,
  payload: t.TConversationTagRequest,
): Promise<t.TConversationTagResponse> {
  return request.put(endpoints.conversationTags(tag), payload);
}
export function deleteConversationTag(tag: string): Promise<t.TConversationTagResponse> {
  return request.delete(endpoints.conversationTags(tag));
}

export function addTagToConversation(
  conversationId: string,
  payload: t.TTagConversationRequest,
): Promise<t.TTagConversationResponse> {
  return request.put(endpoints.addTagToConversation(conversationId), payload);
}
export function rebuildConversationTags(): Promise<t.TConversationTagsResponse> {
  return request.post(endpoints.conversationTags('rebuild'));
}

export function healthCheck(): Promise<string> {
  return request.get(endpoints.health());
}

export function getUserTerms(): Promise<t.TUserTermsResponse> {
  return request.get(endpoints.userTerms());
}

export function acceptTerms(): Promise<t.TAcceptTermsResponse> {
  return request.post(endpoints.acceptUserTerms());
}

export function getBanner(): Promise<t.TBannerResponse> {
  return request.get(endpoints.banner());
}

export function updateFeedback(
  conversationId: string,
  messageId: string,
  payload: t.TUpdateFeedbackRequest,
): Promise<t.TUpdateFeedbackResponse> {
  return request.put(endpoints.feedback(conversationId, messageId), payload);
}

// 2FA
export function enableTwoFactor(): Promise<t.TEnable2FAResponse> {
  return request.get(endpoints.enableTwoFactor());
}

export function verifyTwoFactor(payload: t.TVerify2FARequest): Promise<t.TVerify2FAResponse> {
  return request.post(endpoints.verifyTwoFactor(), payload);
}

export function confirmTwoFactor(payload: t.TVerify2FARequest): Promise<t.TVerify2FAResponse> {
  return request.post(endpoints.confirmTwoFactor(), payload);
}

export function disableTwoFactor(payload?: t.TDisable2FARequest): Promise<t.TDisable2FAResponse> {
  return request.post(endpoints.disableTwoFactor(), payload);
}

export function regenerateBackupCodes(): Promise<t.TRegenerateBackupCodesResponse> {
  return request.post(endpoints.regenerateBackupCodes());
}

export function verifyTwoFactorTemp(
  payload: t.TVerify2FATempRequest,
): Promise<t.TVerify2FATempResponse> {
  return request.post(endpoints.verifyTwoFactorTemp(), payload);
}

/* Memories */
export const getMemories = (): Promise<q.MemoriesResponse> => {
  return request.get(endpoints.memories());
};

export const deleteMemory = (key: string): Promise<void> => {
  return request.delete(endpoints.memory(key));
};

export const updateMemory = (
  key: string,
  value: string,
  originalKey?: string,
): Promise<q.TUserMemory> => {
  return request.patch(endpoints.memory(originalKey || key), { key, value });
};

export const updateMemoryPreferences = (preferences: {
  memories: boolean;
}): Promise<{ updated: boolean; preferences: { memories: boolean } }> => {
  return request.patch(endpoints.memoryPreferences(), preferences);
};

export const createMemory = (data: {
  key: string;
  value: string;
}): Promise<{ created: boolean; memory: q.TUserMemory }> => {
  return request.post(endpoints.memories(), data);
};

/* Skills */
export const getMySkills = (): Promise<q.SkillsListResponse> => {
  return request.get(endpoints.skillsMy());
};

export const getSkillDetail = (skillName: string): Promise<q.SkillDetailResponse> => {
  return request.get(endpoints.skillDetail(skillName));
};

export const uploadSkill = (formData: FormData): Promise<unknown> => {
  return request.postMultiPart(endpoints.skillUpload(), formData);
};

export const downloadSkill = (skillName: string): Promise<Blob> => {
  return request.get(endpoints.skillByName(skillName), { responseType: 'blob' });
};

export const deleteSkill = (skillName: string): Promise<void> => {
  return request.delete(endpoints.skillByName(skillName));
};

export function searchPrincipals(
  params: q.PrincipalSearchParams,
): Promise<q.PrincipalSearchResponse> {
  return request.get(endpoints.searchPrincipals(params));
}

export function getAccessRoles(
  resourceType: permissions.ResourceType,
): Promise<q.AccessRolesResponse> {
  return request.get(endpoints.getAccessRoles(resourceType));
}

export function getResourcePermissions(
  resourceType: permissions.ResourceType,
  resourceId: string,
): Promise<permissions.TGetResourcePermissionsResponse> {
  return request.get(endpoints.getResourcePermissions(resourceType, resourceId));
}

export function updateResourcePermissions(
  resourceType: permissions.ResourceType,
  resourceId: string,
  data: permissions.TUpdateResourcePermissionsRequest,
): Promise<permissions.TUpdateResourcePermissionsResponse> {
  return request.put(endpoints.updateResourcePermissions(resourceType, resourceId), data);
}

export function getEffectivePermissions(
  resourceType: permissions.ResourceType,
  resourceId: string,
): Promise<permissions.TEffectivePermissionsResponse> {
  return request.get(endpoints.getEffectivePermissions(resourceType, resourceId));
}

export function getAllEffectivePermissions(
  resourceType: permissions.ResourceType,
): Promise<permissions.TAllEffectivePermissionsResponse> {
  return request.get(endpoints.getAllEffectivePermissions(resourceType));
}

// SharePoint Graph API Token
export function getGraphApiToken(params: q.GraphTokenParams): Promise<q.GraphTokenResponse> {
  return request.get(endpoints.graphToken(params.scopes));
}

export function getDomainServerBaseUrl(): string {
  return `${endpoints.apiBaseUrl()}/api`;
}

/* Active Jobs */
import type { PIFile, PIFilesResponse } from './types/files';

export interface ActiveJobsResponse {
  activeJobIds: string[];
}

export const getActiveJobs = (): Promise<ActiveJobsResponse> => {
  return request.get(endpoints.activeJobs());
};

/* PI Agent Files */
export type { PIFile, PIFilesResponse };

/* File Management API Types */
export type {
  FileManagementFile,
  FileManagementListResponse,
  FileManagementDetailsResponse,
  FileManagementSearchResponse,
  FileManagementMkdirResponse,
  FileManagementRenameResponse,
  FileManagementMoveResponse,
  FileManagementDeleteResponse,
  FileManagementBatchDeleteResponse,
  FileManagementUnzipResponse,
  FileManagementUploadInitResponse,
  FileManagementUploadChunkResponse,
  FileManagementUploadCompleteResponse,
  FileManagementUploadResponse,
  FileManagementMoveBody,
  FileManagementDeleteBody,
  FileManagementBatchDeleteBody,
  FileManagementMkdirBody,
  FileManagementRenameBody,
  FileManagementUnzipBody,
  FileManagementUploadInitBody,
  FileManagementUploadChunkBody,
  FileManagementUploadCompleteBody,
} from './types/files';

// Task Queue
export type TaskQueueItem = {
  _id: string;
  toUserId: string;
  toUserName?: string;
  toAgentId?: string;
  fromUserId: string;
  fromUserName?: string;
  fromAgentId?: string;
  sourceConversationId?: string;
  sourceSessionId?: string;
  sourceTurnSeq?: number;
  type: 'ai_pending' | 'collaboration' | 'manual' | 'subagent';
  title: string;
  description?: string;
  status: 'pending' | 'accepted' | 'in_progress' | 'waiting_agent' | 'running' | 'completed' | 'rejected' | 'dismissed' | 'failed' | 'aborted';
  priority: 'high' | 'medium' | 'low';
  metadata?: Record<string, unknown>;
  resultSummary?: string;
  userResponse?: string;
  callbackUrl?: string;
  formType?: 'free_text' | 'choice' | 'form' | 'confirmation';
  choices?: { label: string; value: string; description?: string; isCancel?: boolean }[];
  fields?: TaskFormField[];
  formResponse?: Record<string, unknown>;
  subagentTaskId?: string;
  subagentName?: string;
  completedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskFormField = {
  name: string;
  label: string;
  fieldType: 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'date';
  required?: boolean;
  options?: string[];
  default?: unknown;
};

export function getTaskQueue(params?: { status?: string; type?: string; page?: number; limit?: number }): Promise<{ tasks: TaskQueueItem[]; total: number; page: number; limit: number; totalPages: number }> {
  const query = params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : '';
  return request.get(`${endpoints.taskQueue()}${query}`);
}

export function getTaskQueueItem(taskId: string): Promise<TaskQueueItem> {
  return request.get(endpoints.taskQueueItem(taskId));
}

export function updateTaskQueueItem(taskId: string, payload: Partial<Pick<TaskQueueItem, 'status' | 'resultSummary' | 'metadata' | 'sourceConversationId'>>): Promise<TaskQueueItem> {
  return request.patch(endpoints.taskQueueItem(taskId), payload);
}

export function deleteTaskQueueItem(taskId: string): Promise<{ success: boolean }> {
  return request.delete(endpoints.taskQueueItem(taskId));
}

export function respondTaskQueueItem(taskId: string, userResponse: string): Promise<{ taskId: string; status: string }> {
  return request.post(`${endpoints.taskQueueItem(taskId)}/respond`, { userResponse });
}

export function getTasksByConversation(conversationId: string, status?: string): Promise<{ tasks: TaskQueueItem[] }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request.get(`${endpoints.taskQueue()}/by-conversation/${encodeURIComponent(conversationId)}${query}`);
}

export function submitTaskQueueItem(taskId: string, formResponse: Record<string, unknown>): Promise<{ taskId: string; status: string }> {
  return request.post(`${endpoints.taskQueueItem(taskId)}/submit`, { formResponse });
}

export function clearCompletedTasks(conversationId: string): Promise<{ success: boolean; cleared: number }> {
  return request.delete(`${endpoints.taskQueue()}/by-conversation/${encodeURIComponent(conversationId)}/completed`);
}

export function getPIFiles(agentId: string, sessionId: string): Promise<PIFilesResponse> {
  return request.get(endpoints.piFiles(agentId, sessionId));
}

export function downloadPIFile(
  agentId: string,
  sessionId: string,
  filename: string,
): Promise<Blob> {
  return request.get(endpoints.piFileDownload(agentId, sessionId, filename), {
    responseType: 'blob',
  });
}

export function deletePIFile(agentId: string, sessionId: string, filename: string): Promise<void> {
  return request.deleteWithOptions(endpoints.piFileDelete(), { data: { agentId, sessionId, path: filename } });
}

// Artifact 相关方法
export function getArtifactById(artifactId: string): Promise<unknown> {
  return request.get(`${endpoints.apiBaseUrl()}/api/gallery/artifacts/${artifactId}`);
}

export function deleteArtifact(artifactId: string, userId: string): Promise<unknown> {
  return request.deleteWithOptions(`${endpoints.apiBaseUrl()}/api/gallery/artifacts/${artifactId}`, { data: { userId } });
}

// Gallery Artifact Share 相关方法
export function getGalleryArtifactShare(shareId: string): Promise<unknown> {
  return request.get(`${endpoints.apiBaseUrl()}/api/gallery/share/${shareId}`);
}

export function createGalleryArtifactShare(artifactId: string): Promise<unknown> {
  return request.post(`${endpoints.apiBaseUrl()}/api/gallery/${artifactId}/share`, {});
}

export function getGalleryArtifactShares(artifactId: string): Promise<unknown> {
  return request.get(`${endpoints.apiBaseUrl()}/api/gallery/${artifactId}/share`);
}

export function deleteGalleryArtifactShare(artifactId: string): Promise<unknown> {
  return request.delete(`${endpoints.apiBaseUrl()}/api/gallery/${artifactId}/share`);
}

// File Management API
export const listFiles = (
  agentId: string,
  sessionId: string,
  path?: string,
): Promise<f.FileManagementListResponse> => {
  return request.get(endpoints.filesList(agentId, sessionId, path));
};

export const getFileDetails = (
  agentId: string,
  sessionId: string,
  filePath: string,
): Promise<f.FileManagementDetailsResponse> => {
  return request.get(endpoints.filesDetails(agentId, sessionId, filePath));
};

export const searchFiles = (
  agentId: string,
  sessionId: string,
  path?: string,
  pattern?: string,
  type?: string,
): Promise<f.FileManagementSearchResponse> => {
  return request.get(endpoints.filesSearch(agentId, sessionId, path, pattern, type));
};

export const createFolder = (
  body: f.FileManagementMkdirBody,
): Promise<f.FileManagementMkdirResponse> => {
  return request.post(endpoints.filesMkdir(), body);
};

export const renameFile = (
  body: f.FileManagementRenameBody,
): Promise<f.FileManagementRenameResponse> => {
  return request.post(endpoints.filesRename(), body);
};

export const moveFiles = (
  body: f.FileManagementMoveBody,
): Promise<f.FileManagementMoveResponse> => {
  return request.post(endpoints.filesMove(), body);
};

export const deleteFile = (
  body: f.FileManagementDeleteBody,
): Promise<f.FileManagementDeleteResponse> => {
  return request.deleteWithOptions(endpoints.filesDelete(), { data: body });
};

export const batchDeleteFiles = (
  body: f.FileManagementBatchDeleteBody,
): Promise<f.FileManagementBatchDeleteResponse> => {
  return request.post(endpoints.filesBatchDelete(), body);
};

export const downloadFile = async (
  agentId: string,
  sessionId: string,
  filePath: string,
): Promise<Blob> => {
  return request.get(endpoints.filesDownload(agentId, sessionId, filePath), {
    responseType: 'blob',
  });
};

export const batchDownloadFiles = async (body: f.FileManagementBatchDeleteBody): Promise<Blob> => {
  return request.postWithOptions(endpoints.filesBatchDownload(), body, {
    responseType: 'blob',
  });
};

export const unzipFile = (
  body: f.FileManagementUnzipBody,
): Promise<f.FileManagementUnzipResponse> => {
  return request.post(endpoints.filesUnzip(), body);
};

export const getUploadLimits = (): Promise<{ maxFileSizeMB: number }> => {
  return request.get(endpoints.filesUploadLimits());
};

export const uploadFileSimple = (
  agentId: string,
  sessionId: string,
  file: File,
  targetPath?: string,
): Promise<f.FileManagementUploadResponse> => {
  const formData = new FormData();
  formData.append('agentId', agentId);
  formData.append('sessionId', sessionId);
  if (targetPath) {
    formData.append('path', targetPath);
  }
  formData.append('file', file);
  return request.postMultiPart(endpoints.filesUpload(), formData);
};

export const initChunkedUpload = (
  body: f.FileManagementUploadInitBody,
): Promise<f.FileManagementUploadInitResponse> => {
  return request.post(endpoints.filesUploadInit(), body);
};

export const uploadChunk = (
  body: f.FileManagementUploadChunkBody,
): Promise<f.FileManagementUploadChunkResponse> => {
  return request.post(endpoints.filesUploadChunk(), body);
};

export const completeChunkedUpload = (
  body: f.FileManagementUploadCompleteBody,
): Promise<f.FileManagementUploadCompleteResponse> => {
  return request.post(endpoints.filesUploadComplete(), body);
};
