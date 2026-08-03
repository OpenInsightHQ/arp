const { estimateTokens, getPiMaxContextTokens, selectHistoryMessages } = require('./contextBudget');

describe('PI context budget', () => {
  it('uses the DMP value and falls back only when absent or invalid', () => {
    expect(getPiMaxContextTokens({ 'x-pi-max-context-tokens': '200000' })).toBe(200000);
    expect(getPiMaxContextTokens({ 'x-pi-max-context-tokens': '1200.9' })).toBe(1200);
    expect(getPiMaxContextTokens({ 'x-pi-max-context-tokens': '0' })).toBe(100000);
    expect(getPiMaxContextTokens({})).toBe(100000);
  });

  it('reserves 10 percent and counts the current user message first', () => {
    const currentUserMessage = 'x'.repeat(150);
    const result = selectHistoryMessages([], currentUserMessage, 1000);

    expect(result.inputBudget).toBe(900);
    expect(result.historyBudget).toBe(900 - estimateTokens(currentUserMessage));
    expect(result.lines).toEqual([]);
  });

  it('keeps newest history and drops the oldest history when over budget', () => {
    const messages = [
      { isCreatedByUser: true, text: 'OLD-' + 'o'.repeat(150) },
      { isCreatedByUser: false, sender: 'Data Agent', text: 'MID-' + 'm'.repeat(150) },
      { isCreatedByUser: true, text: 'NEW-' + 'n'.repeat(150) },
      { isCreatedByUser: true, text: 'CURRENT' },
    ];

    const result = selectHistoryMessages(messages, 'CURRENT', 365);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toContain('MID-');
    expect(result.lines[1]).toContain('NEW-');
    expect(result.lines.join('\n')).not.toContain('OLD-');
    expect(result.lines.join('\n')).not.toContain('CURRENT');
    expect(result.usedTokens).toBeLessThanOrEqual(result.historyBudget);
  });

  it('only hands off messages after the latest PI reply', () => {
    const messages = [
      { isCreatedByUser: true, text: 'BEFORE-PI' },
      { isCreatedByUser: false, endpoint: 'pi', sender: 'ONE PI', text: 'PI-REPLY' },
      { isCreatedByUser: false, endpoint: 'agents', sender: 'Data Agent', text: 'AFTER-PI' },
      { isCreatedByUser: true, text: 'CURRENT' },
    ];

    const result = selectHistoryMessages(messages, 'CURRENT', 1000);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain('AFTER-PI');
    expect(result.lines.join('\n')).not.toContain('BEFORE-PI');
    expect(result.lines.join('\n')).not.toContain('PI-REPLY');
  });

  it('returns no history when the current message alone exhausts the input budget', () => {
    const messages = [
      { isCreatedByUser: false, sender: 'Data Agent', text: 'SHOULD-NOT-FIT' },
      { isCreatedByUser: true, text: 'x'.repeat(1400) },
    ];

    const result = selectHistoryMessages(messages, 'x'.repeat(1400), 1000);

    expect(result.historyBudget).toBe(0);
    expect(result.lines).toEqual([]);
  });
});
