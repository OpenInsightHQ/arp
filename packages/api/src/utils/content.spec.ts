import { ContentTypes, ToolCallTypes } from 'librechat-data-provider';
import type {
  Agents,
  ContentMetadata,
  PartMetadata,
  TMessageContentParts,
} from 'librechat-data-provider';
import type { ToolCall } from '@langchain/core/messages/tool';
import {
  applyCollectedUsageToContentParts,
  createTimestampTracker,
  extractCacheTokens,
  extractToolCallIds,
  filterMalformedContentParts,
} from './content';

describe('filterMalformedContentParts', () => {
  describe('basic filtering', () => {
    it('should keep valid tool_call content parts', () => {
      const parts: TMessageContentParts[] = [
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {
            id: 'test-id',
            name: 'test_function',
            type: ToolCallTypes.TOOL_CALL,
            args: '{}',
            progress: 1,
            output: 'result',
          },
        },
      ];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(parts[0]);
    });

    it('should filter out malformed tool_call content parts without tool_call property', () => {
      const parts: TMessageContentParts[] = [
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
      ];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(0);
    });

    it('should keep other content types unchanged', () => {
      const parts: TMessageContentParts[] = [
        { type: ContentTypes.TEXT, text: 'Hello world' },
        { type: ContentTypes.THINK, think: 'Thinking...' },
      ];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(2);
      expect(result).toEqual(parts);
    });

    it('should filter out null or undefined parts', () => {
      const parts = [
        { type: ContentTypes.TEXT, text: 'Valid' },
        null,
        undefined,
        { type: ContentTypes.TEXT, text: 'Also valid' },
      ] as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('text', 'Valid');
      expect(result[1]).toHaveProperty('text', 'Also valid');
    });

    it('should return non-array input unchanged', () => {
      const notAnArray = { some: 'object' };
      const result = filterMalformedContentParts(notAnArray);
      expect(result).toBe(notAnArray);
    });
  });

  describe('real-life example with multiple tool calls', () => {
    it('should filter out malformed tool_call entries from actual MCP response', () => {
      const parts: TMessageContentParts[] = [
        {
          type: ContentTypes.THINK,
          think:
            'The user is asking for 10 different time zones, similar to what would be displayed in a stock trading room floor.',
        },
        {
          type: ContentTypes.TEXT,
          text: '# Global Market Times\n\nShowing current time in 10 major financial centers:',
          tool_call_ids: ['tooluse_Yjfib8PoRXCeCcHRH0JqCw'],
        },
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {
            id: 'tooluse_Yjfib8PoRXCeCcHRH0JqCw',
            name: 'get_current_time_mcp_time',
            args: '{"timezone":"America/New_York"}',
            type: ToolCallTypes.TOOL_CALL,
            progress: 1,
            output: '{"timezone":"America/New_York","datetime":"2025-11-13T13:43:17-05:00"}',
          },
        },
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {
            id: 'tooluse_CPsGv9kXTrewVkcO7BEYIg',
            name: 'get_current_time_mcp_time',
            args: '{"timezone":"Europe/London"}',
            type: ToolCallTypes.TOOL_CALL,
            progress: 1,
            output: '{"timezone":"Europe/London","datetime":"2025-11-13T18:43:19+00:00"}',
          },
        },
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {
            id: 'tooluse_5jihRbd4TDWCGebwmAUlfQ',
            name: 'get_current_time_mcp_time',
            args: '{"timezone":"Asia/Tokyo"}',
            type: ToolCallTypes.TOOL_CALL,
            progress: 1,
            output: '{"timezone":"Asia/Tokyo","datetime":"2025-11-14T03:43:21+09:00"}',
          },
        },
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        { type: ContentTypes.TOOL_CALL } as TMessageContentParts,
        {
          type: ContentTypes.TEXT,
          text: '## Major Financial Markets Clock:\n\n| Market | Local Time | Day |',
        },
      ];

      const result = filterMalformedContentParts(parts);

      expect(result).toHaveLength(6);

      expect(result[0].type).toBe(ContentTypes.THINK);
      expect(result[1].type).toBe(ContentTypes.TEXT);
      expect(result[2].type).toBe(ContentTypes.TOOL_CALL);
      expect(result[3].type).toBe(ContentTypes.TOOL_CALL);
      expect(result[4].type).toBe(ContentTypes.TOOL_CALL);
      expect(result[5].type).toBe(ContentTypes.TEXT);

      const toolCalls = result.filter((part) => part.type === ContentTypes.TOOL_CALL);
      expect(toolCalls).toHaveLength(3);

      toolCalls.forEach((toolCall) => {
        if (toolCall.type === ContentTypes.TOOL_CALL) {
          expect(toolCall.tool_call).toBeDefined();
          expect(toolCall.tool_call).toHaveProperty('id');
          expect(toolCall.tool_call).toHaveProperty('name');
        }
      });
    });

    it('should handle empty array', () => {
      const result = filterMalformedContentParts([]);
      expect(result).toEqual([]);
    });

    it('should handle array with only malformed tool calls', () => {
      const parts = [
        { type: ContentTypes.TOOL_CALL },
        { type: ContentTypes.TOOL_CALL },
        { type: ContentTypes.TOOL_CALL },
      ] as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should filter out tool_call with null tool_call property', () => {
      const parts = [
        { type: ContentTypes.TOOL_CALL, tool_call: null as unknown as ToolCall },
      ] as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(0);
    });

    it('should filter out tool_call with non-object tool_call property', () => {
      const parts = [
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: 'not an object' as unknown as ToolCall & PartMetadata,
        },
      ] as TMessageContentParts[];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(0);
    });

    it('should keep tool_call with empty object as tool_call', () => {
      const parts: TMessageContentParts[] = [
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {} as unknown as Agents.ToolCall & PartMetadata,
        },
      ];

      const result = filterMalformedContentParts(parts);
      expect(result).toHaveLength(1);
    });
  });
});

describe('createTimestampTracker', () => {
  const meta = (part: TMessageContentParts) => part as TMessageContentParts & ContentMetadata;

  it('records startTime for new parts and leaves endTime undefined until closed', () => {
    const tracker = createTimestampTracker();
    const parts: TMessageContentParts[] = [{ type: ContentTypes.THINK, think: 'hmm' }];

    tracker.markStart(parts);
    tracker.apply(parts);

    expect(meta(parts[0]).startTime).toBeDefined();
    expect(meta(parts[0]).endTime).toBeUndefined();
  });

  it('auto-closes the preceding part when a new part appears in markStart', () => {
    const tracker = createTimestampTracker();
    const parts: TMessageContentParts[] = [{ type: ContentTypes.THINK, think: 'step 1' }];

    tracker.markStart(parts);

    parts.push({ type: ContentTypes.TEXT, text: 'answer' });
    tracker.markStart(parts);
    tracker.apply(parts);

    expect(meta(parts[0]).endTime).toBeDefined();
    expect(meta(parts[0]).endTime).toBe(meta(parts[1]).startTime);
  });

  it('does not auto-close when markStart is called without new parts', () => {
    const tracker = createTimestampTracker();
    const parts: TMessageContentParts[] = [{ type: ContentTypes.THINK, think: 'hmm' }];

    tracker.markStart(parts);
    tracker.markStart(parts);
    tracker.apply(parts);

    expect(meta(parts[0]).endTime).toBeUndefined();
  });

  it('markAllEnd does not overwrite endTime from auto-close', () => {
    const tracker = createTimestampTracker();
    const parts: TMessageContentParts[] = [{ type: ContentTypes.THINK, think: 'step 1' }];

    tracker.markStart(parts);
    parts.push({ type: ContentTypes.TEXT, text: 'answer' });
    tracker.markStart(parts);
    tracker.markAllEnd(parts);
    tracker.apply(parts);

    const thinkEnd = meta(parts[0]).endTime;
    const textEnd = meta(parts[1]).endTime;

    expect(thinkEnd).toBeDefined();
    expect(textEnd).toBeDefined();
    expect(textEnd).toBeGreaterThanOrEqual(thinkEnd!);
  });

  it('markEnd does not overwrite auto-closed endTime', () => {
    const tracker = createTimestampTracker();
    const parts: TMessageContentParts[] = [
      { type: ContentTypes.THINK, think: 'reasoning' },
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: { id: 'tc1', name: 'search', type: ToolCallTypes.TOOL_CALL, args: '{}' },
      },
    ];

    tracker.markStart([parts[0]]);
    tracker.markStart(parts);
    tracker.markEnd(1);
    tracker.apply(parts);

    const toolEnd = meta(parts[1]).endTime;
    expect(toolEnd).toBeDefined();

    tracker.markEnd(1);
    tracker.apply(parts);
    expect(meta(parts[1]).endTime).toBe(toolEnd);
  });

  it('simulates full agent stream: THINK → TOOL_CALL → THINK → TEXT', () => {
    const tracker = createTimestampTracker();
    const parts: TMessageContentParts[] = [];

    parts.push({ type: ContentTypes.THINK, think: 'Let me think...' });
    tracker.markStart(parts);

    parts.push({
      type: ContentTypes.TOOL_CALL,
      tool_call: { id: 'tc1', name: 'search', type: ToolCallTypes.TOOL_CALL, args: '{}' },
    });
    tracker.markStart(parts);
    tracker.markEnd(1);

    parts.push({ type: ContentTypes.THINK, think: 'Analyzing result...' });
    tracker.markStart(parts);

    parts.push({ type: ContentTypes.TEXT, text: 'Here is the answer.' });
    tracker.markStart(parts);

    tracker.markAllEnd(parts);
    tracker.apply(parts);

    const think0 = meta(parts[0]);
    const tool1 = meta(parts[1]);
    const think2 = meta(parts[2]);
    const text3 = meta(parts[3]);

    expect(think0.startTime).toBeDefined();
    expect(think0.endTime).toBeDefined();
    expect(think0.endTime).toBe(tool1.startTime);

    expect(tool1.startTime).toBeDefined();
    expect(tool1.endTime).toBeDefined();
    expect(tool1.endTime).toBeLessThanOrEqual(think2.startTime!);

    expect(think2.startTime).toBeDefined();
    expect(think2.endTime).toBeDefined();
    expect(think2.endTime).toBe(text3.startTime);

    expect(text3.startTime).toBeDefined();
    expect(text3.endTime).toBeDefined();
  });

  it('skips null entries without setting start/end times', () => {
    const tracker = createTimestampTracker();
    const parts = [null, { type: ContentTypes.TEXT, text: 'valid' }] as TMessageContentParts[];

    tracker.markStart(parts);
    parts.push({ type: ContentTypes.TEXT, text: 'second' });
    tracker.markStart(parts);
    tracker.markAllEnd(parts);
    tracker.apply(parts);

    expect(meta(parts[1]).startTime).toBeDefined();
    expect(meta(parts[2]).startTime).toBeDefined();
  });
});

describe('extractToolCallIds', () => {
  it('returns [] for null/undefined/non-object output', () => {
    expect(extractToolCallIds(null)).toEqual([]);
    expect(extractToolCallIds(undefined)).toEqual([]);
    expect(extractToolCallIds('string')).toEqual([]);
  });

  it('returns [] when tool_calls is missing or empty', () => {
    expect(extractToolCallIds({})).toEqual([]);
    expect(extractToolCallIds({ tool_calls: [] })).toEqual([]);
  });

  it('extracts IDs from tool_calls array', () => {
    const output = {
      tool_calls: [
        { id: 'call_1', name: 'search', args: '{}' },
        { id: 'call_2', name: 'fetch', args: '{}' },
      ],
    };
    expect(extractToolCallIds(output)).toEqual(['call_1', 'call_2']);
  });

  it('filters out entries with missing/empty/non-string IDs', () => {
    const output = {
      tool_calls: [
        { id: 'good', name: 'a', args: '{}' },
        { id: '', name: 'b', args: '{}' },
        { id: undefined, name: 'c', args: '{}' },
        { id: 123, name: 'd', args: '{}' },
        { name: 'e', args: '{}' },
      ],
    };
    expect(extractToolCallIds(output)).toEqual(['good']);
  });
});

describe('applyCollectedUsageToContentParts', () => {
  const makeToolCall = (id: string): TMessageContentParts => ({
    type: ContentTypes.TOOL_CALL,
    tool_call: {
      id,
      name: 'search',
      type: ToolCallTypes.TOOL_CALL,
      args: '{}',
    },
  });

  it('applies tokens to tool_call parts matching by tool_call.id', () => {
    const parts: TMessageContentParts[] = [
      makeToolCall('call_1'),
      { type: ContentTypes.TEXT, text: 'hello' },
      makeToolCall('call_2'),
      makeToolCall('call_3'),
    ];
    applyCollectedUsageToContentParts(parts, [
      {
        input_tokens: 100,
        output_tokens: 50,
        toolCallIds: ['call_1', 'call_2'],
      },
    ]);
    expect(parts[0].inputTokens).toBe(100);
    expect(parts[0].outputTokens).toBe(50);
    expect(parts[2].inputTokens).toBe(100);
    expect(parts[2].outputTokens).toBe(50);
    expect(parts[3].inputTokens).toBeUndefined();
  });

  it('handles multiple usage entries with different toolCallIds', () => {
    const parts: TMessageContentParts[] = [makeToolCall('a'), makeToolCall('b')];
    applyCollectedUsageToContentParts(parts, [
      { input_tokens: 10, output_tokens: 5, toolCallIds: ['a'] },
      { input_tokens: 20, output_tokens: 8, toolCallIds: ['b'] },
    ]);
    expect(parts[0].inputTokens).toBe(10);
    expect(parts[0].outputTokens).toBe(5);
    expect(parts[1].inputTokens).toBe(20);
    expect(parts[1].outputTokens).toBe(8);
  });

  it('skips usage entries without toolCallIds', () => {
    const parts: TMessageContentParts[] = [makeToolCall('a')];
    applyCollectedUsageToContentParts(parts, [
      { input_tokens: 10, output_tokens: 5 },
      { input_tokens: 20, output_tokens: 8, toolCallIds: [] },
    ]);
    expect(parts[0].inputTokens).toBeUndefined();
  });

  it('is a no-op for empty/null inputs', () => {
    const parts: TMessageContentParts[] = [];
    applyCollectedUsageToContentParts(parts, []);
    applyCollectedUsageToContentParts([], [{ input_tokens: 1, toolCallIds: ['x'] }]);
    applyCollectedUsageToContentParts(null, null);
    expect(parts).toEqual([]);
  });

  it('coerces non-numeric tokens to 0', () => {
    const parts: TMessageContentParts[] = [makeToolCall('a')];
    applyCollectedUsageToContentParts(parts, [
      { input_tokens: undefined, output_tokens: NaN, toolCallIds: ['a'] },
    ]);
    expect(parts[0].inputTokens).toBe(0);
    expect(parts[0].outputTokens).toBe(0);
  });

  it('does not match by tool_call.id when missing on the part', () => {
    const parts: TMessageContentParts[] = [
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: { name: 'noId', type: ToolCallTypes.TOOL_CALL, args: '{}' },
      },
    ];
    applyCollectedUsageToContentParts(parts, [
      { input_tokens: 10, output_tokens: 5, toolCallIds: ['whatever'] },
    ]);
    expect(parts[0].inputTokens).toBeUndefined();
  });

  it('does not modify text/think parts', () => {
    const parts: TMessageContentParts[] = [
      { type: ContentTypes.TEXT, text: 'hi' },
      { type: ContentTypes.THINK, think: 'hmm' },
      makeToolCall('call_1'),
    ];
    applyCollectedUsageToContentParts(parts, [
      { input_tokens: 5, output_tokens: 3, toolCallIds: ['call_1'] },
    ]);
    expect(parts[0].inputTokens).toBeUndefined();
    expect(parts[1].inputTokens).toBeUndefined();
    expect(parts[2].inputTokens).toBe(5);
  });

  it('survives aggregator replacing parts (simulated)', () => {
    /** Simulate: ON_RUN_STEP creates part, ON_RUN_STEP_COMPLETED replaces it.
     *  The new part has the same tool_call.id, so matching still works. */
    const originalParts: TMessageContentParts[] = [makeToolCall('call_1')];
    const usage = [{ input_tokens: 42, output_tokens: 7, toolCallIds: ['call_1'] }];

    /** Aggregator replaces the part with a new object (no extra fields). */
    originalParts[0] = {
      type: ContentTypes.TOOL_CALL,
      tool_call: {
        id: 'call_1',
        name: 'search',
        type: ToolCallTypes.TOOL_CALL,
        args: '{"q":"final"}',
        progress: 1,
        output: 'result',
      },
    };

    applyCollectedUsageToContentParts(originalParts, usage);
    expect(originalParts[0].inputTokens).toBe(42);
    expect(originalParts[0].outputTokens).toBe(7);
  });

  it('writes cacheCreationTokens / cacheReadTokens onto matching parts', () => {
    const parts: TMessageContentParts[] = [makeToolCall('call_1')];
    applyCollectedUsageToContentParts(parts, [
      {
        input_tokens: 100,
        output_tokens: 50,
        cacheCreationTokens: 200,
        cacheReadTokens: 300,
        toolCallIds: ['call_1'],
      },
    ]);
    expect(parts[0].inputTokens).toBe(100);
    expect(parts[0].outputTokens).toBe(50);
    expect(parts[0].cacheCreationTokens).toBe(200);
    expect(parts[0].cacheReadTokens).toBe(300);
  });

  it('defaults missing cache fields to 0 on matching parts', () => {
    const parts: TMessageContentParts[] = [makeToolCall('call_1')];
    applyCollectedUsageToContentParts(parts, [
      { input_tokens: 100, output_tokens: 50, toolCallIds: ['call_1'] },
    ]);
    expect(parts[0].cacheCreationTokens).toBe(0);
    expect(parts[0].cacheReadTokens).toBe(0);
  });
});

describe('extractCacheTokens', () => {
  it('returns {0, 0} for null/undefined/non-object usage', () => {
    expect(extractCacheTokens(null)).toEqual({ cacheCreation: 0, cacheRead: 0 });
    expect(extractCacheTokens(undefined)).toEqual({ cacheCreation: 0, cacheRead: 0 });
    expect(extractCacheTokens('string')).toEqual({ cacheCreation: 0, cacheRead: 0 });
  });

  it('returns {0, 0} when no cache fields present', () => {
    expect(extractCacheTokens({ input_tokens: 100 })).toEqual({
      cacheCreation: 0,
      cacheRead: 0,
    });
  });

  it('reads OpenAI-format cache tokens from input_token_details', () => {
    const usage = {
      input_tokens: 100,
      input_token_details: { cache_creation: 250, cache_read: 750 },
    };
    expect(extractCacheTokens(usage)).toEqual({ cacheCreation: 250, cacheRead: 750 });
  });

  it('reads Anthropic-format cache tokens', () => {
    const usage = {
      input_tokens: 100,
      cache_creation_input_tokens: 400,
      cache_read_input_tokens: 600,
    };
    expect(extractCacheTokens(usage)).toEqual({ cacheCreation: 400, cacheRead: 600 });
  });

  it('prefers OpenAI format when both present (OpenAI checked first)', () => {
    const usage = {
      input_token_details: { cache_creation: 10, cache_read: 20 },
      cache_creation_input_tokens: 999,
      cache_read_input_tokens: 888,
    };
    expect(extractCacheTokens(usage)).toEqual({ cacheCreation: 10, cacheRead: 20 });
  });

  it('coerces falsy / non-numeric values to 0', () => {
    const usage = {
      input_token_details: { cache_creation: 0, cache_read: undefined },
    };
    expect(extractCacheTokens(usage)).toEqual({ cacheCreation: 0, cacheRead: 0 });
  });

  it('handles partial OpenAI-format (only one of creation/read)', () => {
    const usage = {
      input_token_details: { cache_read: 500 },
    };
    expect(extractCacheTokens(usage)).toEqual({ cacheCreation: 0, cacheRead: 500 });
  });

  it('handles partial Anthropic-format (only one of creation/read)', () => {
    const usage = {
      cache_creation_input_tokens: 500,
    };
    expect(extractCacheTokens(usage)).toEqual({ cacheCreation: 500, cacheRead: 0 });
  });
});
