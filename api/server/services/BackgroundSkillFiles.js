/**
 * Background skill file-link injection.
 *
 * When execute_skill hits its streaming deadline (PI_SKILL_TIMEOUT_MS), pi
 * keeps executing server-side. pi tracks each /skill: turn as a TaskQueue doc
 * (type 'subagent', sourceConversationId = sessionId) in the shared
 * `taskqueues` collection and flips it to a terminal status when finished.
 *
 * This module watches that doc and, once the skill run finishes, appends the
 * canonical pi download links ("📎 下载文件：[📄 name](url)" markdown, built
 * from collectPiGeneratedFiles + buildPiFileDownloadUrl — identical to the
 * one-pi chat buildFileLinks surface) onto the agent's saved response message
 * text, so the links are visible on refresh without any file download or
 * attachment records.
 *
 * In-memory watcher: lost on process restart (best-effort; files remain
 * retrievable via the pi files API and later turns).
 */
const { logger } = require('@librechat/data-schemas');
const { TaskQueue } = require('../../models/TaskQueue');
const { Message } = require('~/db/models');
const { collectPiGeneratedFiles, buildPiFileLinks } = require('./PIService');

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 30 * 60_000;
/** If no TaskQueue doc appears at all (pi task tracking disabled), give up after this long. */
const NO_TASK_GRACE_MS = 5 * 60_000;
/** pi creates the task doc seconds after the turn starts; allow matching slop. */
const TASK_CREATED_SLOP_MS = 60_000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'aborted', 'rejected', 'dismissed']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const activeWatchers = new Set();

/**
 * Fire-and-forget: wait for the pi skill task (TaskQueue doc) to finish, then
 * collect the files generated during the run and append their download links
 * to the saved response message text (same markdown format as one-pi chat).
 *
 * @param {Object} params
 * @param {string} params.agentId pi agent id
 * @param {string} params.sessionId pi session (= arp conversation) id
 * @param {string} params.userId arp user id
 * @param {string} params.skillName
 * @param {Date|string} params.startedAt turn start cutoff for file mtime filter
 * @param {string} [params.responseMessageId] arp response message to append links to
 */
const scheduleBackgroundSkillFileCollection = async ({
  agentId,
  sessionId,
  userId,
  skillName,
  startedAt,
  responseMessageId,
}) => {
  if (!agentId || !sessionId || !userId || !startedAt || !responseMessageId) {
    return;
  }

  const startedAtMs = new Date(startedAt).getTime();
  const key = `${agentId}|${sessionId}|${skillName}|${startedAtMs}`;
  if (activeWatchers.has(key)) {
    return;
  }
  activeWatchers.add(key);

  try {
    const deadline = Date.now() + MAX_WAIT_MS;
    let noTaskSince = null;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      let task = null;
      try {
        task = await TaskQueue.findOne({
          sourceConversationId: sessionId,
          type: 'subagent',
          subagentName: skillName,
          createdAt: { $gte: new Date(startedAtMs - TASK_CREATED_SLOP_MS) },
        })
          .sort({ createdAt: -1 })
          .lean();
      } catch (err) {
        logger.warn('[BackgroundSkillFiles] TaskQueue lookup failed:', err.message);
      }

      if (!task) {
        if (noTaskSince == null) {
          noTaskSince = Date.now();
        } else if (Date.now() - noTaskSince > NO_TASK_GRACE_MS) {
          logger.info(
            `[BackgroundSkillFiles] No TaskQueue doc for ${skillName}/${sessionId}; doing best-effort file collection`,
          );
          break;
        }
        continue;
      }

      if (TERMINAL_STATUSES.has(task.status)) {
        break;
      }
    }

    const links = await buildPiFileLinks(
      await collectPiGeneratedFiles(agentId, sessionId, userId, new Date(startedAtMs)),
    );
    if (!links) {
      return;
    }

    logger.info(
      `[BackgroundSkillFiles] Skill ${skillName} finished for ${sessionId}: appending file links to message ${responseMessageId}`,
    );

    try {
      await Message.findByIdAndUpdate(responseMessageId, [
        {
          $set: {
            text: {
              $concat: [
                { $ifNull: ['$text', ''] },
                links,
              ],
            },
          },
        },
      ]);
    } catch (err) {
      logger.error('[BackgroundSkillFiles] Failed to append links to message:', err.message);
    }
  } catch (error) {
    logger.error('[BackgroundSkillFiles] Watcher failed:', error.message);
  } finally {
    activeWatchers.delete(key);
  }
};

module.exports = {
  scheduleBackgroundSkillFileCollection,
};
