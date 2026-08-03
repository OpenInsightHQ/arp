const { encodeEphemeralAgentId } = require('librechat-data-provider');
const { getSystemPromptOrSeed } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const {
  GallerySkillTaskRun,
  generateGallerySkillTaskRunId,
} = require('../../models/GallerySkillTaskRun');

const PI_HOST = process.env.PI_HOST || process.env.PI_AGENT_URL || 'http://localhost:3000';
const PI_API_KEY = process.env.PI_API_KEY || 'testkey';

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

const collectPiFiles = async (agentId, sessionId, userId) => {
  const files = [];
  const dirs = [''];
  const visited = new Set();
  try {
    while (dirs.length > 0) {
      const currentPath = dirs.shift();
      const key = currentPath || '/';
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);
      let url = `${PI_HOST}/files?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}`;
      if (currentPath) {
        url += `&path=${encodeURIComponent(currentPath)}`;
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'api-key': PI_API_KEY, 'X-User-Id': String(userId) },
      });
      if (!response.ok) {
        continue;
      }
      const data = await response.json();
      for (const file of data.files || []) {
        const relativePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        if (file.isDirectory) {
          dirs.push(relativePath);
          continue;
        }
        files.push({
          name: file.name,
          path: relativePath,
          url: `/arp/api/pi/files/download?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(relativePath)}`,
          mimeType: file.mimeType || null,
          size: file.size || null,
        });
      }
    }
    return files;
  } catch (error) {
    logger.warn('[GallerySkillTaskExecutor] Failed to collect PI files', { error: error.message });
    return [];
  }
};

const executePiSkillTask = async (task, runId) => {
  const sender = 'One Pi';
  const agentId = encodeEphemeralAgentId({ endpoint: 'pi', model: 'one-pi', sender });
  const sessionId = `skilltask_${task.taskId}_${runId}`;
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
      systemPrompt: await getSystemPromptOrSeed('pi.system'),
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

  const files = await collectPiFiles(agentId, sessionId, task.userId);
  return { agentId, sessionId, message, textOutput, files };
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

  await task.constructor.findByIdAndUpdate(task._id, {
    $set: { status: 'running' },
  });

  try {
    const piResult = await executePiSkillTask(task, runId);
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
      conversationId: piResult.sessionId,
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
    const failedSessionId = `skilltask_${task.taskId}_${runId}`;
    const failedPrompt = buildSkillTaskMessage(task);
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
      sessionId: failedSessionId,
      conversationId: failedSessionId,
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
