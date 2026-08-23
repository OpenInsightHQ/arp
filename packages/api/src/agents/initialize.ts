import { Providers } from '@librechat/agents';
import axios from 'axios';
import {
  Constants,
  ErrorTypes,
  EModelEndpoint,
  EToolResources,
  paramEndpoints,
  isAgentsEndpoint,
  replaceSpecialVars,
  providerEndpointMap,
} from 'librechat-data-provider';
import type {
  AgentToolResources,
  AgentToolOptions,
  AgentSkill,
  TEndpointOption,
  TFile,
  Agent,
  TUser,
} from 'librechat-data-provider';
import type { GenericTool, LCToolRegistry, ToolMap, LCTool } from '@librechat/agents';
import type { Response as ServerResponse } from 'express';
import type { IMongoFile } from '@librechat/data-schemas';
import type { InitializeResultBase, ServerRequest, EndpointDbMethods } from '~/types';
import {
  optionalChainWithEmptyCheck,
  extractLibreChatParams,
  getModelMaxTokens,
  getThreadData,
  replaceLangVar,
  getLangFromReq,
  getLangText,
} from '~/utils';
import { filterFilesByEndpointConfig } from '~/files';
import { appendUniquePrompt, buildVisualizationPrompt, generateArtifactsPrompt } from '~/prompts';
import {
  buildAvailableSkillsPrompt,
  buildAvailablePromptsPrompt,
  buildPiAttachmentsPrompt,
} from '~/prompts';
import type { PiSessionFile } from '~/prompts';
import { getSystemPromptOrSeed } from '~/prompts';
import { getProviderConfig } from '~/endpoints';
import { primeResources } from './resources';

/**
 * Extended agent type with additional fields needed after initialization
 */
export type InitializedAgent = Agent & {
  tools: GenericTool[];
  attachments: IMongoFile[];
  toolContextMap: Record<string, unknown>;
  maxContextTokens: number;
  toolCallVisible: boolean;
  useLegacyContent: boolean;
  resendFiles: boolean;
  tool_resources?: AgentToolResources;
  userMCPAuthMap?: Record<string, Record<string, string>>;
  /** Tool map for ToolNode to use when executing tools (required for PTC) */
  toolMap?: ToolMap;
  /** Tool registry for PTC and tool search (only present when MCP tools with env classification exist) */
  toolRegistry?: LCToolRegistry;
  /** Serializable tool definitions for event-driven execution */
  toolDefinitions?: LCTool[];
  /** Precomputed flag indicating if any tools have defer_loading enabled (for efficient runtime checks) */
  hasDeferredTools?: boolean;
};

/**
 * Parameters for initializing an agent
 * Matches the CJS signature from api/server/services/Endpoints/agents/agent.js
 */
export interface InitializeAgentParams {
  /** Request object */
  req: ServerRequest;
  /** Response object */
  res: ServerResponse;
  /** Agent to initialize */
  agent: Agent;
  /** Conversation ID (optional) */
  conversationId?: string | null;
  /** Parent message ID for determining the current thread (optional) */
  parentMessageId?: string | null;
  /** Request files */
  requestFiles?: IMongoFile[];
  /**
   * PI workspace attachment inventory for this conversation (agent/model
   * endpoints), fetched once by the JS layer via PIService.listPiFiles.
   * When non-empty the primary agent gets the `<attachments>` system-prompt
   * section and the read_text_file tool mounted.
   */
  piAttachmentFiles?: PiSessionFile[];
  /** Function to load agent tools */
  loadTools?: (params: {
    req: ServerRequest;
    res: ServerResponse;
    provider: string;
    agentId: string;
    tools: string[];
    model: string | null;
    tool_options: AgentToolOptions | undefined;
    tool_resources: AgentToolResources | undefined;
    skills: AgentSkill[] | undefined;
    knowledgePromptKeys: string[] | undefined;
  }) => Promise<{
    /** Full tool instances (only present when definitionsOnly=false) */
    tools?: GenericTool[];
    toolContextMap?: Record<string, unknown>;
    userMCPAuthMap?: Record<string, Record<string, string>>;
    toolRegistry?: LCToolRegistry;
    /** Serializable tool definitions for event-driven mode */
    toolDefinitions?: LCTool[];
    hasDeferredTools?: boolean;
  } | null>;
  /** Endpoint option (contains model_parameters and endpoint info) */
  endpointOption?: Partial<TEndpointOption>;
  /** Set of allowed providers */
  allowedProviders: Set<string>;
  /** Whether this is the initial agent */
  isInitialAgent?: boolean;
}

/**
 * Database methods required for agent initialization
 * Most methods come from data-schemas via createMethods()
 * getConvoFiles not yet in data-schemas but included here for consistency
 */
export interface InitializeAgentDbMethods extends EndpointDbMethods {
  /** Update usage tracking for multiple files */
  updateFilesUsage: (files: Array<{ file_id: string }>, fileIds?: string[]) => Promise<unknown[]>;
  /** Get files from database */
  getFiles: (filter: unknown, sort: unknown, select: unknown, opts?: unknown) => Promise<unknown[]>;
  /** Get tool files by IDs (user-uploaded files only, code files handled separately) */
  getToolFilesByIds: (fileIds: string[], toolSet: Set<EToolResources>) => Promise<unknown[]>;
  /** Get conversation file IDs */
  getConvoFiles: (conversationId: string) => Promise<string[] | null>;
  /** Get code-generated files by conversation ID and optional message IDs */
  getCodeGeneratedFiles?: (conversationId: string, messageIds?: string[]) => Promise<unknown[]>;
  /** Get user-uploaded execute_code files by file IDs (from message.files in thread) */
  getUserCodeFiles?: (fileIds: string[]) => Promise<unknown[]>;
  /** Get messages for a conversation (supports select for field projection) */
  getMessages?: (
    filter: { conversationId: string },
    select?: string,
  ) => Promise<Array<{
    messageId: string;
    parentMessageId?: string;
    files?: Array<{ file_id: string }>;
  }> | null>;
}

/**
 * Initializes an agent for use in requests.
 * Handles file processing, tool loading, provider configuration, and context token calculations.
 *
 * This function is exported from @librechat/api and replaces the CJS version from
 * api/server/services/Endpoints/agents/agent.js
 *
 * @param params - Initialization parameters
 * @param deps - Optional dependency injection for testing
 * @returns Promise resolving to initialized agent with tools and configuration
 * @throws Error if agent provider is not allowed or if required dependencies are missing
 */
export async function initializeAgent(
  params: InitializeAgentParams,
  db?: InitializeAgentDbMethods,
): Promise<InitializedAgent> {
  const {
    req,
    res,
    agent,
    loadTools,
    requestFiles = [],
    conversationId,
    endpointOption,
    parentMessageId,
    allowedProviders,
    isInitialAgent = false,
    piAttachmentFiles,
  } = params;

  if (!db) {
    throw new Error('initializeAgent requires db methods to be passed');
  }

  if (
    isAgentsEndpoint(endpointOption?.endpoint) &&
    allowedProviders.size > 0 &&
    !allowedProviders.has(agent.provider)
  ) {
    throw new Error(
      `{ "type": "${ErrorTypes.INVALID_AGENT_PROVIDER}", "info": "${agent.provider}" }`,
    );
  }

  let currentFiles: IMongoFile[] | undefined;

  const _modelOptions = structuredClone(
    Object.assign(
      { model: agent.model },
      agent.model_parameters ?? { model: agent.model },
      isInitialAgent === true ? endpointOption?.model_parameters : {},
    ),
  );

  const { resendFiles, maxContextTokens, toolCallVisible, modelOptions } = extractLibreChatParams(
    _modelOptions as Record<string, unknown>,
  );

  const provider = agent.provider;
  agent.endpoint = provider;

  /**
   * Load conversation files for ALL agents, not just the initial agent.
   * This enables handoff agents to access files that were uploaded earlier
   * in the conversation. Without this, file_search and execute_code tools
   * on handoff agents would fail to find previously attached files.
   */
  if (conversationId != null && resendFiles) {
    const fileIds = (await db.getConvoFiles(conversationId)) ?? [];
    const toolResourceSet = new Set<EToolResources>();
    for (const tool of agent.tools ?? []) {
      if (EToolResources[tool as keyof typeof EToolResources]) {
        toolResourceSet.add(EToolResources[tool as keyof typeof EToolResources]);
      }
    }

    const toolFiles = (await db.getToolFilesByIds(fileIds, toolResourceSet)) as IMongoFile[];

    /**
     * Retrieve execute_code files filtered to the current thread.
     * This includes both code-generated files and user-uploaded execute_code files.
     */
    let codeGeneratedFiles: IMongoFile[] = [];
    let userCodeFiles: IMongoFile[] = [];

    if (toolResourceSet.has(EToolResources.execute_code)) {
      let threadMessageIds: string[] | undefined;
      let threadFileIds: string[] | undefined;

      if (parentMessageId && parentMessageId !== Constants.NO_PARENT && db.getMessages) {
        /** Only select fields needed for thread traversal */
        const messages = await db.getMessages(
          { conversationId },
          'messageId parentMessageId files',
        );
        if (messages && messages.length > 0) {
          /** Single O(n) pass: build Map, traverse thread, collect both IDs */
          const threadData = getThreadData(messages, parentMessageId);
          threadMessageIds = threadData.messageIds;
          threadFileIds = threadData.fileIds;
        }
      }

      /** Code-generated files (context: execute_code) filtered by messageId */
      if (db.getCodeGeneratedFiles) {
        codeGeneratedFiles = (await db.getCodeGeneratedFiles(
          conversationId,
          threadMessageIds,
        )) as IMongoFile[];
      }

      /** User-uploaded execute_code files (context: agents/message_attachment) from thread messages */
      if (db.getUserCodeFiles && threadFileIds && threadFileIds.length > 0) {
        userCodeFiles = (await db.getUserCodeFiles(threadFileIds)) as IMongoFile[];
      }
    }

    const allToolFiles = toolFiles.concat(codeGeneratedFiles, userCodeFiles);
    if (requestFiles.length || allToolFiles.length) {
      currentFiles = (await db.updateFilesUsage(requestFiles.concat(allToolFiles))) as IMongoFile[];
    }
  } else if (requestFiles.length) {
    currentFiles = (await db.updateFilesUsage(requestFiles)) as IMongoFile[];
  }

  if (currentFiles && currentFiles.length) {
    let endpointType: EModelEndpoint | undefined;
    if (!paramEndpoints.has(agent.endpoint ?? '')) {
      endpointType = EModelEndpoint.custom;
    }

    currentFiles = filterFilesByEndpointConfig(req, {
      files: currentFiles,
      endpoint: agent.endpoint ?? '',
      endpointType,
    });
  }

  const { attachments: primedAttachments, tool_resources } = await primeResources({
    req: req as never,
    getFiles: db.getFiles as never,
    appConfig: req.config,
    agentId: agent.id,
    attachments: currentFiles
      ? (Promise.resolve(currentFiles) as unknown as Promise<TFile[]>)
      : undefined,
    tool_resources: agent.tool_resources,
    requestFileSet: new Set(requestFiles?.map((file) => file.file_id)),
  });

  /**
   * PI workspace attachments (agent/model endpoints): files uploaded through
   * the unified PI attachment flow live in the PI workspace keyed by
   * (agent.id, conversationId). The inventory is fetched once by the JS
   * caller via PIService.listPiFiles and passed here as `piAttachmentFiles`.
   * When present on the primary agent (non-pi endpoint):
   * - append the `<attachments>` section to the system prompt, tagging each
   *   file kind="text"/"binary" with per-kind tool rules
   * - mount the `read_text_file` tool ONLY when at least one text file
   *   exists (binary-only workspaces never expose it, so the model cannot
   *   waste a call on it)
   * Binary files are handled by execute_skill (preferred) or execute_code.
   * The PI endpoint itself is skipped: pi manages its own file attachments.
   */
  if (isInitialAgent === true && String(endpointOption?.endpoint) !== 'pi') {
    const attachments = piAttachmentFiles ?? [];
    const attachmentsPrompt = buildPiAttachmentsPrompt(attachments);
    if (attachmentsPrompt) {
      const piRequest = req as ServerRequest & {
        _piAttachmentFiles?: PiSessionFile[];
        _piAgentId?: string;
      };
      piRequest._piAttachmentFiles = attachments;
      piRequest._piAgentId = agent.id;
      agent.additional_instructions = appendUniquePrompt(
        agent.additional_instructions,
        attachmentsPrompt,
      );
      const hasTextFiles = attachments.some((file) => file.isText !== false);
      if (hasTextFiles && !(agent.tools ?? []).includes('read_text_file')) {
        agent.tools = [...(agent.tools ?? []), 'read_text_file'];
      }
    }
  }

  const {
    toolRegistry,
    toolContextMap,
    userMCPAuthMap,
    toolDefinitions,
    hasDeferredTools,
    tools: structuredTools,
  } = (await loadTools?.({
    req,
    res,
    provider,
    agentId: agent.id,
    tools: agent.tools ?? [],
    model: agent.model,
    tool_options: agent.tool_options,
    tool_resources,
    skills: agent.skills ?? undefined,
    knowledgePromptKeys: agent.knowledgePromptKeys ?? undefined,
  })) ?? {
    tools: [],
    toolContextMap: {},
    userMCPAuthMap: undefined,
    toolRegistry: undefined,
    toolDefinitions: [],
    hasDeferredTools: false,
  };

  const { getOptions, overrideProvider } = getProviderConfig({
    provider,
    appConfig: req.config,
  });
  if (overrideProvider !== agent.provider) {
    agent.provider = overrideProvider;
  }

  const finalModelOptions = {
    ...modelOptions,
    model: agent.model,
  };

  const options: InitializeResultBase = await getOptions({
    req,
    endpoint: provider,
    model_parameters: finalModelOptions,
    db,
  });

  const llmConfig = options.llmConfig as Record<string, unknown>;
  const tokensModel =
    agent.provider === EModelEndpoint.azureOpenAI ? agent.model : (llmConfig?.model as string);
  const maxOutputTokens = optionalChainWithEmptyCheck(
    llmConfig?.maxOutputTokens as number | undefined,
    llmConfig?.maxTokens as number | undefined,
    0,
  );
  const agentMaxContextTokens = optionalChainWithEmptyCheck(
    maxContextTokens,
    getModelMaxTokens(
      tokensModel ?? '',
      providerEndpointMap[provider as keyof typeof providerEndpointMap],
      options.endpointTokenConfig,
    ),
    34000,
  );

  if (
    agent.endpoint === EModelEndpoint.azureOpenAI &&
    (llmConfig?.azureOpenAIApiInstanceName as string | undefined) == null
  ) {
    agent.provider = Providers.OPENAI;
  }

  if (options.provider != null) {
    agent.provider = options.provider;
  }

  /** Check for tool presence from either full instances or definitions (event-driven mode) */
  const hasAgentTools = (structuredTools?.length ?? 0) > 0 || (toolDefinitions?.length ?? 0) > 0;

  let tools: GenericTool[] = options.tools?.length
    ? (options.tools as GenericTool[])
    : (structuredTools ?? []);

  if (
    (agent.provider === Providers.GOOGLE || agent.provider === Providers.VERTEXAI) &&
    options.tools?.length &&
    hasAgentTools
  ) {
    throw new Error(`{ "type": "${ErrorTypes.GOOGLE_TOOL_CONFLICT}"}`);
  } else if (
    (agent.provider === Providers.OPENAI ||
      agent.provider === Providers.AZURE ||
      agent.provider === Providers.ANTHROPIC) &&
    options.tools?.length &&
    structuredTools?.length
  ) {
    tools = structuredTools.concat(options.tools as GenericTool[]);
  }

  agent.model_parameters = { ...options.llmConfig } as Agent['model_parameters'];
  if (options.configOptions) {
    (agent.model_parameters as Record<string, unknown>).configuration = options.configOptions;
  }

  // mainPromptKey is the fallback instructions source: `instructions` wins when non-empty
  if ((!agent.instructions || agent.instructions === '') && agent.mainPromptKey) {
    const mainPrompt = await getSystemPromptOrSeed(agent.mainPromptKey);
    if (mainPrompt) {
      agent.instructions = mainPrompt;
    }
  }

  if (agent.instructions && agent.instructions !== '') {
    agent.instructions = replaceSpecialVars({
      text: agent.instructions,
      user: req.user ? (req.user as unknown as TUser) : null,
    });
  }

  if (typeof agent.artifacts === 'string' && agent.artifacts !== '') {
    const artifactsKey =
      agent.provider === EModelEndpoint.anthropic ? 'artifacts.anthropic' : 'artifacts.openai';
    const [dbArtifactsPrompt, dbShadcnPrefix] = await Promise.all([
      getSystemPromptOrSeed(artifactsKey),
      getSystemPromptOrSeed('artifacts.shadcn_prefix'),
    ]);
    const artifactsPromptResult = generateArtifactsPrompt({
      endpoint: agent.provider,
      artifacts: agent.artifacts as never,
      dbPrompt: dbArtifactsPrompt,
      dbShadcnPrefix,
    });
    agent.additional_instructions = artifactsPromptResult ?? undefined;
  }

  const requestBody = req?.body as
    | {
        echartsPrompt?: boolean;
        keywordDefinitions?: string[];
        endpointOption?: { echartsPrompt?: boolean; keywordDefinitions?: string[] };
      }
    | undefined;

  // 替换 {{keyword_definition}}
  const keywordDefinitions = requestBody?.keywordDefinitions;
  if (agent.instructions && /{{keyword_definition}}/i.test(agent.instructions)) {
    const keywordDefText =
      keywordDefinitions && keywordDefinitions.length > 0 ? keywordDefinitions.join(',') : '';
    agent.instructions = agent.instructions.replace(/{{keyword_definition}}/gi, keywordDefText);
  }

  // 替换 {{updated_examples}}
  if (agent.instructions && /{{updated_examples}}/i.test(agent.instructions)) {
    // 写死 lastPullTime 为 1900，DMP 接口返回全量示例SQL
    const lastPullTime = '1900-01-01 00:00:00';
    const dmpHost = process.env.DMP_HOST || '';
    const dmpApiKey = process.env.DMP_API_KEY || '';
    if (dmpHost) {
      try {
        const agentId = agent.id || '';
        const url = `${dmpHost}/open-api/dataset/get-updated-example`;
        const response = await axios.get(url, {
          params: { lastPullTime },
          headers: {
            'api-key': dmpApiKey,
            'X-Agent-Id': agentId,
          },
        });
        const updatedExamplesText =
          typeof response.data?.data === 'string'
            ? response.data.data
            : response.data?.data != null
              ? JSON.stringify(response.data.data)
              : '';
        agent.instructions = agent.instructions.replace(
          /{{updated_examples}}/gi,
          updatedExamplesText,
        );
      } catch (err) {
        console.error('[initialize] Failed to fetch updated examples from DMP:', err);
        agent.instructions = agent.instructions.replace(/{{updated_examples}}/gi, '');
      }
    } else {
      agent.instructions = agent.instructions.replace(/{{updated_examples}}/gi, '');
    }
  }

  // 替换 {{lang}}
  if (agent.instructions && /{{lang}}/i.test(agent.instructions)) {
    agent.instructions = replaceLangVar(agent.instructions, req);
  }

  const endpointVisualizationOptions = (endpointOption ?? {}) as {
    echartsPrompt?: boolean;
    model_parameters?: { echartsPrompt?: boolean };
  };

  const visualizationPrompt = buildVisualizationPrompt({
    echartsPrompt:
      requestBody?.echartsPrompt === true ||
      requestBody?.endpointOption?.echartsPrompt === true ||
      endpointVisualizationOptions.echartsPrompt === true ||
      endpointVisualizationOptions.model_parameters?.echartsPrompt === true,
    dbPrompt: await getSystemPromptOrSeed('visualization.echarts'),
  });

  agent.additional_instructions = appendUniquePrompt(
    agent.additional_instructions,
    visualizationPrompt,
  );

  // PI endpoint: inject language instruction since PI backend's system prompt
  // contains {{lang}} but the PI backend cannot resolve it from the OpenAI-compatible request.
  // Append the resolved language directive so PI receives it via additional_instructions.
  if (String(endpointOption?.endpoint) === 'pi') {
    agent.additional_instructions = appendUniquePrompt(
      agent.additional_instructions,
      getLangText(getLangFromReq(req)),
    );
  }

  const availableSkillsPrompt = buildAvailableSkillsPrompt(agent.skills);
  if (availableSkillsPrompt) {
    agent.additional_instructions = appendUniquePrompt(
      agent.additional_instructions,
      availableSkillsPrompt,
    );
  }

  const availablePromptsPrompt = await buildAvailablePromptsPrompt(agent.knowledgePromptKeys);
  if (availablePromptsPrompt) {
    agent.additional_instructions = appendUniquePrompt(
      agent.additional_instructions,
      availablePromptsPrompt,
    );
  }

  const agentMaxContextNum = Number(agentMaxContextTokens) || 34000;
  const maxOutputTokensNum = Number(maxOutputTokens) || 0;

  const finalAttachments: IMongoFile[] = (primedAttachments ?? [])
    .filter((a): a is TFile => a != null)
    .map((a) => a as unknown as IMongoFile);

  const initializedAgent: InitializedAgent = {
    ...agent,
    resendFiles,
    toolRegistry,
    tool_resources,
    userMCPAuthMap,
    toolDefinitions,
    hasDeferredTools,
    attachments: finalAttachments,
    toolContextMap: toolContextMap ?? {},
    useLegacyContent: !!options.useLegacyContent,
    tools: (tools ?? []) as GenericTool[] & string[],
    maxContextTokens:
      maxContextTokens != null && maxContextTokens > 0
        ? maxContextTokens
        : Math.round((agentMaxContextNum - maxOutputTokensNum) * 0.9),
    toolCallVisible: toolCallVisible === true,
  };

  return initializedAgent;
}
