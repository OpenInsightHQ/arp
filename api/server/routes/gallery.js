const express = require('express');
const mongoose = require('mongoose');
const requireJwtAuth = require('../middleware/requireJwtAuth');
const { GalleryArtifact, getGalleryArtifacts, getPublicGalleryArtifacts, getGalleryArtifactById, updateGalleryArtifact, deleteGalleryArtifact, toggleGalleryLike, toggleGalleryBookmark } = require('../../models/GalleryArtifact');
const Message = mongoose.models.Message;
const { GallerySchedule } = require('../../models/GallerySchedule');
const {
  GallerySkillTask,
  TASK_FREQUENCIES,
  generateGallerySkillTaskId,
  toSkillTaskResponse,
} = require('../../models/GallerySkillTask');
const {
  GallerySkillTaskRun,
  generateGallerySkillTaskRunId,
  toSkillTaskRunResponse,
} = require('../../models/GallerySkillTaskRun');
const { GalleryVersion } = require('../../models/GalleryVersion');
const { GallerySqlQuery } = require('../../models/GallerySqlQuery');
const { logger } = require('@librechat/data-schemas');
const { executeGallerySkillTask } = require('../services/GallerySkillTaskExecutor');
const { sanitizeReflectedFields, sendJsonResponse } = require('~/server/utils/sanitize');
const {
  getMessagesThroughTarget,
  getGalleryVersionProvenance,
} = require('../utils/galleryArtifactIdentity');
const {
  appendGalleryVersion,
  getPublishIdentity,
  upsertGallerySqlQueries,
  upsertLegacyPublishedArtifact,
  upsertPublishedArtifact,
} = require('../services/Artifacts/galleryPublishing');

/**
 * 根据 frequency 和 updateTime 计算下次执行时间
 * @param {string} frequency - 更新频率 (daily/weekly/monthly)
 * @param {string} updateTime - 执行时间 (如 "09:00")
 * @returns {Date} 下次执行时间
 */
const calculateNextRunAt = (frequency, updateTime, interval = null) => {
  const now = new Date();
  const [hours, minutes] = (updateTime || '09:00').split(':').map(Number);
  
  let nextRun = new Date(now);
  nextRun.setHours(hours, minutes, 0, 0);
  
  switch (frequency) {
    case 'minute': {
      const minutesInterval = Number(interval) > 0 ? Number(interval) : 30;
      nextRun = new Date(now.getTime() + minutesInterval * 60 * 1000);
      break;
    }
    case 'hourly': {
      const hoursInterval = Number(interval) > 0 ? Number(interval) : 1;
      nextRun = new Date(now.getTime() + hoursInterval * 60 * 60 * 1000);
      break;
    }
    case 'daily':
      // 如果今天已过，则安排明天
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      break;
    case 'weekly':
      // 安排到下周的同一天同一时间
      nextRun.setDate(nextRun.getDate() + 7);
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 7);
      }
      break;
    case 'monthly':
      // 安排到下月的同一天同一时间
      nextRun.setMonth(nextRun.getMonth() + 1);
      if (nextRun <= now) {
        nextRun.setMonth(nextRun.getMonth() + 1);
      }
      break;
    default:
      // 默认安排明天
      nextRun.setDate(nextRun.getDate() + 1);
  }
  
  return nextRun;
};

const calculateRetryDelay = (consecutiveFailures) => {
  const delays = [
    5 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000,
  ];
  const index = Math.min(consecutiveFailures - 1, delays.length - 1);
  return delays[index] || delays[delays.length - 1];
};

const router = express.Router();

/**
 * 获取作品列表（用户自己的作品)
 */
router.get('/', requireJwtAuth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized - Invalid user' });
    }
    
    const result = await getGalleryArtifacts(req.user.id, req.query);
    res.json(result);
  } catch (error) {
    console.error('[GET /api/gallery] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取公开作品列表
 */
router.get('/public', async (req, res) => {
  try {
    const result = await getPublicGalleryArtifacts(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const createSkillTaskPlaceholderRun = async (task, triggeredBy = 'manual') => {
  const startedAt = new Date();
  const run = await GallerySkillTaskRun.create({
    runId: generateGallerySkillTaskRunId(),
    taskId: task.taskId,
    userId: task.userId,
    skillName: task.skillName,
    taskNameSnapshot: task.taskName,
    triggeredBy,
    status: 'success',
    parameters: task.parameters || {},
    textOutput: '调度已触发。PI 隐藏会话执行器尚未接入，本次仅记录调度事件并推进下次运行时间。',
    files: [],
    logs: [
      {
        level: 'info',
        message: 'SKILL task schedule triggered; PI executor not connected yet.',
        timestamp: startedAt,
      },
    ],
    startedAt,
    completedAt: new Date(),
    durationMs: Date.now() - startedAt.getTime(),
  });

  const nextRunAt = calculateNextRunAt(task.frequency, task.scheduleTime, task.interval);
  const updatedTask = await GallerySkillTask.findByIdAndUpdate(
    task._id,
    {
      $set: {
        status: 'success',
        lastRunAt: run.completedAt,
        lastDurationMs: run.durationMs,
        lastError: null,
        failureCount: 0,
        nextRunAt,
      },
    },
    { new: true },
  ).lean();

  return { task: updatedTask, run };
};

/**
 * 获取 SKILL 任务列表
 */
router.get('/skill-tasks', requireJwtAuth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized - Invalid user' });
    }

    const { status, frequency, search, skillName } = req.query;
    const filter = { userId: new mongoose.Types.ObjectId(req.user.id) };

    if (skillName && String(skillName).trim()) {
      filter.skillName = String(skillName).trim();
    }

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (frequency && frequency !== 'all') {
      filter.frequency = frequency;
    }
    if (search && String(search).trim()) {
      const regex = new RegExp(String(search).trim(), 'i');
      filter.$or = [{ taskName: regex }, { skillName: regex }, { description: regex }];
    }

    const tasks = await GallerySkillTask.find(filter).sort({ nextRunAt: 1, updatedAt: -1 }).lean();
    sendJsonResponse(res, { tasks: tasks.map(toSkillTaskResponse) });
  } catch (error) {
    logger.error('[GET /api/gallery/skill-tasks] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 创建 SKILL 任务（MVP：保存任务配置，不触发执行器）
 */
router.post('/skill-tasks', requireJwtAuth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized - Invalid user' });
    }

    const {
      taskName,
      description = '',
      skillName,
      skillAuthor = null,
      skillSource = 'my',
      skillMetadataSnapshot = {},
      parameters = {},
      frequency = 'daily',
      interval = null,
      scheduleTime = '09:00',
      timezone = 'Asia/Shanghai',
    } = req.body || {};

    if (!skillName || typeof skillName !== 'string') {
      return res.status(400).json({ error: 'skillName is required' });
    }
    if (!taskName || typeof taskName !== 'string') {
      return res.status(400).json({ error: 'taskName is required' });
    }
    if (!TASK_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: 'Invalid frequency' });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const nextRunAt = calculateNextRunAt(frequency, scheduleTime, interval);
    const task = await GallerySkillTask.create({
      taskId: generateGallerySkillTaskId(),
      userId,
      taskName: taskName.trim(),
      description: String(description || ''),
      skillName: skillName.trim(),
      skillAuthor,
      skillSource,
      skillMetadataSnapshot,
      parameters,
      frequency,
      interval: interval === null || interval === '' ? null : Number(interval),
      scheduleTime,
      timezone,
      enabled: true,
      status: 'not_started',
      nextRunAt,
      maxRetries: 2,
    });

    sendJsonResponse(res.status(201), { task: toSkillTaskResponse(task) });
  } catch (error) {
    logger.error('[POST /api/gallery/skill-tasks] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取 SKILL 任务运行记录
 */
router.get('/skill-tasks/:taskId/runs', requireJwtAuth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized - Invalid user' });
    }

    const task = await GallerySkillTask.findOne({
      taskId: req.params.taskId,
      userId: req.user.id,
    }).lean();

    if (!task) {
      return res.status(404).json({ error: 'Skill task not found' });
    }

    const runs = await GallerySkillTaskRun.find({
      taskId: req.params.taskId,
      userId: new mongoose.Types.ObjectId(req.user.id),
    })
      .sort({ startedAt: -1 })
      .limit(50)
      .lean();

    sendJsonResponse(res, { runs: runs.map(toSkillTaskRunResponse) });
  } catch (error) {
    logger.error('[GET /api/gallery/skill-tasks/:taskId/runs] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取某个 SKILL 的运行记录
 */
router.get('/skill-runs', requireJwtAuth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized - Invalid user' });
    }

    const { skillName } = req.query;
    const filter = { userId: new mongoose.Types.ObjectId(req.user.id) };
    if (skillName && String(skillName).trim()) {
      filter.skillName = String(skillName).trim();
    }

    const runs = await GallerySkillTaskRun.find(filter).sort({ startedAt: -1 }).limit(50).lean();
    sendJsonResponse(res, { runs: runs.map(toSkillTaskRunResponse) });
  } catch (error) {
    logger.error('[GET /api/gallery/skill-runs] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 立即运行 SKILL 任务（真实 PI 执行器）
 */
router.post('/skill-tasks/:taskId/run', requireJwtAuth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized - Invalid user' });
    }

    const task = await GallerySkillTask.findOne({
      taskId: req.params.taskId,
      userId: req.user.id,
    });

    if (!task) {
      return res.status(404).json({ error: 'Skill task not found' });
    }

    const result = await executeGallerySkillTask({
      task,
      triggeredBy: 'manual',
      calculateNextRunAt,
      calculateRetryDelay,
      advanceSchedule: false,
    });
    sendJsonResponse(res, {
      task: toSkillTaskResponse(result.task),
      run: toSkillTaskRunResponse(result.run),
    });
  } catch (error) {
    logger.error('[POST /api/gallery/skill-tasks/:taskId/run] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 更新 SKILL 任务状态（MVP：暂停/恢复）
 */
router.patch('/skill-tasks/:taskId', requireJwtAuth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized - Invalid user' });
    }

    const { enabled, status, frequency, interval, scheduleTime, taskName } = req.body || {};
    const update = {};

    if (enabled !== undefined) {
      update.enabled = Boolean(enabled);
    }
    if (status !== undefined) {
      update.status = status;
      if (status === 'failed_paused') {
        update.enabled = false;
      } else if (status === 'not_started' && req.body.enabled === undefined) {
        update.enabled = true;
      }
    }
    if (frequency !== undefined) {
      if (!TASK_FREQUENCIES.includes(frequency)) {
        return res.status(400).json({ error: 'Invalid frequency' });
      }
      update.frequency = frequency;
    }
    if (interval !== undefined) {
      update.interval = interval === null || interval === '' ? null : Number(interval);
    }
    if (scheduleTime !== undefined) {
      update.scheduleTime = scheduleTime;
    }
    if (taskName !== undefined && String(taskName).trim()) {
      update.taskName = String(taskName).trim();
    }

    if (update.frequency || update.interval !== undefined || update.scheduleTime) {
      const current = await GallerySkillTask.findOne({ taskId: req.params.taskId, userId: req.user.id }).lean();
      if (!current) {
        return res.status(404).json({ error: 'Skill task not found' });
      }
      update.nextRunAt = calculateNextRunAt(
        update.frequency || current.frequency,
        update.scheduleTime || current.scheduleTime,
        update.interval !== undefined ? update.interval : current.interval,
      );
    }

    const task = await GallerySkillTask.findOneAndUpdate(
      { taskId: req.params.taskId, userId: req.user.id },
      { $set: update },
      { new: true },
    ).lean();

    if (!task) {
      return res.status(404).json({ error: 'Skill task not found' });
    }

    sendJsonResponse(res, { task: toSkillTaskResponse(task) });
  } catch (error) {
    logger.error('[PATCH /api/gallery/skill-tasks/:taskId] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 删除 SKILL 任务配置（保留历史运行记录）
 */
router.delete('/skill-tasks/:taskId', requireJwtAuth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized - Invalid user' });
    }

    const task = await GallerySkillTask.findOneAndDelete({
      taskId: req.params.taskId,
      userId: req.user.id,
    }).lean();

    if (!task) {
      return res.status(404).json({ error: 'Skill task not found' });
    }

    sendJsonResponse(res, { success: true });
  } catch (error) {
    logger.error('[DELETE /api/gallery/skill-tasks/:taskId] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/published/status', requireJwtAuth, async (req, res) => {
  try {
    const identity = getPublishIdentity(req.query);
    const artifact = await GalleryArtifact.findOne({
      userId: req.user.id,
      sourceArtifactId: identity.sourceArtifactId,
      targetMessageId: identity.targetMessageId,
    }).lean();

    if (!artifact) {
      return res.json(null);
    }

    return res.json({
      id: artifact.galleryArtifactId,
      sourceArtifactId: artifact.sourceArtifactId,
      targetMessageId: artifact.targetMessageId,
      autoUpdate: artifact.autoUpdate,
      updateFrequency: artifact.updateFrequency,
      updateTime: artifact.updateTime,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

/**
 * 获取作品详情
 */
router.get('/:id', requireJwtAuth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized - Invalid user' });
    }
    // 禁用缓存，确保总是返回最新内容
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    
    const artifact = await getGalleryArtifactById(req.params.id, req.user.id);
    if (!artifact) {
      return res.status(404).json({ error: 'Gallery artifact not found' });
    }
    res.json(artifact);
  } catch (error) {
    console.error('[GET /api/gallery/:id] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取作品原始 HTML 内容（公开）
 */
router.get('/:id/raw', async (req, res) => {
  try {
    const { id } = req.params;
    const artifact = await GalleryArtifact.findOne({ galleryArtifactId: id }).lean();
    
    if (!artifact) {
      return res.status(404).send('Artifact not found');
    }
    
    if (!artifact.isPublic) {
      return res.status(403).send('Artifact is not public');
    }
    
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(artifact.content);
  } catch (error) {
    console.error('[GET /api/gallery/:id/raw] Error:', error);
    res.status(500).send('Internal server error');
  }
});

/**
 * 发布作品（创建）
 */
router.post('/publish', requireJwtAuth, async (req, res) => {
  try {
    logger.info('[gallery/publish] Request received', { 
      bodyKeys: Object.keys(req.body),
      hasContent: !!req.body.content,
      contentLength: req.body.content ? req.body.content.length : 0,
      contentPreview: req.body.content ? req.body.content.substring(0, 100) : 'NO CONTENT',
      user: req.user ? { id: req.user.id, _id: req.user._id } : null 
    });

    const {
      title,
      type,
      sourceArtifactId,
      conversationId,
      messageId,
      targetMessageId,
      content,
      autoUpdate,
      updateFrequency,
      updateTime,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (sourceArtifactId) {
      try {
        getPublishIdentity(req.body);
      } catch (identityError) {
        return res.status(identityError.statusCode || 400).json({ error: identityError.message });
      }
    }
    if (autoUpdate && (!conversationId || !(targetMessageId || messageId))) {
      return res.status(400).json({ error: 'conversationId and targetMessageId are required for autoUpdate' });
    }

    // 确保 userId 是有效的 ObjectId
    let userId = req.user.id;
    if (!userId) {
      logger.error('[gallery/publish] user.id is missing from req.user');
      return res.status(401).json({ error: 'Unauthorized: user not found' });
    }

    // 如果是字符串，转换为 ObjectId
    if (typeof userId === 'string') {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        logger.error('[gallery/publish] Invalid userId format', { userId });
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      userId = new mongoose.Types.ObjectId(userId);
    }

    logger.info('[gallery/publish] Creating artifact', { 
      userId, 
      title, 
      type,
      autoUpdate,
      updateTime,
      updateFrequency
    });

    const publishResult = await (sourceArtifactId
      ? upsertPublishedArtifact
      : upsertLegacyPublishedArtifact)({
      GalleryArtifact,
      userId,
      payload: req.body,
    });
    const existing = publishResult.created ? null : publishResult.artifact;

    let artifact;

    if (existing) {
      // 已存在，更新内容和定时设置
      logger.info('[gallery/publish] Updating existing artifact', {
        existingId: existing.galleryArtifactId,
        autoUpdate,
        updateTime
      });

      artifact = publishResult.artifact;

      // 处理 GallerySchedule
      if (autoUpdate) {
        const nextRunAt = calculateNextRunAt(updateFrequency, updateTime);
        await GallerySchedule.findOneAndUpdate(
          { galleryArtifactId: existing.galleryArtifactId },
          {
            $set: {
              frequency: updateFrequency || 'daily',
              updateTime: updateTime || '09:00',
              enabled: true,
              nextRunAt,
              runStatus: 'idle',
              lastError: null,
            },
            $setOnInsert: { userId },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
      } else {
        // 禁用定时更新：禁用现有 GallerySchedule（不删除）
        await GallerySchedule.updateMany(
          { galleryArtifactId: existing.galleryArtifactId },
          { enabled: false }
        );
        logger.info('[gallery/publish] GallerySchedule disabled');
      }

    } else {
      artifact = publishResult.artifact;

      try {
        const { grantPermission } = require('~/server/services/PermissionService');
        await grantPermission({
          resourceType: 'galleryArtifact',
          resourceId: artifact._id,
          principalId: userId,
          principalType: 'user',
          accessRoleId: 'galleryArtifact_owner',
        });
      } catch (permissionError) {
        logger.error('[gallery/publish] Failed to grant owner permission', permissionError);
      }

      // 如果 autoUpdate 为 true，同时创建 GallerySchedule 记录
      if (autoUpdate && artifact) {
        try {
          const nextRunAt = calculateNextRunAt(updateFrequency, updateTime);
          
          const schedule = await GallerySchedule.findOneAndUpdate(
            { galleryArtifactId: artifact.galleryArtifactId },
            {
              $set: {
                frequency: updateFrequency || 'daily',
                updateTime: updateTime || '09:00',
                enabled: true,
                nextRunAt,
              },
              $setOnInsert: { userId },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );

          logger.info('[gallery/publish] GallerySchedule created', { 
            scheduleId: schedule._id, 
            galleryArtifactId: artifact.galleryArtifactId,
            nextRunAt: nextRunAt
          });
        } catch (scheduleError) {
          logger.error('[gallery/publish] Error creating GallerySchedule:', scheduleError);
          // 不阻止 artifact 创建成功，只是调度创建失败
        }
      }

    }

    const versionResult = await appendGalleryVersion({
      GalleryArtifact,
      GalleryVersion,
      artifact,
      versionData: {
        html: content || '',
        createdBy: 'user',
        status: 'success',
      },
    });
    artifact = versionResult.artifact;

    // 发布成功后自动提取保存 SQL（仅 autoUpdate=true 时，不走对话窗口）
    let sqlResult = null;
    if (autoUpdate) {
      try {
        const sqlArtifactId = artifact.galleryArtifactId;
        const currentVersionNum = versionResult.version;

        // 从 MongoDB 查询对话历史，而不是前端传 messages
        const reportTargetMessageId = artifact.targetMessageId;
        const msgs = await Message.find({ conversationId, user: userId })
          .sort({ createdAt: 1, _id: 1 })
          .lean();

        const relevantMsgs = getMessagesThroughTarget(msgs, reportTargetMessageId);

        if (relevantMsgs) {
          const queries = [];
          let order = 1;
          for (const msg of relevantMsgs) {
            if (!msg.content || !Array.isArray(msg.content)) continue;
            for (const part of msg.content) {
              if (part.type !== 'tool_call' || !part.tool_call) continue;
              try {
                const tc = part.tool_call;
                const args = typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args;
                if (!args) continue;
                const sql = args.querySql || args.sql || args.query || args.sqlQuery || args.statement;
                if (sql && typeof sql === 'string' && (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('WITH'))) {
                  queries.push({
                    sql: sql.trim(),
                    datasetId: args.datasetId || args.id,
                    dataKey: `query_${order}`,
                    description: args.question || args.description || `${tc.name || '查询'} ${order}`,
                    resultShape: 'table',
                    order,
                  });
                  order++;
                }
              } catch (e) { /* skip malformed tool_calls */ }
            }
          }
          if (queries.length > 0) {
            await upsertGallerySqlQueries({
              GallerySqlQuery,
              artifact,
              userId,
              queries,
              extractedBy: 'tool_calls',
            });
            // 更新版本记录：SQL 固化成功
            await GalleryVersion.updateOne(
              { galleryArtifactId: sqlArtifactId, version: currentVersionNum },
              { $set: { sqlMessage: "已固化 " + queries.length + " 条数据查询" } }
            );
            sqlResult = { success: true, count: queries.length };
            logger.info('[gallery/publish] Auto-saved SQL queries', { artifactId: sqlArtifactId, count: queries.length });
          } else {
            // 更新版本记录：SQL 固化失败
            await GalleryVersion.updateOne(
              { galleryArtifactId: sqlArtifactId, version: currentVersionNum },
              { $set: { status: 'failed', errorMessage: '定时任务已开启，但未从对话中找到数据查询语句，定时更新将无法执行' } }
            );
            sqlResult = { success: false, reason: 'no_sql_found' };
            logger.warn('[gallery/publish] No SQL queries found in relevant messages', {
              artifactId: sqlArtifactId,
              targetMessageId: reportTargetMessageId,
            });
          }
        } else {
          await GalleryVersion.updateOne(
            { galleryArtifactId: sqlArtifactId, version: currentVersionNum },
            { $set: { status: 'failed', errorMessage: '未找到目标消息，定时更新将无法执行' } }
          );
          sqlResult = { success: false, reason: 'target_not_found' };
          logger.warn('[gallery/publish] Target message not found in DB messages', {
            targetMessageId: reportTargetMessageId,
          });
        }
      } catch (sqlError) {
        sqlResult = { success: false, reason: 'error', error: sqlError.message };
        logger.error('[gallery/publish] Error auto-saving SQL:', sqlError);
      }
    }

    logger.info('[gallery/publish] Artifact saved successfully', {
      galleryArtifactId: artifact.galleryArtifactId,
      created: publishResult.created,
      version: versionResult.version,
    });
    const response = artifact.toObject ? artifact.toObject() : { ...artifact };
    response.id = artifact.galleryArtifactId;
    sanitizeReflectedFields(response, [
      'galleryArtifactId', 'title', 'type', 'conversationId',
      'sourceArtifactId', 'messageId', 'targetMessageId', 'skillId', 'skillPath',
      'agentId', 'agentName',
    ]);
    response.sqlResult = sqlResult;
    sendJsonResponse(res, response);
  } catch (error) {
    logger.error('[gallery/publish] Error creating artifact:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

/**
 * 更新作品
 */
router.patch('/:id', requireJwtAuth, async (req, res) => {
  try {
    const result = await updateGalleryArtifact(req.params.id, req.user.id, req.body);
    if (!result) {
      return res.status(404).json({ error: 'Gallery artifact not found' });
    }
    
    // 自动更新分享链接
    const { updateGalleryArtifactShare } = require('~/models/GalleryArtifactShare');
    try {
      await updateGalleryArtifactShare(req.params.id, result);
    } catch (shareError) {
      // 忽略分享更新错误
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 删除作品
 */
router.delete('/:id', requireJwtAuth, async (req, res) => {
  try {
    const result = await deleteGalleryArtifact(req.params.id, req.user.id);
    if (!result) {
      return res.status(404).json({ error: 'Gallery artifact not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取版本列表
 */
router.get('/:id/versions', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const safeId = String(id);
    if (!/^gal_[a-z0-9]+_[a-z0-9]+$/i.test(safeId)) {
      return res.status(400).json({ error: 'Invalid artifact ID format' });
    }
    const rawPage = parseInt(req.query.page, 10);
    const rawLimit = parseInt(req.query.limit, 10);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 100 ? rawLimit : 10;
    const skip = (page - 1) * limit;
    
    const [versions, totalAgg] = await Promise.all([
      GalleryVersion.aggregate([
        { $match: { galleryArtifactId: safeId } },
        { $project: { html: 0 } },
        { $sort: { version: -1 } },
        { $skip: skip },
        { $limit: limit },
      ]),
      GalleryVersion.aggregate([
        { $match: { galleryArtifactId: safeId } },
        { $count: 'total' },
      ]),
    ]);
    
    const total = totalAgg.length > 0 ? totalAgg[0].total : 0;
    sendJsonResponse(res, { versions, total, page, limit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取指定版本详情（含 HTML）
 */
router.get('/:id/versions/:version', requireJwtAuth, async (req, res) => {
  try {
    const { id, version } = req.params;
    const versionRecord = await GalleryVersion.findOne({
      galleryArtifactId: id,
      version: parseInt(version),
    }).lean();
    
    if (!versionRecord) {
      return res.status(404).json({ error: 'Version not found' });
    }
    
    res.json(versionRecord);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 手动触发更新
 */
router.post('/:id/manual-update', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const artifact = await GalleryArtifact.findOne({ galleryArtifactId: id, userId: req.user.id });
    if (!artifact) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    
    // 先检查 SQL queries（需要在获取 currentVersion 之后才能创建失败版本）
    const sqlRecord = await GallerySqlQuery.findOne({ galleryArtifactId: id });
    
    // 执行更新流程（复用和 galleryScheduler 相同的逻辑）
    const currentVersion = await GalleryVersion.findOne({
      galleryArtifactId: id,
      version: artifact.currentVersion || 1,
    });
    
    if (!currentVersion) {
      return res.status(400).json({ error: 'Current version not found' });
    }
    
    // 创建失败版本的辅助函数（在获取 currentVersion 后可用）
    const createFailedVersion = async (errorMessage) => {
      const newVersion = (artifact.currentVersion || 1) + 1;
      await GalleryVersion.create({
        galleryArtifactId: id,
        version: newVersion,
        html: currentVersion.html,
        createdBy: 'manual',
        status: 'failed',
        errorMessage: errorMessage,
        ...getGalleryVersionProvenance(artifact),
      });
      await GalleryArtifact.updateOne(
        { galleryArtifactId: id },
        { currentVersion: newVersion }
      );
      return { version: newVersion, message: errorMessage };
    };
    
    // 检查 SQL queries（在 createFailedVersion 定义后）
    if (!sqlRecord || sqlRecord.queries.length === 0) {
      const { version, message } = await createFailedVersion('No SQL queries found. Please solidify the report first.');
      return res.json({ message, version, status: 'failed' });
    }
    
    const DMP_MCP_URL = process.env.DMP_MCP_URL;
    const DMP_API_KEY = process.env.DMP_API_KEY;
    
    if (!DMP_MCP_URL || !DMP_API_KEY) {
      const { version, message } = await createFailedVersion('DMP API not configured');
      return res.json({ message, version, status: 'failed' });
    }
    
    const agentIdForDMP = artifact.agentId;
    let datasetId;
    for (const q of sqlRecord.queries) {
      if (q.datasetId) {
        datasetId = q.datasetId;
        break;
      }
    }
    
    // Execute SQL queries
    const queryResults = [];
    let rpcId = 100;
    for (const query of sqlRecord.queries) {
      try {
        const response = await fetch(DMP_MCP_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Api-Key': DMP_API_KEY,
            'X-Agent-Id': agentIdForDMP,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId++,
            method: 'tools/call',
            params: {
              name: 'query_data',
              arguments: {
                datasetId: query.datasetId || datasetId,
                querySql: query.sql,
              },
            },
          }),
        });
        const data = await response.json();
        const resultText = data?.result?.content?.[0]?.text;
        if (resultText) {
          queryResults.push({ description: query.description, result: resultText });
        } else {
          queryResults.push({ description: query.description, error: data?.error?.message || 'No result' });
        }
      } catch (e) {
        queryResults.push({ description: query.description, error: e.message });
      }
    }
    
    const successCount = queryResults.filter(r => r.result).length;
    
    if (successCount === 0) {
      // All queries failed - create failed version
      const newVersion = (artifact.currentVersion || 1) + 1;
      await GalleryVersion.create({
        galleryArtifactId: id,
        version: newVersion,
        html: currentVersion.html,
        createdBy: 'manual',
        status: 'failed',
        errorMessage: '所有SQL查询执行失败',
        ...getGalleryVersionProvenance(artifact),
      });
      await GalleryArtifact.updateOne(
        { galleryArtifactId: id },
        { currentVersion: newVersion }
      );
      return res.json({ message: '更新失败：所有SQL查询执行失败', version: newVersion, status: 'failed' });
    }
    
    // Resolve LLM config
    const envVarRegex = /\$\{([^}]+)\}/;
    function extractEnvVariable(value) {
      if (!value || typeof value !== 'string') return value;
      const match = value.match(envVarRegex);
      if (match) {
        const envValue = process.env[match[1]];
        return envValue !== undefined ? envValue : value;
      }
      return value;
    }
    function normalizeEndpointName(name) {
      return name ? name.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    }
    
    const agent = await mongoose.connection.db.collection('agents').findOne({ id: agentIdForDMP });
    if (!agent) {
      const { version, message } = await createFailedVersion('Agent not found');
      return res.json({ message, version, status: 'failed' });
    }
    
    // 使用 loadCustomConfig 统一读取配置（支持 CONFIG_PATH 远程/本地）
    const loadCustomConfig = require('../services/Config/loadCustomConfig');
    let customEndpoints = [];
    try {
      const customConfig = await loadCustomConfig(false);
      customEndpoints = customConfig?.endpoints?.custom || [];
    } catch (e) { /* ignore */ }
    
    let endpointConfig;
    const normalizedProvider = normalizeEndpointName(agent.provider);
    for (const ep of customEndpoints) {
      if (normalizeEndpointName(ep.name) === normalizedProvider) {
        endpointConfig = ep;
        break;
      }
    }
    
    if (!endpointConfig) {
      const { version, message } = await createFailedVersion(`No endpoint config for provider: ${agent.provider}`);
      return res.json({ message, version, status: 'failed' });
    }
    
    const apiKey = extractEnvVariable(endpointConfig.apiKey || '');
    const baseURL = extractEnvVariable(endpointConfig.baseURL || '');
    
    if (!apiKey || apiKey === 'user_provided') {
      const { version, message } = await createFailedVersion('API key not available');
      return res.json({ message, version, status: 'failed' });
    }
    
    // Call LLM
    const currentHtml = currentVersion.html;
    const resultsSummary = queryResults
      .filter(r => r.result)
      .map(r => `【${r.description}】\n${r.result}`)
      .join('\n\n');
    
    try {
      const llmResponse = await fetch(`${baseURL || 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: agent.model,
          messages: [
            {
              role: 'system',
              content: `你是一个报告更新助手。你会收到一份HTML报告模板和最新的数据查询结果（每组包含SQL语句和执行结果）。\n你的任务是基于新数据，重新生成一份完整的HTML报告。\n\n规则：\n0. 先理解报告结构 - 阅读HTML模板，理解报告中包含哪些数据展示（图表、表格、指标等）\n1. 样式和布局保持不变 — HTML结构、CSS样式、图表类型、页面布局完全复用原报告\n2. 数据全部更新 — 用查询结果中的最新数据替换所有旧数据\n3. 解读重新生成 — 基于新数据重新撰写所有分析解读、趋势描述、关键发现等文字内容\n4. 元数据更新 — 更新报告中的日期、时间、统计截止日期等元信息\n5. 当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}，所有涉及“更新时间”“报告日期”等字段请使用此时间\n6. 输出完整HTML — 不要省略任何部分，不要添加解释，只输出HTML`,
            },
            {
              role: 'user',
              content: `以下是原HTML报告模板：\n\n${currentHtml}\n\n以下是最新的数据查询结果：\n\n${resultsSummary}\n\n请基于新数据重新生成报告，保持相同的样式和布局，更新所有数据、解读和元信息。`,
            },
          ],
          temperature: 0.1,
          max_tokens: 16000,
        }),
      });
      
      const llmData = await llmResponse.json();
      let newHtml = llmData?.choices?.[0]?.message?.content;
      
      if (!newHtml) {
        const newVersion = (artifact.currentVersion || 1) + 1;
        await GalleryVersion.create({
          galleryArtifactId: id,
          version: newVersion,
          html: currentVersion.html,
          createdBy: 'manual',
          status: 'failed',
          errorMessage: 'LLM returned empty response',
          ...getGalleryVersionProvenance(artifact),
        });
        await GalleryArtifact.updateOne(
          { galleryArtifactId: id },
          { currentVersion: newVersion }
        );
        return res.json({ message: '更新失败：LLM返回为空', version: newVersion, status: 'failed' });
      }
      
      newHtml = newHtml.replace(/^```html?\n?/, '').replace(/\n?```$/, '');
      
      const newVersion = (artifact.currentVersion || 1) + 1;
      await GalleryVersion.create({
        galleryArtifactId: id,
        version: newVersion,
        html: newHtml,
        createdBy: 'manual',
        status: 'success',
        ...getGalleryVersionProvenance(artifact),
      });
      
      await GalleryArtifact.updateOne(
        { galleryArtifactId: id },
        { currentVersion: newVersion, content: newHtml }
      );
      
      res.json({ message: `已更新到 V${newVersion}`, version: newVersion, status: 'success' });
    } catch (llmError) {
      const newVersion = (artifact.currentVersion || 1) + 1;
      await GalleryVersion.create({
        galleryArtifactId: id,
        version: newVersion,
        html: currentVersion.html,
        createdBy: 'manual',
        status: 'failed',
        errorMessage: `LLM更新失败: ${llmError.message}`,
        ...getGalleryVersionProvenance(artifact),
      });
      await GalleryArtifact.updateOne(
        { galleryArtifactId: id },
        { currentVersion: newVersion }
      );
      res.json({ message: `更新失败：${llmError.message}`, version: newVersion, status: 'failed' });
    }
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 点赞/取消点赞
 */
router.post('/:id/like', requireJwtAuth, async (req, res) => {
  try {
    const result = await toggleGalleryLike(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 收藏/取消收藏
 */
router.post('/:id/bookmark', requireJwtAuth, async (req, res) => {
  try {
    const result = await toggleGalleryBookmark(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 保存报告关联的 SQL 查询
 */
router.post('/sql-queries', requireJwtAuth, async (req, res) => {
  try {
    const { galleryArtifactId, queries, extractedBy } = req.body;
    const userId = req.user.id;

    if (!galleryArtifactId || !queries || !Array.isArray(queries)) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const artifact = await GalleryArtifact.findOne({ galleryArtifactId, userId });
    if (!artifact) {
      return res.status(404).json({ error: '作品不存在' });
    }

    const record = await upsertGallerySqlQueries({
      GallerySqlQuery,
      artifact,
      userId,
      queries,
      extractedBy,
    });

    res.json({ success: true, id: record._id });
  } catch (error) {
    console.error('[Gallery] Error saving SQL queries:', error);
    res.status(500).json({ error: '保存 SQL 查询失败' });
  }
});

/**
 * 获取报告关联的 SQL 查询
 */
router.get('/sql-queries/:artifactId', requireJwtAuth, async (req, res) => {
  try {
    const { artifactId } = req.params;
    const artifact = await GalleryArtifact.findOne({
      galleryArtifactId: artifactId,
      userId: req.user.id,
    }).select('_id').lean();
    if (!artifact) {
      return res.status(404).json({ error: '作品不存在' });
    }
    const record = await GallerySqlQuery.findOne({ galleryArtifactId: artifactId });
    if (!record) {
      return res.status(404).json({ error: '未找到 SQL 查询记录' });
    }
    res.json(record);
  } catch (error) {
    console.error('[Gallery] Error fetching SQL queries:', error);
    res.status(500).json({ error: '获取 SQL 查询失败' });
  }
});

module.exports = router;
