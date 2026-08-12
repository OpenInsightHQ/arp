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
});
