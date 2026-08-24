const { logger } = require('@librechat/data-schemas');
const { Constants, ViolationTypes, ContentTypes } = require('librechat-data-provider');
const {
  sendEvent,
  getViolationInfo,
  GenerationJobManager,
  decrementPendingRequest,
  sanitizeFileForTransmit,
  sanitizeMessageForTransmit,
  checkAndIncrementPendingRequest,
} = require('@librechat/api');
const { disposeClient, clientRegistry, requestDataMap } = require('~/server/cleanup');
const { handleAbortError } = require('~/server/middleware');
const { logViolation } = require('~/cache');
const { saveMessage } = require('~/models');
const {
  collectPiGeneratedFiles,
  buildPiFileLinks,
  filterPiResultFiles,
  isIntermediateArtifact,
  appendPiLinksToSavedMessage,
} = require('~/server/services/PIService');
const { removeStreamLogCollector } = require('~/server/services/StreamLog');
const { sanitizeReflectedString } = require('~/server/utils/sanitize');

/**
 * Read the captured raw stream log from the client's collector (if any).
 * @param {import('~/server/controllers/agents/client').AgentClient | null} client
 * @returns {string | undefined}
 */
function readStreamLog(client) {
  const collector = client?.streamLogCollector;
  if (!collector) {
    return undefined;
  }
  return collector.getLog();
}

/**
 * Read a TEXT content part's value, accepting both storage shapes: plain
 * string server-side ({ text: '...' }), { value } wrap client-side.
 * @param {Partial<TMessageContentPart>} part
 * @returns {string}
 */
function textPartValue(part) {
  if (part?.type !== ContentTypes.TEXT) {
    return '';
  }
  const text = part[ContentTypes.TEXT];
  return typeof text === 'string' ? text : (text?.value ?? '');
}

/**
 * Extract the mention-filter source text from the response message,
 * strict → loose:
 * 1. TEXT parts after the LAST tool_call part — the final summary segment of
 *    interleaved agent messages (text between tool calls is narration that
 *    routinely mentions input/intermediate files);
 * 2. all TEXT parts (models that end on a tool_call part);
 * 3. response.text (text-only messages).
 * @param {Partial<TMessage>} response
 * @returns {string}
 */
function extractSummaryText(response) {
  let strict = '';
  let all = '';
  if (Array.isArray(response.content)) {
    for (const part of response.content) {
      if (part?.type === ContentTypes.TOOL_CALL) {
        strict = '';
        continue;
      }
      const value = textPartValue(part);
      if (value) {
        strict += value;
        all += value;
      }
    }
  }
  return strict || all || response.text || '';
}

/** Root-level (no directory component) files, excluding skill intermediates. */
const rootDeliverableFiles = (files) =>
  files.filter((f) => {
    const p = f.path || f.name || '';
    return !p.includes('/') && !isIntermediateArtifact(p);
  });

/** Max wait for the post-summary pi file collection; degrades to no footer. */
const PI_FOOTER_DEADLINE_MS = 20_000;

/**
 * Collect the files of the turn's execute_skill runs and filter them down to
 * the deliverables the final summary actually mentions. Fallback when the
 * mention filter matches nothing: root-level deliverables — never the full
 * list, so workspace clutter can never flood the footer.
 * @param {Array<{agentId: string; sessionId: string; userId: string; startedAt: string}>} skillRuns
 * @param {string} summaryText
 * @returns {Promise<string>} footer markdown ('' when nothing to show)
 */
async function buildSkillRunFooter(skillRuns, summaryText) {
  try {
    const collected = await Promise.race([
      Promise.all(
        skillRuns.map((run) =>
          collectPiGeneratedFiles(run.agentId, run.sessionId, run.userId, run.startedAt),
        ),
      ),
      new Promise((resolve) => setTimeout(() => resolve(null), PI_FOOTER_DEADLINE_MS)),
    ]);
    if (!collected) {
      logger.warn('[AgentController] Pi file collection timed out; skipping footer');
      return '';
    }

    const allFiles = collected.flat();

    const mentioned = summaryText
      ? filterPiResultFiles(allFiles, summaryText)
      : filterPiResultFiles(rootDeliverableFiles(allFiles));
    const deliverables =
      mentioned.length > 0 ? mentioned : filterPiResultFiles(rootDeliverableFiles(allFiles));

    return buildPiFileLinks(deliverables) || '';
  } catch (error) {
    logger.warn('[AgentController] Pi skill file collection failed:', error.message);
    return '';
  }
}

/**
 * Append the pi file-links footer to the response message so the download
 * links render on the page. Agent messages may be dual-content (content-parts
 * array with empty `text`), so the footer is appended to BOTH `text` and a
 * trailing text content part (matching the sibling parts' storage shape) —
 * same visible surface as the one-pi chat buildFileLinks markdown.
 *
 * Two staging sources, resolved AFTER the LLM finished its reply:
 * - req._piSkillRuns (execute_skill): deferred runs — re-run
 *   collectPiGeneratedFiles per run, filter the files against the LLM's final
 *   summary text (whole-token mention match), then build the footer from
 *   buildPiFileDownloadUrl links. Link accuracy never depends on the LLM
 *   relaying URLs from the collapsed tool output.
 * - req._piFileLinksText (execute_code pi sync): exact tool artifacts, kept
 *   as-is without mention filtering.
 *
 * @param {ServerRequest} req
 * @param {Partial<TMessage>} response
 * @returns {Promise<string | null>} the appended footer, or null
 */
async function appendPiFileLinks(req, response) {
  const stagedLinks = req._piFileLinksText;
  const skillRuns = req._piSkillRuns;
  delete req._piFileLinksText;
  delete req._piSkillRuns;

  let footer = stagedLinks || '';
  if (Array.isArray(skillRuns) && skillRuns.length > 0) {
    footer += await buildSkillRunFooter(skillRuns, extractSummaryText(response));
  }

  if (!footer) {
    return null;
  }
  response.text = (response.text || '') + footer;
  if (Array.isArray(response.content) && response.content.length > 0) {
    const sibling = response.content.find((p) => p?.type === ContentTypes.TEXT);
    const usePlainString = sibling != null && typeof sibling[ContentTypes.TEXT] === 'string';
    response.content.push({
      type: ContentTypes.TEXT,
      [ContentTypes.TEXT]: usePlainString ? footer : { value: footer },
    });
  }
  return footer;
}

function createCloseHandler(abortController) {
  return function (manual) {
    if (!manual) {
      logger.debug('[AgentController] Request closed');
    }
    if (!abortController) {
      return;
    } else if (abortController.signal.aborted) {
      return;
    } else if (abortController.requestCompleted) {
      return;
    }

    abortController.abort();
    logger.debug('[AgentController] Request aborted on close');
  };
}

/**
 * Resumable Agent Controller - Generation runs independently of HTTP connection.
 * Returns streamId immediately, client subscribes separately via SSE.
 */
const ResumableAgentController = async (req, res, next, initializeClient, addTitle) => {
  const {
    text,
    isRegenerate,
    endpointOption,
    conversationId: reqConversationId,
    isContinued = false,
    editedContent = null,
    parentMessageId = null,
    overrideParentMessageId = null,
    responseMessageId: editedResponseMessageId = null,
  } = req.body;

  const userId = req.user.id;
  const isPIEndpoint = String(endpointOption?.endpoint) === 'pi';

  let responseMessageId = editedResponseMessageId;
  if (isPIEndpoint && !responseMessageId) {
    const bodyMessageId = req.body.messageId;
    if (bodyMessageId) {
      responseMessageId = `${bodyMessageId}_`;
      req.body.responseMessageId = responseMessageId;
      if (!req.body.overrideUserMessageId) {
        req.body.overrideUserMessageId = `${bodyMessageId}__0`;
      }
    }
  }

  const { allowed, pendingRequests, limit } = await checkAndIncrementPendingRequest(userId);
  if (!allowed) {
    const violationInfo = getViolationInfo(pendingRequests, limit);
    await logViolation(req, res, ViolationTypes.CONCURRENT, violationInfo, violationInfo.score);
    return res.status(429).json(violationInfo);
  }

  // Generate conversationId upfront if not provided - streamId === conversationId always
  // Treat "new" as a placeholder that needs a real UUID (frontend may send "new" for new convos)
  const conversationId =
    !reqConversationId || reqConversationId === 'new' ? crypto.randomUUID() : reqConversationId;
  const streamId = conversationId;

  // Ensure conversationId is available in req.body for downstream handlers
  req.body.conversationId = conversationId;

  let client = null;

  try {
    logger.debug(`[ResumableAgentController] Creating job`, {
      streamId,
      conversationId,
      reqConversationId,
      userId,
    });

    const job = await GenerationJobManager.createJob(streamId, userId, conversationId);
    const jobCreatedAt = job.createdAt; // Capture creation time to detect job replacement
    req._resumableStreamId = streamId;

    // Send JSON response IMMEDIATELY so client can connect to SSE stream
    // This is critical: tool loading (MCP OAuth) may emit events that the client needs to receive
    res.json({
      streamId: sanitizeReflectedString(streamId),
      conversationId: sanitizeReflectedString(conversationId),
      status: 'started',
    });

    // Note: We no longer use res.on('close') to abort since we send JSON immediately.
    // The response closes normally after res.json(), which is not an abort condition.
    // Abort handling is done through GenerationJobManager via the SSE stream connection.

    // Track if partial response was already saved to avoid duplicates
    let partialResponseSaved = false;

    /**
     * Listen for all subscribers leaving to save partial response.
     * This ensures the response is saved to DB even if all clients disconnect
     * while generation continues.
     *
     * Note: The messageId used here falls back to `${userMessage.messageId}_` if the
     * actual response messageId isn't available yet. The final response save will
     * overwrite this with the complete response using the same messageId pattern.
     */
    job.emitter.on('allSubscribersLeft', async (aggregatedContent) => {
      if (partialResponseSaved || !aggregatedContent || aggregatedContent.length === 0) {
        return;
      }

      const resumeState = await GenerationJobManager.getResumeState(streamId);
      if (!resumeState?.userMessage) {
        logger.debug('[ResumableAgentController] No user message to save partial response for');
        return;
      }

      partialResponseSaved = true;
      const responseConversationId = resumeState.conversationId || conversationId;

      try {
        // 过滤 null/undefined 元素（GLM模型 think 后直接 tool_call 时会产生空 text slot）
        const cleanContent = Array.isArray(aggregatedContent)
          ? aggregatedContent.filter((part) => part != null)
          : aggregatedContent;

        const partialMessage = {
          messageId: resumeState.responseMessageId || `${resumeState.userMessage.messageId}_`,
          conversationId: responseConversationId,
          parentMessageId: resumeState.userMessage.messageId,
          sender: client?.sender ?? 'AI',
          content: cleanContent,
          unfinished: true,
          error: false,
          isCreatedByUser: false,
          user: userId,
          endpoint: endpointOption.endpoint,
          model: endpointOption.modelOptions?.model || endpointOption.model_parameters?.model,
          streamLog: readStreamLog(client),
        };

        if (req.body?.agent_id) {
          partialMessage.agent_id = req.body.agent_id;
        }

        await saveMessage(req, partialMessage, {
          context: 'api/server/controllers/agents/request.js - partial response on disconnect',
        });

        logger.debug(
          `[ResumableAgentController] Saved partial response for ${streamId}, content parts: ${cleanContent.length}`,
        );
      } catch (error) {
        logger.error('[ResumableAgentController] Error saving partial response:', error);
        // Reset flag so we can try again if subscribers reconnect and leave again
        partialResponseSaved = false;
      }
    });

    /** @type {{ client: TAgentClient; userMCPAuthMap?: Record<string, Record<string, string>> }} */
    const result = await initializeClient({
      req,
      res,
      endpointOption,
      // Use the job's abort controller signal - allows abort via GenerationJobManager.abortJob()
      signal: job.abortController.signal,
    });

    if (job.abortController.signal.aborted) {
      GenerationJobManager.completeJob(streamId, 'Request aborted during initialization');
      await decrementPendingRequest(userId);
      return;
    }

    client = result.client;

    if (client?.sender) {
      GenerationJobManager.updateMetadata(streamId, { sender: client.sender });
    }

    // Store reference to client's contentParts - graph will be set when run is created
    if (client?.contentParts) {
      GenerationJobManager.setContentParts(streamId, client.contentParts);
    }

    let userMessage;

    const getReqData = (data = {}) => {
      if (data.userMessage) {
        userMessage = data.userMessage;
      }
      // conversationId is pre-generated, no need to update from callback
    };

    // Start background generation - readyPromise resolves immediately now
    // (sync mechanism handles late subscribers)
    const startGeneration = async () => {
      try {
        // Short timeout as safety net - promise should already be resolved
        await Promise.race([job.readyPromise, new Promise((resolve) => setTimeout(resolve, 100))]);
      } catch (waitError) {
        logger.warn(
          `[ResumableAgentController] Error waiting for subscriber: ${waitError.message}`,
        );
      }

      try {
        const onStart = (userMsg, respMsgId, _isNewConvo) => {
          userMessage = userMsg;

          // Store userMessage and responseMessageId upfront for resume capability
          GenerationJobManager.updateMetadata(streamId, {
            responseMessageId: respMsgId,
            userMessage: {
              messageId: userMsg.messageId,
              parentMessageId: userMsg.parentMessageId,
              conversationId: userMsg.conversationId,
              text: userMsg.text,
            },
          });

          GenerationJobManager.emitChunk(streamId, {
            created: true,
            message: userMessage,
            streamId,
          });
        };

        const messageOptions = {
          user: userId,
          onStart,
          getReqData,
          isContinued,
          isRegenerate,
          editedContent,
          conversationId,
          parentMessageId,
          abortController: job.abortController,
          overrideParentMessageId,
          isEdited: !!editedContent,
          userMCPAuthMap: result.userMCPAuthMap,
          responseMessageId: responseMessageId,
          progressOptions: {
            res: {
              write: () => true,
              end: () => {},
              headersSent: false,
              writableEnded: false,
            },
          },
        };

        const response = await client.sendMessage(text, messageOptions);

        const messageId = response.messageId;
        const endpoint = endpointOption.endpoint;
        response.endpoint = endpoint;

        const databasePromise = response.databasePromise;
        delete response.databasePromise;

        const { conversation: convoData = {} } = await databasePromise;
        const conversation = { ...convoData };
        conversation.title =
          conversation && !conversation.title ? null : conversation?.title || 'New Chat';

        if (req.body.files && client.options?.attachments) {
          userMessage.files = [];
          const messageFiles = new Set(req.body.files.map((file) => file.file_id));
          for (const attachment of client.options.attachments) {
            if (messageFiles.has(attachment.file_id)) {
              userMessage.files.push(sanitizeFileForTransmit(attachment));
            }
          }
        }

        // Check abort state BEFORE calling completeJob (which triggers abort signal for cleanup)
        const wasAbortedBeforeComplete = job.abortController.signal.aborted;
        const shouldGenerateTitle =
          addTitle &&
          parentMessageId === Constants.NO_PARENT &&
          !isRegenerate &&
          !editedContent &&
          !wasAbortedBeforeComplete;

        // Append the pi file-links footer BEFORE emitting the final event:
        // execute_skill runs are re-collected and filtered against the LLM's
        // final summary here. The DB patch of the graph-saved message is
        // fire-and-forget (durability only) — nothing post-summary may block
        // the final event.
        const piFooter = await appendPiFileLinks(req, response);
        if (piFooter && client.savedMessageIds?.has(messageId)) {
          appendPiLinksToSavedMessage(messageId, piFooter);
        }

        // Save user message BEFORE sending final event to avoid race condition
        // where client refetch happens before database is updated
        if (!client.skipSaveUserMessage && userMessage) {
          await saveMessage(req, userMessage, {
            context: 'api/server/controllers/agents/request.js - resumable user message',
          });
        }

        // CRITICAL: Save response message BEFORE emitting final event.
        // This prevents race conditions where the client sends a follow-up message
        // before the response is saved to the database, causing orphaned parentMessageIds.
        // CRITICAL: Save response message BEFORE emitting final event.
        // This prevents race conditions where the client sends a follow-up message
        // before the response is saved to the database, causing orphaned parentMessageIds.
        if (client.savedMessageIds && !client.savedMessageIds.has(messageId)) {
          await saveMessage(
            req,
            {
              ...response,
              user: userId,
              unfinished: wasAbortedBeforeComplete,
              streamLog: readStreamLog(client),
            },
            { context: 'api/server/controllers/agents/request.js - resumable response end' },
          );
        }
        removeStreamLogCollector(streamId);

        // Check if our job was replaced by a new request before emitting
        // This prevents stale requests from emitting events to newer jobs
        const currentJob = await GenerationJobManager.getJob(streamId);
        const jobWasReplaced = !currentJob || currentJob.createdAt !== jobCreatedAt;

        if (jobWasReplaced) {
          logger.debug(`[ResumableAgentController] Skipping FINAL emit - job was replaced`, {
            streamId,
            originalCreatedAt: jobCreatedAt,
            currentCreatedAt: currentJob?.createdAt,
          });
          // Still decrement pending request since we incremented at start
          await decrementPendingRequest(userId);
          return;
        }

        if (!wasAbortedBeforeComplete) {
          const finalEvent = {
            final: true,
            conversation,
            title: conversation.title,
            requestMessage: sanitizeMessageForTransmit(userMessage),
            responseMessage: { ...response },
          };

          logger.debug(`[ResumableAgentController] Emitting FINAL event`, {
            streamId,
            wasAbortedBeforeComplete,
            userMessageId: userMessage?.messageId,
            responseMessageId: response?.messageId,
            conversationId: conversation?.conversationId,
          });

          await GenerationJobManager.emitDone(streamId, finalEvent);
          GenerationJobManager.completeJob(streamId);
          await decrementPendingRequest(userId);
        } else {
          const finalEvent = {
            final: true,
            conversation,
            title: conversation.title,
            requestMessage: sanitizeMessageForTransmit(userMessage),
            responseMessage: { ...response, unfinished: true },
          };

          logger.debug(`[ResumableAgentController] Emitting ABORTED FINAL event`, {
            streamId,
            wasAbortedBeforeComplete,
            userMessageId: userMessage?.messageId,
            responseMessageId: response?.messageId,
            conversationId: conversation?.conversationId,
          });

          await GenerationJobManager.emitDone(streamId, finalEvent);
          GenerationJobManager.completeJob(streamId, 'Request aborted');
          await decrementPendingRequest(userId);
        }

        if (shouldGenerateTitle) {
          addTitle(req, {
            text,
            response: { ...response },
            client,
          })
            .catch((err) => {
              logger.error('[ResumableAgentController] Error in title generation', err);
            })
            .finally(() => {
              if (client) {
                disposeClient(client);
              }
            });
        } else {
          if (client) {
            disposeClient(client);
          }
        }
      } catch (error) {
        // Check if this was an abort (not a real error)
        const wasAborted = job.abortController.signal.aborted || error.message?.includes('abort');
        removeStreamLogCollector(streamId);

        if (wasAborted) {
          logger.debug(`[ResumableAgentController] Generation aborted for ${streamId}`);
          // abortJob already handled emitDone and completeJob
        } else {
          logger.error(`[ResumableAgentController] Generation error for ${streamId}:`, error);
          // Detect content moderation errors and convert to structured MODERATION type
          // so frontend Error.tsx can render localized user-friendly messages
          const errMsg = error.message || 'Generation failed';
          const isModeration =
            errMsg.includes('inappropriate content') ||
            errMsg.includes('DataInspectionFailed') ||
            errMsg.includes('content_filter') ||
            errMsg.includes('content policy') ||
            errMsg.includes('content management policy') ||
            errMsg.includes('flagged by our moderation');
          const emitMsg = isModeration ? JSON.stringify({ type: 'moderation' }) : errMsg;
          await GenerationJobManager.emitError(streamId, emitMsg);
          GenerationJobManager.completeJob(streamId, emitMsg);
        }

        await decrementPendingRequest(userId);

        if (client) {
          disposeClient(client);
        }

        // Don't continue to title generation after error/abort
        return;
      }
    };

    // Start generation and handle any unhandled errors
    startGeneration().catch(async (err) => {
      logger.error(
        `[ResumableAgentController] Unhandled error in background generation: ${err.message}`,
      );
      GenerationJobManager.completeJob(streamId, err.message);
      await decrementPendingRequest(userId);
    });
  } catch (error) {
    logger.error('[ResumableAgentController] Initialization error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to start generation' });
    } else {
      // JSON already sent, emit error to stream so client can receive it
      await GenerationJobManager.emitError(streamId, error.message || 'Failed to start generation');
    }
    GenerationJobManager.completeJob(streamId, error.message);
    await decrementPendingRequest(userId);
    if (client) {
      disposeClient(client);
    }
  }
};

/**
 * Agent Controller - Routes to ResumableAgentController for all requests.
 * The legacy non-resumable path is kept below but no longer used by default.
 */
const AgentController = async (req, res, next, initializeClient, addTitle) => {
  return ResumableAgentController(req, res, next, initializeClient, addTitle);
};

/**
 * Legacy Non-resumable Agent Controller - Uses GenerationJobManager for abort handling.
 * Response is streamed directly to client via res, but abort state is managed centrally.
 * @deprecated Use ResumableAgentController instead
 */
const _LegacyAgentController = async (req, res, next, initializeClient, addTitle) => {
  const {
    text,
    isRegenerate,
    endpointOption,
    conversationId: reqConversationId,
    isContinued = false,
    editedContent = null,
    parentMessageId = null,
    overrideParentMessageId = null,
    responseMessageId: editedResponseMessageId = null,
  } = req.body;

  // Generate conversationId upfront if not provided - streamId === conversationId always
  // Treat "new" as a placeholder that needs a real UUID (frontend may send "new" for new convos)
  const conversationId =
    !reqConversationId || reqConversationId === 'new' ? crypto.randomUUID() : reqConversationId;
  const streamId = conversationId;

  let userMessage;
  let userMessageId;
  let responseMessageId;
  let client = null;
  let cleanupHandlers = [];

  // Match the same logic used for conversationId generation above
  const isNewConvo = !reqConversationId || reqConversationId === 'new';
  const userId = req.user.id;
  // PI endpoint: messages are recorded by the PI backend, skip local saves.
  const isPIEndpoint = String(endpointOption?.endpoint) === 'pi';

  // Create handler to avoid capturing the entire parent scope
  let getReqData = (data = {}) => {
    for (let key in data) {
      if (key === 'userMessage') {
        userMessage = data[key];
        userMessageId = data[key].messageId;
      } else if (key === 'responseMessageId') {
        responseMessageId = data[key];
      } else if (key === 'promptTokens') {
        // Update job metadata with prompt tokens for abort handling
        GenerationJobManager.updateMetadata(streamId, { promptTokens: data[key] });
      } else if (key === 'sender') {
        GenerationJobManager.updateMetadata(streamId, { sender: data[key] });
      }
      // conversationId is pre-generated, no need to update from callback
    }
  };

  // Create a function to handle final cleanup
  const performCleanup = async () => {
    logger.debug('[AgentController] Performing cleanup');
    if (Array.isArray(cleanupHandlers)) {
      for (const handler of cleanupHandlers) {
        try {
          if (typeof handler === 'function') {
            handler();
          }
        } catch (e) {
          logger.error('[AgentController] Error in cleanup handler', e);
        }
      }
    }

    // Complete the job in GenerationJobManager
    if (streamId) {
      logger.debug('[AgentController] Completing job in GenerationJobManager');
      await GenerationJobManager.completeJob(streamId);
    }

    // Dispose client properly
    if (client) {
      disposeClient(client);
    }

    // Clear all references
    client = null;
    getReqData = null;
    userMessage = null;
    cleanupHandlers = null;

    // Clear request data map
    if (requestDataMap.has(req)) {
      requestDataMap.delete(req);
    }
    logger.debug('[AgentController] Cleanup completed');
  };

  try {
    let prelimAbortController = new AbortController();
    const prelimCloseHandler = createCloseHandler(prelimAbortController);
    res.on('close', prelimCloseHandler);
    const removePrelimHandler = (manual) => {
      try {
        prelimCloseHandler(manual);
        res.removeListener('close', prelimCloseHandler);
      } catch (e) {
        logger.error('[AgentController] Error removing close listener', e);
      }
    };
    cleanupHandlers.push(removePrelimHandler);

    /** @type {{ client: TAgentClient; userMCPAuthMap?: Record<string, Record<string, string>> }} */
    const result = await initializeClient({
      req,
      res,
      endpointOption,
      signal: prelimAbortController.signal,
    });

    if (prelimAbortController.signal?.aborted) {
      prelimAbortController = null;
      throw new Error('Request was aborted before initialization could complete');
    } else {
      prelimAbortController = null;
      removePrelimHandler(true);
      cleanupHandlers.pop();
    }
    client = result.client;

    // Register client with finalization registry if available
    if (clientRegistry) {
      clientRegistry.register(client, { userId }, client);
    }

    // Store request data in WeakMap keyed by req object
    requestDataMap.set(req, { client });

    // Create job in GenerationJobManager for abort handling
    // streamId === conversationId (pre-generated above)
    const job = await GenerationJobManager.createJob(streamId, userId, conversationId);

    // Store endpoint metadata for abort handling
    GenerationJobManager.updateMetadata(streamId, {
      endpoint: endpointOption.endpoint,
      iconURL: endpointOption.iconURL,
      model: endpointOption.modelOptions?.model || endpointOption.model_parameters?.model,
      sender: client?.sender,
    });

    // Store content parts reference for abort
    if (client?.contentParts) {
      GenerationJobManager.setContentParts(streamId, client.contentParts);
    }

    const closeHandler = createCloseHandler(job.abortController);
    res.on('close', closeHandler);
    cleanupHandlers.push(() => {
      try {
        res.removeListener('close', closeHandler);
      } catch (e) {
        logger.error('[AgentController] Error removing close listener', e);
      }
    });

    /**
     * onStart callback - stores user message and response ID for abort handling
     */
    const onStart = (userMsg, respMsgId, _isNewConvo) => {
      sendEvent(res, { message: userMsg, created: true });
      userMessage = userMsg;
      userMessageId = userMsg.messageId;
      responseMessageId = respMsgId;

      // Store metadata for abort handling (conversationId is pre-generated)
      GenerationJobManager.updateMetadata(streamId, {
        responseMessageId: respMsgId,
        userMessage: {
          messageId: userMsg.messageId,
          parentMessageId: userMsg.parentMessageId,
          conversationId,
          text: userMsg.text,
        },
      });
    };

    const messageOptions = {
      user: userId,
      onStart,
      getReqData,
      isContinued,
      isRegenerate,
      editedContent,
      conversationId,
      parentMessageId,
      abortController: job.abortController,
      overrideParentMessageId,
      isEdited: !!editedContent,
      userMCPAuthMap: result.userMCPAuthMap,
      responseMessageId: editedResponseMessageId,
      progressOptions: {
        res,
      },
    };

    let response = await client.sendMessage(text, messageOptions);

    // Extract what we need and immediately break reference
    const messageId = response.messageId;
    const endpoint = endpointOption.endpoint;
    response.endpoint = endpoint;

    // Store database promise locally
    const databasePromise = response.databasePromise;
    delete response.databasePromise;

    // Resolve database-related data
    const { conversation: convoData = {} } = await databasePromise;
    const conversation = { ...convoData };
    conversation.title =
      conversation && !conversation.title ? null : conversation?.title || 'New Chat';

    // Process files if needed (sanitize to remove large text fields before transmission)
    if (req.body.files && client.options?.attachments) {
      userMessage.files = [];
      const messageFiles = new Set(req.body.files.map((file) => file.file_id));
      for (const attachment of client.options.attachments) {
        if (messageFiles.has(attachment.file_id)) {
          userMessage.files.push(sanitizeFileForTransmit(attachment));
        }
      }
    }

    // Only send if not aborted
    if (!job.abortController.signal.aborted) {
      // Create a new response object with minimal copies
      const finalResponse = { ...response };
      await appendPiFileLinks(req, finalResponse);

      sendEvent(res, {
        final: true,
        conversation,
        title: conversation.title,
        requestMessage: sanitizeMessageForTransmit(userMessage),
        responseMessage: finalResponse,
      });
      res.end();

      // Save the message if needed
      if (client.savedMessageIds && !client.savedMessageIds.has(messageId)) {
        await saveMessage(
          req,
          { ...finalResponse, user: userId, streamLog: readStreamLog(client) },
          { context: 'api/server/controllers/agents/request.js - response end' },
        );
      }
      removeStreamLogCollector(streamId);
    }
    // Edge case: sendMessage completed but abort happened during sendCompletion
    // We need to ensure a final event is sent
    else if (!res.headersSent && !res.finished) {
      logger.debug(
        '[AgentController] Handling edge case: `sendMessage` completed but aborted during `sendCompletion`',
      );

      const finalResponse = { ...response };
      finalResponse.error = true;

      sendEvent(res, {
        final: true,
        conversation,
        title: conversation.title,
        requestMessage: sanitizeMessageForTransmit(userMessage),
        responseMessage: finalResponse,
        error: { message: 'Request was aborted during completion' },
      });
      res.end();
    }

    // Save user message if needed
    if (!client.skipSaveUserMessage) {
      await saveMessage(req, userMessage, {
        context: "api/server/controllers/agents/request.js - don't skip saving user message",
      });
    }

    // Add title if needed - extract minimal data
    if (addTitle && parentMessageId === Constants.NO_PARENT && !isRegenerate && !editedContent) {
      addTitle(req, {
        text,
        response: { ...response },
        client,
      })
        .then(() => {
          logger.debug('[AgentController] Title generation started');
        })
        .catch((err) => {
          logger.error('[AgentController] Error in title generation', err);
        })
        .finally(() => {
          logger.debug('[AgentController] Title generation completed');
          performCleanup();
        });
    } else {
      performCleanup();
    }
  } catch (error) {
    removeStreamLogCollector(streamId);
    // Handle error without capturing much scope
    handleAbortError(res, req, error, {
      conversationId,
      sender: client?.sender,
      messageId: responseMessageId,
      parentMessageId: overrideParentMessageId ?? userMessageId ?? parentMessageId,
      userMessageId,
    })
      .catch((err) => {
        logger.error('[api/server/controllers/agents/request] Error in `handleAbortError`', err);
      })
      .finally(() => {
        performCleanup();
      });
  }
};

module.exports = AgentController;
