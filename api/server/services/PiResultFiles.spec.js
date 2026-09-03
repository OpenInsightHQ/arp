/**
 * Unit tests for pi result-file selection (filterPiResultFiles)
 */

jest.mock('@librechat/api', () => ({
  createAxiosInstance: jest.fn(),
  getPiSystemPrompt: jest.fn(),
}));
jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('mongodb', () => ({ MongoClient: jest.fn() }));
jest.mock('librechat-data-provider', () => ({
  PermissionBits: { VIEW: 1 },
  ResourceType: { SYSTEM_PROMPT: 'systemPrompt' },
}));

const { filterPiResultFiles, listPiFiles, MAX_PI_RESULT_FILES } = require('./PIService');

const file = (path, lastModified) => ({
  name: path.split('/').pop(),
  path,
  url: `/dl/${encodeURIComponent(path)}`,
  lastModified,
});

describe('filterPiResultFiles', () => {
  it('drops node_modules, hidden entries and intermediate dirs in no-text mode', () => {
    const files = [
      file('slides/report.pptx', '2026-09-03T10:00:00Z'),
      file('slides/node_modules/@types/node/fs.d.ts', '2026-09-03T10:05:00Z'),
      file('slides/node_modules/.package-lock.json', '2026-09-03T10:06:00Z'),
      file('xlsx_work/sheet1.xml', '2026-09-03T10:07:00Z'),
      file('.hidden.xlsx', '2026-09-03T10:08:00Z'),
      file('slides/compile.js', '2026-09-03T09:00:00Z'),
    ];
    expect(filterPiResultFiles(files)).toEqual([
      expect.objectContaining({ path: 'slides/report.pptx' }),
      expect.objectContaining({ path: 'slides/compile.js' }),
    ]);
  });

  it('sorts newest-first and caps at MAX_PI_RESULT_FILES', () => {
    const files = Array.from({ length: MAX_PI_RESULT_FILES + 5 }, (_, i) =>
      file(`out/file${String(i).padStart(2, '0')}.csv`, new Date(1_000_000 + i).toISOString()),
    );
    const result = filterPiResultFiles(files);
    expect(result).toHaveLength(MAX_PI_RESULT_FILES);
    expect(result[0].path).toBe('out/file14.csv');
    expect(result[MAX_PI_RESULT_FILES - 1].path).toBe('out/file05.csv');
  });

  it('dedupes by basename keeping the newest copy', () => {
    const files = [
      file('v1/report.pdf', '2026-09-03T09:00:00Z'),
      file('v2/report.pdf', '2026-09-03T11:00:00Z'),
    ];
    const [kept] = filterPiResultFiles(files);
    expect(kept.path).toBe('v2/report.pdf');
  });

  it('keeps only whole-token mentioned files', () => {
    const files = [
      file('slides/report.pptx', '2026-09-03T10:00:00Z'),
      file('slides/data.xlsx', '2026-09-03T10:01:00Z'),
      file('slides/data.xlsx.bak', '2026-09-03T10:02:00Z'),
    ];
    const text = '报告已生成：slides/report.pptx，另见 data.xlsx';
    expect(filterPiResultFiles(files, text)).toEqual([
      expect.objectContaining({ path: 'slides/data.xlsx' }),
      expect.objectContaining({ path: 'slides/report.pptx' }),
    ]);
  });

  it('never keeps node_modules files, even when the text mentions them', () => {
    const files = [
      file('slides/report.pptx', '2026-09-03T10:00:00Z'),
      file('slides/node_modules/@types/node/fs.d.ts', '2026-09-03T10:02:00Z'),
    ];
    const text = '编辑了 slides/node_modules/@types/node/fs.d.ts 和 slides/report.pptx';
    expect(filterPiResultFiles(files, text)).toEqual([
      expect.objectContaining({ path: 'slides/report.pptx' }),
    ]);
  });

  it('sorts files with missing/invalid mtimes last, keeping listing order', () => {
    const files = [
      file('a.csv', undefined),
      file('b.csv', 'not-a-date'),
      file('c.csv', '2026-09-03T10:00:00Z'),
    ];
    expect(filterPiResultFiles(files).map((f) => f.path)).toEqual(['c.csv', 'a.csv', 'b.csv']);
  });
});

describe('listPiFiles source filtering', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('drops node_modules and dot segments, keeps work/temp entries and dirs pass-through shape', async () => {
    const piFiles = [
      { path: 'slides/report.pptx', isDirectory: false },
      { path: 'slides/node_modules/@types/node/fs.d.ts', isDirectory: false },
      { path: 'slides/node_modules/.package-lock.json', isDirectory: false },
      { path: '.git/config', isDirectory: false },
      { path: '.env.local', isDirectory: false },
      { path: 'slides', isDirectory: true },
      { path: 'xlsx_work/sheet1.xml', isDirectory: false },
    ];
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ files: piFiles }) });

    const listed = await listPiFiles('agent', 'session', 'user');
    expect(listed.map((f) => f.path)).toEqual(['slides/report.pptx', 'xlsx_work/sheet1.xml']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
