import { buildPiForwardHeaders } from './piRequestHeaders';

describe('buildPiForwardHeaders', () => {
  it.each([1000, 200000])('forwards DMP piMaxContextTokens value %s', (maxContextTokens) => {
    const headers = buildPiForwardHeaders(
      { Authorization: 'Bearer test' },
      'conversation-1',
      true,
      maxContextTokens,
    );

    expect(headers).toEqual({
      Authorization: 'Bearer test',
      'X-Conversation-Id': 'conversation-1',
      'X-PI-Context-Handoff': 'true',
      'X-PI-Max-Context-Tokens': String(maxContextTokens),
    });
  });

  it('marks ordinary PI requests as no handoff', () => {
    const headers = buildPiForwardHeaders(undefined, undefined, false, 100000);

    expect(headers['X-PI-Context-Handoff']).toBe('false');
    expect(headers['X-PI-Max-Context-Tokens']).toBe('100000');
  });
});
