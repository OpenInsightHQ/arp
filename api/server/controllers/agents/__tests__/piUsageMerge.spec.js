/**
 * Tests for the pi endpoint FINAL-event usage merge in ResumableAgentController.
 *
 * The pi endpoint flow skips the pi-consistent usage fields when building the
 * in-memory response (the pi backend owns them), so the FINAL event must read
 * the persisted message back and merge the usage fields — otherwise the live
 * message shows no turn totals until the client refetches.
 */

const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

const mockGenerationJobManager = {
  createJob: jest.fn(),
  getJob: jest.fn(),
  emitDone: jest.fn(),
  emitChunk: jest.fn(),
  completeJob: jest.fn(),
  updateMetadata: jest.fn(),
  setContentParts: jest.fn(),
};

const mockSaveMessage = jest.fn();
const mockGetMessage = jest.fn();
const mockDecrementPendingRequest = jest.fn();
const mockAppendPiFileLinks = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
}));

jest.mock('@librechat/api', () => ({
  GenerationJobManager: mockGenerationJobManager,
  sendEvent: jest.fn(),
  getViolationInfo: jest.fn(),
  logViolation: undefined,
  decrementPendingRequest: (...args) => mockDecrementPendingRequest(...args),
  sanitizeFileForTransmit: jest.fn((file) => file),
  sanitizeMessageForTransmit: jest.fn((msg) => msg),
  checkAndIncrementPendingRequest: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('~/server/cleanup', () => ({
  disposeClient: jest.fn(),
  clientRegistry: new Map(),
  requestDataMap: new Map(),
}));

jest.mock('~/server/middleware', () => ({
  handleAbortError: jest.fn(),
}));

jest.mock('~/cache', () => ({
  logViolation: jest.fn(),
}));

jest.mock('~/models', () => ({
  saveMessage: (...args) => mockSaveMessage(...args),
  getMessage: (...args) => mockGetMessage(...args),
}));

jest.mock('~/server/services/PIService', () => ({
  appendPiLinksToSavedMessage: jest.fn(),
}));

jest.mock('~/server/services/PiFileFooter', () => ({
  appendPiFileLinks: (...args) => mockAppendPiFileLinks(...args),
}));

jest.mock('~/server/services/StreamLog', () => ({
  removeStreamLogCollector: jest.fn(),
}));

jest.mock('~/server/utils/sanitize', () => ({
  sanitizeReflectedString: jest.fn((value) => value),
}));

const AgentController = require('~/server/controllers/agents/request');

const piUsageDoc = {
  messageId: 'resp-1',
  inputTokens: 380,
  outputTokens: 1231,
  cacheReadTokens: 15104,
  cacheWriteTokens: 0,
  totalInputTokens: 10642,
  totalOutputTokens: 1231,
  totalCacheReadTokens: 15104,
  totalCacheWriteTokens: 0,
};

/** Drives the controller to completion and returns the emitted FINAL event. */
const runController = async ({ endpoint }) => {
  let resolveDone;
  const donePromise = new Promise((resolve) => {
    resolveDone = resolve;
  });
  mockGenerationJobManager.emitDone.mockImplementation(async (_streamId, finalEvent) => {
    resolveDone(finalEvent);
  });

  const responseMessage = {
    messageId: 'resp-1',
    conversationId: 'convo-1',
    sender: 'AI',
    text: 'hello',
    tokenCount: 1231,
    inputTokenCount: 25958,
    databasePromise: Promise.resolve({ message: { messageId: 'resp-1' }, conversation: {} }),
  };

  const client = {
    sender: 'AI',
    options: { endpoint },
    savedMessageIds: new Set(['resp-1']),
    sendMessage: jest.fn().mockResolvedValue(responseMessage),
  };

  const req = {
    body: {
      text: 'hi',
      conversationId: 'convo-1',
      endpointOption: { endpoint },
    },
    user: { id: 'user-1' },
  };
  const res = { json: jest.fn() };

  await AgentController(req, res, jest.fn(), async () => ({ client }), null);

  return await donePromise;
};

describe('PI usage merge on FINAL event', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerationJobManager.createJob.mockResolvedValue({
      createdAt: 1000,
      readyPromise: Promise.resolve(),
      abortController: new AbortController(),
      emitter: { on: jest.fn() },
    });
    mockGenerationJobManager.getJob.mockResolvedValue({ createdAt: 1000 });
    mockAppendPiFileLinks.mockResolvedValue(null);
    mockDecrementPendingRequest.mockResolvedValue(undefined);
  });

  it('merges pi-persisted usage fields into the pi flow FINAL event', async () => {
    mockGetMessage.mockResolvedValue(piUsageDoc);

    const finalEvent = await runController({ endpoint: 'pi' });

    expect(mockGetMessage).toHaveBeenCalledWith({ user: 'user-1', messageId: 'resp-1' });
    expect(finalEvent.responseMessage.totalInputTokens).toBe(10642);
    expect(finalEvent.responseMessage.totalOutputTokens).toBe(1231);
    expect(finalEvent.responseMessage.totalCacheReadTokens).toBe(15104);
    expect(finalEvent.responseMessage.totalCacheWriteTokens).toBe(0);
    expect(finalEvent.responseMessage.inputTokens).toBe(380);
    expect(finalEvent.responseMessage.outputTokens).toBe(1231);
  });

  it('does not read back usage for native agent flows', async () => {
    await runController({ endpoint: 'agents' });

    expect(mockGetMessage).not.toHaveBeenCalled();
  });

  it('emits without usage fields when the pi message is not persisted yet', async () => {
    mockGetMessage.mockResolvedValue(null);

    const finalEvent = await runController({ endpoint: 'pi' });

    expect(finalEvent.responseMessage.totalInputTokens).toBeUndefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('keeps the FINAL event intact when the read-back fails', async () => {
    mockGetMessage.mockRejectedValue(new Error('db down'));

    const finalEvent = await runController({ endpoint: 'pi' });

    expect(finalEvent.final).toBe(true);
    expect(finalEvent.responseMessage.totalInputTokens).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[ResumableAgentController] Failed to merge pi usage fields:',
      'db down',
    );
  });
});
