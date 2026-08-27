/**
 * Unit tests for the shared pi file-links footer module
 */

const mockBuildPiFileLinks = jest.fn();
const mockFilterPiResultFiles = jest.fn();
const mockCollectPiGeneratedFiles = jest.fn();

jest.mock('./PIService', () => ({
  collectPiGeneratedFiles: (...args) => mockCollectPiGeneratedFiles(...args),
  buildPiFileLinks: (...args) => mockBuildPiFileLinks(...args),
  filterPiResultFiles: (...args) => mockFilterPiResultFiles(...args),
  isIntermediateArtifact: (path) => /_work/.test(String(path)),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const { appendPiFileLinks } = require('./PiFileFooter');

describe('appendPiFileLinks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null and does not mutate when nothing is staged', async () => {
    const req = {};
    const response = { text: 'answer', content: [{ type: 'text', text: 'answer' }] };
    const footer = await appendPiFileLinks(req, response);
    expect(footer).toBeNull();
    expect(response.text).toBe('answer');
    expect(response.content).toHaveLength(1);
  });

  it('appends staged execute_code files, deduped and filtered against existing links', async () => {
    mockBuildPiFileLinks.mockReturnValue('\n\n---\n📎 下载文件：[📄 b.xlsx](/dl/b.xlsx)');
    const req = {
      _piCodeOutputFiles: [
        { name: 'a.xlsx', url: '/dl/a.xlsx' },
        { name: 'a.xlsx', url: '/dl/a-dup.xlsx' },
        { name: 'already.xlsx', url: '/dl/already.xlsx' },
        { name: 'no-url.xlsx' },
      ],
    };
    const response = {
      text: 'see already.xlsx at /dl/already.xlsx',
      content: [{ type: 'text', text: 'see already.xlsx at /dl/already.xlsx' }],
    };
    const footer = await appendPiFileLinks(req, response);
    expect(mockBuildPiFileLinks).toHaveBeenCalledWith([{ name: 'a.xlsx', url: '/dl/a.xlsx' }]);
    expect(footer).toBe('\n\n---\n📎 下载文件：[📄 b.xlsx](/dl/b.xlsx)');
    expect(response.text).toContain('/dl/b.xlsx');
    expect(response.content).toHaveLength(2);
    expect(response.content[1]).toEqual({ type: 'text', text: footer });
    expect(req._piCodeOutputFiles).toBeUndefined();
  });

  it('collects execute_skill runs against the post-tool-call summary text', async () => {
    mockCollectPiGeneratedFiles.mockResolvedValue([
      { name: 'report.docx', path: 'report.docx', url: '/report' },
    ]);
    mockFilterPiResultFiles.mockReturnValue([{ name: 'report.docx', url: '/report' }]);
    mockBuildPiFileLinks.mockReturnValue('\n\nfooter');

    const req = {
      _piSkillRuns: [{ agentId: 'agent', sessionId: 'convo', userId: 'u', startedAt: 't' }],
    };
    const response = {
      text: '',
      content: [
        {
          type: 'tool_call',
          tool_call: { id: 'tc', name: 'execute_skill', args: {}, output: 'files' },
        },
        { type: 'text', text: 'your report is ready' },
      ],
    };

    const footer = await appendPiFileLinks(req, response);
    expect(mockCollectPiGeneratedFiles).toHaveBeenCalledWith('agent', 'convo', 'u', 't');
    expect(mockFilterPiResultFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'report.docx' })],
      'your report is ready',
    );
    expect(footer).toBe('\n\nfooter');
    expect(response.text).toBe('\n\nfooter');
    expect(req._piSkillRuns).toBeUndefined();
  });

  it('wraps the footer value when sibling TEXT parts use the { value } shape', async () => {
    mockBuildPiFileLinks.mockReturnValue('\nfooter');
    const req = { _piCodeOutputFiles: [{ name: 'f.csv', url: '/f' }] };
    const response = { text: '', content: [{ type: 'text', text: { value: 'hi' } }] };
    await appendPiFileLinks(req, response);
    expect(response.content[1]).toEqual({ type: 'text', text: { value: '\nfooter' } });
  });

  it('skips the footer when skill collection fails', async () => {
    mockCollectPiGeneratedFiles.mockRejectedValue(new Error('pi down'));
    const req = {
      _piSkillRuns: [{ agentId: 'agent', sessionId: 'convo', userId: 'u', startedAt: 't' }],
    };
    const response = { text: 'answer' };
    const footer = await appendPiFileLinks(req, response);
    expect(footer).toBeNull();
    expect(response.text).toBe('answer');
  });
});
