import { buildPiForwardHeaders } from './piRequestHeaders';

describe('buildPiForwardHeaders', () => {
  it('forwards conversation id and language', () => {
    const headers = buildPiForwardHeaders(
      { Authorization: 'Bearer test' },
      'conversation-1',
      'zh-Hans',
    );

    expect(headers).toEqual({
      Authorization: 'Bearer test',
      'X-Conversation-Id': 'conversation-1',
      'Accept-Language': 'zh-Hans',
    });
  });

  it('defaults conversation id to empty string', () => {
    const headers = buildPiForwardHeaders(undefined, undefined);

    expect(headers['X-Conversation-Id']).toBe('');
  });

  it('omits Accept-Language when lang is not provided', () => {
    const headers = buildPiForwardHeaders(undefined, undefined);

    expect(headers['Accept-Language']).toBeUndefined();
  });

  it('forwards context handoff with the branch parent', () => {
    const headers = buildPiForwardHeaders(
      undefined,
      'conv-1',
      'zh-CN',
      'user-1',
      'assistant-1',
      'parent-1',
      { piContextHandoff: false },
      true,
    );

    expect(headers).toMatchObject({
      'X-Parent-Message-Id': 'parent-1',
      'X-PI-Context-Handoff': 'true',
    });
  });
});
