const { v4: uuidv4 } = require('uuid');
const { encodeEphemeralAgentId } = require('librechat-data-provider');
const { getPiSystemPrompt } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const {
  GallerySkillTaskRun,
  generateGallerySkillTaskRunId,
} = require('../../models/GallerySkillTaskRun');
const { Conversation } = require('~/db/models');

const PI_HOST = process.env.PI_HOST || process.env.PI_AGENT_URL || 'http://localhost:3000';
const PI_API_KEY = process.env.PI_API_KEY || 'testkey';

const SKILL_TASK_SOURCE = 'gallery_skill_task';

const buildSkillTaskMessage = (task) => {
  const params = task.parameters || {};
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && String(value).trim() !== '',
  );
  if (entries.length === 0) {
    return `/skill:${task.skillName}`;
  }

  const parameterText = entries.map(([key, value]) => `- ${key}: ${value}`).join('\n');
  return `/skill:${task.skillName}\n\n本次任务参数：\n${parameterText}`;
};

const collectPiFiles = async (agentId, sessionId, userId, modifiedSince) => {
  if (!agentId || !sessionId) {
    return [];
  }

  try {
    let url = `${PI_HOST}/files?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}&recursive=true`;
    if (modifiedSince) {
      url += `&modifiedSince=${encodeURIComponent(new Date(modifiedSince).toISOString())}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'api-key': PI_API_KEY, 'X-User-Id': String(userId) },
    });

    if (!response.ok) {
      logger.warn('[GallerySkillTaskExecutor] PI files API returned', { status: response.status });
      return [];
    }

    const data = await response.json();
    const files = (data.files || []).filter((f) => !f.isDirectory);

    return files.map((f) => ({
      name: (f.path || f.name || '').split('/').pop(),
      path: f.path || f.name,
      url: `/arp/api/pi/files/download?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(f.path || f.name)}`,
      mimeType: f.mimeType || null,
      size: f.size || null,
    }));
  } catch (error) {
    logger.warn('[GallerySkillTaskExecutor] Failed to collect PI files', { error: error.message });
    return [];
  }
};

const createSkillTaskConversation = (task, runId) => {
  const conversationId = uuidv4();
  return Conversation.create({
    conversationId,
    user: String(task.userId),
    source: SKILL_TASK_SOURCE,
    sourceDataId: runId,
    title: task.taskName || task.skillName || 'Skill Task',
    endpoint: 'pi',
    model: 'one-pi',
    messages: [],
  }).then((doc) => doc.conversationId);
};

const executePiSkillTask = async (task, conversationId) => {
  const sender = 'One Pi';
  const agentId = encodeEphemeralAgentId({ endpoint: 'pi', model: 'one-pi', sender });
  const sessionId = conversationId;
  const message = buildSkillTaskMessage(task);
  const response = await fetch(`${PI_HOST}/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': PI_API_KEY,
      'X-User-Id': String(task.userId),
    },
    body: JSON.stringify({
      message,
      agentId,
      sessionId,
      cwd: null,
      stream: true,
      systemPrompt: await getPiSystemPrompt(),
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  let textOutput = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) {
        continue;
      }
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'text_delta' && data.delta) {
          textOutput += data.delta;
        }
      } catch (_) {
        // skip malformed SSE line
      }
    }
  }

  const files = await collectPiFiles(agentId, sessionId, task.userId, task._startedAt);
  return { agentId, sessionId, conversationId, message, textOutput, files };
};

const executeGallerySkillTask = async ({
  task,
  triggeredBy = 'auto',
  calculateNextRunAt,
  calculateRetryDelay,
  advanceSchedule = triggeredBy === 'auto',
}) => {
  const startedAt = new Date();
  const runId = generateGallerySkillTaskRunId();
  task._startedAt = startedAt;

  await task.constructor.findByIdAndUpdate(task._id, {
    $set: { status: 'running' },
  });

  const conversationId = await createSkillTaskConversation(task, runId);

  try {
    const piResult = await executePiSkillTask(task, conversationId);
    const completedAt = new Date();
    const run = await GallerySkillTaskRun.create({
      runId,
      taskId: task.taskId,
      userId: task.userId,
      skillName: task.skillName,
      taskNameSnapshot: task.taskName,
      triggeredBy,
      status: 'success',
      parameters: task.parameters || {},
      textOutput: piResult.textOutput,
      files: piResult.files,
      logs: [
        {
          level: 'info',
          message: `Sent to PI: ${piResult.message}`,
          timestamp: startedAt,
        },
      ],
      sessionId: piResult.sessionId,
      conversationId,
      agentId: piResult.agentId,
      prompt: piResult.message,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    });

    const update = {
      status: 'success',
      enabled: true,
      lastRunAt: completedAt,
      lastDurationMs: run.durationMs,
      lastError: null,
      failureCount: 0,
    };
    if (advanceSchedule && calculateNextRunAt) {
      update.nextRunAt = calculateNextRunAt(task.frequency, task.scheduleTime, task.interval);
    }

    const updatedTask = await task.constructor.findByIdAndUpdate(task._id, { $set: update }, { new: true });
    return { task: updatedTask, run };
  } catch (error) {
    const completedAt = new Date();
    const failureCount = triggeredBy === 'auto' ? (task.failureCount || 0) + 1 : task.failureCount || 0;
    const shouldPause = triggeredBy === 'auto' && failureCount >= 2;
    const failedPrompt = buildSkillTaskMessage(task);
    const failedAgentId = encodeEphemeralAgentId({ endpoint: 'pi', model: 'one-pi', sender: 'One Pi' });

    const run = await GallerySkillTaskRun.create({
      runId,
      taskId: task.taskId,
      userId: task.userId,
      skillName: task.skillName,
      taskNameSnapshot: task.taskName,
      triggeredBy,
      status: 'failed',
      parameters: task.parameters || {},
      textOutput: '',
      files: [],
      logs: [
        {
          level: 'error',
          message: error.message,
          timestamp: completedAt,
        },
      ],
      error: { message: error.message, stack: error.stack || null },
      sessionId: conversationId,
      conversationId,
      agentId: failedAgentId,
      prompt: failedPrompt,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    });

    const update = {
      status: shouldPause ? 'failed_paused' : 'failed',
      enabled: !shouldPause,
      lastRunAt: completedAt,
      lastDurationMs: run.durationMs,
      lastError: error.message,
      failureCount,
    };
    if (triggeredBy === 'auto') {
      update.nextRunAt = shouldPause
        ? task.nextRunAt
        : new Date(Date.now() + calculateRetryDelay(failureCount));
    }

    const updatedTask = await task.constructor.findByIdAndUpdate(task._id, { $set: update }, { new: true });
    return { task: updatedTask, run };
  }
};

module.exports = {
  buildSkillTaskMessage,
  executeGallerySkillTask,
  executePiSkillTask,
};
