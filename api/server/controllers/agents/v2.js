const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { nanoid } = require('nanoid');
const { logger } = require('@librechat/data-schemas');
const {
  Callback,
  ToolEndHandler,
  formatAgentMessages,
  createContentAggregator,
  GraphEvents,
} = require('@librechat/agents');
const { EModelEndpoint, VisionModes } = require('librechat-data-provider');
const {
  writeSSE,
  createRun,
  createChunk,
  buildToolSet,
  sendFinalChunk,
  createSafeUser,
  validateRequest,
  initializeAgent,
  getBalanceConfig,
  createErrorResponse,
  recordCollectedUsage,
  getTransactionsConfig,
  createToolExecuteHandler,
  buildNonStreamingResponse,
  createOpenAIStreamTracker,
  createOpenAIContentAggregator,
  filterMalformedContentParts,
  createTimestampTracker,
  healMessagePayload,
  normalizeArtifactStream,
  isChatCompletionValidationFailure,
  extractToolCallIds,
  extractCacheTokens,
  inputTokensExcludeCache,
  applyCollectedUsageToContentParts,
  createTokenCounter,
  getLangFromReq,
} = require('@librechat/api');
const { loadAgentTools, loadToolsForExecution } = require('~/server/services/ToolService');
const { createToolEndCallback } = require('~/server/controllers/agents/callbacks');
const {
  isStreamLogEnabled,
  createStreamLogCollector,
  wrapResponseWrite,
} = require('~/server/services/StreamLog');
const { spendTokens, spendStructuredTokens } = require('~/models/spendTokens');
const { getConvo, getConvoFiles, searchConversation } = require('~/models/Conversation');
const { getAgent } = require('~/models/Agent');
const {
  summarizeOnRecursionLimit,
  formatInProgressAgentOutputs,
  EMPTY_AGENT_OUTPUTS_TEXT,
  buildFallbackSummary,
} = require('./summary');
const {
  FinishReason,
  isRecursionLimitError,
  getErrorFinishReason,
  getSuccessFinishReason,
  buildErrorMetadata,
  contentPartsContainToolCall,
} = require('./finishReason');
const db = require('~/models');
const { sanitizeReflectedFields, sendJsonResponse } = require('~/server/utils/sanitize');
const { runPIChatWithPersistence } = require('./piPersistence');
const { isPIConfigured, listPiFiles } = require('~/server/services/PIService');
const { appendPiFileLinks } = require('~/server/services/PiFileFooter');
const { encodeAndFormat } = require('~/server/services/Files/images/encode');
const { getThreadMessages, convertHistoryMessage } = require('./v2History');

const DMP_HOST = process.env.DMP_HOST || '';
const DMP_API_KEY = process.env.DMP_API_KEY || '';

const NO_PARENT = '00000000-0000-0000-0000-000000000000';

async function resolveUserByThirdPartyId(thirdPartyUserId) {
  if (!DMP_HOST) {
    throw new Error('DMP_HOST is not configured');
  }
  const url = `${DMP_HOST}/open-api/system/user/get-by-third-party-user-id`;
  const response = await axios.get(url, {
    params: { thirdPartyUserId },
    headers: { 'api-key': DMP_API_KEY },
  });
  if (!response.data?.data) {
    throw new Error(`User not found for third-party user ID: ${thirdPartyUserId}`);
  }
  return response.data.data;
}

function createToolLoader(signal, definitionsOnly = true) {
  return async function loadTools({
    req,
    res,
    tools,
    model,
    agentId,
    provider,
    tool_options,
    tool_resources,
    skills,
    knowledgePromptKeys,
  }) {
    const agent = {
      id: agentId,
      tools,
      provider,
      model,
      tool_options,
      skills,
      knowledgePromptKeys,
    };
    try {
      return await loadAgentTools({
        req,
        res,
        agent,
        signal,
        tool_resources,
        definitionsOnly,
        streamId: null,
      });
    } catch (error) {
      logger.error('Error loading tools for agent ' + agentId, error);
    }
  };
}

function convertContentPart(part) {
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }
  if (part.type === 'image_url') {
    return { type: 'image_url', image_url: part.image_url };
  }
  return part;
}

function convertMessages(messages) {
  return messages.map((msg) => {
    let content;
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (msg.content) {
      content = msg.content.map(convertContentPart);
    } else {
      content = '';
    }
    return {
      role: msg.role,
      content,
      ...(msg.name && { name: msg.name }),
      ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
      ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
    };
  });
}

function sendErrorResponse(res, statusCode, message, type = 'invalid_request_error', code = null) {
  res.status(statusCode).json(createErrorResponse(message, type, code));
}

/**
 * Encode thread user messages' image attachments into OpenAI image_url parts.
 * All file docs are fetched in ONE query; per-message encoding failures
 * degrade to text-only history.
 * @param {ServerRequest} req
 * @param {TMessage[]} threadMessages
 * @param {string} provider
 * @returns {Promise<Map<string, object[]>>} messageId → image_url parts
 */
async function loadHistoryImages(req, threadMessages, provider) {
  const userMessagesWithFiles = threadMessages.filter(
    (msg) => msg.isCreatedByUser && Array.isArray(msg.files) && msg.files.length > 0,
  );
  if (userMessagesWithFiles.length === 0) {
    return new Map();
  }

  let files;
  try {
    const fileIds = userMessagesWithFiles.flatMap((msg) =>
      msg.files.map((file) => file?.file_id).filter(Boolean),
    );
    files = fileIds.length > 0 ? ((await db.getFiles({ file_id: { $in: fileIds } })) ?? []) : [];
  } catch (error) {
    logger.warn('[V2 API] Failed to load history files:', error?.message);
    return new Map();
  }

  const fileById = new Map(files.map((file) => [file.file_id, file]));
  const imageUrlsByMessage = new Map();
  for (const msg of userMessagesWithFiles) {
    const imageFiles = msg.files
      .map((file) => fileById.get(file?.file_id))
      .filter((file) => file && String(file.type ?? '').startsWith('image/'));
    if (imageFiles.length === 0) {
      continue;
    }
    try {
      const { image_urls } = await encodeAndFormat(
        req,
        imageFiles,
        { provider },
        VisionModes.agents,
      );
      if (image_urls.length > 0) {
        imageUrlsByMessage.set(msg.messageId, image_urls);
      }
    } catch (error) {
      logger.warn(`[V2 API] Failed to encode history images for ${msg.messageId}:`, error?.message);
    }
  }
  return imageUrlsByMessage;
}

/**
 * Load the conversation thread ending at `parentMessageId` (parent-chain
 * traversal, branch-safe) as OpenAI-format messages with image attachments.
 */
async function loadConversationMessages(
  req,
  conversationId,
  userSn,
  parentMessageId,
  provider,
  { includeImages = true } = {},
) {
  const messages = await db.getMessages({ conversationId, user: userSn });
  if (!messages || messages.length === 0) {
    return [];
  }
  const threadMessages = getThreadMessages(messages, parentMessageId);
  if (threadMessages.length === 0) {
    return [];
  }
  const imageUrlsByMessage = includeImages
    ? await loadHistoryImages(req, threadMessages, provider)
    : new Map();
  return threadMessages.flatMap((msg) =>
    convertHistoryMessage(msg, imageUrlsByMessage.get(msg.messageId)),
  );
}

async function getLastMessageId(conversationId, userSn) {
  const messages = await db.getMessages({ conversationId, user: userSn }, 'messageId');
  if (!messages || messages.length === 0) {
    return NO_PARENT;
  }
  return messages[messages.length - 1].messageId;
}

function extractTextFromMessages(messages) {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
}

/**
 * Resolve v2-specific request context: third-party user ID → userSn (via DMP),
 * and conversation ID (with UUID generation for new conversations).
 *
 * Shared between the normal V2 agent flow and the v2 PI bypass
 * (model === PI_AGENT_ID), since both belong to the /api/agents/v2 interface.
 *
 * On validation/auth failure, sends an error response and returns null.
 *
 * @returns {Promise<{ userSn: string, conversationId: string, isNewConversation: boolean } | null>}
 */
async function resolveV2Context(req, res) {
  const thirdPartyUserId = req.headers['x-user-id'] || req.body?.user_id;
  if (!thirdPartyUserId) {
    sendErrorResponse(
      res,
      400,
      'X-User-Id header or user_id in body is required',
      'invalid_request_error',
      'missing_user_id',
    );
    return null;
  }

  let userSn;
  try {
    const dmpUserData = await resolveUserByThirdPartyId(thirdPartyUserId);
    userSn = dmpUserData.userSn;
    if (!userSn) {
      sendErrorResponse(
        res,
        400,
        'userSn not found in DMP user data',
        'invalid_request_error',
        'invalid_user',
      );
      return null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve user';
    logger.error('[V2 API] Error resolving user:', error);
    sendErrorResponse(res, 401, message, 'auth_error', 'user_resolution_failed');
    return null;
  }

  let conversationId = req.headers['x-conversation-id'] || req.body?.conversation_id;
  let isNewConversation = true;
  if (conversationId) {
    const existingConvo = await searchConversation(conversationId);
    isNewConversation = !existingConvo;
  }
  if (isNewConversation) {
    conversationId = conversationId || uuidv4();
  }

  res.setHeader('X-Conversation-Id', conversationId);

  return { userSn, conversationId, isNewConversation };
}

const V2ChatCompletionController = async (req, res) => {
  const appConfig = req.config;
  const requestStartTime = Date.now();

  const ctx = await resolveV2Context(req, res);
  if (!ctx) {
    return;
  }
  const { userSn, conversationId, isNewConversation } = ctx;

  /*
    API-key auth populated req.user with the KEY OWNER — that identity is only
    for the route-level validation that has already run. From here on the
    acting user is the v2 user resolved from X-User-Id/user_id, so everything
    keying off req.user downstream (agent init, tool loading, prompt special
    vars, PI workspace, artifacts, credentials) acts as the correct user.
  */
  req.user = { ...req.user, id: userSn };

  const validation = validateRequest(req.body);
  if (isChatCompletionValidationFailure(validation)) {
    return sendErrorResponse(res, 400, validation.error);
  }

  const request = validation.request;
  const agentId = request.model;

  const agent = await getAgent({ id: agentId });
  if (!agent) {
    return sendErrorResponse(
      res,
      404,
      `Agent not found: ${agentId}`,
      'invalid_request_error',
      'model_not_found',
    );
  }

  // ===== Normal Agent flow =====
  const userMessageId = nanoid();
  const responseMessageId = `chatcmpl-${nanoid()}`;
  const created = Math.floor(Date.now() / 1000);

  let parentMessageId = NO_PARENT;
  if (!isNewConversation) {
    parentMessageId = request.parent_message_id ?? (await getLastMessageId(conversationId, userSn));
  }

  const context = {
    created,
    requestId: responseMessageId,
    model: agentId,
  };

  logger.debug(
    `[V2 API] Request ${responseMessageId} started for agent ${agentId}, stream: ${request.stream}, conversationId: ${conversationId}, isNew: ${isNewConversation}`,
  );

  const abortController = new AbortController();

  req.on('close', () => {
    if (!abortController.signal.aborted) {
      abortController.abort();
      logger.debug('[V2 API] Client disconnected, aborting');
    }
  });

  const textChunks = [];
  const reasoningChunks = [];

  let run = null;
  let handlerConfig = null;
  /** @type {import('~/server/services/StreamLog').StreamLogCollector | null} */
  let streamLogCollector = null;
  let contentParts = [];
  let timestampTracker = createTimestampTracker();
  const recursionLimit = agent.recursion_limit ?? 50;
  let maxAgentStep = 0;
  const collectedUsage = [];

  try {
    const allowedProviders = new Set(
      appConfig?.endpoints?.[EModelEndpoint.agents]?.allowedProviders,
    );

    const loadTools = createToolLoader(abortController.signal);

    const endpointOption = {
      endpoint: agent.provider,
      model_parameters: agent.model_parameters ?? {},
    };

    /**
     * PI workspace attachments: fetch the conversation's PI workspace
     * inventory once via the canonical listPiFiles (same as the frontend
     * agent flow); initializeAgent turns it into the <attachments> prompt
     * section and mounts read_text_file. Keyed by the v2 user (userSn) —
     * the same id PI tool execution uses on this path (req.user.id).
     */
    let piAttachmentFiles;
    if (isPIConfigured(req) && conversationId) {
      piAttachmentFiles = await listPiFiles(agent.id, conversationId, userSn);
    }

    // PI-side persistence key: pi mounts its subtree under the in-flight
    // response message id (no generation job on this path)
    req._piResponseMessageId = responseMessageId;

    const primaryConfig = await initializeAgent(
      {
        req,
        res,
        loadTools,
        requestFiles: [],
        conversationId,
        parentMessageId,
        agent,
        endpointOption,
        allowedProviders,
        isInitialAgent: true,
        piAttachmentFiles,
      },
      {
        getConvoFiles,
        getFiles: db.getFiles,
        getUserKey: db.getUserKey,
        getMessages: db.getMessages,
        updateFilesUsage: db.updateFilesUsage,
        getUserKeyValues: db.getUserKeyValues,
        getUserCodeFiles: db.getUserCodeFiles,
        getToolFilesByIds: db.getToolFilesByIds,
        getCodeGeneratedFiles: db.getCodeGeneratedFiles,
      },
    );

    /**
     * Stash the primary agent's final system prompt (instructions +
     * additional_instructions as mutated by initializeAgent with
     * <attachments>/<available_skills>/<available_prompts>) so execute_skill
     * forwards the agent's EXACT prompt to pi (no generation job on this path).
     */
    const piAgentSystemPrompt = [agent.instructions, agent.additional_instructions]
      .filter(Boolean)
      .join('\n\n')
      .trim();
    if (piAgentSystemPrompt) {
      req._piAgentSystemPrompt = piAgentSystemPrompt;
    }

    const streamingDisabled = !!primaryConfig.model_parameters?.disableStreaming;
    const isStreaming = request.stream === true && !streamingDisabled;

    streamLogCollector = isStreamLogEnabled() ? createStreamLogCollector() : null;
    if (isStreaming && streamLogCollector) {
      wrapResponseWrite(res, streamLogCollector);
    }

    const tracker = isStreaming ? createOpenAIStreamTracker() : null;
    const aggregator = isStreaming ? null : createOpenAIContentAggregator();
    const aggregatorObj = createContentAggregator();
    contentParts = aggregatorObj.contentParts;
    const aggregateContent = aggregatorObj.aggregateContent;

    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const initialChunk = createChunk(context, { role: 'assistant' });
      writeSSE(res, initialChunk);
    }

    handlerConfig = isStreaming
      ? {
          res,
          context,
          tracker,
        }
      : null;

    const artifactPromises = [];

    const toolEndCallback = createToolEndCallback({ req, res, artifactPromises, streamId: null });

    const toolExecuteOptions = {
      loadTools: async (toolNames) => {
        return loadToolsForExecution({
          req,
          res,
          agent,
          toolNames,
          signal: abortController.signal,
          toolRegistry: primaryConfig.toolRegistry,
          userMCPAuthMap: primaryConfig.userMCPAuthMap,
          tool_resources: primaryConfig.tool_resources,
          conversationId,
        });
      },
      toolEndCallback,
    };

    let openaiMessages = convertMessages(request.messages);

    if (!isNewConversation) {
      const historyMessages = await loadConversationMessages(
        req,
        conversationId,
        userSn,
        parentMessageId,
        agent.provider,
      );
      if (historyMessages.length > 0) {
        openaiMessages = [...historyMessages, ...openaiMessages];
      }
    }

    const toolSet = buildToolSet(primaryConfig);
    const { messages: formattedMessages, indexTokenCountMap } = formatAgentMessages(
      openaiMessages,
      {},
      toolSet,
    );

    const createHandler = (processor) => ({
      handle: (event, data, metadata) => {
        const step = Number(metadata?.langgraph_step);
        if (Number.isFinite(step) && step > maxAgentStep) {
          maxAgentStep = step;
        }
        if (processor) {
          processor(data);
        }
      },
    });

    const createAggregatingHandler = (eventName, processor) => ({
      handle: (event, data, metadata) => {
        const step = Number(metadata?.langgraph_step);
        if (Number.isFinite(step) && step > maxAgentStep) {
          maxAgentStep = step;
        }
        aggregateContent({ event: eventName, data });
        timestampTracker.markStart(contentParts);
        if (processor) {
          processor(data);
        }
      },
    });

    const streamText = (text) => {
      if (!text) {
        return;
      }
      textChunks.push(text);
      if (isStreaming) {
        tracker.addText();
        writeSSE(res, createChunk(context, { content: text }));
      } else {
        aggregator.addText(text);
      }
    };

    const streamReasoning = (text) => {
      if (!text) {
        return;
      }
      reasoningChunks.push(text);
      if (isStreaming) {
        tracker.addReasoning();
        writeSSE(res, createChunk(context, { reasoning: text }));
      } else {
        aggregator.addReasoning(text);
      }
    };

    const openaiHandlers = {
      on_message_delta: createAggregatingHandler(GraphEvents.ON_MESSAGE_DELTA, (data) => {
        const content = data?.delta?.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part.type === 'text' && part.text) {
              streamText(part.text);
            }
          }
        }
      }),

      on_reasoning_delta: createAggregatingHandler(GraphEvents.ON_REASONING_DELTA, (data) => {
        const content = data?.delta?.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            const text = part.think || part.text;
            if (text) {
              streamReasoning(text);
            }
          }
        }
      }),

      on_run_step: createAggregatingHandler(GraphEvents.ON_RUN_STEP, (data) => {
        const stepDetails = data?.stepDetails;
        if (stepDetails?.type === 'tool_calls' && stepDetails.tool_calls) {
          for (const tc of stepDetails.tool_calls) {
            const toolIndex = data.index ?? 0;
            const toolId = tc.id ?? '';
            const toolName = tc.name ?? '';
            const toolCall = {
              id: toolId,
              type: 'function',
              function: { name: toolName, arguments: '' },
            };

            if (isStreaming) {
              if (!tracker.toolCalls.has(toolIndex)) {
                tracker.toolCalls.set(toolIndex, toolCall);
              }
              writeSSE(
                res,
                createChunk(context, {
                  tool_calls: [{ index: toolIndex, ...toolCall }],
                }),
              );
            } else {
              if (!aggregator.toolCalls.has(toolIndex)) {
                aggregator.toolCalls.set(toolIndex, toolCall);
              }
            }
          }
        }
      }),

      on_run_step_delta: createAggregatingHandler(GraphEvents.ON_RUN_STEP_DELTA, (data) => {
        const delta = data?.delta;
        if (delta?.type === 'tool_calls' && delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const args = tc.args ?? '';
            if (!args) {
              continue;
            }

            const toolIndex = tc.index ?? 0;
            const targetMap = isStreaming ? tracker.toolCalls : aggregator.toolCalls;
            const tracked = targetMap.get(toolIndex);
            if (tracked) {
              tracked.function.arguments += args;
            }

            if (isStreaming) {
              writeSSE(
                res,
                createChunk(context, {
                  tool_calls: [
                    {
                      index: toolIndex,
                      function: { arguments: args },
                    },
                  ],
                }),
              );
            }
          }
        }
      }),

      on_chat_model_end: createHandler((data) => {
        const usage = data?.output?.usage_metadata;
        if (usage) {
          collectedUsage.push(usage);
          const target = isStreaming ? tracker : aggregator;
          target.usage.promptTokens += usage.input_tokens ?? 0;
          target.usage.completionTokens += usage.output_tokens ?? 0;
          usage.toolCallIds = extractToolCallIds(data?.output);
          const cacheTokens = extractCacheTokens(usage);
          usage.cacheCreationTokens = cacheTokens.cacheCreation;
          usage.cacheReadTokens = cacheTokens.cacheRead;
        }
      }),
      on_run_step_completed: {
        handle: (event, data, metadata) => {
          const step = Number(metadata?.langgraph_step);
          if (Number.isFinite(step) && step > maxAgentStep) {
            maxAgentStep = step;
          }
          aggregateContent({ event: GraphEvents.ON_RUN_STEP_COMPLETED, data });
          timestampTracker.markStart(contentParts);
          for (let i = contentParts.length - 1; i >= 0; i--) {
            const part = contentParts[i];
            if (
              part &&
              part.type === 'tool_call' &&
              part.tool_call &&
              part.tool_call.progress === 1
            ) {
              timestampTracker.markEnd(i);
              break;
            }
          }
        },
      },
      on_tool_end: new ToolEndHandler(toolEndCallback, logger),
      on_chain_stream: createHandler(),
      on_chain_end: createHandler(),
      on_agent_update: createHandler(),
      on_custom_event: createHandler(),
      on_tool_execute: createToolExecuteHandler(toolExecuteOptions),
    };

    const userMCPAuthMap = primaryConfig.userMCPAuthMap;

    // Check if the message contains SOLIDIFY context in HTML comment or legacy [固化报告] format
    // This is now logged for debugging purposes - tools are permanently available
    const userMessagesContent =
      request.messages
        ?.filter((m) => m.role === 'user')
        ?.map((m) => m.content)
        ?.join('\n') ?? '';

    // New format: parse HTML comment <!-- SOLIDIFY:base64json -->
    let solidificationMatch = userMessagesContent.match(/<!-- SOLIDIFY:([A-Za-z0-9+/=]+) -->/);

    if (solidificationMatch) {
      try {
        const context = JSON.parse(Buffer.from(solidificationMatch[1], 'base64').toString('utf8'));
        logger.debug(
          `[V2 API] Solidification request detected for artifact: ${context.artifactId}`,
        );
      } catch (parseErr) {
        logger.warn('[V2 API] Failed to parse SOLIDIFY context:', parseErr);
      }
    } else {
      // Legacy format check
      const legacyMatch = userMessagesContent.match(
        /^\[固化报告\](?:[\s\S]*?)targetMessageId:\s*([\w-]+)[\s\S]*?artifactId:\s*([\w-]+)/,
      );
      if (legacyMatch) {
        logger.debug(
          `[V2 API] Solidification request detected (legacy format) for artifact: ${legacyMatch[2]}`,
        );
      }
    }

    // No need to dynamically inject them here

    const requestLang = getLangFromReq(req);

    run = await createRun({
      agents: [primaryConfig],
      messages: formattedMessages,
      indexTokenCountMap,
      runId: responseMessageId,
      signal: abortController.signal,
      customHandlers: openaiHandlers,
      requestBody: {
        messageId: responseMessageId,
        conversationId,
        lang: requestLang,
      },
      user: { id: userSn },
      tokenCounter: createTokenCounter('o200k_base'),
    });

    if (!run) {
      throw new Error('Failed to create agent run');
    }

    const config = {
      runName: 'AgentRun',
      configurable: {
        thread_id: conversationId,
        user_id: userSn,
        user: createSafeUser(req.user),
        requestBody: {
          messageId: responseMessageId,
          conversationId,
          lang: requestLang,
        },
        ...(userMCPAuthMap != null && { userMCPAuthMap }),
      },
      signal: abortController.signal,
      streamMode: 'values',
      version: 'v2',
      recursionLimit,
    };

    await run.processStream({ messages: formattedMessages }, config, {
      callbacks: {
        [Callback.TOOL_ERROR]: (graph, error, toolId) => {
          logger.error(`[V2 API] Tool Error "${toolId}"`, error);
        },
      },
    });

    const balanceConfig = getBalanceConfig(appConfig);
    const transactionsConfig = getTransactionsConfig(appConfig);
    recordCollectedUsage(
      { spendTokens, spendStructuredTokens },
      {
        user: userSn,
        conversationId,
        collectedUsage,
        context: 'message',
        balance: balanceConfig,
        transactions: transactionsConfig,
        model: primaryConfig.model || agent.model_parameters?.model,
      },
    ).catch((err) => {
      logger.error('[V2 API] Error recording usage:', err);
    });

    const fullResponseText = textChunks.join('');
    const fullReasoningText = reasoningChunks.join('');

    timestampTracker.markAllEnd(contentParts);
    timestampTracker.apply(contentParts);
    applyCollectedUsageToContentParts(contentParts, collectedUsage);

    // Full prompt of the first LLM call as the message-level inputTokenCount,
    // mirroring the frontend chat flow (client.js recordCollectedUsage).
    // Claude-style entries report input WITHOUT cache (add it); OpenAI-style
    // entries report prompt_tokens which ALREADY includes cache (use as-is).
    const firstUsage = collectedUsage[0];
    const messageInputTokens = inputTokensExcludeCache(firstUsage)
      ? (Number(firstUsage?.input_tokens) || 0) +
        (Number(firstUsage?.input_token_details?.cache_creation) ||
          Number(firstUsage?.cache_creation_input_tokens) ||
          0) +
        (Number(firstUsage?.input_token_details?.cache_read) ||
          Number(firstUsage?.cache_read_input_tokens) ||
          0)
      : Number(firstUsage?.input_tokens) || 0;
    /*
      pi-consistent usage accounting (shared caliber with the pi backend, see AGENTS.md
      "Token Accounting"): per-call fields describe the turn's FIRST model call (pairing
      with inputTokenCount so In ≥ cache-hit always holds in display), total* fields
      accumulate every call of the turn. inputTokens is the fresh (non-cached) input;
      cacheReadTokens/cacheWriteTokens are recorded separately, never folded in.
    */
    let totalOutputTokens = 0;
    let totalInputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    let firstCallUsage;
    for (const usage of collectedUsage) {
      if (!usage) {
        continue;
      }
      const cacheWriteTokens =
        Number(usage.input_token_details?.cache_creation) ||
        Number(usage.cache_creation_input_tokens) ||
        0;
      const cacheReadTokens =
        Number(usage.input_token_details?.cache_read) || Number(usage.cache_read_input_tokens) || 0;
      // Fresh input: Claude-style reports it directly; OpenAI-style input
      // already includes cache, so subtract (clamped).
      const freshInput = inputTokensExcludeCache(usage)
        ? Number(usage.input_tokens) || 0
        : Math.max(0, (Number(usage.input_tokens) || 0) - cacheWriteTokens - cacheReadTokens);
      totalOutputTokens += Number(usage.output_tokens) || 0;
      totalInputTokens += freshInput;
      totalCacheReadTokens += cacheReadTokens;
      totalCacheWriteTokens += cacheWriteTokens;
      firstCallUsage ??= {
        inputTokens: freshInput,
        outputTokens: Number(usage.output_tokens) || 0,
        cacheReadTokens,
        cacheWriteTokens,
      };
    }

    const filteredContentParts = filterMalformedContentParts(contentParts);
    // Heal artifact format issues (unclosed :::/fence, directive wrapped in
    // code fence) before persistence. The raw SSE stream is preserved in the
    // `streamLog` field, so sanitizing `text`/`content` here is lossless.
    const healed = healMessagePayload({
      text: fullResponseText,
      content: filteredContentParts.length > 0 ? filteredContentParts : undefined,
    });
    const responseContent = healed.content.length > 0 ? healed.content : undefined;
    const healedResponseText = healed.text ?? '';

    // Append the pi file-links footer (execute_skill / execute_code outputs)
    // to the response BEFORE persisting, mirroring the frontend agent flow.
    const piFooterResponse = { text: healedResponseText, content: responseContent };
    const piFooter = await appendPiFileLinks(req, piFooterResponse);

    const userMessageText = extractTextFromMessages(request.messages);

    const fakeReq = { user: { id: userSn }, config: appConfig };

    if (userMessageText) {
      await db.saveMessage(
        fakeReq,
        {
          messageId: userMessageId,
          conversationId,
          parentMessageId,
          text: userMessageText,
          sender: 'user',
          isCreatedByUser: true,
          endpoint: EModelEndpoint.agents,
          model: agentId,
        },
        { context: 'api/server/controllers/agents/v2.js - user message' },
      );
    }

    const successFinishReason = getSuccessFinishReason({
      hasToolCalls: contentPartsContainToolCall(piFooterResponse.content),
    });

    if (piFooterResponse.text || fullReasoningText || piFooterResponse.content) {
      const streamLogValue = streamLogCollector ? streamLogCollector.getLog() : undefined;
      logger.debug(
        `[V2 API] streamLog: collector=${!!streamLogCollector}, length=${streamLogValue?.length ?? 0}`,
      );
      await db.saveMessage(
        fakeReq,
        {
          messageId: responseMessageId,
          conversationId,
          parentMessageId: userMessageId,
          text: piFooterResponse.text,
          content: piFooterResponse.content,
          sender: 'AI',
          isCreatedByUser: false,
          endpoint: EModelEndpoint.agents,
          model: agentId,
          streamLog: streamLogValue,
          finish_reason: successFinishReason,
          recursionLimit: `${maxAgentStep}/${recursionLimit}`,
          tokenCount: totalOutputTokens,
          inputTokenCount: messageInputTokens,
          // pi-consistent usage fields: per-call (latest) + turn-cumulative totals
          ...(firstCallUsage && {
            ...firstCallUsage,
            totalInputTokens,
            totalOutputTokens,
            totalCacheReadTokens,
            totalCacheWriteTokens,
          }),
        },
        { context: 'api/server/controllers/agents/v2.js - assistant message' },
      );
    }

    /*
      Session-cumulative usage totals on the conversation record (shared caliber
      with the pi backend, see AGENTS.md "Token Accounting"): accumulate this
      turn's usage onto the existing totals.
    */
    let convoUsageTotals;
    if (firstCallUsage) {
      const existingConvo = await getConvo(userSn, conversationId);
      convoUsageTotals = {
        totalInputTokens: (existingConvo?.totalInputTokens ?? 0) + totalInputTokens,
        totalOutputTokens: (existingConvo?.totalOutputTokens ?? 0) + totalOutputTokens,
        totalCacheReadTokens: (existingConvo?.totalCacheReadTokens ?? 0) + totalCacheReadTokens,
        totalCacheWriteTokens: (existingConvo?.totalCacheWriteTokens ?? 0) + totalCacheWriteTokens,
      };
    }

    await db.saveConvo(
      fakeReq,
      {
        conversationId,
        endpoint: EModelEndpoint.agents,
        endpointType: EModelEndpoint.agents,
        agent_id: agentId,
        model: agentId,
        finish_reason: successFinishReason,
        ...(convoUsageTotals && convoUsageTotals),
      },
      { context: 'api/server/controllers/agents/v2.js - conversation' },
    );

    const duration = Date.now() - requestStartTime;
    if (isStreaming) {
      if (piFooter) {
        writeSSE(res, createChunk(context, { content: piFooter }));
      }
      sendFinalChunk(handlerConfig);
      res.end();
      logger.debug(`[V2 API] Request ${responseMessageId} completed in ${duration}ms (streaming)`);

      if (artifactPromises.length > 0) {
        Promise.all(artifactPromises).catch((artifactError) => {
          logger.warn('[V2 API] Error processing artifacts:', artifactError);
        });
      }
    } else {
      if (artifactPromises.length > 0) {
        try {
          await Promise.all(artifactPromises);
        } catch (artifactError) {
          logger.warn('[V2 API] Error processing artifacts:', artifactError);
        }
      }

      const usage = {
        prompt_tokens: aggregator.usage.promptTokens,
        completion_tokens: aggregator.usage.completionTokens,
        total_tokens: aggregator.usage.promptTokens + aggregator.usage.completionTokens,
      };

      if (aggregator.usage.reasoningTokens > 0) {
        usage.completion_tokens_details = {
          reasoning_tokens: aggregator.usage.reasoningTokens,
        };
      }

      const response = buildNonStreamingResponse(
        context,
        piFooter
          ? normalizeArtifactStream(aggregator.getText()) + piFooter
          : normalizeArtifactStream(aggregator.getText()),
        aggregator.getReasoning(),
        aggregator.toolCalls,
        usage,
      );
      sanitizeReflectedFields(response, ['id', 'model']);
      sendJsonResponse(res, response);
      logger.debug(
        `[V2 API] Request ${responseMessageId} completed in ${duration}ms (non-streaming)`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An error occurred';

    const recursionHit = isRecursionLimitError(error);

    if (!recursionHit) {
      logger.error('[V2 API] Error:', error?.message || error);
      if (error?.stack) {
        logger.error('[V2 API] Stack:', error.stack);
      }
      if (error?.cause) {
        logger.error('[V2 API] Cause:', error.cause);
      }
    }

    const errorFinishReason = recursionHit
      ? FinishReason.RECURSION_LIMIT
      : getErrorFinishReason(error);

    // Partial token counts: same semantics as success path — first call's
    // input_tokens (with cache) as inputTokenCount, summed output as tokenCount.
    const partialFirstUsage = collectedUsage[0];
    const partialInputTokens =
      (Number(partialFirstUsage?.input_tokens) || 0) +
      (Number(partialFirstUsage?.input_token_details?.cache_creation) ||
        Number(partialFirstUsage?.cache_creation_input_tokens) ||
        0) +
      (Number(partialFirstUsage?.input_token_details?.cache_read) ||
        Number(partialFirstUsage?.cache_read_input_tokens) ||
        0);
    const partialOutputTokens = collectedUsage.reduce(
      (sum, u) => sum + (Number(u?.output_tokens) || 0),
      0,
    );

    // Persist the user message, conversation record, and whatever was captured of
    // the stream so they are retained even for aborted/errored requests. The try
    // block skips its saveMessage/saveConvo calls when an error is thrown, so we
    // compensate here (idempotent via upsert on messageId/conversationId).
    const partialReq = { user: { id: userSn }, config: appConfig };

    const userMessageText = extractTextFromMessages(request.messages);
    if (userMessageText) {
      db.saveMessage(
        partialReq,
        {
          messageId: userMessageId,
          conversationId,
          parentMessageId,
          text: userMessageText,
          sender: 'user',
          isCreatedByUser: true,
          endpoint: EModelEndpoint.agents,
          model: agentId,
        },
        { context: 'api/server/controllers/agents/v2.js - user message on error' },
      ).catch((saveErr) => logger.warn('[V2 API] Error saving user message on error:', saveErr));
    }

    // Finalize timestamps and heal content (mirrors the success path) so
    // tool_call parts captured in `contentParts` are persisted on the error
    // path too. Without this, only `text` (joined from textChunks) would be
    // saved and all structured tool_call parts would be lost.
    if (timestampTracker) {
      timestampTracker.markAllEnd(contentParts);
      timestampTracker.apply(contentParts);
    }
    const partialText = textChunks.join('');
    const filteredErrorParts = filterMalformedContentParts(contentParts);
    const healedError = healMessagePayload({
      text: partialText,
      content: filteredErrorParts.length > 0 ? filteredErrorParts : undefined,
    });
    const errorContent = healedError.content.length > 0 ? healedError.content : undefined;
    const healedErrorText = healedError.text ?? '';

    // For recursion-limit errors, generate the summary first so it can be
    // persisted into the original response message (requirement: the summary
    // message must be recorded in the messages table).
    let summaryText = '';
    if (recursionHit) {
      const maxSteps = agent.recursion_limit ?? 50;

      const lastUserMsg = [...request.messages].reverse().find((msg) => msg.role === 'user');
      const userQuestion = lastUserMsg?.content || '';

      let summaryGenerated = false;

      let lastSevenMessages = [];
      let recentMessagesText = '';
      try {
        const historyMessages = await loadConversationMessages(
          req,
          conversationId,
          userSn,
          parentMessageId,
          agent.provider,
          { includeImages: false },
        );
        lastSevenMessages = historyMessages.slice(-7);
        recentMessagesText = lastSevenMessages
          .map((msg, idx) => {
            if (!msg || typeof msg !== 'object') {
              return '';
            }
            const index = idx + 1;
            const role = msg.role || (msg.isCreatedByUser === true ? 'user' : 'assistant');
            const content = msg.text || msg.content || '';
            return `${index}\uFF09\u89D2\u8272\uFF1A${role}\uFF0C\u5185\u5BB9\uFF1A${content || '\uFF08\u7A7A\uFF09'}`;
          })
          .filter(Boolean)
          .join('\n');
      } catch (msgErr) {
        logger.warn('[V2 API] Failed to load conversation messages for summary:', msgErr);
      }

      const agentOutputsText =
        formatInProgressAgentOutputs(filteredErrorParts) ?? EMPTY_AGENT_OUTPUTS_TEXT;

      if (run) {
        try {
          const result = await summarizeOnRecursionLimit({
            run,
            agent,
            req,
            appConfig,
            conversationId,
            userId: userSn,
            signal: abortController.signal,
            userQuestion,
            recentMessagesText,
            agentOutputsText,
            contentParts: filteredErrorParts,
            messageId: responseMessageId,
            parentMessageId,
          });
          summaryText = result.summaryText || '';
          summaryGenerated = result.summaryGenerated;
        } catch (summaryErr) {
          logger.warn(
            '[V2 API] Failed to generate summary with model, using fallback:',
            summaryErr,
          );
        }
      }

      if (!summaryGenerated) {
        summaryText = buildFallbackSummary({ inputContent: null, agentOutputsText });
      }

      logger.error(
        `[V2 API] Recursion limit reached after ~${maxSteps} steps | ` +
          `summaryGenerated: ${summaryGenerated} | ` +
          `summaryLength: ${summaryText.length} | ` +
          `error: ${errorMessage}`,
      );
    }

    db.saveConvo(
      partialReq,
      {
        conversationId,
        endpoint: EModelEndpoint.agents,
        endpointType: EModelEndpoint.agents,
        agent_id: agentId,
        model: agentId,
        finish_reason: errorFinishReason,
      },
      { context: 'api/server/controllers/agents/v2.js - conversation on error' },
    ).catch((saveErr) => logger.warn('[V2 API] Error saving conversation on error:', saveErr));

    if (recursionHit) {
      // Recursion-limit errors are persisted as TWO separate messages:
      //   1) the original `responseMessageId` keeps whatever partial text AND
      //      content (tool_calls) were captured before the limit was hit
      //      (finish_reason=recursion_limit_partial);
      //   2) a new message id holds the generated summary, parented to the
      //      partial message (finish_reason=recursion_limit_summary).
      const streamLogValue = streamLogCollector ? streamLogCollector.getLog() : undefined;

      if (healedErrorText || errorContent || streamLogValue !== undefined) {
        db.saveMessage(
          partialReq,
          {
            messageId: responseMessageId,
            conversationId,
            parentMessageId: userMessageId,
            text: healedErrorText,
            content: errorContent,
            sender: 'AI',
            isCreatedByUser: false,
            endpoint: EModelEndpoint.agents,
            model: agentId,
            error: false,
            unfinished: true,
            finish_reason: FinishReason.RECURSION_LIMIT_PARTIAL,
            recursionLimit: `${maxAgentStep}/${recursionLimit}`,
            tokenCount: partialOutputTokens,
            inputTokenCount: partialInputTokens,
            ...(streamLogValue !== undefined && { streamLog: streamLogValue }),
          },
          { context: 'api/server/controllers/agents/v2.js - recursion partial message' },
        ).catch((saveErr) =>
          logger.warn('[V2 API] Error saving recursion partial message:', saveErr),
        );
      }

      const summaryMessageId = `chatcmpl-${nanoid()}`;
      db.saveMessage(
        partialReq,
        {
          messageId: summaryMessageId,
          conversationId,
          parentMessageId: responseMessageId,
          text: summaryText,
          sender: 'AI',
          isCreatedByUser: false,
          endpoint: EModelEndpoint.agents,
          model: agentId,
          error: false,
          unfinished: false,
          finish_reason: FinishReason.RECURSION_LIMIT_SUMMARY,
          recursionLimit: `${maxAgentStep}/${recursionLimit}`,
        },
        { context: 'api/server/controllers/agents/v2.js - recursion summary message' },
      ).catch((saveErr) =>
        logger.warn('[V2 API] Error saving recursion summary message:', saveErr),
      );
    } else {
      // Non-recursion error: always persist a placeholder assistant message so
      // the failure reason is recorded even when stream logging is disabled.
      // `healedErrorText`/`errorContent` were computed above from contentParts
      // so any tool_call parts captured before the failure are retained.
      const streamLogValue = streamLogCollector ? streamLogCollector.getLog() : undefined;
      const errorMetadata = buildErrorMetadata(error);
      db.saveMessage(
        partialReq,
        {
          messageId: responseMessageId,
          conversationId,
          parentMessageId: userMessageId,
          text: healedErrorText,
          content: errorContent,
          sender: 'AI',
          isCreatedByUser: false,
          endpoint: EModelEndpoint.agents,
          model: agentId,
          error: true,
          unfinished: true,
          finish_reason: errorFinishReason,
          recursionLimit: `${maxAgentStep}/${recursionLimit}`,
          tokenCount: partialOutputTokens,
          inputTokenCount: partialInputTokens,
          ...(streamLogValue !== undefined && { streamLog: streamLogValue }),
          ...(errorMetadata !== undefined && { metadata: errorMetadata }),
        },
        { context: 'api/server/controllers/agents/v2.js - partial on error' },
      ).catch((saveErr) => logger.warn('[V2 API] Error saving partial message:', saveErr));
    }

    // Recursion limit error: send the summary as the response (already persisted above)
    if (recursionHit) {
      if (res.headersSent) {
        const summaryChunk = createChunk(context, { content: `\n\n${summaryText}` });
        writeSSE(res, summaryChunk);
        logger.debug('[V2 API] Error handler: sending summary chunk + final chunk');
        sendFinalChunk(handlerConfig);
        res.end();
        return;
      } else {
        const response = buildNonStreamingResponse(context, summaryText, '', new Map(), {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        });
        sanitizeReflectedFields(response, ['id', 'model']);
        sendJsonResponse(res, response);
        return;
      }
    }

    // Regular error handling
    logger.error(
      `[V2 API] Non-recursion error | headersSent: ${res.headersSent} | error: ${errorMessage}`,
    );
    if (res.headersSent) {
      const errorChunk = createChunk(context, { content: `\n\nError: ${errorMessage}` }, 'stop');
      writeSSE(res, errorChunk);
      logger.debug('[V2 API] Error handler: sending error chunk + final chunk');
      sendFinalChunk(handlerConfig);
      res.end();
    } else {
      const statusCode =
        typeof error?.status === 'number' && error.status >= 400 && error.status < 600
          ? error.status
          : 500;
      const errorType =
        statusCode >= 400 && statusCode < 500 ? 'invalid_request_error' : 'server_error';
      sendErrorResponse(res, statusCode, errorMessage, errorType);
    }
  }
};

/**
 * V2 PI chat completion controller with persistence.
 *
 * Resolves v2-specific request context (DMP userSn, conversation ID) then
 * delegates to runPIChatWithPersistence, which wraps the stateless
 * piChatCompletionsController to add message/conversation persistence.
 *
 * Does NOT affect the frontend PI chat, which goes through
 * /api/agents/chat/pi → ResumableAgentController (a completely separate path).
 */
const v2PIChatCompletionController = async (req, res) => {
  const ctx = await resolveV2Context(req, res);
  if (!ctx) {
    return;
  }

  return runPIChatWithPersistence({
    userId: ctx.userSn,
    conversationId: ctx.conversationId,
    appConfig: req.config,
    req,
    res,
  });
};

module.exports = {
  V2ChatCompletionController,
  resolveV2Context,
  resolveUserByThirdPartyId,
  v2PIChatCompletionController,
};
