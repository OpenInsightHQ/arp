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
const { isPIConfigured, handlePIToolCall, downloadPIFile } = require('~/server/services/PIService');
const { DynamicStructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');
const { getRoleByName } = require('~/models/Role');
const { createFile } = require('~/models');
const { GallerySqlQuery, GalleryVersion } = require('~/models');
const { GalleryArtifact } = require('~/models/GalleryArtifact');

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const MAX_PI_FILE_SIZE_BYTES = parseInt(process.env.PI_UPLOAD_LIMIT_MB || '1024', 10) * 1024 * 1024;

const pathSeparatorRegex = /[\\/\0]/;

const sanitizeFileName = (name) => path.basename(name).replace(/[\\/:*?"<>|]/g, '_');

const downloadAndSavePIFiles = async (generatedFiles, userId) => {
  if (!generatedFiles || generatedFiles.length === 0) {
    return [];
  }

  const savedFiles = [];

  for (const fileInfo of generatedFiles) {
    try {
      const downloadResult = await downloadPIFile(
        {
          sessionId: fileInfo.sessionId,
          filename: fileInfo.name,
          agentId: fileInfo.agentId,
        },
        userId,
      );

      if (!downloadResult.success) {
        logger.error(
          `[downloadAndSavePIFiles] Failed to download ${fileInfo.name}: ${downloadResult.error}`,
        );
        continue;
      }

      const buffer = downloadResult.data.buffer;
      const mimeType =
        downloadResult.data.mimeType || fileInfo.mimeType || 'application/octet-stream';

      if (buffer.length > MAX_PI_FILE_SIZE_BYTES) {
        logger.error(
          `[downloadAndSavePIFiles] File "${fileInfo.name}" (${buffer.length} bytes) exceeds max size of ${MAX_PI_FILE_SIZE_BYTES} bytes`,
        );
        continue;
      }

      if (pathSeparatorRegex.test(userId)) {
        logger.error(`[downloadAndSavePIFiles] Invalid userId: ${userId}`);
        continue;
      }

      const safeName = sanitizeFileName(fileInfo.name);
      const fileId = uuidv4();
      const filename = `${fileId}_${safeName}`;

      const uploadPath = path.join('uploads', userId, filename);
      const uploadDir = path.dirname(uploadPath);

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      fs.writeFileSync(uploadPath, buffer);

      const fileRecord = await createFile({
        file_id: fileId,
        user: userId,
        filename: fileInfo.name,
        filepath: `/uploads/${userId}/${filename}`,
        type: mimeType,
        bytes: buffer.length,
        source: 'local',
        context: 'pi_generated',
        metadata: {
          originalName: fileInfo.name,
          mimeType,
          size: fileInfo.size,
        },
      });

      savedFiles.push({
        file_id: fileId,
        filename: fileInfo.name,
        filepath: `/uploads/${userId}/${filename}`,
        type: mimeType,
        size: buffer.length,
      });
    } catch (error) {
      logger.error(`[downloadAndSavePIFiles] Error processing ${fileInfo.name}:`, error);
    }
  }

  return savedFiles;
};

const createPITools = (options = {}) => {
  const tools = [];

  if (!isPIConfigured()) {
    return tools;
  }

  const { streamId, res, agentId, conversationId, userId } = options;
  const effectiveAgentId = agentId || 'default';
  const sessionId = conversationId || undefined;

  /**
   * Resolve the current message-tree leaf for pi-side persistence.
   * At tool-execution time the outer agent's reply for this turn is not yet
   * saved, so pi must mount its messages under the in-flight responseMessageId
   * (stored in the generation job metadata by onStart) instead of guessing
   * "last message" — otherwise the pi subtree forks the message tree.
   */
  const resolveParentMessageId = async () => {
    if (!streamId) {
      return undefined;
    }
    try {
      const job = await GenerationJobManager.getJob(streamId);
      return job?.metadata?.responseMessageId || undefined;
    } catch (err) {
      logger.debug('[PITools] Failed to resolve responseMessageId from job:', err.message);
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

  const emitAttachment = async (attachment) => {
    if (streamId) {
      try {
        await GenerationJobManager.emitChunk(streamId, {
          event: 'attachment',
          data: attachment,
        });
      } catch (err) {
        logger.error('[PITools] Failed to emit attachment:', err.message);
      }
    }
  };

  const formatResult = (result, savedFiles) => {
    if (!result.success) {
      return `Error: ${result.error}`;
    }

    const data = result.data;
    let output = data.message || '';

    if (savedFiles && savedFiles.length > 0) {
      output += '\n\n**Generated Files:**\n';
      for (const file of savedFiles) {
        output += `- **${file.filename}**`;
        if (file.size) {
          output += ` (${(file.size / 1024).toFixed(2)} KB)`;
        }
        if (file.filepath) {
          output += `\n  Download: ${file.filepath}`;
        }
        output += '\n';
      }
    } else if (data.generatedFiles && data.generatedFiles.length > 0) {
      output += '\n\n**Generated Files:**\n';
      for (const file of data.generatedFiles) {
        output += `- ${file.name}`;
        if (file.size) {
          output += ` (${(file.size / 1024).toFixed(2)} KB)`;
        }
        if (file.url) {
          output += `\n  URL: ${file.url}`;
        }
        output += '\n';
      }
    }

    return output;
  };

  const piGenerateDocumentTool = new DynamicStructuredTool({
    name: 'office_skills',
    description: `Create or modify office files(docx, xlsx, pptx, pdf).

Use this tool for office files(docx, xlsx, pptx, pdf) operations - simply pass the user's original request directly:
- Create new documents (docx, xlsx, pptx, pdf)
- Modify existing documents
- Add content to documents
- Update specific sections, lines, or chapters
- Delete content from documents
- Generate SVG graphics

DO NOT use this tool for generating HTML pages or reports. Use the :::artifact{}::: syntax to output HTML directly.

DO NOT interpret or restructure the user's request. Pass the user's original message directly as the 'request' parameter.

PI will handle the file operation automatically - it can create new documents, modify existing documents, or append to documents based on the user's request.`,
    schema: z.object({
      request: z
        .string()
        .describe(
          'The user request - describe what document to create/modify (docx, xlsx, pptx, pdf). Pass it exactly as stated without modification.',
        ),
    }),
    func: async (input) => {
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
          name: 'office_skills',
          arguments: {
            request: input.request,
          },
          agentId: effectiveAgentId,
          sessionId,
        },
        onChunk,
        onThinking,
        onToolEvent,
        userId,
      );

      const savedFiles =
        result.success && result.data?.generatedFiles?.length > 0
          ? await downloadAndSavePIFiles(result.data.generatedFiles, userId)
          : [];

      for (const file of savedFiles) {
        await emitAttachment({
          messageId: streamId,
          file_id: file.file_id,
          filename: file.filename,
          filepath: file.filepath,
          type: file.type,
          size: file.size,
        });
      }

      return formatResult(result, savedFiles);
    },
  });

  tools.push(piGenerateDocumentTool);

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
        if (file.url) {
          output += `\n  Download: ${file.url}`;
        }
        output += '\n';
      }
    }

    return output;
  };

  const piExecuteSkillTool = new DynamicStructuredTool({
    name: 'execute_skill',
    description: `Execute a registered skill by name.

Use this tool when the user's request matches one of the skills listed in the <available_skills> section of the system prompt (match by the skill description's usage cues).

Rules:
- skillName MUST be one of the names listed in <available_skills>.
- Pass the user's request in 'input' exactly as stated, without interpretation or restructuring.
- The skill runs asynchronously and returns its final output and any generated files.`,
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
        },
        onChunk,
        onThinking,
        onToolEvent,
        userId,
      );

      return formatSkillResult(result);
    },
  });

  tools.push(piExecuteSkillTool);
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
