const {
  estimateTokens,
  truncateTextToTokenBudget,
  selectHistoryMessages,
  getPiMaxContextTokens,
  isPiContextHandoffEnabled,
} = require('./contextBudget');

describe('PI context budget', () => {
  test('estimates tokens conservatively from text length', () => {
    expect(estimateTokens('12345678')).toBe(2);
  });

  test('preserves both the beginning and end when truncating', () => {
    const text = `${'A'.repeat(120)}${'Z'.repeat(120)}`;
    const result = truncateTextToTokenBudget(text, 30, {
      charsPerToken: 2,
      tailTokens: 10,
      marker: '[cut]',
    });

    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.startsWith('A')).toBe(true);
    expect(result).toContain('[cut]');
    expect(result.endsWith('Z'.repeat(20))).toBe(true);
  });

  test('selects only the newest contiguous branch history within budget', () => {
    const messages = [
      { messageId: 'old', text: 'A'.repeat(80) },
      { messageId: 'middle', text: 'B'.repeat(20) },
      { messageId: 'new', text: 'C'.repeat(20) },
    ];

    expect(selectHistoryMessages(messages, 36, { charsPerToken: 4 })).toEqual([
      messages[1],
      messages[2],
    ]);
  });

  test('uses request value before environment value for max context tokens', () => {
    expect(getPiMaxContextTokens('64000', { PI_MAX_CONTEXT_TOKENS: '32000' })).toBe(64000);
  });

  test('enables handoff by default and accepts explicit disable values', () => {
    expect(isPiContextHandoffEnabled(undefined, undefined, {})).toBe(true);
    expect(isPiContextHandoffEnabled('false', true, {})).toBe(false);
    expect(isPiContextHandoffEnabled(undefined, 'off', {})).toBe(false);
  });
});
