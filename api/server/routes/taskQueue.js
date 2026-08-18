const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const cookies = require('cookie');
const { isEnabled } = require('@librechat/api');
const { TaskQueue } = require('../../models/TaskQueue');
const { logger } = require('@librechat/data-schemas');

const { User } = require('~/db/models');

const router = express.Router();

const PI_API_KEY = process.env.PI_API_KEY || 'testkey';

/**
 * 认证中间件：先尝试 JWT，失败后尝试 api-key
 * - JWT 认证：req.user.id（从 JWT token 解析）
 * - api-key 认证：req.headers['api-key'] 匹配 PI_API_KEY 后，信任 x-user-id header
 *
 * 参考 pi.js 的 chat/completions 路由：不走 requireJwtAuth，
 * 而是用 passport 直接尝试认证，失败不写响应，留给 api-key 回退。
 */
function requireTaskQueueAuth(req, res, next) {
  // 1. 尝试 JWT 认证（不发送响应）
  const cookieHeader = req.headers.cookie;
  const tokenProvider = cookieHeader ? cookies.parse(cookieHeader).token_provider : null;

  let strategy;
  if (tokenProvider === 'openid' && isEnabled(process.env.OPENID_REUSE_TOKENS)) {
    strategy = 'openidJwt';
  } else {
    strategy = 'jwt';
  }

  passport.authenticate(strategy, { session: false }, (err, user, info) => {
    // JWT 成功
    if (!err && user && user.id) {
      req.user = user;
      req._authMethod = 'jwt';
      return next();
    }

    // JWT 失败，尝试 api-key
    const apiKey = req.headers['api-key'] || req.body?.apiKey;
    if (apiKey && apiKey === PI_API_KEY) {
      const userId = req.headers['x-user-id'] || req.body?.userId;
      if (!userId) {
        return res.status(400).json({ error: 'userId is required when using api-key auth' });
      }
      req.user = { id: userId };
      req._authMethod = 'api-key';
      return next();
    }

    // 两种认证都失败
    return res.status(401).json({ error: 'Authentication required (JWT or api-key)' });
  })(req, res, next);
}

/**
 * GET /api/task-queue
 * 获取我的任务列表（toUserId = 当前用户）
 * query: ?status=pending&type=collaboration&page=1&limit=20
 */
router.get('/', requireTaskQueueAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, type, page = 1, limit = 20 } = req.query;

    const filter = { toUserId: userId, cleared: { $ne: true } };

    if (status) {
      filter.status = status;
    }
    if (type) {
      filter.type = type;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [tasks, total] = await Promise.all([
      TaskQueue.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      TaskQueue.countDocuments(filter),
    ]);

    // 收集所有不重复的 userId
    const uniqueUserIds = [...new Set([
      ...tasks.map((t) => t.fromUserId),
      ...tasks.map((t) => t.toUserId),
    ].filter(Boolean))];

    // 查询用户信息，构建 userId -> { name, username } 映射
    const userMap = {};
    if (uniqueUserIds.length > 0) {
      try {
        const users = await User.find({ _id: { $in: uniqueUserIds } }).select('name username').lean();
        for (const u of users) {
          userMap[u._id.toString()] = { name: u.name, username: u.username };
        }
      } catch (userErr) {
        logger.warn('[GET /api/task-queue] Failed to lookup users:', userErr.message);
      }
    }

    // 给每个 task 附加 fromUserName 和 toUserName
    const tasksWithNames = tasks.map((task) => {
      const fromUser = task.fromUserId ? userMap[task.fromUserId] : null;
      const toUser = task.toUserId ? userMap[task.toUserId] : null;
      return {
        ...task,
        fromUserName: fromUser ? (fromUser.name || fromUser.username || '未知用户') : '未知用户',
        toUserName: toUser ? (toUser.name || toUser.username || '未知用户') : '未知用户',
      };
    });

    return res.json({
      tasks: tasksWithNames,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    logger.error('[GET /api/task-queue] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/task-queue/:taskId
 * 查询单条任务
 * 权限：toUserId 或 fromUserId 匹配当前用户
 */
router.get('/:taskId', requireTaskQueueAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: 'Invalid taskId format' });
    }

    const task = await TaskQueue.findById(taskId).lean();
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // 权限检查
    if (task.toUserId !== userId && task.fromUserId !== userId) {
      return res.status(403).json({ error: 'You do not have permission to view this task' });
    }

    return res.json(task);
  } catch (error) {
    logger.error('[GET /api/task-queue/:taskId] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/task-queue
 * 创建任务
 * body: { toUserId, toAgentId?, fromAgentId?, type, title, description?, metadata?, callbackUrl?, expiresAt?, sourceConversationId?, sourceSessionId? }
 * fromUserId 自动从认证信息取
 */
router.post('/', requireTaskQueueAuth, async (req, res) => {
  try {
    const fromUserId = req.user.id;
    const {
      toUserId,
      toAgentId,
      fromAgentId,
      type = 'ai_pending',
      title,
      description,
      metadata,
      callbackUrl,
      expiresAt,
      sourceConversationId,
      sourceSessionId,
      sourceTurnSeq,
      priority,
      formType,
      choices,
      fields,
      subagentTaskId,
      subagentName,
    } = req.body;

    // 校验必填字段
    if (!toUserId) {
      return res.status(400).json({ error: 'toUserId is required' });
    }
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const validTypes = ['ai_pending', 'collaboration', 'manual', 'subagent'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const validPriorities = ['low', 'medium', 'high'];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of: ${validPriorities.join(', ')}` });
    }

    const taskData = {
      toUserId,
      toAgentId: toAgentId || undefined,
      fromUserId,
      fromAgentId: fromAgentId || undefined,
      sourceConversationId: sourceConversationId || undefined,
      sourceSessionId: sourceSessionId || undefined,
      sourceTurnSeq: sourceTurnSeq || undefined,
      type,
      title,
      description: description || undefined,
      priority: priority || 'medium',
      metadata: metadata || {},
      callbackUrl: callbackUrl || undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      formType: formType || 'free_text',
      choices: choices || undefined,
      fields: fields || undefined,
      subagentTaskId: subagentTaskId || undefined,
      subagentName: subagentName || undefined,
    };

    // 移除 undefined 字段，避免 mongoose 警告
    Object.keys(taskData).forEach((key) => taskData[key] === undefined && delete taskData[key]);

    const task = await TaskQueue.create(taskData);

    logger.info('[POST /api/task-queue] Task created', {
      taskId: task._id,
      toUserId,
      fromUserId,
      type,
      title: title.substring(0, 50),
    });

    return res.status(201).json(task);
  } catch (error) {
    logger.error('[POST /api/task-queue] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/task-queue/:taskId
 * 更新任务（主要是改状态）
 * body: { status, resultSummary? }
 * 权限：toUserId 的用户才能改状态（接收方确认/拒绝/完成）
 * 特殊：fromUserId 也可以 dismiss 自己发出的协作请求
 */
router.patch('/:taskId', requireTaskQueueAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: 'Invalid taskId format' });
    }

    const task = await TaskQueue.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // 权限检查
    const isToUser = task.toUserId === userId;
    const isFromUser = task.fromUserId === userId;

    if (!isToUser && !isFromUser) {
      return res.status(403).json({ error: 'You do not have permission to update this task' });
    }

    const isApiKey = req._authMethod === 'api-key';

    // api-key 认证可更新的字段
    const apiKeyFields = [
      'title',
      'description',
      'metadata',
      'priority',
      'status',
      'callbackUrl',
      'expiresAt',
      'resultSummary',
      'subagentTaskId',
      'subagentName',
    ];
    // JWT 认证可更新的字段（原有逻辑）
    const jwtFields = ['status', 'resultSummary', 'metadata', 'sourceConversationId', 'formResponse'];

    const allowedFields = isApiKey ? apiKeyFields : jwtFields;
    const update = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        // 状态校验
        if (field === 'status') {
          const validStatuses = [
            'pending',
            'accepted',
            'in_progress',
            'waiting_agent',
            'running',
            'completed',
            'rejected',
            'dismissed',
            'failed',
            'aborted',
          ];
          if (!validStatuses.includes(req.body[field])) {
            return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
          }
          // fromUserId 只能 dismiss 自己发出的请求
          if (!isToUser && isFromUser && req.body[field] !== 'dismissed') {
            return res.status(403).json({ error: 'As the task creator, you can only dismiss your own task' });
          }
          update.status = req.body[field];
          // 状态流转逻辑
          if (['completed', 'rejected', 'dismissed', 'failed', 'aborted'].includes(req.body[field])) {
            update.completedAt = new Date();
          }
        } else if (field === 'priority') {
          const validPriorities = ['low', 'medium', 'high'];
          if (!validPriorities.includes(req.body[field])) {
            return res.status(400).json({ error: `priority must be one of: ${validPriorities.join(', ')}` });
          }
          update[field] = req.body[field];
        } else if (field === 'expiresAt') {
          update[field] = req.body[field] ? new Date(req.body[field]) : null;
        } else {
          update[field] = req.body[field];
        }
      }
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: `At least one of ${allowedFields.join(', ')} is required` });
    }

    const updatedTask = await TaskQueue.findByIdAndUpdate(
      taskId,
      { $set: update },
      { new: true },
    ).lean();

    logger.info('[PATCH /api/task-queue/:taskId] Task updated', {
      taskId,
      userId,
      updateFields: Object.keys(update),
    });

    return res.json(updatedTask);
  } catch (error) {
    logger.error('[PATCH /api/task-queue/:taskId] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/task-queue/:taskId
 * 删除任务
 * 权限：只有 toUserId 或 fromUserId 才能删
 */
router.delete('/:taskId', requireTaskQueueAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: 'Invalid taskId format' });
    }

    const task = await TaskQueue.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // 权限检查
    if (task.toUserId !== userId && task.fromUserId !== userId) {
      return res.status(403).json({ error: 'You do not have permission to delete this task' });
    }

    await TaskQueue.findByIdAndDelete(taskId);

    logger.info('[DELETE /api/task-queue/:taskId] Task deleted', {
      taskId,
      userId,
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/task-queue/:taskId] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/task-queue/:taskId/respond
 * 用户回复协作任务，触发后台 PI 执行
 * body: { userResponse: string }
 * 流程：pending → in_progress → completed
 */
router.post('/:taskId/respond', requireTaskQueueAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { userResponse } = req.body;

    if (!userResponse || !userResponse.trim()) {
      return res.status(400).json({ error: 'userResponse is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: 'Invalid taskId format' });
    }

    const task = await TaskQueue.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // 只有 toUserId 才能回复
    if (task.toUserId !== userId) {
      return res.status(403).json({ error: 'Only the assignee can respond to this task' });
    }

    if (task.status !== 'pending') {
      return res.status(400).json({ error: `Task is already ${task.status}, cannot respond` });
    }

    // 保存用户回复，标记为 in_progress
    task.userResponse = userResponse.trim();
    task.status = 'in_progress';
    await task.save();

    // 方案2：不调 PI，只保存用户回复 + 标 in_progress
    // 前端负责创建 PI 对话 + 注入上下文 + navigate
    // 对话结束时前端回写 resultSummary + 标 completed
    return res.json({ taskId: task._id, status: 'in_progress', userResponse: userResponse.trim() });
  } catch (error) {
    logger.error('[POST /api/task-queue/:taskId/respond] Error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
  }
});

// =====================
// === 新增端点 ===
// =====================

/**
 * GET /api/task-queue/by-conversation/:conversationId
 * 按会话拉取任务列表（前端会话内面板用）
 * query: ?status=pending
 */
router.get('/by-conversation/:conversationId', requireTaskQueueAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { status } = req.query;

    const filter = { sourceConversationId: conversationId, cleared: { $ne: true } };
    if (status) {
      filter.status = status;
    }

    const tasks = await TaskQueue.find(filter).sort({ createdAt: 1 }).lean();

    const visibleTasks = tasks.filter((t) => t.toUserId === userId || t.fromUserId === userId);

    return res.json({ tasks: visibleTasks });
  } catch (error) {
    logger.error('[GET /api/task-queue/by-conversation] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/task-queue/by-conversation/:conversationId/completed
 * 软删除会话内已完结任务（completed/rejected/dismissed/failed/aborted）：
 * 置 cleared=true，不再出现在任务列表，文档保留（审计/回溯），
 * 由 completedAt TTL（7 天）最终回收。活跃任务不受影响。
 * 权限：toUserId 或 fromUserId 匹配当前用户
 */
router.delete('/by-conversation/:conversationId/completed', requireTaskQueueAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const result = await TaskQueue.updateMany(
      {
        sourceConversationId: conversationId,
        status: { $in: ['completed', 'rejected', 'dismissed', 'failed', 'aborted'] },
        cleared: { $ne: true },
        $or: [{ toUserId: userId }, { fromUserId: userId }],
      },
      { $set: { cleared: true } },
    );

    logger.info('[DELETE /api/task-queue/by-conversation/completed] Cleared finished tasks', {
      conversationId,
      userId,
      cleared: result.modifiedCount,
    });

    return res.json({ success: true, cleared: result.modifiedCount });
  } catch (error) {
    logger.error('[DELETE /api/task-queue/by-conversation/completed] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/task-queue/:taskId/submit
 * 提交表单响应，状态 → waiting_agent
 * body: { formResponse: object }
 */
router.post('/:taskId/submit', requireTaskQueueAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { formResponse } = req.body;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: 'Invalid taskId format' });
    }

    const task = await TaskQueue.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.toUserId !== userId) {
      return res.status(403).json({ error: 'Only the assignee can submit this task' });
    }

    if (!['pending', 'accepted'].includes(task.status)) {
      return res.status(400).json({ error: `Task is ${task.status}, cannot submit` });
    }

    task.formResponse = formResponse || {};
    task.userResponse = typeof formResponse === 'string' ? formResponse : JSON.stringify(formResponse);

    // 语义化终态：取消类响应直接落终态，不进入 waiting_agent
    // - confirmation 拒绝（confirmed === false）→ rejected
    // - choice 选中标记 isCancel 的选项（如"取消"）→ rejected
    // 其余响应 → waiting_agent，由 pi 下一轮 prompt 接管（注入后 running → completed）
    let nextStatus = 'waiting_agent';
    if (task.formType === 'confirmation' && formResponse?.confirmed === false) {
      nextStatus = 'rejected';
    } else if (task.formType === 'choice' && typeof formResponse?.choice === 'string') {
      const chosen = (task.choices || []).find(
        (c) => c.value === formResponse.choice || c.label === formResponse.choice,
      );
      if (chosen?.isCancel) {
        nextStatus = 'rejected';
      }
    }

    task.status = nextStatus;
    if (nextStatus === 'rejected') {
      task.completedAt = new Date();
    }
    await task.save();

    logger.info('[POST /api/task-queue/:taskId/submit] Task submitted', {
      taskId,
      userId,
      formType: task.formType,
      nextStatus,
    });

    return res.json({ taskId: task._id, status: nextStatus });
  } catch (error) {
    logger.error('[POST /api/task-queue/:taskId/submit] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/task-queue/:taskId/start
 * pi 开始处理任务，状态 → running
 * 需要 api-key 认证（pi 后端调用）
 */
router.post('/:taskId/start', requireTaskQueueAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: 'Invalid taskId format' });
    }

    const task = await TaskQueue.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!['waiting_agent', 'accepted', 'pending'].includes(task.status)) {
      return res.status(400).json({ error: `Task is ${task.status}, cannot start` });
    }

    task.status = 'running';
    await task.save();

    logger.info('[POST /api/task-queue/:taskId/start] Task started', {
      taskId,
      userId,
      agentId: req.headers['x-agent-id'],
    });

    return res.json({ taskId: task._id, status: 'running' });
  } catch (error) {
    logger.error('[POST /api/task-queue/:taskId/start] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
