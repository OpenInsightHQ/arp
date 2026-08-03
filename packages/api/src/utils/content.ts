import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts, ContentMetadata } from 'librechat-data-provider';
/**
 * Filters out malformed tool call content parts that don't have the required tool_call property.
 * This handles edge cases where tool_call content parts may be created with only a type property
 * but missing the actual tool_call data.
 *
 * @param contentParts - Array of content parts to filter
 * @returns Filtered array with malformed tool calls removed
 *
 * @example
 * // Removes malformed tool_call without the tool_call property
 * const parts = [
 *   { type: 'tool_call', tool_call: { id: '123', name: 'test' } }, // valid - kept
 *   { type: 'tool_call' }, // invalid - filtered out
 *   { type: 'text', text: 'Hello' }, // valid - kept (other types pass through)
 * ];
 * const filtered = filterMalformedContentParts(parts);
 * // Returns all parts except the malformed tool_call
 */
export function filterMalformedContentParts(
  contentParts: TMessageContentParts[],
): TMessageContentParts[];
export function filterMalformedContentParts<T>(contentParts: T): T;
export function filterMalformedContentParts<T>(
  contentParts: T | TMessageContentParts[],
): T | TMessageContentParts[] {
  if (!Array.isArray(contentParts)) {
    return contentParts;
  }

  return contentParts.filter((part) => {
    if (!part || typeof part !== 'object') {
      return false;
    }

    const { type } = part;

    if (type === ContentTypes.TOOL_CALL) {
      return 'tool_call' in part && part.tool_call != null && typeof part.tool_call === 'object';
    }

    return true;
  });
}

export interface TimestampTracker {
  markStart: (contentParts: TMessageContentParts[]) => void;
  markEnd: (index: number) => void;
  markAllEnd: (contentParts: TMessageContentParts[]) => void;
  apply: (contentParts: TMessageContentParts[]) => void;
}

export function createTimestampTracker(): TimestampTracker {
  const startTimes = new Map<number, number>();
  const endTimes = new Map<number, number>();

  return {
    /**
     * Records start times for new parts and auto-closes the preceding part.
     * In sequential agent streaming each content part (THINK / TOOL_CALL /
     * TEXT) finishes when the next one begins, so the previous part's endTime
     * is set to `now` when a new part appears.
     *
     * Without auto-closing, THINK and TEXT parts never receive an explicit
     * `markEnd` call (only `tool_call` parts do, via `on_run_step_completed`),
     * so their endTime defaults to `markAllEnd` at request completion and
     * every step shows the full request duration.
     */
    markStart(contentParts: TMessageContentParts[]) {
      const now = Date.now();
      for (let i = 0; i < contentParts.length; i++) {
        if (contentParts[i] != null && !startTimes.has(i)) {
          startTimes.set(i, now);
          if (i > 0 && startTimes.has(i - 1) && !endTimes.has(i - 1)) {
            endTimes.set(i - 1, now);
          }
        }
      }
    },
    markEnd(index: number) {
      if (!endTimes.has(index)) {
        endTimes.set(index, Date.now());
      }
    },
    markAllEnd(contentParts: TMessageContentParts[]) {
      const now = Date.now();
      for (let i = 0; i < contentParts.length; i++) {
        if (contentParts[i] != null && !endTimes.has(i)) {
          endTimes.set(i, now);
        }
      }
    },
    apply(contentParts: TMessageContentParts[]) {
      for (const [index, startTime] of startTimes) {
        const part = contentParts[index] as (TMessageContentParts & ContentMetadata) | undefined;
        if (part) {
          part.startTime = startTime;
        }
      }
      for (const [index, endTime] of endTimes) {
        const part = contentParts[index] as (TMessageContentParts & ContentMetadata) | undefined;
        if (part) {
          part.endTime = endTime;
        }
      }
    },
  };
}

/**
 * Usage metadata enriched with the IDs of tool calls produced by the same
 * LLM invocation. The IDs are extracted from `data.output.tool_calls` in the
 * `on_chat_model_end` handler and used to reliably match usage back to
 * content parts — `tool_call.id` survives aggregator replacements, unlike
 * ad-hoc step/runId tags which `ON_RUN_STEP_COMPLETED` wipes.
 *
 * Cache token fields are normalized from provider-specific shapes
 * (OpenAI `input_token_details.cache_*` / Anthropic `cache_*_input_tokens`)
 * by `extractCacheTokens` before the entry is pushed to `collectedUsage`.
 */
export interface UsageWithToolCallIds {
  input_tokens?: number;
  output_tokens?: number;
  /** Prompt-cache write tokens (cache_creation), normalized across providers. */
  cacheCreationTokens?: number;
  /** Prompt-cache read tokens (cache_read), normalized across providers. */
  cacheReadTokens?: number;
  /** IDs of tool calls produced by this model call; populated from `data.output.tool_calls` */
  toolCallIds?: string[];
}

/**
 * Extract tool-call IDs from a LangChain `on_chat_model_end` output.
 * The output is an `AIMessage` whose `tool_calls` array contains
 * `{ id, name, args }` entries. Returns an empty array when no tool calls
 * are present (text-only / reasoning-only model responses).
 */
export function extractToolCallIds(output: unknown): string[] {
  if (!output || typeof output !== 'object') {
    return [];
  }
  const toolCalls = (output as { tool_calls?: Array<{ id?: string }> }).tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
  }
  const ids: string[] = [];
  for (const tc of toolCalls) {
    if (tc && typeof tc.id === 'string' && tc.id !== '') {
      ids.push(tc.id);
    }
  }
  return ids;
}

/**
 * Normalize prompt-cache token counts across the two provider formats:
 * - OpenAI: `input_token_details.cache_creation` / `input_token_details.cache_read`
 * - Anthropic: `cache_creation_input_tokens` / `cache_read_input_tokens`
 *
 * Returns `{ 0, 0 }` when the provider does not report cache data (most non-caching
 * models). Mutually exclusive: a given usage object uses at most one format.
 */
export function extractCacheTokens(usage: unknown): {
  cacheCreation: number;
  cacheRead: number;
} {
  if (!usage || typeof usage !== 'object') {
    return { cacheCreation: 0, cacheRead: 0 };
  }
  const u = usage as {
    input_token_details?: { cache_creation?: number; cache_read?: number };
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  return {
    cacheCreation:
      Number(u.input_token_details?.cache_creation) || Number(u.cache_creation_input_tokens) || 0,
    cacheRead: Number(u.input_token_details?.cache_read) || Number(u.cache_read_input_tokens) || 0,
  };
}

/** Token fields written onto each matching tool_call content part. */
interface PartTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Deferred application: walks an array of collected usage entries (each
 * carrying the IDs of the tool calls its producing model call emitted) and
 * writes `inputTokens` / `outputTokens` / `cacheCreationTokens` /
 * `cacheReadTokens` onto every matching `tool_call` content part.
 *
 * Matching is by `tool_call.id`, which is stable across the aggregator's
 * `ON_RUN_STEP` / `ON_RUN_STEP_DELTA` / `ON_RUN_STEP_COMPLETED` replacements
 * — unlike step/runId tags.
 *
 * Each matching part receives the full token counts of the producing call
 * (no splitting), mirroring how the balance is charged per-call. Note that
 * `inputTokens` excludes cache tokens: cache write/read are recorded in
 * their own fields to preserve the rate-tier distinction.
 *
 * Must be called AFTER `processStream` completes (so all
 * `ON_RUN_STEP_COMPLETED` events have fired and parts are final).
 */
export function applyCollectedUsageToContentParts(
  contentParts: TMessageContentParts[] | undefined,
  collectedUsage: UsageWithToolCallIds[] | undefined,
): void {
  if (
    !Array.isArray(contentParts) ||
    !Array.isArray(collectedUsage) ||
    collectedUsage.length === 0
  ) {
    return;
  }

  /** Map<toolCallId, PartTokens> — single pass over usage. */
  const usageByToolCallId = new Map<string, PartTokens>();
  for (const usage of collectedUsage) {
    if (!usage || !Array.isArray(usage.toolCallIds) || usage.toolCallIds.length === 0) {
      continue;
    }
    const tokens: PartTokens = {
      inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
      cacheCreationTokens: Number(usage.cacheCreationTokens) || 0,
      cacheReadTokens: Number(usage.cacheReadTokens) || 0,
    };
    for (const id of usage.toolCallIds) {
      usageByToolCallId.set(id, tokens);
    }
  }

  if (usageByToolCallId.size === 0) {
    return;
  }

  /** Single pass over content parts — apply tokens to matching tool_calls. */
  for (const part of contentParts) {
    if (!part || part.type !== ContentTypes.TOOL_CALL) {
      continue;
    }
    const id = part.tool_call?.id;
    if (typeof id !== 'string' || id === '') {
      continue;
    }
    const tokens = usageByToolCallId.get(id);
    if (tokens) {
      const meta = part as TMessageContentParts & ContentMetadata;
      meta.inputTokens = tokens.inputTokens;
      meta.outputTokens = tokens.outputTokens;
      meta.cacheCreationTokens = tokens.cacheCreationTokens;
      meta.cacheReadTokens = tokens.cacheReadTokens;
    }
  }
}
