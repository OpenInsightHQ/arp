const { nanoid } = require('nanoid');
const { logger } = require('@librechat/data-schemas');
const { Constants, EnvVar, GraphEvents, ToolEndHandler } = require('@librechat/agents');
const { Tools, StepTypes, FileContext, ErrorTypes } = require('librechat-data-provider');
const {
  sendEvent,
  GenerationJobManager,
  writeAttachmentEvent,
  createToolExecuteHandler,
  createTimestampTracker,
  extractToolCallIds,
  extractCacheTokens,
} = require('@librechat/api');
const { processFileCitations } = require('~/server/services/Files/Citations');
const { processCodeOutput, syncCodeOutputToPi } = require('~/server/services/Files/Code/process');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { saveBase64Image } = require('~/server/services/Files/process');
const { isPIConfigured, buildPiFileLinks } = require('~/server/services/PIService');

class ModelEndHandler {
  /**
   * @param {Array<UsageMetadata>} collectedUsage
   */
  constructor(collectedUsage) {
    if (!Array.isArray(collectedUsage)) {
      throw new Error('collectedUsage must be an array');
    }
    this.collectedUsage = collectedUsage;
  }

  finalize(errorMessage) {
    if (!errorMessage) {
      return;
    }
    throw new Error(errorMessage);
  }

  /**
   * @param {string} event
   * @param {ModelEndData | undefined} data
   * @param {Record<string, unknown> | undefined} metadata
   * @param {StandardGraph} graph
   * @returns {Promise<void>}
   */
  async handle(event, data, metadata, graph) {
    if (!graph || !metadata) {
      console.warn(`Graph or metadata not found in ${event} event`);
      return;
    }

    /** @type {string | undefined} */
    let errorMessage;
    try {
      const agentContext = graph.getAgentContext(metadata);
      if (data?.output?.additional_kwargs?.stop_reason === 'refusal') {
        const info = { ...data.output.additional_kwargs };
        errorMessage = JSON.stringify({
          type: ErrorTypes.REFUSAL,
          info,
        });
        logger.debug(`[ModelEndHandler] Model refused to respond`, {
          ...info,
          userId: metadata.user_id,
          messageId: metadata.run_id,
          conversationId: metadata.thread_id,
        });
      }

      const usage = data?.output?.usage_metadata;
      if (!usage) {
        return this.finalize(errorMessage);
      }
      const modelName = metadata?.ls_model_name || agentContext.clientOptions?.model;
      if (modelName) {
        usage.model = modelName;
      }

      usage.toolCallIds = extractToolCallIds(data?.output);
      const cacheTokens = extractCacheTokens(usage);
      usage.cacheCreationTokens = cacheTokens.cacheCreation;
      usage.cacheReadTokens = cacheTokens.cacheRead;
      this.collectedUsage.push(usage);
    } catch (error) {
      logger.error('Error handling model end event:', error);
      return this.finalize(errorMessage);
    }
  }
}

/**
 * @deprecated Agent Chain helper
 * @param {string | undefined} [last_agent_id]
 * @param {string | undefined} [langgraph_node]
 * @returns {boolean}
 */
function checkIfLastAgent(last_agent_id, langgraph_node) {
  if (!last_agent_id || !langgraph_node) {
    return false;
  }
  return langgraph_node?.endsWith(last_agent_id);
}

/**
 * @typedef {Object} ToolExecuteOptions
 * @property {(toolNames: string[]) => Promise<{loadedTools: StructuredTool[]}>} loadTools - Function to load tools by name
 * @property {Object} configurable - Configurable context for tool invocation
 */

/**
 * Get default handlers for stream events.
 * @param {Object} options - The options object.
 * @param {ServerResponse} options.res - The server response object.
 * @param {ContentAggregator} options.aggregateContent - Content aggregator function.
 * @param {ToolEndCallback} options.toolEndCallback - Callback to use when tool ends.
 * @param {Array<UsageMetadata>} options.collectedUsage - The list of collected usage metadata.
 * @param {Array<TMessageContentParts>} options.contentParts - The shared content parts array.
 * @param {TimestampTracker} [options.timestampTracker] - Optional timestamp tracker.
 * @param {string | null} [options.streamId] - The stream ID for resumable mode, or null for standard mode.
 * @param {ToolExecuteOptions} [options.toolExecuteOptions] - Options for event-driven tool execution.
 * @param {import('~/server/services/StreamLog').StreamLogCollector | null} [options.streamLogCollector] - Optional collector for raw stream logging.
 * @returns {Record<string, t.EventHandler>} The default handlers.
 * @throws {Error} If the request is not found.
 */
function getDefaultHandlers({
  res,
  aggregateContent,
  toolEndCallback,
  collectedUsage,
  contentParts,
  timestampTracker,
  streamId = null,
  toolExecuteOptions = null,
  streamLogCollector = null,
  stepRef = null,
}) {
  if (!res || !aggregateContent) {
    throw new Error(
      `[getDefaultHandlers] Missing required options: res: ${!res}, aggregateContent: ${!aggregateContent}`,
    );
  }
  /**
   * Capture the current LangGraph super-step from event metadata so the caller
   * can persist the actual agent step count on the message.
   * @param {Record<string, unknown> | undefined} metadata
   */
  const captureStep = (metadata) => {
    if (!stepRef) {
      return;
    }
    const step = Number(metadata?.langgraph_step);
    if (Number.isFinite(step) && step > stepRef.value) {
      stepRef.value = step;
    }
  };
  /**
   * Emit an event to the client (resumable or direct) while also capturing the
   * raw SSE wire format into the stream log collector when enabled.
   * @param {Object} eventData
   * @returns {Promise<void>}
   */
  const emit = async (eventData) => {
    if (streamLogCollector) {
      streamLogCollector.append(`event: message\ndata: ${JSON.stringify(eventData)}\n\n`);
    }
    if (streamId) {
      await GenerationJobManager.emitChunk(streamId, eventData);
    } else {
      sendEvent(res, eventData);
    }
  };
  const handlers = {
    [GraphEvents.CHAT_MODEL_END]: new ModelEndHandler(collectedUsage),
    [GraphEvents.TOOL_END]: new ToolEndHandler(toolEndCallback, logger),
    [GraphEvents.ON_CHAIN_START]: {
      handle: (_event, _data, metadata) => {
        captureStep(metadata);
      },
    },
    [GraphEvents.ON_RUN_STEP]: {
      handle: async (event, data, metadata) => {
        captureStep(metadata);
        aggregateContent({ event, data });
        if (timestampTracker && contentParts) {
          timestampTracker.markStart(contentParts);
        }
        if (data?.stepDetails.type === StepTypes.TOOL_CALLS) {
          await emit({ event, data });
        } else if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emit({ event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emit({ event, data });
        } else {
          const agentName = metadata?.name ?? 'Agent';
          const isToolCall = data?.stepDetails.type === StepTypes.TOOL_CALLS;
          const action = isToolCall ? 'performing a task...' : 'thinking...';
          await emit({
            event: 'on_agent_update',
            data: {
              runId: metadata?.run_id,
              message: `${agentName} is ${action}`,
            },
          });
        }
      },
    },
    [GraphEvents.ON_RUN_STEP_DELTA]: {
      handle: async (event, data, metadata) => {
        captureStep(metadata);
        aggregateContent({ event, data });
        if (timestampTracker && contentParts) {
          timestampTracker.markStart(contentParts);
        }
        if (data?.delta.type === StepTypes.TOOL_CALLS) {
          await emit({ event, data });
        } else if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emit({ event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emit({ event, data });
        }
      },
    },
    [GraphEvents.ON_RUN_STEP_COMPLETED]: {
      handle: async (event, data, metadata) => {
        captureStep(metadata);
        aggregateContent({ event, data });
        if (timestampTracker && contentParts) {
          timestampTracker.markStart(contentParts);
          if (data?.result != null) {
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
          }
        }
        if (data?.result != null) {
          await emit({ event, data });
        } else if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emit({ event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emit({ event, data });
        }
      },
    },
    [GraphEvents.ON_MESSAGE_DELTA]: {
      handle: async (event, data, metadata) => {
        captureStep(metadata);
        aggregateContent({ event, data });
        if (timestampTracker && contentParts) {
          timestampTracker.markStart(contentParts);
        }
        if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emit({ event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emit({ event, data });
        }
      },
    },
    [GraphEvents.ON_REASONING_DELTA]: {
      handle: async (event, data, metadata) => {
        captureStep(metadata);
        aggregateContent({ event, data });
        if (timestampTracker && contentParts) {
          timestampTracker.markStart(contentParts);
        }
        if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emit({ event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emit({ event, data });
        }
      },
    },
  };

  if (toolExecuteOptions) {
    handlers[GraphEvents.ON_TOOL_EXECUTE] = createToolExecuteHandler(toolExecuteOptions);
  }

  return handlers;
}

/**
 * Helper to write attachment events either to res or to job emitter.
 * Note: Attachments are not order-sensitive like deltas, so fire-and-forget is acceptable.
 * @param {ServerResponse} res - The server response object
 * @param {string | null} streamId - The stream ID for resumable mode, or null for standard mode
 * @param {Object} attachment - The attachment data
 */
function writeAttachment(res, streamId, attachment) {
  if (streamId) {
    GenerationJobManager.emitChunk(streamId, { event: 'attachment', data: attachment });
  } else {
    res.write(`event: attachment\ndata: ${JSON.stringify(attachment)}\n\n`);
  }
}

/**
 *
 * @param {Object} params
 * @param {ServerRequest} params.req
 * @param {ServerResponse} params.res
 * @param {Promise<MongoFile | { filename: string; filepath: string; expires: number;} | null>[]} params.artifactPromises
 * @param {string | null} [params.streamId] - The stream ID for resumable mode, or null for standard mode.
 * @param {{ current: string | null }} [params.piAgentIdRef] - Mutable ref resolved with the
 *   primary agent id once initialization completes; used to key the PI workspace
 *   when syncing execute_code outputs back to PI.
 * @returns {ToolEndCallback} The tool end callback.
 */
function createToolEndCallback({ req, res, artifactPromises, streamId = null, piAgentIdRef }) {
  /**
   * Upload a code-env output file to the PI workspace and stage the canonical
   * download-links footer (req._piFileLinksText) so the controller appends it
   * to the final response text — the same surface execute_skill uses.
   * Returns the canonical PI attachment record (file_id/filename/filepath with
   * the /arp/api/pi/files/download URL) or null.
   */
  const stagePiCodeOutputLink = async ({ id, name, session_id, apiKey, metadata, toolCallId }) => {
    try {
      const agentId = piAgentIdRef?.current || req._piAgentId || null;
      const conversationId = metadata?.thread_id;
      if (!agentId || !conversationId) {
        return null;
      }
      const piFile = await syncCodeOutputToPi({
        req,
        id,
        name,
        session_id,
        apiKey,
        agentId,
        conversationId,
      });
      if (!piFile) {
        return null;
      }
      const links = buildPiFileLinks([piFile]);
      if (links) {
        req._piFileLinksText = (req._piFileLinksText || '') + links;
      }
      return {
        file_id: piFile.name,
        temp_file_id: piFile.name,
        filename: piFile.name,
        filepath: piFile.url,
        type: 'application/octet-stream',
        conversationId,
        messageId: metadata.run_id,
        toolCallId: toolCallId ?? null,
      };
    } catch (error) {
      logger.error('Error syncing code output to PI:', error);
      return null;
    }
  };

  /**
   * @type {ToolEndCallback}
   */
  return async (data, metadata) => {
    const output = data?.output;
    if (!output) {
      return;
    }

    if (!output.artifact) {
      return;
    }

    if (output.artifact[Tools.file_search]) {
      artifactPromises.push(
        (async () => {
          const user = req.user;
          const attachment = await processFileCitations({
            user,
            metadata,
            appConfig: req.config,
            toolArtifact: output.artifact,
            toolCallId: output.tool_call_id,
          });
          if (!attachment) {
            return null;
          }
          if (!streamId && !res.headersSent) {
            return attachment;
          }
          writeAttachment(res, streamId, attachment);
          return attachment;
        })().catch((error) => {
          logger.error('Error processing file citations:', error);
          return null;
        }),
      );
    }

    if (output.artifact[Tools.ui_resources]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.ui_resources,
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            [Tools.ui_resources]: output.artifact[Tools.ui_resources].data,
          };
          if (!streamId && !res.headersSent) {
            return attachment;
          }
          writeAttachment(res, streamId, attachment);
          return attachment;
        })().catch((error) => {
          logger.error('Error processing artifact content:', error);
          return null;
        }),
      );
    }

    if (output.artifact[Tools.web_search]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.web_search,
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            [Tools.web_search]: { ...output.artifact[Tools.web_search] },
          };
          if (!streamId && !res.headersSent) {
            return attachment;
          }
          writeAttachment(res, streamId, attachment);
          return attachment;
        })().catch((error) => {
          logger.error('Error processing artifact content:', error);
          return null;
        }),
      );
    }

    if (output.artifact.content) {
      /** @type {FormattedContent[]} */
      const content = output.artifact.content;
      for (let i = 0; i < content.length; i++) {
        const part = content[i];
        if (!part) {
          continue;
        }
        if (part.type !== 'image_url') {
          continue;
        }
        const { url } = part.image_url;
        artifactPromises.push(
          (async () => {
            const filename = `${output.name}_img_${nanoid()}`;
            const file_id = output.artifact.file_ids?.[i];
            const file = await saveBase64Image(url, {
              req,
              file_id,
              filename,
              endpoint: metadata.provider,
              context: FileContext.image_generation,
            });
            const fileMetadata = Object.assign(file, {
              messageId: metadata.run_id,
              toolCallId: output.tool_call_id,
              conversationId: metadata.thread_id,
            });
            if (!streamId && !res.headersSent) {
              return fileMetadata;
            }

            if (!fileMetadata) {
              return null;
            }

            writeAttachment(res, streamId, fileMetadata);
            return fileMetadata;
          })().catch((error) => {
            logger.error('Error processing artifact content:', error);
            return null;
          }),
        );
      }
      return;
    }

    const isCodeTool =
      output.name === Tools.execute_code || output.name === Constants.PROGRAMMATIC_TOOL_CALLING;
    if (!isCodeTool) {
      return;
    }

    if (!output.artifact.files) {
      return;
    }

    for (const file of output.artifact.files) {
      const { id, name } = file;
      artifactPromises.push(
        (async () => {
          const result = await loadAuthValues({
            userId: req.user.id,
            authFields: [EnvVar.CODE_API_KEY],
          });
          const codeApiKey = result[EnvVar.CODE_API_KEY];

          /**
           * PI flow: download from the code env, upload into the PI workspace,
           * and emit the canonical /arp/api/pi/files/download attachment +
           * links footer. No LibreChat file storage (uploads dir / DB file
           * record) is involved — PI is the single storage backend.
           */
          if (isPIConfigured(req) && codeApiKey) {
            const piAttachment = await stagePiCodeOutputLink({
              id,
              name,
              session_id: output.artifact.session_id,
              apiKey: codeApiKey,
              metadata,
              toolCallId: output.tool_call_id,
            });
            if (piAttachment) {
              if (!streamId && !res.headersSent) {
                return piAttachment;
              }
              writeAttachment(res, streamId, piAttachment);
              return piAttachment;
            }
            logger.warn(
              `PI sync failed for code output "${name}"; falling back to LibreChat file processing`,
            );
          }

          const processFn = processCodeOutput;
          const fileMetadata = await processFn({
            req,
            id,
            name,
            apiKey: codeApiKey,
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            session_id: output.artifact.session_id,
          });
          if (!streamId && !res.headersSent) {
            return fileMetadata;
          }

          if (!fileMetadata) {
            return null;
          }

          writeAttachment(res, streamId, fileMetadata);
          return fileMetadata;
        })().catch((error) => {
          logger.error('Error processing code output:', error);
          return null;
        }),
      );
    }
  };
}

/**
 * Helper to write attachment events in Open Responses format (librechat:attachment)
 * @param {ServerResponse} res - The server response object
 * @param {Object} tracker - The response tracker with sequence number
 * @param {Object} attachment - The attachment data
 * @param {Object} metadata - Additional metadata (messageId, conversationId)
 */
function writeResponsesAttachment(res, tracker, attachment, metadata) {
  const sequenceNumber = tracker.nextSequence();
  writeAttachmentEvent(res, sequenceNumber, attachment, {
    messageId: metadata.run_id,
    conversationId: metadata.thread_id,
  });
}

/**
 * Creates a tool end callback specifically for the Responses API.
 * Emits attachments as `librechat:attachment` events per the Open Responses extension spec.
 *
 * @param {Object} params
 * @param {ServerRequest} params.req
 * @param {ServerResponse} params.res
 * @param {Object} params.tracker - Response tracker with sequence number
 * @param {Promise<MongoFile | { filename: string; filepath: string; expires: number;} | null>[]} params.artifactPromises
 * @returns {ToolEndCallback} The tool end callback.
 */
function createResponsesToolEndCallback({ req, res, tracker, artifactPromises }) {
  /**
   * @type {ToolEndCallback}
   */
  return async (data, metadata) => {
    const output = data?.output;
    if (!output) {
      return;
    }

    if (!output.artifact) {
      return;
    }

    if (output.artifact[Tools.file_search]) {
      artifactPromises.push(
        (async () => {
          const user = req.user;
          const attachment = await processFileCitations({
            user,
            metadata,
            appConfig: req.config,
            toolArtifact: output.artifact,
            toolCallId: output.tool_call_id,
          });
          if (!attachment) {
            return null;
          }
          // For Responses API, emit attachment during streaming
          if (res.headersSent && !res.writableEnded) {
            writeResponsesAttachment(res, tracker, attachment, metadata);
          }
          return attachment;
        })().catch((error) => {
          logger.error('Error processing file citations:', error);
          return null;
        }),
      );
    }

    if (output.artifact[Tools.ui_resources]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.ui_resources,
            toolCallId: output.tool_call_id,
            [Tools.ui_resources]: output.artifact[Tools.ui_resources].data,
          };
          // For Responses API, always emit attachment during streaming
          if (res.headersSent && !res.writableEnded) {
            writeResponsesAttachment(res, tracker, attachment, metadata);
          }
          return attachment;
        })().catch((error) => {
          logger.error('Error processing artifact content:', error);
          return null;
        }),
      );
    }

    if (output.artifact[Tools.web_search]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.web_search,
            toolCallId: output.tool_call_id,
            [Tools.web_search]: { ...output.artifact[Tools.web_search] },
          };
          // For Responses API, always emit attachment during streaming
          if (res.headersSent && !res.writableEnded) {
            writeResponsesAttachment(res, tracker, attachment, metadata);
          }
          return attachment;
        })().catch((error) => {
          logger.error('Error processing artifact content:', error);
          return null;
        }),
      );
    }

    if (output.artifact.content) {
      /** @type {FormattedContent[]} */
      const content = output.artifact.content;
      for (let i = 0; i < content.length; i++) {
        const part = content[i];
        if (!part) {
          continue;
        }
        if (part.type !== 'image_url') {
          continue;
        }
        const { url } = part.image_url;
        artifactPromises.push(
          (async () => {
            const filename = `${output.name}_img_${nanoid()}`;
            const file_id = output.artifact.file_ids?.[i];
            const file = await saveBase64Image(url, {
              req,
              file_id,
              filename,
              endpoint: metadata.provider,
              context: FileContext.image_generation,
            });
            const fileMetadata = Object.assign(file, {
              toolCallId: output.tool_call_id,
            });

            if (!fileMetadata) {
              return null;
            }

            // For Responses API, emit attachment during streaming
            if (res.headersSent && !res.writableEnded) {
              const attachment = {
                file_id: fileMetadata.file_id,
                filename: fileMetadata.filename,
                type: fileMetadata.type,
                url: fileMetadata.filepath,
                width: fileMetadata.width,
                height: fileMetadata.height,
                tool_call_id: output.tool_call_id,
              };
              writeResponsesAttachment(res, tracker, attachment, metadata);
            }

            return fileMetadata;
          })().catch((error) => {
            logger.error('Error processing artifact content:', error);
            return null;
          }),
        );
      }
      return;
    }

    const isCodeTool =
      output.name === Tools.execute_code || output.name === Constants.PROGRAMMATIC_TOOL_CALLING;
    if (!isCodeTool) {
      return;
    }

    if (!output.artifact.files) {
      return;
    }

    for (const file of output.artifact.files) {
      const { id, name } = file;
      artifactPromises.push(
        (async () => {
          const result = await loadAuthValues({
            userId: req.user.id,
            authFields: [EnvVar.CODE_API_KEY],
          });
          const codeApiKey = result[EnvVar.CODE_API_KEY];

          /**
           * PI flow: upload into the PI workspace and emit the canonical
           * /arp/api/pi/files/download URL. No LibreChat file storage —
           * PI is the single storage backend.
           */
          if (isPIConfigured(req) && codeApiKey) {
            const agentId = req._piAgentId || null;
            const conversationId = metadata.thread_id;
            const piFile =
              agentId && conversationId
                ? await syncCodeOutputToPi({
                    req,
                    id,
                    name,
                    session_id: output.artifact.session_id,
                    apiKey: codeApiKey,
                    agentId,
                    conversationId,
                  }).catch(() => null)
                : null;
            if (piFile) {
              const links = buildPiFileLinks([piFile]);
              if (links) {
                req._piFileLinksText = (req._piFileLinksText || '') + links;
              }
              const piAttachment = {
                file_id: piFile.name,
                filename: piFile.name,
                type: 'application/octet-stream',
                filepath: piFile.url,
                url: piFile.url,
                tool_call_id: output.tool_call_id,
              };
              if (res.headersSent && !res.writableEnded) {
                writeResponsesAttachment(res, tracker, piAttachment, metadata);
              }
              return piAttachment;
            }
            logger.warn(
              `PI sync failed for code output "${name}"; falling back to LibreChat file processing`,
            );
          }

          const processFn = processCodeOutput;
          const fileMetadata = await processFn({
            req,
            id,
            name,
            apiKey: codeApiKey,
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            session_id: output.artifact.session_id,
          });

          if (!fileMetadata) {
            return null;
          }

          // For Responses API, emit attachment during streaming
          if (res.headersSent && !res.writableEnded) {
            const attachment = {
              file_id: fileMetadata.file_id,
              filename: fileMetadata.filename,
              type: fileMetadata.type,
              url: fileMetadata.filepath,
              width: fileMetadata.width,
              height: fileMetadata.height,
              tool_call_id: output.tool_call_id,
            };
            writeResponsesAttachment(res, tracker, attachment, metadata);
          }

          return fileMetadata;
        })().catch((error) => {
          logger.error('Error processing code output:', error);
          return null;
        }),
      );
    }
  };
}

module.exports = {
  getDefaultHandlers,
  createToolEndCallback,
  createResponsesToolEndCallback,
};
