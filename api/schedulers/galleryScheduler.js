/**
 * Gallery Scheduler - 定时任务执行器
 *
 * 功能:
 * 1. 每分钟扫描 GallerySchedule 表
 * 2. 查找 enabled=true 且 nextRunAt <= now 的任务
 * 3. 执行任务:读取 SQL → DMP 执行查询 → LLM 更新 HTML → 存新版本
 * 4. 记录执行日志到 GalleryRunLog
 * 5. 失败重试策略:连续失败次数越多,重试间隔越长
 * 6. 连续失败 5 次后禁用任务
 *
 * 启动方式:node api/schedulers/galleryScheduler.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { encodeEphemeralAgentId } = require('librechat-data-provider');
const { getSystemPromptOrSeed, initializeSystemPromptService } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');

// 导入模型
const { GalleryArtifact } = require('../models/GalleryArtifact');
const { GallerySchedule, GalleryRunLog } = require('../models/GallerySchedule');
const { GallerySqlQuery } = require('../models/GallerySqlQuery');
const { GalleryVersion } = require('../models/GalleryVersion');
const { GallerySkillTask } = require('../models/GallerySkillTask');
const { executeGallerySkillTask } = require('../server/services/GallerySkillTaskExecutor');
const { getGalleryVersionProvenance } = require('../server/utils/galleryArtifactIdentity');

// 配置
const SCAN_INTERVAL_MS = 60 * 1000; // 每分钟扫描一次
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const MAX_CONSECUTIVE_FAILURES = 5; // 最大连续失败次数
const PI_HOST = process.env.PI_HOST || process.env.PI_AGENT_URL || 'http://localhost:3000';
const PI_API_KEY = process.env.PI_API_KEY || 'testkey';


// DMP API 配置
const DMP_MCP_URL = process.env.DMP_MCP_URL;
const DMP_API_KEY = process.env.DMP_API_KEY;

// YAML 配置加载
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// 加载 librechat.yaml 配置
let customEndpointsCache = null;

async function loadCustomEndpoints() {
  if (customEndpointsCache) return customEndpointsCache;
  try {
    const loadCustomConfig = require('../server/services/Config/loadCustomConfig');
    const customConfig = await loadCustomConfig(false);
    customEndpointsCache = customConfig?.endpoints?.custom || [];
  } catch (e) {
    logger.error('[GalleryScheduler] Failed to load config:', e);
    customEndpointsCache = [];
  }
  return customEndpointsCache;
}

// 环境变量解析(和 initializeCustom 里的 extractEnvVariable 同逻辑)
const envVarRegex = /\$\{([^}]+)\}/;
function extractEnvVariable(value) {
  if (!value || typeof value !== 'string') return value;
  const match = value.match(envVarRegex);
  if (match) {
    const envVar = match[1];
    const envValue = process.env[envVar];
    if (envValue !== undefined) return envValue;
    return value; // 找不到环境变量就返回原始值
  }
  return value;
}

function normalizeEndpointName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 从 agents 集合和 librechat.yaml 解析 LLM 配置
 */
async function resolveLlmConfig(agentId) {
  // 1. 从 agents 集合查 provider 和 model
  const agent = await mongoose.connection.db.collection('agents').findOne({ id: agentId });
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const provider = agent.provider;
  const model = agent.model;

  // 2. 从 librechat.yaml 找匹配的 custom endpoint
  const endpoints = await loadCustomEndpoints();
  const endpointConfig = endpoints.find(
    (ep) => normalizeEndpointName(ep.name) === normalizeEndpointName(provider)
  );

  if (!endpointConfig) {
    throw new Error(`No custom endpoint config for provider: ${provider}`);
  }

  // 3. 解析 apiKey 和 baseURL(处理环境变量引用)
  let apiKey = extractEnvVariable(endpointConfig.apiKey || '');
  let baseURL = extractEnvVariable(endpointConfig.baseURL || '');

  if (!apiKey || apiKey === 'user_provided') {
    throw new Error(`API key not available for provider: ${provider}`);
  }

  if (!baseURL) {
    baseURL = 'https://api.openai.com/v1';
  }

  return { apiKey, baseURL, model, provider };
}

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI or MONGO_URI is not set in environment');
  process.exit(1);
}

/**
 * 连接 MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    initializeSystemPromptService(mongoose);
    logger.info('[GalleryScheduler] MongoDB connected');
  } catch (error) {
    logger.error('[GalleryScheduler] MongoDB connection error:', error);
    process.exit(1);
  }
}

/**
 * 计算下次执行时间
 */
function calculateNextRunAt(frequency, updateTime, interval = null) {
  const now = new Date();

  if (frequency === 'minute') {
    const minutesInterval = Number(interval) > 0 ? Number(interval) : 30;
    return new Date(now.getTime() + minutesInterval * 60 * 1000);
  }

  if (frequency === 'hourly') {
    const hoursInterval = Number(interval) > 0 ? Number(interval) : 1;
    return new Date(now.getTime() + hoursInterval * 60 * 60 * 1000);
  }

  const [hours, minutes] = (updateTime || '09:00').split(':').map(Number);

  let nextRun = new Date(now);
  nextRun.setHours(hours, minutes, 0, 0);

  switch (frequency) {
    case 'hourly':
      if (nextRun <= now) {
        nextRun.setHours(nextRun.getHours() + 1);
      }
      break;
    case 'daily':
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      break;
    case 'weekly':
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 7);
      }
      break;
    case 'monthly':
      if (nextRun <= now) {
        nextRun.setMonth(nextRun.getMonth() + 1);
      }
      break;
    default:
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
  }

  return nextRun;
}

/**
 * 计算失败重试间隔(指数退避)
 */
function calculateRetryDelay(consecutiveFailures) {
  const delays = [
    5 * 60 * 1000,   // 5 分钟
    15 * 60 * 1000,  // 15 分钟
    30 * 60 * 1000,  // 30 分钟
    60 * 60 * 1000,  // 1 小时
  ];

  const index = Math.min(consecutiveFailures - 1, delays.length - 1);
  return delays[index] || delays[delays.length - 1];
}

/**
 * 执行完整的更新流程:SQL查询 → LLM更新HTML
 */
async function executeUpdate(artifact) {
  const artifactId = artifact.galleryArtifactId;

  // Step 1: 获取 SQL 查询
  const sqlRecord = await GallerySqlQuery.findOne({ galleryArtifactId: artifactId });
  if (!sqlRecord || sqlRecord.queries.length === 0) {
    throw new Error('No SQL queries found for artifact');
  }

  // Step 2: 获取当前版本 HTML
  const currentVersion = await GalleryVersion.findOne({
    galleryArtifactId: artifactId,
    version: artifact.currentVersion || 1,
  });
  if (!currentVersion) {
    throw new Error('Current version not found');
  }

  // Step 3: 执行 SQL 查询(通过 DMP MCP API)
  if (!DMP_MCP_URL || !DMP_API_KEY) {
    throw new Error('DMP API not configured');
  }

  const agentIdForDMP = artifact.agentId;
  if (!agentIdForDMP) {
    throw new Error('Artifact missing agent ID');
  }

  const datasetId = sqlRecord.queries.find(q => q.datasetId)?.datasetId;

  logger.info(`[GalleryScheduler] Executing ${sqlRecord.queries.length} SQL queries for ${artifactId}`);

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
        queryResults.push({ description: query.description, sql: query.sql, result: resultText });
      } else {
        queryResults.push({ description: query.description, error: data?.error?.message || 'No result' });
      }
    } catch (e) {
      queryResults.push({ description: query.description, error: e.message });
    }
  }

  const successCount = queryResults.filter(r => r.result).length;
  logger.info(`[GalleryScheduler] ${successCount}/${queryResults.length} queries succeeded`);

  if (successCount === 0) {
    throw new Error('All SQL queries failed');
  }

  // Step 4: 调用 LLM 更新 HTML
  const llmConfig = await resolveLlmConfig(agentIdForDMP);

  const currentHtml = currentVersion.html;
  const resultsSummary = queryResults
    .filter(r => r.result)
    .map(r => `【${r.description}】\nSQL: ${r.sql}\n结果:\n${r.result}`)
    .join('\n\n');

  logger.info(`[GalleryScheduler] Calling LLM ${llmConfig.model} at ${llmConfig.baseURL} to update HTML`);

  const llmResponse = await fetch(`${llmConfig.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model,
      messages: [
        {
          role: 'system',
          content: `你是一个报告更新助手。你会收到一份HTML报告模板和最新的数据查询结果（每组包含SQL语句和执行结果）。\n你的任务是基于新数据，重新生成一份完整的HTML报告。\n\n规则：\n0. 先理解报告结构 - 阅读HTML模板，理解报告中包含哪些数据展示（图表、表格、指标等）\n1. 样式和布局保持不变 — HTML结构、CSS样式、图表类型、页面布局完全复用原报告\n2. 数据全部更新 — 用查询结果中的最新数据替换所有旧数据，只使用报告需要的数据\n3. 解读重新生成 — 基于新数据重新撰写所有分析解读、趋势描述、关键发现等文字内容\n4. 元数据更新 — 更新报告中的日期、时间、统计截止日期等元信息\n5. 当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}，所有涉及"更新时间""报告日期"等字段请使用此时间\n6. 【最重要】只输出HTML代码本身，不要输出任何解释、说明、开场白、总结。不要用markdown代码围栏包裹。直接以 <!DOCTYPE html> 开头，以 </html> 结尾`,
        },
        {
          role: 'user',
          content: `以下是原HTML报告模板：\n\n${currentHtml}\n\n以下是最新的数据查询结果：\n\n${resultsSummary}\n\n请基于新数据重新生成报告，保持相同的样式和布局，更新报告需要用的所有数据、解读和元信息。`,
        },
      ],
      temperature: 0.1,
      max_tokens: 16000,
    }),
  });

  const llmData = await llmResponse.json();
  let newHtml = llmData?.choices?.[0]?.message?.content;

  if (!newHtml) {
    throw new Error('LLM returned empty response');
  }

  // 清理 LLM 可能输出的多余内容：markdown 代码围栏、解释文字等
  // 1. 去除 markdown 代码围栏
  newHtml = newHtml.replace(/```html?\n?/g, '').replace(/\n?```/g, '');
  // 2. 提取 <!DOCTYPE html> 到 </html> 之间的内容，丢弃前后多余文字
  const htmlStart = newHtml.indexOf('<!DOCTYPE html>');
  const htmlEnd = newHtml.lastIndexOf('</html>');
  if (htmlStart !== -1 && htmlEnd !== -1 && htmlEnd > htmlStart) {
    newHtml = newHtml.substring(htmlStart, htmlEnd + '</html>'.length);
  }

  // Step 5: 原子递增版本号并保存新版本
  const updatedArtifact = await GalleryArtifact.findOneAndUpdate(
    { galleryArtifactId: artifactId },
    { $inc: { currentVersion: 1 } },
    { new: true }
  );
  const newVersion = updatedArtifact.currentVersion;

  await GalleryVersion.create({
    galleryArtifactId: artifactId,
    version: newVersion,
    html: newHtml,
    createdBy: 'scheduler',
    status: 'success',
    ...getGalleryVersionProvenance(artifact),
  });

  logger.info(`[GalleryScheduler] Created V${newVersion} for ${artifactId}`);

  return { newVersion, newHtml };
}

/**
 * 执行单个任务
 */
async function executeTask(schedule) {
  const startTime = Date.now();
  let runLog = null;

  try {
    logger.info('[GalleryScheduler] Executing task', {
      scheduleId: schedule._id,
      galleryArtifactId: schedule.galleryArtifactId,
      frequency: schedule.frequency,
      consecutiveFailures: schedule.consecutiveFailures || 0,
    });

    // 1. 更新状态为 running
    await GallerySchedule.findByIdAndUpdate(schedule._id, {
      runStatus: 'running',
    });

    // 2. 获取 GalleryArtifact
    const artifact = await GalleryArtifact.findOne({
      galleryArtifactId: schedule.galleryArtifactId,
    });

    if (!artifact) {
      throw new Error(`Artifact not found: ${schedule.galleryArtifactId}`);
    }

    // 3. 创建执行日志
    runLog = await GalleryRunLog.create({
      scheduleId: schedule._id,
      galleryArtifactId: schedule.galleryArtifactId,
      userId: schedule.userId,
      triggeredBy: 'auto',
      startedAt: new Date(),
      status: 'running',
      previousContent: artifact.content,
    });

    // 4. 执行更新流程:SQL查询 → LLM更新HTML
    const result = await executeUpdate(artifact);

    // 5. Artifact currentVersion 已在 executeUpdate 中更新
    // 同时更新 content 为最新版本的 HTML
    if (result.newHtml) {
      await GalleryArtifact.findByIdAndUpdate(artifact._id, {
        content: result.newHtml,
      });
    }

    // 6. 更新执行日志为成功
    await GalleryRunLog.findByIdAndUpdate(runLog._id, {
      status: 'success',
      completedAt: new Date(),
      newContent: result.newHtml,
    });

    // 7. 更新 Schedule 状态
    const nextRunAt = calculateNextRunAt(schedule.frequency, schedule.updateTime);
    await GallerySchedule.findByIdAndUpdate(schedule._id, {
      runStatus: 'success',
      lastRunAt: new Date(),
      nextRunAt: nextRunAt,
      lastError: null,
      consecutiveFailures: 0,
      disabledReason: null,
    });

    const duration = Date.now() - startTime;
    logger.info('[GalleryScheduler] Task completed', {
      scheduleId: schedule._id,
      galleryArtifactId: schedule.galleryArtifactId,
      duration: `${duration}ms`,
      nextRunAt: nextRunAt.toISOString(),
    });

    return { success: true, duration };

  } catch (error) {
    logger.error('[GalleryScheduler] Task failed:', error);

    // 更新执行日志为失败
    if (runLog) {
      await GalleryRunLog.findByIdAndUpdate(runLog._id, {
        status: 'failed',
        completedAt: new Date(),
        error: error.message,
      });
    }

    // 创建失败版本记录
    try {
      const updatedArtifact = await GalleryArtifact.findOneAndUpdate(
        { galleryArtifactId: schedule.galleryArtifactId },
        { $inc: { currentVersion: 1 } },
        { new: true }
      );
      if (updatedArtifact) {
        const newVersion = updatedArtifact.currentVersion;
        const currentHtml = updatedArtifact.content || '';
        await GalleryVersion.create({
          galleryArtifactId: schedule.galleryArtifactId,
          version: newVersion,
          html: currentHtml,
          createdBy: 'scheduler',
          status: 'failed',
          errorMessage: error.message,
          ...getGalleryVersionProvenance(updatedArtifact),
        });
        logger.info('[GalleryScheduler] Created failed version record', {
          galleryArtifactId: schedule.galleryArtifactId,
          version: newVersion,
          error: error.message,
        });
      }
    } catch (versionErr) {
      logger.error('[GalleryScheduler] Failed to create error version record:', versionErr);
    }

    // 计算新的失败次数
    const newFailureCount = (schedule.consecutiveFailures || 0) + 1;

    // 检查是否需要禁用任务
    if (newFailureCount >= MAX_CONSECUTIVE_FAILURES) {
      logger.warn('[GalleryScheduler] Task disabled due to consecutive failures', {
        scheduleId: schedule._id,
        galleryArtifactId: schedule.galleryArtifactId,
        consecutiveFailures: newFailureCount,
      });

      await GallerySchedule.findByIdAndUpdate(schedule._id, {
        enabled: false,
        runStatus: 'failed',
        lastError: error.message,
        consecutiveFailures: newFailureCount,
        disabledReason: `连续失败 ${newFailureCount} 次,任务已自动禁用`,
      });

      return { success: false, error: error.message, disabled: true };
    }

    // 计算重试延迟
    const retryDelay = calculateRetryDelay(newFailureCount);
    const retryAt = new Date(Date.now() + retryDelay);

    // 更新 Schedule 状态
    await GallerySchedule.findByIdAndUpdate(schedule._id, {
      runStatus: 'failed',
      lastError: error.message,
      consecutiveFailures: newFailureCount,
      nextRunAt: retryAt,
    });

    logger.info('[GalleryScheduler] Task scheduled for retry', {
      scheduleId: schedule._id,
      consecutiveFailures: newFailureCount,
      retryAt: retryAt.toISOString(),
    });

    return { success: false, error: error.message, retryAt };
  }
}

function buildSkillTaskMessage(task) {
  const params = task.parameters || {};
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  if (entries.length === 0) {
    return `/skill:${task.skillName}`;
  }

  const parameterText = entries.map(([key, value]) => `- ${key}: ${value}`).join('\n');
  return `/skill:${task.skillName}\n\n本次任务参数：\n${parameterText}`;
}

async function collectPiFiles(agentId, sessionId, userId) {
  const files = [];
  const dirs = [''];
  const visited = new Set();
  try {
    while (dirs.length > 0) {
      const currentPath = dirs.shift();
      const key = currentPath || '/';
      if (visited.has(key)) continue;
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
    logger.warn('[GalleryScheduler] Failed to collect PI files', { error: error.message });
    return [];
  }
}

async function executePiSkillTask(task, runId) {
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
    if (done) break;
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
}

/**
 * 执行 SKILL 自动任务：创建 PI hidden session 并记录运行结果。
 */
async function executeSkillTask(task) {
  logger.info('[GalleryScheduler] Executing SKILL task', {
    taskId: task.taskId,
    skillName: task.skillName,
  });

  const result = await executeGallerySkillTask({
    task,
    triggeredBy: 'auto',
    calculateNextRunAt,
    calculateRetryDelay,
    advanceSchedule: true,
  });

  if (result.run.status === 'success') {
    logger.info('[GalleryScheduler] SKILL task completed', {
      taskId: task.taskId,
      runId: result.run.runId,
      sessionId: result.run.sessionId,
      nextRunAt: result.task.nextRunAt?.toISOString?.(),
    });
    return;
  }

  logger.error('[GalleryScheduler] SKILL task failed', {
    taskId: task.taskId,
    runId: result.run.runId,
    failureCount: result.task.failureCount,
    paused: result.task.status === 'failed_paused',
    error: result.run.error?.message,
  });
}

/**
 * 扫描并执行待处理的任务
 */
async function scanAndExecute() {
  try {
    const now = new Date();

    const pendingSchedules = await GallerySchedule.find({
      enabled: true,
      nextRunAt: { $lte: now },
      runStatus: { $ne: 'running' },
    }).limit(10);

    if (pendingSchedules.length > 0) {
      logger.info('[GalleryScheduler] Found pending tasks', {
        count: pendingSchedules.length,
      });

      for (const schedule of pendingSchedules) {
        await executeTask(schedule);
      }
    } else {
      logger.debug('[GalleryScheduler] No pending HTML tasks');
    }

    const pendingSkillTasks = await GallerySkillTask.find({
      enabled: true,
      nextRunAt: { $lte: now },
      status: { $ne: 'running' },
    }).limit(10);

    if (pendingSkillTasks.length > 0) {
      logger.info('[GalleryScheduler] Found pending SKILL tasks', {
        count: pendingSkillTasks.length,
      });

      for (const task of pendingSkillTasks) {
        await executeSkillTask(task);
      }
    } else {
      logger.debug('[GalleryScheduler] No pending SKILL tasks');
    }

  } catch (error) {
    logger.error('[GalleryScheduler] Scan error:', error);
  }
}

/**
 * 主循环
 */
function startScheduler() {
  logger.info('[GalleryScheduler] Starting scheduler...');
  logger.info('[GalleryScheduler] Scan interval:', SCAN_INTERVAL_MS / 1000, 'seconds');
  logger.info('[GalleryScheduler] Max consecutive failures:', MAX_CONSECUTIVE_FAILURES);

  scanAndExecute();
  setInterval(scanAndExecute, SCAN_INTERVAL_MS);

  process.on('SIGINT', async () => {
    logger.info('[GalleryScheduler] Shutting down...');
    await mongoose.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('[GalleryScheduler] Shutting down...');
    await mongoose.disconnect();
    process.exit(0);
  });
}

connectDB().then(() => {
  startScheduler();
}).catch((error) => {
  logger.error('[GalleryScheduler] Failed to start:', error);
  process.exit(1);
});
