const { logger } = require('@librechat/data-schemas');

/**
 * Whether stream logging is enabled via the `LOG_LLM_STREAM` environment variable.
 * When enabled, the raw stream (SSE wire format) returned by the LLM is captured
 * and persisted on the assistant message record (`streamLog` field).
 * @returns {boolean}
 */
function isStreamLogEnabled() {
  const raw = process.env.LOG_LLM_STREAM;
  const enabled = raw != null && raw.trim().toLowerCase() === 'true';
  return enabled;
}

// Log once at module load so it's visible in server startup logs.
logger.info(
  `[StreamLog] LOG_LLM_STREAM=${JSON.stringify(process.env.LOG_LLM_STREAM)} → enabled=${isStreamLogEnabled()}`,
);

/**
 * In-memory registry of active collectors keyed by streamId, so that paths
 * without a direct reference to the collector (e.g. the abort route) can still
 * retrieve whatever was captured up to that point.
 * @type {Map<string, StreamLogCollector>}
 */
const registry = new Map();

/**
 * A collector that accumulates raw stream chunks and joins them on demand.
 * Uses an array for O(1) appends, joining only when the final log is requested.
 */
class StreamLogCollector {
  constructor() {
    /** @type {string[]} */
    this.chunks = [];
    /** @type {string | null} */
    this.cached = null;
  }

  /**
   * Append a raw chunk (already in SSE wire format) to the log.
   * @param {string} text
   * @returns {void}
   */
  append(text) {
    if (!text || this.cached !== null) {
      return;
    }
    this.chunks.push(text);
  }

  /**
   * Returns the joined raw stream log. The result is cached after the first call
   * (the stream is considered complete once read).
   * @returns {string}
   */
  getLog() {
    if (this.cached === null) {
      this.cached = this.chunks.join('');
      this.chunks = [];
    }
    return this.cached;
  }

  /** Clear captured content. */
  clear() {
    this.chunks = [];
    this.cached = null;
  }
}

/**
 * Create a new stream log collector and optionally register it by streamId.
 * @param {string | null} [streamId=null] - When provided, registers the collector
 *   so it can be retrieved via {@link getStreamLogCollector} (used by the abort route).
 * @returns {StreamLogCollector}
 */
function createStreamLogCollector(streamId = null) {
  const collector = new StreamLogCollector();
  if (streamId) {
    registry.set(streamId, collector);
  }
  logger.debug(`[StreamLog] Collector created (streamId=${streamId ?? 'none'})`);
  return collector;
}

/**
 * Retrieve a registered collector by streamId (returns null if logging is disabled
 * or no collector is registered for the given streamId).
 * @param {string} streamId
 * @returns {StreamLogCollector | null}
 */
function getStreamLogCollector(streamId) {
  if (!isStreamLogEnabled()) {
    return null;
  }
  return registry.get(streamId) ?? null;
}

/**
 * Remove a registered collector from the registry (call after the final save).
 * @param {string} streamId
 * @returns {void}
 */
function removeStreamLogCollector(streamId) {
  registry.delete(streamId);
}

/**
 * Wraps `res.write` so that every chunk written to the HTTP response is appended
 * to the provided collector. This captures the exact SSE wire format sent to the
 * client. Returns a no-op undo function when the collector is null.
 *
 * Use this for controllers that write SSE directly to `res` (v1/v2/responses/legacy).
 *
 * @param {import('express').Response} res - The HTTP response to wrap.
 * @param {StreamLogCollector | null} collector - The collector, or null to disable.
 * @returns {() => void} A function that restores the original `res.write`.
 */
function wrapResponseWrite(res, collector) {
  if (!collector) {
    return () => {};
  }
  const originalWrite = res.write.bind(res);
  /** @param {unknown} chunk */
  res.write = function (chunk) {
    try {
      let text;
      if (typeof chunk === 'string') {
        text = chunk;
      } else if (Buffer.isBuffer(chunk)) {
        text = chunk.toString('utf8');
      } else {
        text = String(chunk ?? '');
      }
      collector.append(text);
    } catch (err) {
      logger.error('[StreamLog] Error capturing response write:', err);
    }
    return originalWrite(chunk);
  };
  return () => {
    res.write = originalWrite;
  };
}

module.exports = {
  StreamLogCollector,
  isStreamLogEnabled,
  createStreamLogCollector,
  getStreamLogCollector,
  removeStreamLogCollector,
  wrapResponseWrite,
};
