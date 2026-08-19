/**
 * Background skill file collection.
 *
 * When execute_skill hits its streaming deadline (PI_SKILL_TIMEOUT_MS), pi
 * keeps executing server-side. pi tracks each /skill: turn as a TaskQueue doc
 * (type 'subagent', sourceConversationId = sessionId) in the shared
 * `taskqueues` collection and flips it to a terminal status when finished.
 *
 * This module watches that doc and, once the skill run finishes, collects the
 * files generated since the turn started, saves them as arp file records and
 * attaches them to the agent's response message — so generated files (e.g. a
 * PPTX exported minutes after the deadline) appear as real message
 * attachments on refresh, and are pushed live via the SSE `attachment` event
 * when the stream is still open.
 *
 * In-memory watcher: lost on process restart (best-effort; files remain
 * retrievable via the pi files API and later turns).
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const { TaskQueue } = require('../../models/TaskQueue');
const { Message } = require('~/db/models');
const { createFile } = require('~/models');
const { collectPiGeneratedFiles, filterPiResultFiles, downloadPIFile } = require('./PIService');

const MAX_PI_FILE_SIZE_BYTES = parseInt(process.env.PI_UPLOAD_LIMIT_MB || '1024', 10) * 1024 * 1024;

const pathSeparatorRegex = /[\\/\0]/;

const sanitizeFileName = (name) => path.basename(name).replace(/[\\/:*?"<>|]/g, '_');

/**
 * Download pi-generated files and persist them as arp file records
 * (uploads/<userId>/ + files collection), returning attachment descriptors.
 */
const downloadAndSavePIFiles = async (generatedFiles, userId) => {
  if (!generatedFiles || generatedFiles.length === 0) {
    return [];
  }

  const savedFiles = [];

  for (const fileInfo of generatedFiles) {
    try {
      const downloadResult = await downloadPIFile(
        {
          sessionId: fileInfo.sessionId,
          filename: fileInfo.name,
          agentId: fileInfo.agentId,
        },
        userId,
      );

      if (!downloadResult.success) {
        logger.error(
          `[downloadAndSavePIFiles] Failed to download ${fileInfo.name}: ${downloadResult.error}`,
        );
        continue;
      }

      const buffer = downloadResult.data.buffer;
      const mimeType =
        downloadResult.data.mimeType || fileInfo.mimeType || 'application/octet-stream';

      if (buffer.length > MAX_PI_FILE_SIZE_BYTES) {
        logger.error(
          `[downloadAndSavePIFiles] File "${fileInfo.name}" (${buffer.length} bytes) exceeds max size of ${MAX_PI_FILE_SIZE_BYTES} bytes`,
        );
        continue;
      }

      if (pathSeparatorRegex.test(userId)) {
        logger.error(`[downloadAndSavePIFiles] Invalid userId: ${userId}`);
        continue;
      }

      const safeName = sanitizeFileName(fileInfo.name);
      const fileId = uuidv4();
      const filename = `${fileId}_${safeName}`;

      const uploadPath = path.join('uploads', userId, filename);
      const uploadDir = path.dirname(uploadPath);

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      fs.writeFileSync(uploadPath, buffer);

      await createFile({
        file_id: fileId,
        user: userId,
        filename: fileInfo.name,
        filepath: `/uploads/${userId}/${filename}`,
        type: mimeType,
        bytes: buffer.length,
        source: 'local',
        context: 'pi_generated',
        metadata: {
          originalName: fileInfo.name,
          mimeType,
          size: fileInfo.size,
        },
      });

      savedFiles.push({
        file_id: fileId,
        filename: fileInfo.name,
        filepath: `/uploads/${userId}/${filename}`,
        type: mimeType,
        size: buffer.length,
      });
    } catch (error) {
      logger.error(`[downloadAndSavePIFiles] Error processing ${fileInfo.name}:`, error);
    }
  }

  return savedFiles;
};

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
 * collect/save/attach the files generated during the run.
 *
 * @param {Object} params
 * @param {string} params.agentId pi agent id
 * @param {string} params.sessionId pi session (= arp conversation) id
 * @param {string} params.userId arp user id
 * @param {string} params.skillName
 * @param {Date|string} params.startedAt turn start cutoff for file mtime filter
 * @param {string} [params.responseMessageId] arp response message to attach files to
 * @param {Function} [params.emitAttachment] optional SSE attachment emitter (live push)
 */
const scheduleBackgroundSkillFileCollection = async ({
  agentId,
  sessionId,
  userId,
  skillName,
  startedAt,
  responseMessageId,
  emitAttachment,
}) => {
  if (!agentId || !sessionId || !userId) {
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

    const files = filterPiResultFiles(
      await collectPiGeneratedFiles(agentId, sessionId, userId, new Date(startedAtMs)),
      null,
    );
    if (files.length === 0) {
      return;
    }

    const savedFiles = await downloadAndSavePIFiles(
      files.map((f) => ({
        sessionId,
        agentId,
        name: f.path || f.name,
        mimeType: f.mimeType,
        size: f.size,
      })),
      userId,
    );
    if (savedFiles.length === 0) {
      return;
    }

    logger.info(
      `[BackgroundSkillFiles] Skill ${skillName} finished for ${sessionId}: attaching ${savedFiles.length} file(s)`,
    );

    if (responseMessageId) {
      try {
        await Message.findByIdAndUpdate(responseMessageId, {
          $push: { attachments: { $each: savedFiles } },
        });
      } catch (err) {
        logger.error('[BackgroundSkillFiles] Failed to attach files to message:', err.message);
      }

      if (emitAttachment) {
        for (const file of savedFiles) {
          await emitAttachment({ messageId: responseMessageId, ...file });
        }
      }
    }
  } catch (error) {
    logger.error('[BackgroundSkillFiles] Watcher failed:', error.message);
  } finally {
    activeWatchers.delete(key);
  }
};

module.exports = {
  downloadAndSavePIFiles,
  scheduleBackgroundSkillFileCollection,
};
