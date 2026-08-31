const { logger } = require('@librechat/data-schemas');
const { ContentTypes } = require('librechat-data-provider');
const {
  collectPiGeneratedFiles,
  buildPiFileLinks,
  filterPiResultFiles,
  isIntermediateArtifact,
} = require('./PIService');

/**
 * Read a TEXT content part's value, accepting both storage shapes: plain
 * string server-side ({ text: '...' }), { value } wrap client-side.
 * @param {Partial<TMessageContentPart>} part
 * @returns {string}
 */
function textPartValue(part) {
  if (part?.type !== ContentTypes.TEXT) {
    return '';
  }
  const text = part[ContentTypes.TEXT];
  return typeof text === 'string' ? text : (text?.value ?? '');
}

/**
 * Extract the mention-filter source text from the response message,
 * strict → loose:
 * 1. TEXT parts after the LAST tool_call part — the final summary segment of
 *    interleaved agent messages (text between tool calls is narration that
 *    routinely mentions input/intermediate files);
 * 2. all TEXT parts (models that end on a tool_call part);
 * 3. response.text (text-only messages).
 * @param {Partial<TMessage>} response
 * @returns {string}
 */
function extractSummaryText(response) {
  let strict = '';
  let all = '';
  if (Array.isArray(response.content)) {
    for (const part of response.content) {
      if (part?.type === ContentTypes.TOOL_CALL) {
        strict = '';
        continue;
      }
      const value = textPartValue(part);
      if (value) {
        strict += value;
        all += value;
      }
    }
  }
  return strict || all || response.text || '';
}

/** Root-level (no directory component) files, excluding skill intermediates. */
const rootDeliverableFiles = (files) =>
  files.filter((f) => {
    const p = f.path || f.name || '';
    return !p.includes('/') && !isIntermediateArtifact(p);
  });

/** Max wait for the post-summary pi file collection; degrades to no footer. */
const PI_FOOTER_DEADLINE_MS = 20_000;

/**
 * Collect the files of the turn's execute_skill runs and filter them down to
 * the deliverables the final summary actually mentions. Fallback when the
 * mention filter matches nothing: root-level deliverables — never the full
 * list, so workspace clutter can never flood the footer.
 * @param {Array<{agentId: string; sessionId: string; userId: string; startedAt: string}>} skillRuns
 * @param {string} summaryText
 * @returns {Promise<string>} footer markdown ('' when nothing to show)
 */
async function buildSkillRunFooter(skillRuns, summaryText) {
  try {
    const collected = await Promise.race([
      Promise.all(
        skillRuns.map((run) =>
          collectPiGeneratedFiles(run.agentId, run.sessionId, run.userId, run.startedAt),
        ),
      ),
      new Promise((resolve) => setTimeout(() => resolve(null), PI_FOOTER_DEADLINE_MS)),
    ]);
    if (!collected) {
      logger.warn('[PiFileFooter] Pi file collection timed out; skipping footer');
      return '';
    }

    const allFiles = collected.flat();

    const mentioned = summaryText
      ? filterPiResultFiles(allFiles, summaryText)
      : filterPiResultFiles(rootDeliverableFiles(allFiles));
    const deliverables =
      mentioned.length > 0 ? mentioned : filterPiResultFiles(rootDeliverableFiles(allFiles));

    return buildPiFileLinks(deliverables) || '';
  } catch (error) {
    logger.warn('[PiFileFooter] Pi skill file collection failed:', error.message);
    return '';
  }
}

/**
 * Collect the response's visible text (message `text` + TEXT content parts)
 * so staged download links can be checked for prior presence.
 * @param {Partial<TMessage>} response
 * @returns {string}
 */
function collectResponseText(response) {
  let text = response.text || '';
  if (Array.isArray(response.content)) {
    for (const part of response.content) {
      text += textPartValue(part);
    }
  }
  return text;
}

/**
 * Append an already-built footer to the response message in place — `text`
 * plus a trailing TEXT content part (matching the sibling parts' storage
 * shape), the same visible surface as appending before initial persistence.
 * @param {Partial<TMessage>} response - mutated in place
 * @param {string} footer
 */
function appendFooterToResponse(response, footer) {
  response.text = (response.text || '') + footer;
  if (Array.isArray(response.content) && response.content.length > 0) {
    const sibling = response.content.find((p) => p?.type === ContentTypes.TEXT);
    const usePlainString = sibling != null && typeof sibling[ContentTypes.TEXT] === 'string';
    response.content.push({
      type: ContentTypes.TEXT,
      [ContentTypes.TEXT]: usePlainString ? footer : { value: footer },
    });
  }
}

/**
 * Append the pi file-links footer to the response message so the download
 * links render on the page. Agent messages may be dual-content (content-parts
 * array with empty `text`), so the footer is appended to BOTH `text` and a
 * trailing text content part (matching the sibling parts' storage shape) —
 * same visible surface as the one-pi chat buildFileLinks markdown.
 *
 * Two staging sources, resolved AFTER the LLM finished its reply:
 * - req._piSkillRuns (execute_skill): deferred runs — re-run
 *   collectPiGeneratedFiles per run, filter the files against the LLM's final
 *   summary text (whole-token mention match), then build the footer from
 *   buildPiFileDownloadUrl links. Link accuracy never depends on the LLM
 *   relaying URLs from the collapsed tool output.
 * - req._piCodeOutputFiles (execute_code pi sync): exact tool artifacts, kept
 *   without mention filtering, but deduped — the pi compat layer
 *   (chatCompletions buildFileLinks) may have already streamed the same file's
 *   link into the response text, and same-name files staged by multiple tool
 *   calls collapse to one link.
 *
 * @param {ServerRequest} req
 * @param {Partial<TMessage>} response - mutated in place when a footer is appended
 * @returns {Promise<string | null>} the appended footer, or null
 */
async function appendPiFileLinks(req, response) {
  const stagedFiles = req._piCodeOutputFiles;
  const skillRuns = req._piSkillRuns;
  delete req._piCodeOutputFiles;
  delete req._piSkillRuns;

  let footer = '';
  if (Array.isArray(stagedFiles) && stagedFiles.length > 0) {
    const responseText = collectResponseText(response);
    const seen = new Set();
    const unstaged = stagedFiles.filter((file) => {
      if (!file?.name || !file?.url || seen.has(file.name)) {
        return false;
      }
      seen.add(file.name);
      return !responseText.includes(file.url);
    });
    footer += buildPiFileLinks(unstaged) || '';
  }
  if (Array.isArray(skillRuns) && skillRuns.length > 0) {
    footer += await buildSkillRunFooter(skillRuns, extractSummaryText(response));
  }

  if (!footer) {
    return null;
  }
  appendFooterToResponse(response, footer);
  return footer;
}

module.exports = {
  appendPiFileLinks,
  appendFooterToResponse,
  extractSummaryText,
  buildSkillRunFooter,
};
