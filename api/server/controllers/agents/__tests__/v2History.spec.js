const { getThreadMessages, convertHistoryMessage } = require('../v2History');

const NO_PARENT = '00000000-0000-0000-0000-000000000000';

describe('getThreadMessages', () => {
  it('orders the parent chain root→leaf', () => {
    const messages = [
      { messageId: 'm1', parentMessageId: NO_PARENT },
      { messageId: 'm2', parentMessageId: 'm1' },
      { messageId: 'm3', parentMessageId: 'm2' },
    ];
    expect(getThreadMessages(messages, 'm3').map((m) => m.messageId)).toEqual(['m1', 'm2', 'm3']);
  });

  it('excludes branch siblings (regenerate forks)', () => {
    const messages = [
      { messageId: 'm1', parentMessageId: NO_PARENT },
      { messageId: 'm2a', parentMessageId: 'm1' },
      { messageId: 'm2b', parentMessageId: 'm1' },
      { messageId: 'm3', parentMessageId: 'm2b' },
    ];
    expect(getThreadMessages(messages, 'm3').map((m) => m.messageId)).toEqual(['m1', 'm2b', 'm3']);
  });

  it('stops on unknown leaf and cycles', () => {
    const cyclic = [
      { messageId: 'a', parentMessageId: 'b' },
      { messageId: 'b', parentMessageId: 'a' },
    ];
    expect(getThreadMessages(cyclic, 'a').map((m) => m.messageId)).toEqual(['b', 'a']);
    expect(getThreadMessages([{ messageId: 'x', parentMessageId: NO_PARENT }], 'missing')).toEqual(
      [],
    );
  });
});

describe('convertHistoryMessage', () => {
  it('converts a user message with images into text + image_url parts', () => {
    const msg = { messageId: 'u1', isCreatedByUser: true, text: 'look at this' };
    const imageUrls = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }];
    expect(convertHistoryMessage(msg, imageUrls)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
        ],
      },
    ]);
  });

  it('converts a user message without images to a plain string content', () => {
    const msg = { messageId: 'u1', isCreatedByUser: true, text: 'hello' };
    expect(convertHistoryMessage(msg, undefined)).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('keeps TEXT parts only for assistant messages (THINK dropped, not concatenated)', () => {
    const msg = {
      messageId: 'a1',
      isCreatedByUser: false,
      text: '',
      content: [
        { type: 'think', think: 'internal reasoning' },
        { type: 'text', text: 'final answer' },
      ],
    };
    expect(convertHistoryMessage(msg, undefined)).toEqual([
      { role: 'assistant', content: 'final answer' },
    ]);
  });

  it('emits tool_calls + tool pairs for assistant tool messages', () => {
    const msg = {
      messageId: 'a2',
      isCreatedByUser: false,
      text: '',
      content: [
        { type: 'text', text: 'running tool' },
        {
          type: 'tool_call',
          tool_call: { id: 'tc1', name: 'execute_skill', args: { skillName: 'x' }, output: 'ok' },
        },
        { type: 'text', text: 'done' },
      ],
    };
    const result = convertHistoryMessage(msg, undefined);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: 'assistant',
      content: 'running tooldone',
      tool_calls: [
        {
          id: 'tc1',
          type: 'function',
          function: { name: 'execute_skill', arguments: JSON.stringify({ skillName: 'x' }) },
        },
      ],
    });
    expect(result[1]).toEqual({ role: 'tool', tool_call_id: 'tc1', content: 'ok' });
  });

  it('falls back to msg.text for content-less messages', () => {
    const msg = { messageId: 'a3', isCreatedByUser: false, text: 'legacy' };
    expect(convertHistoryMessage(msg, undefined)).toEqual([
      { role: 'assistant', content: 'legacy' },
    ]);
  });
});
