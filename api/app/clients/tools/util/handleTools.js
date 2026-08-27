const { logger } = require('@librechat/data-schemas');
const {
  EnvVar,
  Calculator,
  createSearchTool,
  createCodeExecutionTool,
} = require('@librechat/agents');
const {
  checkAccess,
  createSafeUser,
  mcpToolPattern,
  loadWebSearchAuth,
  buildImageToolContext,
  buildWebSearchContext,
  GenerationJobManager,
  getCustomEndpointConfig,
} = require('@librechat/api');
const { getMCPServersRegistry } = require('~/config');
const {
  Tools,
  Constants,
  Permissions,
  EToolResources,
  PermissionTypes,
} = require('librechat-data-provider');
const {
  availableTools,
  manifestToolMap,
  // Basic Tools
  GoogleSearchAPI,
  // Structured Tools
  DALLE3,
  FluxAPI,
  OpenWeather,
  StructuredSD,
  StructuredACS,
  TraversaalSearch,
  StructuredWolfram,
  TavilySearchResults,
  createGeminiImageTool,
  createOpenAIImageTools,
} = require('../');
const { primeFiles: primeCodeFiles } = require('~/server/services/Files/Code/process');
const { createFileSearchTool, primeFiles: primeSearchFiles } = require('./fileSearch');
const { getUserPluginAuthValue } = require('~/server/services/PluginService');
const { createMCPTool, createMCPTools } = require('~/server/services/MCP');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { getMCPServerTools } = require('~/server/services/Config');
const { isPIConfigured, handlePIToolCall, readPiTextFile } = require('~/server/services/PIService');
const { scheduleBackgroundSkillFileCollection } = require('~/server/services/BackgroundSkillFiles');
const { DynamicStructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');
const { getRoleByName } = require('~/models/Role');
const { GallerySqlQuery, GalleryVersion } = require('~/models');
const { GalleryArtifact } = require('~/models/GalleryArtifact');

const createPITools = (options = {}) => {
  const tools = [];

  if (!isPIConfigured()) {
    return tools;
  }

  const { streamId, res, req, agentId, conversationId, userId } = options;
  /**
   * PI workspace key resolution (must match every other PI surface —
   * <attachments> inventory, execute_code syncing, PI download URLs):
   * 1. req._piAgentId — primary agent id stashed during initialization
   *    (always set for agent/model endpoints, even with an empty workspace)
   * 2. options.agentId — fallback for execution paths that never ran the
   *    initialization stash (e.g. missing agent context)
   * 3. 'default'
   */
  const effectiveAgentId = req?._piAgentId || agentId || 'default';
  const sessionId = conversationId || undefined;

  /**
   * Defer the pi file-links footer to the END of the turn: record the skill
   * run (agentId/sessionId/userId/startedAt) on the request so the
   * controller, AFTER the LLM wrote its final summary, re-runs
   * collectPiGeneratedFiles, filters the files against the summary text
   * (whole-token mention match) and appends canonical download links
   * (buildPiFileDownloadUrl). Staging prebuilt links at tool-call time
   * relied on the skill's raw output for filtering and on the LLM
   * preserving relayed links from the collapsed tool output — both unstable.
   */
  const stagePiSkillRun = (startedAt) => {
    if (!req || !startedAt) {
      return;
    }
    if (!Array.isArray(req._piSkillRuns)) {
      req._piSkillRuns = [];
    }
    req._piSkillRuns.push({
      agentId: effectiveAgentId,
      sessionId,
      userId,
      startedAt,
    });
  };

  /**
   * Resolve the current message-tree leaf for pi-side persistence.
   * At tool-execution time the outer agent's reply for this turn is not yet
   * saved, so pi must mount its messages under the in-flight responseMessageId
   * instead of guessing "last message" — otherwise the pi subtree forks the
   * message tree. Resumable flows read it from the generation job; non-job
   * flows (OpenAI-compat v1/v2 controllers) stash it on the request.
   */
  const resolveParentMessageId = async () => {
    if (!streamId) {
      return req?._piResponseMessageId || undefined;
    }
    try {
      const job = await GenerationJobManager.getJob(streamId);
      return job?.metadata?.responseMessageId || undefined;
    } catch (err) {
      logger.debug('[PITools] Failed to resolve responseMessageId from job:', err.message);
      return undefined;
    }
  };

  /**
   * Resolve the outer agent's exact system prompt (stashed on the generation
   * job at sendMessage time, or on the request by non-job controllers).
   * execute_skill forwards it to pi's /execute-agent-skill so the skill runs
   * under the agent's verbatim prompt.
   */
  const resolveAgentSystemPrompt = async () => {
    if (!streamId) {
      return req?._piAgentSystemPrompt || undefined;
    }
    try {
      const job = await GenerationJobManager.getJob(streamId);
      return job?.metadata?.agentSystemPrompt || undefined;
    } catch (err) {
      logger.debug('[PITools] Failed to resolve agentSystemPrompt from job:', err.message);
      return undefined;
    }
  };

  logger.info(
    `[createPITools] streamId: ${streamId || 'NOT SET'}, agentId: ${effectiveAgentId}, sessionId: ${sessionId || 'not set'}`,
  );

  const emitStreamChunk = async (content) => {
    if (streamId) {
      try {
        await GenerationJobManager.emitChunk(streamId, {
          event: 'pi_stream',
          data: { content },
        });
      } catch (err) {
        logger.debug('[PITools] Failed to emit stream chunk:', err.message);
      }
    }
  };

  const emitThinking = async (thinkingData) => {
    if (streamId) {
      try {
        await GenerationJobManager.emitChunk(streamId, {
          event: 'pi_thinking',
          data: thinkingData,
        });
      } catch (err) {
        logger.error('[PITools] Failed to emit thinking:', err.message);
      }
    }
  };

  const emitToolEvent = async (toolData) => {
    if (streamId) {
      try {
        await GenerationJobManager.emitChunk(streamId, {
          event: 'pi_tool',
          data: toolData,
        });
      } catch (err) {
        logger.debug('[PITools] Failed to emit tool event:', err.message);
      }
    }
  };

  const formatSkillResult = (result) => {
    if (!result.success) {
      return `Error: ${result.error}`;
    }

    const data = result.data;

    // Deadline reached: pi keeps running in the background; the note tells
    // the agent to wrap up the turn instead of waiting.
    if (result.background && data.note) {
      let partial = '';
      if (data.output) {
        partial = `Partial output streamed so far:\n${data.output.slice(-2000)}\n\n`;
      }
      return `${partial}${data.note}`;
    }

    let output = data.output || data.message || '';

    if (data.files && data.files.length > 0) {
      output += '\n\n**Generated Files:**\n';
      for (const file of data.files) {
        output += `- **${file.name}**`;
        if (file.size) {
          output += ` (${(file.size / 1024).toFixed(2)} KB)`;
        }
        output += '\n';
      }
      output +=
        '\nWhen summarizing the result for the user, mention the deliverable file names exactly as listed above.';
    }

    return output;
  };

  const piExecuteSkillTool = new DynamicStructuredTool({
    name: 'execute_skill',
    description: `Execute a registered skill by name.

Use this tool when the user's request matches one of the skills listed in the <available_skills> section of the system prompt (match by the skill description's usage cues).

For files from the <attachments> workspace: PREFER this tool over execute_code when a listed skill matches the task (especially for kind="binary" files such as xlsx, docx, pdf); fall back to execute_code only when no listed skill matches.

Rules:
- skillName MUST be one of the names listed in <available_skills>.
- Pass the user's request in 'input' exactly as stated, without interpretation or restructuring.
- The skill runs asynchronously and returns its final output and any generated files.
- If the skill output asks for confirmation, options, or any user decision (e.g. ending with a question or a list of choices to confirm): you MUST relay the full options/choices in your visible reply and STOP to wait for the user's answer. NEVER answer, confirm, or choose on the user's behalf, and NEVER proceed to a follow-up skill call in the same turn. Only re-invoke the skill after the user has explicitly responded.`,
    schema: z.object({
      skillName: z
        .string()
        .describe(
          'The skill name exactly as listed in <available_skills>. Do not invent skill names.',
        ),
      input: z
        .string()
        .describe(
          "The user's request related to this skill. Pass the relevant part of the user's message as stated, without modification.",
        ),
    }),
    func: async ({ skillName, input }) => {
      const onChunk = streamId
        ? async (content) => {
            await emitStreamChunk(content);
          }
        : undefined;

      const onThinking = streamId
        ? async (thinkingData) => {
            await emitThinking(thinkingData);
          }
        : undefined;

      const onToolEvent = streamId
        ? async (toolData) => {
            await emitToolEvent(toolData);
          }
        : undefined;

      const result = await handlePIToolCall(
        {
          name: 'execute_skill',
          arguments: { skillName, input },
          agentId: effectiveAgentId,
          sessionId,
          parentMessageId: await resolveParentMessageId(),
          agentSystemPrompt: await resolveAgentSystemPrompt(),
        },
        onChunk,
        onThinking,
        onToolEvent,
        userId,
      );

      // No server-side download: the download-links footer (appended by the
      // controller after the LLM's summary) points straight at pi's download
      // endpoint, so the browser streams files directly from pi. Downloading
      // here would stall the tool call (sequential 60s-timeout fetches) and
      // duplicate storage.
      if (result.success && !result.background && result.data?.files?.length > 0) {
        // Defer the download-links footer: stage the run so the controller
        // collects + filters the files against the LLM's final summary once
        // the turn completes.
        stagePiSkillRun(result.data.startedAt);
      }

      // Deadline hit: pi keeps executing in the background. Watch the pi skill
      // task (TaskQueue doc) and, when it finishes, collect the files
      // generated during the run and append their canonical pi download links
      // (collectPiGeneratedFiles + buildPiFileDownloadUrl, same markdown as
      // the one-pi chat surface) to the saved response message text.
      if (result.success && result.background) {
        scheduleBackgroundSkillFileCollection({
          agentId: effectiveAgentId,
          sessionId,
          userId,
          skillName,
          startedAt: result.data?.startedAt,
          // resolveParentMessageId() reads job.metadata.responseMessageId, i.e.
          // the in-flight response message the watcher should append links to
          responseMessageId: await resolveParentMessageId(),
        }).catch(() => {
          /* watcher logs its own errors */
        });
      }

      return formatSkillResult(result);
    },
  });

  const piReadPromptTool = new DynamicStructuredTool({
    name: 'read_prompt',
    description: `Read a system prompt's full content by its key.

Use this tool when you need the detailed content of one of the prompts listed in the <available_prompts> section of the system prompt.

Rules:
- key MUST be one of the <name> values listed in <available_prompts>. Do not invent keys.
- Returns the prompt content; use it to fulfill the user's request.`,
    schema: z.object({
      key: z
        .string()
        .describe('The prompt key exactly as listed in <available_prompts>. Do not invent keys.'),
    }),
    func: async ({ key }) => {
      const result = await handlePIToolCall(
        {
          name: 'read_prompt',
          arguments: { key },
          agentId: effectiveAgentId,
          sessionId,
        },
        undefined,
        undefined,
        undefined,
        userId,
      );

      if (!result.success) {
        return `Error: ${result.error}`;
      }
      return result.data?.content || '';
    },
  });

  const piReadTextFileTool = new DynamicStructuredTool({
    name: 'read_text_file',
    description: `Read the content of a text file from the user's file workspace.

Use this tool when you need the content of one of the files listed in the <attachments> section of the system prompt (also referenced by the user as [附件:filename] or [Attachment:filename]).

Rules:
- path MUST be one of the <path> values listed in <attachments> with kind="text", passed EXACTLY as listed (workspace-relative, e.g. report.txt, data/values.csv). Do not invent paths.
- NEVER call this tool on kind="binary" files (xlsx/xls, docx/pptx, pdf, png/jpg and other images, audio/video, zip and other archives): it only returns an error. Use execute_skill (preferred) or execute_code for those instead.
- Do NOT pass /mnt/data/... paths: that prefix only exists inside the execute_code sandbox, not in this workspace.
- Returns the file content; use it to fulfill the user's request.`,
    schema: z.object({
      path: z
        .string()
        .describe(
          'The file path exactly as listed in <attachments> of the system prompt. Do not invent paths.',
        ),
    }),
    func: async ({ path: filePath }) => {
      const result = await readPiTextFile(
        {
          agentId: effectiveAgentId,
          sessionId,
          path: filePath,
        },
        userId,
      );

      if (!result.success) {
        return `Error: ${result.error}`;
      }
      return result.data?.content || '';
    },
  });

  tools.push(piExecuteSkillTool, piReadPromptTool, piReadTextFileTool);
  return tools;
};

/**
 * Validates the availability and authentication of tools for a user based on environment variables or user-specific plugin authentication values.
 * Tools without required authentication or with valid authentication are considered valid.
 *
 * @param {Object} user The user object for whom to validate tool access.
 * @param {Array<string>} tools An array of tool identifiers to validate. Defaults to an empty array.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of valid tool identifiers.
 */
const validateTools = async (user, tools = []) => {
  try {
    const validToolsSet = new Set(tools);
    const availableToolsToValidate = availableTools.filter((tool) =>
      validToolsSet.has(tool.pluginKey),
    );

    /**
     * Validates the credentials for a given auth field or set of alternate auth fields for a tool.
     * If valid admin or user authentication is found, the function returns early. Otherwise, it removes the tool from the set of valid tools.
     *
     * @param {string} authField The authentication field or fields (separated by "||" for alternates) to validate.
     * @param {string} toolName The identifier of the tool being validated.
     */
    const validateCredentials = async (authField, toolName) => {
      const fields = authField.split('||');
      for (const field of fields) {
        const adminAuth = process.env[field];
        if (adminAuth && adminAuth.length > 0) {
          return;
        }

        let userAuth = null;
        try {
          userAuth = await getUserPluginAuthValue(user, field);
        } catch (err) {
          if (field === fields[fields.length - 1] && !userAuth) {
            throw err;
          }
        }
        if (userAuth && userAuth.length > 0) {
          return;
        }
      }

      validToolsSet.delete(toolName);
    };

    for (const tool of availableToolsToValidate) {
      if (!tool.authConfig || tool.authConfig.length === 0) {
        continue;
      }

      for (const auth of tool.authConfig) {
        await validateCredentials(auth.authField, tool.pluginKey);
      }
    }

    return Array.from(validToolsSet.values());
  } catch (err) {
    logger.error('[validateTools] There was a problem validating tools', err);
    throw new Error(err);
  }
};

/** @typedef {typeof import('@langchain/core/tools').Tool} ToolConstructor */
/** @typedef {import('@langchain/core/tools').Tool} Tool */

/**
 * Initializes a tool with authentication values for the given user, supporting alternate authentication fields.
 * Authentication fields can have alternates separated by "||", and the first defined variable will be used.
 *
 * @param {string} userId The user ID for which the tool is being loaded.
 * @param {Array<string>} authFields Array of strings representing the authentication fields. Supports alternate fields delimited by "||".
 * @param {ToolConstructor} ToolConstructor The constructor function for the tool to be initialized.
 * @param {Object} options Optional parameters to be passed to the tool constructor alongside authentication values.
 * @returns {() => Promise<Tool>} An Async function that, when called, asynchronously initializes and returns an instance of the tool with authentication.
 */
const loadToolWithAuth = (userId, authFields, ToolConstructor, options = {}) => {
  return async function () {
    const authValues = await loadAuthValues({ userId, authFields });
    return new ToolConstructor({ ...options, ...authValues, userId });
  };
};

/**
 * @param {string} toolKey
 * @returns {Array<string>}
 */
const getAuthFields = (toolKey) => {
  return manifestToolMap[toolKey]?.authConfig.map((auth) => auth.authField) ?? [];
};

/**
 *
 * @param {object} params
 * @param {string} params.user
 * @param {Record<string, Record<string, string>>} [object.userMCPAuthMap]
 * @param {AbortSignal} [object.signal]
 * @param {Pick<Agent, 'id' | 'provider' | 'model'>} [params.agent]
 * @param {string} [params.model]
 * @param {EModelEndpoint} [params.endpoint]
 * @param {LoadToolOptions} [params.options]
 * @param {boolean} [params.useSpecs]
 * @param {Array<string>} params.tools
 * @param {boolean} [params.functions]
 * @param {boolean} [params.returnMap]
 * @param {AppConfig['webSearch']} [params.webSearch]
 * @param {AppConfig['fileStrategy']} [params.fileStrategy]
 * @param {AppConfig['imageOutputType']} [params.imageOutputType]
 * @returns {Promise<{ loadedTools: Tool[], toolContextMap: Object<string, any> } | Record<string,Tool>>}
 */
const loadTools = async ({
  user,
  agent,
  model,
  signal,
  endpoint,
  userMCPAuthMap,
  tools = [],
  options = {},
  functions = true,
  returnMap = false,
  webSearch,
  fileStrategy,
  imageOutputType,
}) => {
  const toolConstructors = {
    flux: FluxAPI,
    calculator: Calculator,
    google: GoogleSearchAPI,
    open_weather: OpenWeather,
    wolfram: StructuredWolfram,
    'stable-diffusion': StructuredSD,
    'azure-ai-search': StructuredACS,
    traversaal_search: TraversaalSearch,
    tavily_search_results_json: TavilySearchResults,
  };

  const customConstructors = {
    image_gen_oai: async (toolContextMap) => {
      const authFields = getAuthFields('image_gen_oai');
      const authValues = await loadAuthValues({ userId: user, authFields });
      const imageFiles = options.tool_resources?.[EToolResources.image_edit]?.files ?? [];
      const toolContext = buildImageToolContext({
        imageFiles,
        toolName: `${EToolResources.image_edit}_oai`,
        contextDescription: 'image editing',
      });
      if (toolContext) {
        toolContextMap.image_edit_oai = toolContext;
      }
      return createOpenAIImageTools({
        ...authValues,
        isAgent: !!agent,
        req: options.req,
        imageOutputType,
        fileStrategy,
        imageFiles,
      });
    },
    gemini_image_gen: async (toolContextMap) => {
      const authFields = getAuthFields('gemini_image_gen');
      const authValues = await loadAuthValues({ userId: user, authFields, throwError: false });
      const imageFiles = options.tool_resources?.[EToolResources.image_edit]?.files ?? [];
      const toolContext = buildImageToolContext({
        imageFiles,
        toolName: 'gemini_image_gen',
        contextDescription: 'image context',
      });
      if (toolContext) {
        toolContextMap.gemini_image_gen = toolContext;
      }
      return createGeminiImageTool({
        ...authValues,
        isAgent: !!agent,
        req: options.req,
        imageFiles,
        userId: user,
        fileStrategy,
      });
    },
  };

  const requestedTools = {};

  if (functions === true) {
    toolConstructors.dalle = DALLE3;
  }

  /** @type {ImageGenOptions} */
  const imageGenOptions = {
    isAgent: !!agent,
    req: options.req,
    fileStrategy,
    processFileURL: options.processFileURL,
    returnMetadata: options.returnMetadata,
    uploadImageBuffer: options.uploadImageBuffer,
  };

  const toolOptions = {
    flux: imageGenOptions,
    dalle: imageGenOptions,
    'stable-diffusion': imageGenOptions,
    gemini_image_gen: imageGenOptions,
  };

  /** @type {Record<string, string>} */
  const toolContextMap = {};
  const requestedMCPTools = {};

  const piTools = isPIConfigured(options.req)
    ? createPITools({
        streamId: options.req?._resumableStreamId,
        res: options.res,
        req: options.req,
        agentId: agent?.id,
        conversationId: options.conversationId,
        userId: typeof user === 'string' ? user : (user?.id ?? options.req?.user?.id),
      })
    : [];
  const piToolNames = new Set(piTools.map((t) => t.name));

  for (const tool of tools) {
    if (piToolNames.has(tool)) {
      const piTool = piTools.find((t) => t.name === tool);
      if (piTool) {
        requestedTools[tool] = async () => piTool;
      }
      continue;
    }

    if (tool === Tools.execute_code) {
      requestedTools[tool] = async () => {
        const authValues = await loadAuthValues({
          userId: user,
          authFields: [EnvVar.CODE_API_KEY],
        });
        const codeApiKey = authValues[EnvVar.CODE_API_KEY];
        const { files, toolContext } = await primeCodeFiles(
          {
            ...options,
            agentId: agent?.id,
          },
          codeApiKey,
        );
        if (toolContext) {
          toolContextMap[tool] = toolContext;
        }
        const CodeExecutionTool = createCodeExecutionTool({
          user_id: user,
          files,
          ...authValues,
        });
        CodeExecutionTool.apiKey = codeApiKey;
        return CodeExecutionTool;
      };
      continue;
    } else if (tool === Tools.file_search) {
      requestedTools[tool] = async () => {
        const { files, toolContext } = await primeSearchFiles({
          ...options,
          agentId: agent?.id,
        });
        if (toolContext) {
          toolContextMap[tool] = toolContext;
        }

        /** @type {boolean | undefined} Check if user has FILE_CITATIONS permission */
        let fileCitations;
        if (fileCitations == null && options.req?.user != null) {
          try {
            fileCitations = await checkAccess({
              user: options.req.user,
              permissionType: PermissionTypes.FILE_CITATIONS,
              permissions: [Permissions.USE],
              getRoleByName,
            });
          } catch (error) {
            logger.error('[handleTools] FILE_CITATIONS permission check failed:', error);
            fileCitations = false;
          }
        }

        return createFileSearchTool({
          userId: user,
          files,
          entity_id: agent?.id,
          fileCitations,
        });
      };
      continue;
    } else if (tool === Tools.web_search) {
      const result = await loadWebSearchAuth({
        userId: user,
        loadAuthValues,
        webSearchConfig: webSearch,
      });
      const { onSearchResults, onGetHighlights } = options?.[Tools.web_search] ?? {};
      requestedTools[tool] = async () => {
        toolContextMap[tool] = buildWebSearchContext();
        return createSearchTool({
          ...result.authResult,
          onSearchResults,
          onGetHighlights,
          logger,
        });
      };
      continue;
    } else if (tool && mcpToolPattern.test(tool)) {
      const [toolName, serverName] = tool.split(Constants.mcp_delimiter);
      if (toolName === Constants.mcp_server) {
        /** Placeholder used for UI purposes */
        continue;
      }
      const serverConfig = serverName
        ? await getMCPServersRegistry().getServerConfig(serverName, user)
        : null;
      if (!serverConfig) {
        logger.warn(
          `MCP server "${serverName}" for "${toolName}" tool is not configured${agent?.id != null && agent.id ? ` but attached to "${agent.id}"` : ''}`,
        );
        continue;
      }
      if (toolName === Constants.mcp_all) {
        requestedMCPTools[serverName] = [
          {
            type: 'all',
            serverName,
            config: serverConfig,
          },
        ];
        continue;
      }

      requestedMCPTools[serverName] = requestedMCPTools[serverName] || [];
      requestedMCPTools[serverName].push({
        type: 'single',
        toolKey: tool,
        serverName,
        config: serverConfig,
      });
      continue;
    }

    if (customConstructors[tool]) {
      requestedTools[tool] = async () => customConstructors[tool](toolContextMap);
      continue;
    }

    if (toolConstructors[tool]) {
      const options = toolOptions[tool] || {};
      const toolInstance = loadToolWithAuth(
        user,
        getAuthFields(tool),
        toolConstructors[tool],
        options,
      );
      requestedTools[tool] = toolInstance;
      continue;
    }
  }

  if (returnMap) {
    return requestedTools;
  }

  const toolPromises = [];
  for (const tool of tools) {
    const validTool = requestedTools[tool];
    if (validTool) {
      toolPromises.push(
        validTool().catch((error) => {
          logger.error(`Error loading tool ${tool}:`, error);
          return null;
        }),
      );
    }
  }

  const loadedTools = (await Promise.all(toolPromises)).flatMap((plugin) => plugin || []);
  const mcpToolPromises = [];
  /** MCP server tools are initialized sequentially by server */
  let index = -1;
  const failedMCPServers = new Set();
  const safeUser = createSafeUser(options.req?.user);
  for (const [serverName, toolConfigs] of Object.entries(requestedMCPTools)) {
    index++;
    /** @type {LCAvailableTools} */
    let availableTools;
    for (const config of toolConfigs) {
      try {
        if (failedMCPServers.has(serverName)) {
          continue;
        }
        const mcpParams = {
          index,
          signal,
          user: safeUser,
          userMCPAuthMap,
          res: options.res,
          streamId: options.req?._resumableStreamId || null,
          model: agent?.model ?? model,
          serverName: config.serverName,
          provider: agent?.provider ?? endpoint,
          config: config.config,
        };

        if (config.type === 'all' && toolConfigs.length === 1) {
          /** Handle async loading for single 'all' tool config */
          mcpToolPromises.push(
            createMCPTools(mcpParams).catch((error) => {
              logger.error(`Error loading ${serverName} tools:`, error);
              return null;
            }),
          );
          continue;
        }
        if (!availableTools) {
          try {
            availableTools = await getMCPServerTools(safeUser.id, serverName);
          } catch (error) {
            logger.error(`Error fetching available tools for MCP server ${serverName}:`, error);
          }
        }

        /** Handle synchronous loading */
        const mcpTool =
          config.type === 'all'
            ? await createMCPTools(mcpParams)
            : await createMCPTool({
                ...mcpParams,
                availableTools,
                toolKey: config.toolKey,
              });

        if (Array.isArray(mcpTool)) {
          loadedTools.push(...mcpTool);
        } else if (mcpTool) {
          loadedTools.push(mcpTool);
        } else {
          failedMCPServers.add(serverName);
          logger.warn(
            `MCP tool creation failed for "${config.toolKey}", server may be unavailable or unauthenticated.`,
          );
        }
      } catch (error) {
        logger.error(`Error loading MCP tool for server ${serverName}:`, error);
      }
    }
  }
  loadedTools.push(...(await Promise.all(mcpToolPromises)).flatMap((plugin) => plugin || []));
  return { loadedTools, toolContextMap };
};

module.exports = {
  loadToolWithAuth,
  validateTools,
  loadTools,
};
