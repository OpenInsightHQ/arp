/** Memories */
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { Tools } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { HumanMessage } from '@langchain/core/messages';
import { Run, Providers, GraphEvents } from '@librechat/agents';
import type {
  OpenAIClientOptions,
  StreamEventData,
  ToolEndCallback,
  ClientOptions,
  EventHandler,
  ToolEndData,
  LLMConfig,
} from '@librechat/agents';
import type { ObjectId, MemoryMethods, IUser } from '@librechat/data-schemas';
import type { TAttachment, MemoryArtifact } from 'librechat-data-provider';
import type { BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { Response as ServerResponse } from 'express';
import { GenerationJobManager } from '~/stream/GenerationJobManager';
import { Tokenizer, resolveHeaders, createSafeUser } from '~/utils';

type RequiredMemoryMethods = Pick<
  MemoryMethods,
  'setMemory' | 'deleteMemory' | 'getFormattedMemories'
>;

type ToolEndMetadata = Record<string, unknown> & {
  run_id?: string;
  thread_id?: string;
};

export interface MemoryConfig {
  validKeys?: string[];
  instructions?: string;
  llmConfig?: Partial<LLMConfig>;
  tokenLimit?: number;
}

export const memoryInstructions =
  'The system automatically stores important user information and can update memories based on user requests. Users can manage (including delete) their memories through the memory panel in settings.';

const getDefaultInstructions = (
  validKeys?: string[],
  tokenLimit?: number,
  existingKeys?: string[],
): string => {
  let prompt = `You are a memory gatekeeper. ALL memories are personal to THIS user — they describe who this user is, what they prefer, or what rules they want followed.

Based on the user's CURRENT MESSAGE and conversation context, choose ONE of three actions:

---

## Action 1: PASSIVE (explicit intent)

**Trigger**: User's current message explicitly says "记住" / "记下来" / "下次记住" / "以后都这样" / "改一下" / "Remember this" / "Save this" etc.

**Behavior**: Call set_memory tool.
- No matching key → CREATE
- Matching key exists → UPDATE

---

## Action 2: SUGGEST (AI recommendation)

**Trigger**: User did NOT say "记住", but the CURRENT MESSAGE reveals durable information matching one of four categories:

| Category | What it captures | Examples |
|-----------|-----------------|----------|
| **profile** | Identity, background, role | "我是做物流的", "我在上海" |
| **preference** | Likes, dislikes, habits, style choices | "我喜欢黑色", "PPT用这个风格" |
| **constraint** | Business rules, policies user wants followed | "大客户标准是年采购50万" |
| **knowledge** | Durable facts user shares as important | "我们系统用PostgreSQL" |

### When NOT to SUGGEST:

❌ User asks a question — never suggest
❌ User requests a task — never suggest
❌ Casual chatter without clear signal — never suggest
❌ AI-generated or AI-inferred information — never suggest
❌ Information already covered by an existing memory key — skip

**CRITICAL RULE for value**: Every memory value MUST explicitly reference "用户" (or the user's identity/role). Write as if speaking ON behalf of the user:
- ✅ "用户是财务部门的，统计口径默认按duedate" 
- ✅ "用户偏好深色主题"
- ❌ "财务部门默认按duedate" ← missing user reference
- ❌ "深色主题更好" ← not user-centric

### SUGGEST output format:

When suggesting, include ONLY this in your response (no other text, no tool calls):

<MEMORY_SUGGESTION>
key: rule_finance_date_metric
value: 用户是财务部门的，统计口径默认按duedate而非orderDate，无论按年还是月统计
category: constraint
</MEMORY_SUGGESTION>

Max 1 suggestion per turn.

---

## Action 3: NOTHING

Return empty response. No tool calls, no tags.

---

## Key naming rules (when creating)

- Lowercase snake_case
- Prefixes: user_* (profile/identity), pref_* (preference), rule_* (constraint)
- key name MUST reflect the user-centric nature: rule_finance_date_metric, not finance_date_metric
- NO quotes, NO spaces, NO special characters

---

## Priority

PASSIVE > SUGGEST > NOTHING. If user explicitly says "记住", always use PASSIVE — do NOT also output a SUGGEST tag.

When in doubt, choose NOTHING. Missing a memory is far better than storing garbage.`;

  if (existingKeys && existingKeys.length > 0) {
    prompt += '\n\n## Existing Memory Keys';
    prompt += '\n\nThese keys already exist. For PASSIVE: CREATE a new one or UPDATE one only if the user explicitly asks. For SUGGEST: skip if the information is already covered.';
    for (const k of existingKeys) {
      prompt += `\n- ${k}`;
    }
  }

  if (validKeys && validKeys.length > 0) {
    prompt += `\n\nVALID KEYS: ${validKeys.join(', ')}`;
  }

  if (tokenLimit) {
    prompt += `\n\nTOKEN LIMIT: Maximum ${tokenLimit} tokens per memory value.`;
  }

  return prompt;
};

/**
 * Extract memory key names from the formatted "withKeys" string.
 * Parses lines like: 1. [date]. ["key": "keyName"] ...
 */
function extractMemoryKeys(withKeys: string): string[] {
  if (!withKeys) return [];
  const keys: string[] = [];
  const regex = /\["key":\s*"([^"]+)"\]/g;
  let match;
  while ((match = regex.exec(withKeys)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

/**
 * Creates a memory tool instance with user context
 */
export const createMemoryTool = ({
  userId,
  setMemory,
  validKeys,
  tokenLimit,
  totalTokens = 0,
  conversationId,
  messageIds = [],
}: {
  userId: string | ObjectId;
  setMemory: MemoryMethods['setMemory'];
  validKeys?: string[];
  tokenLimit?: number;
  totalTokens?: number;
  conversationId?: string;
  messageIds?: string[];
}) => {
  const remainingTokens = tokenLimit ? tokenLimit - totalTokens : Infinity;
  const isOverflowing = tokenLimit ? remainingTokens <= 0 : false;

  return tool(
    async ({ key, value, type, importance }) => {
      try {
        if (validKeys && validKeys.length > 0 && !validKeys.includes(key)) {
          logger.warn(
            `Memory Agent failed to set memory: Invalid key "${key}". Must be one of: ${validKeys.join(
              ', ',
            )}`,
          );
          return [`Invalid key "${key}". Must be one of: ${validKeys.join(', ')}`, undefined];
        }

        const tokenCount = Tokenizer.getTokenCount(value, 'o200k_base');

        if (isOverflowing) {
          const errorArtifact: Record<Tools.memory, MemoryArtifact> = {
            [Tools.memory]: {
              key: 'system',
              type: 'error',
              value: JSON.stringify({
                errorType: 'already_exceeded',
                tokenCount: Math.abs(remainingTokens),
                totalTokens: totalTokens,
                tokenLimit: tokenLimit!,
              }),
              tokenCount: totalTokens,
            },
          };
          return [`Memory storage exceeded. Cannot save new memories.`, errorArtifact];
        }

        if (tokenLimit) {
          const newTotalTokens = totalTokens + tokenCount;
          const newRemainingTokens = tokenLimit - newTotalTokens;

          if (newRemainingTokens < 0) {
            const errorArtifact: Record<Tools.memory, MemoryArtifact> = {
              [Tools.memory]: {
                key: 'system',
                type: 'error',
                value: JSON.stringify({
                  errorType: 'would_exceed',
                  tokenCount: Math.abs(newRemainingTokens),
                  totalTokens: newTotalTokens,
                  tokenLimit,
                }),
                tokenCount: totalTokens,
              },
            };
            return [`Memory storage would exceed limit. Cannot save this memory.`, errorArtifact];
          }
        }

        // Auto-determine type if not provided
        const memoryType = type ?? 'knowledge';

        // Build source object with conversation context
        const source = {
          from: 'auto' as const,
          conversationId,
          messageIds,
        };

        // Build weight object with importance
        const weight = importance != null ? { importance } : undefined;

        const artifact: Record<Tools.memory, MemoryArtifact> = {
          [Tools.memory]: {
            key,
            value,
            tokenCount,
            type: 'update',
          },
        };

        const result = await setMemory({ userId, key, value, tokenCount, type: memoryType, source, weight });
        if (result.ok) {
          logger.debug(`Memory set for key "${key}" (${tokenCount} tokens) for user "${userId}"`);
          return [`Memory set for key "${key}" (${tokenCount} tokens)`, artifact];
        }
        logger.warn(`Failed to set memory for key "${key}" for user "${userId}"`);
        return [`Failed to set memory for key "${key}"`, undefined];
      } catch (error) {
        logger.error('Memory Agent failed to set memory', error);
        return [`Error setting memory for key "${key}"`, undefined];
      }
    },
    {
      name: 'set_memory',
      description: 'Saves important information about the user into memory.',
      responseFormat: 'content_and_artifact',
      schema: z.object({
        key: z
          .string()
          .describe(
            validKeys && validKeys.length > 0
              ? `The key of the memory value. Must be one of: ${validKeys.join(', ')}`
              : 'The key identifier for this memory',
          ),
        value: z
          .string()
          .describe(
          'Value MUST be a complete sentence that explicitly references the user ("用户"). Example: "用户是财务部门的，统计口径默认按duedate而非orderDate"',
          ),
        type: z
          .enum(['profile', 'preference', 'constraint', 'knowledge'])
          .optional()
          .describe(
            'The type of memory: profile (user identity/background), preference (user likes/dislikes/habits), constraint (rules user wants followed), knowledge (facts user explicitly asked to remember).',
          ),
        importance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('The importance level of this memory (0-1). Higher values indicate more important memories.'),
      }),
    },
  );
};

/**
 * Creates a delete memory tool instance with user context
 */
const createDeleteMemoryTool = ({
  userId,
  deleteMemory,
  validKeys,
}: {
  userId: string | ObjectId;
  deleteMemory: MemoryMethods['deleteMemory'];
  validKeys?: string[];
}) => {
  return tool(
    async ({ key }) => {
      try {
        if (validKeys && validKeys.length > 0 && !validKeys.includes(key)) {
          logger.warn(
            `Memory Agent failed to delete memory: Invalid key "${key}". Must be one of: ${validKeys.join(
              ', ',
            )}`,
          );
          return [`Invalid key "${key}". Must be one of: ${validKeys.join(', ')}`, undefined];
        }

        const artifact: Record<Tools.memory, MemoryArtifact> = {
          [Tools.memory]: {
            key,
            type: 'delete',
          },
        };

        const result = await deleteMemory({ userId, key });
        if (result.ok) {
          logger.debug(`Memory deleted for key "${key}" for user "${userId}"`);
          return [`Memory deleted for key "${key}"`, artifact];
        }
        logger.warn(`Failed to delete memory for key "${key}" for user "${userId}"`);
        return [`Failed to delete memory for key "${key}"`, undefined];
      } catch (error) {
        logger.error('Memory Agent failed to delete memory', error);
        return [`Error deleting memory for key "${key}"`, undefined];
      }
    },
    {
      name: 'delete_memory',
      description:
        'Deletes specific memory data about the user using the provided key. For updating existing memories, use the `set_memory` tool instead',
      responseFormat: 'content_and_artifact',
      schema: z.object({
        key: z
          .string()
          .describe(
            validKeys && validKeys.length > 0
              ? `The key of the memory to delete. Must be one of: ${validKeys.join(', ')}`
              : 'The key identifier of the memory to delete',
          ),
      }),
    },
  );
};
export class BasicToolEndHandler implements EventHandler {
  private callback?: ToolEndCallback;
  constructor(callback?: ToolEndCallback) {
    this.callback = callback;
  }

  handle(
    event: string,
    data: StreamEventData | undefined,
    metadata?: Record<string, unknown>,
  ): void {
    if (!metadata) {
      console.warn(`Graph or metadata not found in ${event} event`);
      return;
    }
    const toolEndData = data as ToolEndData | undefined;
    if (!toolEndData?.output) {
      console.warn('No output found in tool_end event');
      return;
    }
    this.callback?.(toolEndData, metadata);
  }
}

export async function processMemory({
  res,
  userId,
  setMemory,
  deleteMemory,
  messages,
  existingKeys = [],
  messageId,
  conversationId,
  validKeys,
  instructions,
  llmConfig,
  streamId = null,
  user,
}: {
  res: ServerResponse;
  setMemory: MemoryMethods['setMemory'];
  deleteMemory: MemoryMethods['deleteMemory'];
  userId: string | ObjectId;
  existingKeys?: string[];
  messageId: string;
  conversationId: string;
  messages: BaseMessage[];
  validKeys?: string[];
  instructions: string;
  llmConfig?: Partial<LLMConfig>;
  streamId?: string | null;
  user?: IUser;
}): Promise<(Partial<TAttachment> | null)[] | undefined> {
  try {
    const memoryTool = createMemoryTool({
      userId,
      setMemory,
      validKeys,
      conversationId,
      messageIds: [messageId],
    });
    // Note: deleteMemoryTool is intentionally NOT registered to prevent AI from deleting memories
    // Users can delete memories through the memory panel in settings

    // Only pass existing keys for dedup — no values, no token stats
    const keysList = existingKeys.length > 0
      ? existingKeys.map((k) => `- ${k}`).join('\n')
      : '(none)';
    const memoryStatus = `# Existing memory keys:\n${keysList}`;

    const defaultLLMConfig: LLMConfig = {
      provider: Providers.OPENAI,
      model: 'gpt-4.1-mini',
      temperature: 0.4,
      streaming: false,
      disableStreaming: true,
    };

    const finalLLMConfig: ClientOptions = {
      ...defaultLLMConfig,
      ...llmConfig,
      /**
       * Ensure streaming is always disabled for memory processing
       */
      streaming: false,
      disableStreaming: true,
    };

    // Handle GPT-5+ models
    if ('model' in finalLLMConfig && /\bgpt-[5-9](?:\.\d+)?\b/i.test(finalLLMConfig.model ?? '')) {
      // Remove temperature for GPT-5+ models
      delete finalLLMConfig.temperature;

      // Move maxTokens to modelKwargs for GPT-5+ models
      if ('maxTokens' in finalLLMConfig && finalLLMConfig.maxTokens != null) {
        const modelKwargs = (finalLLMConfig as OpenAIClientOptions).modelKwargs ?? {};
        const paramName =
          (finalLLMConfig as OpenAIClientOptions).useResponsesApi === true
            ? 'max_output_tokens'
            : 'max_completion_tokens';
        modelKwargs[paramName] = finalLLMConfig.maxTokens;
        delete finalLLMConfig.maxTokens;
        (finalLLMConfig as OpenAIClientOptions).modelKwargs = modelKwargs;
      }
    }

    const bedrockConfig = finalLLMConfig as {
      additionalModelRequestFields?: { thinking?: unknown };
      temperature?: number;
    };
    if (
      llmConfig?.provider === Providers.BEDROCK &&
      bedrockConfig.additionalModelRequestFields?.thinking != null &&
      bedrockConfig.temperature != null
    ) {
      (finalLLMConfig as unknown as Record<string, unknown>).temperature = 1;
    }

    const anthropicConfig = finalLLMConfig as {
      thinking?: { type?: string };
      temperature?: number;
    };
    if (
      llmConfig?.provider === Providers.ANTHROPIC &&
      anthropicConfig.thinking?.type === 'enabled' &&
      anthropicConfig.temperature != null
    ) {
      delete (finalLLMConfig as Record<string, unknown>).temperature;
    }

    const llmConfigWithHeaders = finalLLMConfig as OpenAIClientOptions;
    if (llmConfigWithHeaders?.configuration?.defaultHeaders != null) {
      llmConfigWithHeaders.configuration.defaultHeaders = resolveHeaders({
        headers: llmConfigWithHeaders.configuration.defaultHeaders as Record<string, string>,
        user: user ? createSafeUser(user) : undefined,
      });
    }

    const artifactPromises: Promise<Partial<TAttachment> | null>[] = [];
    const memoryCallback = createMemoryCallback({ res, artifactPromises, streamId });
    const customHandlers = {
      [GraphEvents.TOOL_END]: new BasicToolEndHandler(memoryCallback),
    };

    const configModel = 'model' in finalLLMConfig ? finalLLMConfig.model : undefined;
    logger.info('[memory.ts] processMemory START, provider=' + (llmConfig?.provider || '?') + ', model=' + (configModel || '?') + ', msgs=' + messages.length);

    /**
     * For Bedrock provider, include instructions in the user message instead of as a system prompt.
     * Bedrock's Converse API requires conversations to start with a user message, not a system message.
     * Other providers can use the standard system prompt approach.
     */
    const isBedrock = llmConfig?.provider === Providers.BEDROCK;

    let graphInstructions: string | undefined = instructions;
    let graphAdditionalInstructions: string | undefined = memoryStatus;
    let processedMessages = messages;

    if (isBedrock) {
      const combinedInstructions = [instructions, memoryStatus].filter(Boolean).join('\n\n');

      if (messages.length > 0) {
        const firstMessage = messages[0];
        const originalContent =
          typeof firstMessage.content === 'string' ? firstMessage.content : '';

        if (typeof firstMessage.content !== 'string') {
          logger.warn(
            'Bedrock memory processing: First message has non-string content, using empty string',
          );
        }

        const bedrockUserMessage = new HumanMessage(
          `${combinedInstructions}\n\n${originalContent}`,
        );
        processedMessages = [bedrockUserMessage, ...messages.slice(1)];
      } else {
        processedMessages = [new HumanMessage(combinedInstructions)];
      }

      graphInstructions = undefined;
      graphAdditionalInstructions = undefined;
    }

    const run = await Run.create({
      runId: messageId,
      graphConfig: {
        type: 'standard',
        llmConfig: finalLLMConfig,
        tools: [memoryTool],
        instructions: graphInstructions,
        additional_instructions: graphAdditionalInstructions,
        toolEnd: true,
      },
      customHandlers,
      returnContent: true,
    });

    const config = {
      runName: 'MemoryRun',
      configurable: {
        user_id: userId,
        thread_id: conversationId,
        provider: llmConfig?.provider,
      },
      streamMode: 'values',
      recursionLimit: 3,
      version: 'v2',
    } as const;

    const inputs = {
      messages: processedMessages,
    };
    logger.info('[memory.ts] Memory Agent invoking processStream with ' + processedMessages.length + ' messages');
    const content = await run.processStream(inputs, config);
    if (content) {
      const respContent = typeof content === 'string' ? content : JSON.stringify(content);
      logger.info('[memory.ts] Memory Agent RESPONSE [' + respContent.length + ' chars]: ' + respContent.substring(0, 800));

      // Parse SUGGEST XML: if LLM returns <MEMORY_SUGGESTION>, push as attachment
      // The regex handles both newline chars and JSON-escaped \\n
      const suggestMatch = respContent.match(
        /<MEMORY_SUGGESTION>[\s\\n]*key:\s*(.+?)[\s\\n]+value:\s*(.+?)[\s\\n]+category:\s*(profile|preference|constraint|knowledge)[\s\\n]*<\/MEMORY_SUGGESTION>/,
      );
      if (suggestMatch) {
        const [, key, value, category] = suggestMatch;
        const suggestionArtifact: MemoryArtifact = {
          key: key.trim(),
          value: value.trim(),
          type: 'suggestion',
          category: category.trim() as MemoryArtifact['category'],
          status: 'pending',
        };
        logger.info('[memory.ts] Memory suggestion parsed: key=' + key.trim() + ', category=' + category);

        const attachment: Partial<TAttachment> = {
          type: Tools.memory,
          toolCallId: messageId,
          messageId,
          conversationId,
          [Tools.memory]: suggestionArtifact,
        };

        if (streamId) {
          GenerationJobManager.emitChunk(streamId, { event: 'attachment', data: attachment });
        } else if (!res.headersSent) {
          res.write(`event: attachment\ndata: ${JSON.stringify(attachment)}\n\n`);
        }
        artifactPromises.push(Promise.resolve(attachment));
        return await Promise.all(artifactPromises);
      }
    } else {
      logger.warn('[memory.ts] Memory Agent processed memory but returned no content');
    }
    return await Promise.all(artifactPromises);
  } catch (error) {
    logger.error('Memory Agent failed to process memory', error);
  }
}

export async function createMemoryProcessor({
  res,
  userId,
  messageId,
  memoryMethods,
  conversationId,
  config = {},
  streamId = null,
  user,
}: {
  res: ServerResponse;
  messageId: string;
  conversationId: string;
  userId: string | ObjectId;
  memoryMethods: RequiredMemoryMethods;
  config?: MemoryConfig;
  streamId?: string | null;
  user?: IUser;
}): Promise<[string, (messages: BaseMessage[]) => Promise<(Partial<TAttachment> | null)[] | undefined>]> {
  const { validKeys, instructions, llmConfig, tokenLimit } = config;

  const { withKeys, withoutKeys, totalTokens } = await memoryMethods.getFormattedMemories({
    userId,
  });

  // Extract just the key names from the formatted memory for dedup
  const existingKeys = extractMemoryKeys(withKeys);

  const finalInstructions = instructions || getDefaultInstructions(validKeys, tokenLimit, existingKeys);

  return [
    withoutKeys,
    async function (messages: BaseMessage[]): Promise<(Partial<TAttachment> | null)[] | undefined> {
      try {
        return await processMemory({
          res,
          userId,
          messages,
          validKeys,
          llmConfig,
          messageId,
          streamId,
          conversationId,
          existingKeys,
          instructions: finalInstructions,
          setMemory: memoryMethods.setMemory,
          deleteMemory: memoryMethods.deleteMemory,
          user,
        });
      } catch (error) {
        logger.error('Memory Agent failed to process memory', error);
      }
    },
  ];
}

async function handleMemoryArtifact({
  res,
  data,
  metadata,
  streamId = null,
}: {
  res: ServerResponse;
  data: ToolEndData;
  metadata?: ToolEndMetadata;
  streamId?: string | null;
}) {
  const output = data?.output as ToolMessage | undefined;
  if (!output) {
    return null;
  }

  if (!output.artifact) {
    return null;
  }

  const memoryArtifact = output.artifact[Tools.memory] as MemoryArtifact | undefined;
  if (!memoryArtifact) {
    return null;
  }

  const attachment: Partial<TAttachment> = {
    type: Tools.memory,
    toolCallId: output.tool_call_id,
    messageId: metadata?.run_id ?? '',
    conversationId: metadata?.thread_id ?? '',
    [Tools.memory]: memoryArtifact,
  };
  if (!res.headersSent) {
    return attachment;
  }
  if (streamId) {
    GenerationJobManager.emitChunk(streamId, { event: 'attachment', data: attachment });
  } else {
    res.write(`event: attachment\ndata: ${JSON.stringify(attachment)}\n\n`);
  }
  return attachment;
}

/**
 * Creates a memory callback for handling memory artifacts
 * @param params - The parameters object
 * @param params.res - The server response object
 * @param params.artifactPromises - Array to collect artifact promises
 * @param params.streamId - The stream ID for resumable mode, or null for standard mode
 * @returns The memory callback function
 */
export function createMemoryCallback({
  res,
  artifactPromises,
  streamId = null,
}: {
  res: ServerResponse;
  artifactPromises: Promise<Partial<TAttachment> | null>[];
  streamId?: string | null;
}): ToolEndCallback {
  return async (data: ToolEndData, metadata?: Record<string, unknown>) => {
    const output = data?.output as ToolMessage | undefined;
    const memoryArtifact = output?.artifact?.[Tools.memory] as MemoryArtifact;
    if (memoryArtifact == null) {
      return;
    }
    artifactPromises.push(
      handleMemoryArtifact({ res, data, metadata, streamId }).catch((error) => {
        logger.error('Error processing memory artifact content:', error);
        return null;
      }),
    );
  };
}
