const { logger } = require('@librechat/data-schemas');
const {
  countTokens,
  isEnabled,
  sendEvent,
  GenerationJobManager,
  sanitizeMessageForTransmit,
  applyCollectedUsageToContentParts,
} = require('@librechat/api');
const { isAssistantsEndpoint, ErrorTypes } = require('librechat-data-provider');
const { spendTokens, spendStructuredTokens } = require('~/models/spendTokens');
const { truncateText, smartTruncateText } = require('~/app/clients/prompts');
const clearPendingReq = require('~/cache/clearPendingReq');
const { sendError } = require('~/server/middleware/error');
const { saveMessage, getConvo, getMessages } = require('~/models');
const { abortRun } = require('./abortRun');

/**
 * Spend tokens for all models from collected usage.
 * This handles both sequential and parallel agent execution.
 *
 * IMPORTANT: After spending, this function clears the collectedUsage array
 * to prevent double-spending. The array is shared with AgentClient.collectedUsage,
 * so clearing it here prevents the finally block from also spending tokens.
 *
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.conversationId - Conversation ID
 * @param {Array<Object>} params.collectedUsage - Usage metadata from all models
 * @param {string} [params.fallbackModel] - Fallback model name if not in usage
 */
async function spendCollectedUsage({ userId, conversationId, collectedUsage, fallbackModel }) {
  if (!collectedUsage || collectedUsage.length === 0) {
    return;
  }

  const spendPromises = [];

  for (const usage of collectedUsage) {
    if (!usage) {
      continue;
    }

    // Support both OpenAI format (input_token_details) and Anthropic format (cache_*_input_tokens)
    const cache_creation =
      Number(usage.input_token_details?.cache_creation) ||
      Number(usage.cache_creation_input_tokens) ||
      0;
    const cache_read =
      Number(usage.input_token_details?.cache_read) || Number(usage.cache_read_input_tokens) || 0;

    const txMetadata = {
      context: 'abort',
      conversationId,
      user: userId,
      model: usage.model ?? fallbackModel,
    };

    if (cache_creation > 0 || cache_read > 0) {
      spendPromises.push(
        spendStructuredTokens(txMetadata, {
          promptTokens: {
            input: usage.input_tokens,
            write: cache_creation,
            read: cache_read,
          },
          completionTokens: usage.output_tokens,
        }).catch((err) => {
          logger.error('[abortMiddleware] Error spending structured tokens for abort', err);
        }),
      );
      continue;
    }

    spendPromises.push(
      spendTokens(txMetadata, {
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens,
      }).catch((err) => {
        logger.error('[abortMiddleware] Error spending tokens for abort', err);
      }),
    );
  }

  // Wait for all token spending to complete
  await Promise.all(spendPromises);

  // Clear the array to prevent double-spending from the AgentClient finally block.
  // The collectedUsage array is shared by reference with AgentClient.collectedUsage,
  // so clearing it here ensures recordCollectedUsage() sees an empty array and returns early.
  collectedUsage.length = 0;
}

/**
 * Abort an active message generation.
 * Uses GenerationJobManager for all agent requests.
 * Since streamId === conversationId, we can directly abort by conversationId.
 */
async function abortMessage(req, res) {
  const { abortKey, endpoint } = req.body;

  if (isAssistantsEndpoint(endpoint)) {
    return await abortRun(req, res);
  }

  const conversationId = abortKey?.split(':')?.[0] ?? req.user.id;
  const userId = req.user.id;

  // Use GenerationJobManager to abort the job (streamId === conversationId)
  const abortResult = await GenerationJobManager.abortJob(conversationId);

  if (!abortResult.success) {
    if (!res.headersSent) {
      return res.status(204).send({ message: 'Request not found' });
    }
    return;
  }

  const { jobData, content, text, collectedUsage } = abortResult;

  if (Array.isArray(content) && Array.isArray(collectedUsage) && collectedUsage.length > 0) {
    applyCollectedUsageToContentParts(content, collectedUsage);
  }

  const completionTokens = await countTokens(text);
  const promptTokens = jobData?.promptTokens ?? 0;

  /**
   * Resolve the response document id.
   *
   * jobData.responseMessageId is set asynchronously (updateMetadata from
   * onStart) and can be missing when the user aborts very early. Saving with
   * a fresh id then creates a SECOND assistant child under the user message
   * and forks the message tree. Reuse, in order of preference:
   * 1. jobData.responseMessageId (the run's own response id)
   * 2. an existing assistant response document for this turn (e.g. already
   *    persisted by the pi backend when the abort signal reached it first)
   * 3. the deterministic prelim id `<userMessageId>_` (same id pi uses via
   *    the forwarded responseMessageId header, and the same fallback
   *    GenerationJobManager.abortJob uses for its final event)
   */
  let responseMessageId = jobData?.responseMessageId;
  if (!responseMessageId && jobData?.userMessage?.messageId) {
    const userMessageId = jobData.userMessage.messageId;
    responseMessageId = `${userMessageId}_`;
    if (jobData?.conversationId) {
      try {
        const existing = await getMessages(
          {
            conversationId: jobData.conversationId,
            user: userId,
            isCreatedByUser: false,
            parentMessageId: userMessageId,
          },
          'messageId',
        );
        if (existing.length > 0) {
          responseMessageId = existing[existing.length - 1].messageId;
        }
      } catch (err) {
        logger.warn('[abortMessage] Failed to look up existing response message:', err);
      }
    }
  }

  const responseMessage = {
    messageId: responseMessageId,
    parentMessageId: jobData?.userMessage?.messageId,
    conversationId: jobData?.conversationId,
    content,
    text,
    sender: jobData?.sender ?? 'AI',
    finish_reason: 'incomplete',
    endpoint: jobData?.endpoint,
    iconURL: jobData?.iconURL,
    model: jobData?.model,
    unfinished: false,
    error: false,
    isCreatedByUser: false,
    tokenCount: completionTokens,
  };

  // Spend tokens for ALL models from collectedUsage (handles parallel agents/addedConvo)
  if (collectedUsage && collectedUsage.length > 0) {
    await spendCollectedUsage({
      userId,
      conversationId: jobData?.conversationId,
      collectedUsage,
      fallbackModel: jobData?.model,
    });
  } else {
    // Fallback: no collected usage, use text-based token counting for primary model only
    await spendTokens(
      { ...responseMessage, context: 'incomplete', user: userId },
      { promptTokens, completionTokens },
    );
  }

  await saveMessage(
    req,
    { ...responseMessage, user: userId },
    { context: 'api/server/middleware/abortMiddleware.js' },
  );

  // Get conversation for title
  const conversation = await getConvo(userId, conversationId);

  const finalEvent = {
    title: conversation && !conversation.title ? null : conversation?.title || 'New Chat',
    final: true,
    conversation,
    requestMessage: jobData?.userMessage
      ? sanitizeMessageForTransmit({
          messageId: jobData.userMessage.messageId,
          parentMessageId: jobData.userMessage.parentMessageId,
          conversationId: jobData.userMessage.conversationId,
          text: jobData.userMessage.text,
          isCreatedByUser: true,
        })
      : null,
    responseMessage,
  };

  logger.debug(
    `[abortMessage] ID: ${userId} | ${req.user.email} | Aborted request: ${conversationId}`,
  );

  if (res.headersSent) {
    return sendEvent(res, finalEvent);
  }

  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(finalEvent));
}

const handleAbort = function () {
  return async function (req, res) {
    try {
      if (isEnabled(process.env.LIMIT_CONCURRENT_MESSAGES)) {
        await clearPendingReq({ userId: req.user.id });
      }
      return await abortMessage(req, res);
    } catch (err) {
      logger.error('[abortMessage] handleAbort error', err);
    }
  };
};

/**
 * Handle abort errors during generation.
 * @param {ServerResponse} res
 * @param {ServerRequest} req
 * @param {Error | unknown} error
 * @param {Partial<TMessage> & { partialText?: string }} data
 * @returns {Promise<void>}
 */
const handleAbortError = async (res, req, error, data) => {
  if (error?.message?.includes('base64')) {
    logger.error('[handleAbortError] Error in base64 encoding', {
      ...error,
      stack: smartTruncateText(error?.stack, 1000),
      message: truncateText(error.message, 350),
    });
  } else {
    logger.error('[handleAbortError] AI response error; aborting request:', error);
  }
  const { sender, conversationId, messageId, parentMessageId, userMessageId, partialText } = data;

  if (error.stack && error.stack.includes('google')) {
    logger.warn(
      `AI Response error for conversation ${conversationId} likely caused by Google censor/filter`,
    );
  }

  let errorText = error?.message?.includes('"type"')
    ? error.message
    : 'An error occurred while processing your request. Please contact the Admin.';

  if (error?.type === ErrorTypes.INVALID_REQUEST) {
    errorText = `{"type":"${ErrorTypes.INVALID_REQUEST}"}`;
  }

  if (error?.message?.includes("does not support 'system'")) {
    errorText = `{"type":"${ErrorTypes.NO_SYSTEM_MESSAGES}"}`;
  }

  if (
    error?.message?.includes('inappropriate content') ||
    error?.message?.includes('DataInspectionFailed') ||
    error?.message?.includes('content_filter') ||
    error?.message?.includes('content policy') ||
    error?.message?.includes('content management policy') ||
    error?.message?.includes('flagged by our moderation')
  ) {
    errorText = `{"type":"${ErrorTypes.MODERATION}"}`;
  }

  /**
   * @param {string} partialText
   * @returns {Promise<void>}
   */
  const respondWithError = async (partialText) => {
    const endpointOption = req.body?.endpointOption;
    let options = {
      sender,
      messageId,
      conversationId,
      parentMessageId,
      text: errorText,
      user: req.user.id,
      spec: endpointOption?.spec,
      iconURL: endpointOption?.iconURL,
      modelLabel: endpointOption?.modelLabel,
      shouldSaveMessage: userMessageId != null,
      model: endpointOption?.modelOptions?.model || req.body?.model,
    };

    if (req.body?.agent_id) {
      options.agent_id = req.body.agent_id;
    }

    if (partialText) {
      options = {
        ...options,
        error: false,
        unfinished: true,
        text: partialText,
      };
    }

    await sendError(req, res, options);
  };

  if (partialText && partialText.length > 5) {
    try {
      return await abortMessage(req, res);
    } catch (err) {
      logger.error('[handleAbortError] error while trying to abort message', err);
      return respondWithError(partialText);
    }
  } else {
    return respondWithError();
  }
};

module.exports = {
  handleAbort,
  handleAbortError,
};
