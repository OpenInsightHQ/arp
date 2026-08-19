const { logger } = require('@librechat/data-schemas');
const { createAxiosInstance, getPiSystemPrompt } = require('@librechat/api');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

const PI_API_KEY = process.env.PI_API_KEY;
const PI_HOST = process.env.PI_HOST;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27018/LibreChat';

let mongoClient = null;

const getMongoClient = async () => {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
  }
  return mongoClient;
};

const isPIConfigured = (req) => {
  if (!(PI_API_KEY && PI_HOST)) {
    return false;
  }
  if (req != null) {
    return req.config?.interfaceConfig?.pi === true;
  }
  return true;
};

const sendToPI = async (promptData, userId) => {
  if (!isPIConfigured()) {
    logger.warn('[PIService] PI is not configured. Set PI_API_KEY and PI_HOST in environment.');
    return { success: false, error: 'PI not configured' };
  }

  const axios = createAxiosInstance();

  const finalData = {
    message: promptData.message,
    agentId: promptData.agentId || 'default',
    sessionId: promptData.sessionId,
    cwd: promptData.cwd,
    stream: promptData.stream ?? false,
  };

  const headers = {
    'api-key': PI_API_KEY,
    'Content-Type': 'application/json',
  };
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  try {
    const response = await axios.post(`${PI_HOST}/prompt`, finalData, {
      headers,
      timeout: 300000,
    });

    logger.debug('[PIService] Successfully sent request to PI');

    const result = {
      success: true,
      data: {
        message: response.data.message || '',
        sessionId: response.data.sessionId,
        agentId: response.data.agentId,
        generatedFiles: response.data.generatedFiles || [],
      },
    };

    return result;
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    logger.error(`[PIService] Failed to send request to PI: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

const sendToPIStream = async (promptData, onChunk, onThinking, onToolEvent, userId) => {
  if (!isPIConfigured()) {
    logger.warn('[PIService] PI is not configured. Set PI_API_KEY and PI_HOST in environment.');
    return { success: false, error: 'PI not configured' };
  }

  const axios = createAxiosInstance();

  const headers = {
    'api-key': PI_API_KEY,
    'Content-Type': 'application/json',
  };
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  logger.info(
    `[PIService] sendToPIStream: ${PI_HOST}/prompt, userId=${userId}, headers=${JSON.stringify(headers)}`,
  );

  try {
    const response = await axios.post(
      `${PI_HOST}/prompt`,
      {
        ...promptData,
        stream: true,
      },
      {
        headers,
        responseType: 'stream',
        timeout: 300000,
      },
    );

    return new Promise((resolve, reject) => {
      let fullMessage = '';
      let sessionId = promptData.sessionId;
      let agentId = promptData.agentId;
      let generatedFiles = [];
      let hasError = false;
      let errorMessage = '';

      const parseSSE = (line) => {
        if (!line.startsWith('data: ')) {
          return null;
        }
        try {
          return JSON.parse(line.slice(6));
        } catch {
          return null;
        }
      };

      const parseEvent = (line) => {
        if (!line.startsWith('event: ')) {
          return null;
        }
        return line.slice(7).trim();
      };

      let currentEvent = null;
      let buffer = '';

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          if (line.startsWith('event: ')) {
            currentEvent = parseEvent(line);
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = parseSSE(line);
            if (!data) {
              continue;
            }

            if (currentEvent === 'error') {
              logger.error(`[PIService] PI error: ${data.message}`);
              hasError = true;
              errorMessage = data.message;
              if (onChunk) {
                onChunk(`[Error] ${data.message}`, data);
              }
              continue;
            }

            if (data.message || data.content) {
              const content = data.message || data.content || '';
              fullMessage += content;
              if (onChunk) {
                onChunk(content, data);
              }
            }

            if (data.sessionId && !sessionId) {
              sessionId = data.sessionId;
            }

            if (data.generatedFiles) {
              generatedFiles = data.generatedFiles;
            }
          }
        }
      });

      response.data.on('end', () => {
        if (hasError) {
          resolve({
            success: false,
            error: errorMessage || 'PI returned an error',
          });
          return;
        }
        resolve({
          success: true,
          data: {
            message: fullMessage,
            sessionId,
            agentId,
            generatedFiles,
          },
        });
      });

      response.data.on('error', (err) => {
        logger.error(`[PIService] Stream error: ${err.message}`);
        reject({ success: false, error: err.message });
      });
    });
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    logger.error(`[PIService] sendToPIStream failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

const executeCode = async ({ lang, code, sessionId, cwd, agentId }, userId) => {
  if (!isPIConfigured()) {
    return { success: false, error: 'PI not configured' };
  }

  const axios = createAxiosInstance();
  const message = `Execute the following ${lang} code and return the results:\n\n\`\`\`${lang}\n${code}\n\`\`\``;

  const headers = {
    'api-key': PI_API_KEY,
    'Content-Type': 'application/json',
  };
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  try {
    const response = await axios.post(
      `${PI_HOST}/prompt`,
      {
        message,
        agentId: agentId || 'default',
        sessionId,
        cwd,
        stream: false,
      },
      {
        headers,
        timeout: 300000,
      },
    );

    return {
      success: true,
      data: {
        message: response.data.message || '',
        sessionId: response.data.sessionId,
        generatedFiles: response.data.generatedFiles || [],
      },
    };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    logger.error(`[PIService] executeCode failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

const executeCodeStream = async (
  { lang, code, sessionId, cwd, agentId },
  onChunk,
  onThinking,
  onToolEvent,
  userId,
) => {
  if (!isPIConfigured()) {
    return { success: false, error: 'PI not configured' };
  }

  const message = `Execute the following ${lang} code and return the results:\n\n\`\`\`${lang}\n${code}\n\`\`\``;

  return sendToPIStream(
    {
      message,
      agentId: agentId || 'default',
      sessionId,
      cwd,
    },
    onChunk,
    onThinking,
    onToolEvent,
    userId,
  );
};

const generateDocument = async ({ request, sessionId, cwd, agentId }, userId) => {
  if (!isPIConfigured()) {
    return { success: false, error: 'PI not configured' };
  }

  const axios = createAxiosInstance();

  const headers = {
    'api-key': PI_API_KEY,
    'Content-Type': 'application/json',
  };
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  try {
    const response = await axios.post(
      `${PI_HOST}/prompt`,
      {
        message: request,
        agentId: agentId || 'default',
        sessionId,
        cwd,
        stream: false,
      },
      {
        headers,
        timeout: 300000,
      },
    );

    return {
      success: true,
      data: {
        message: response.data.message || '',
        sessionId: response.data.sessionId,
        generatedFiles: response.data.generatedFiles || [],
      },
    };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    logger.error(`[PIService] generateDocument failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

const generateDocumentStream = async (
  { request, sessionId, cwd, agentId },
  onChunk,
  onThinking,
  onToolEvent,
  userId,
) => {
  if (!isPIConfigured()) {
    return { success: false, error: 'PI not configured' };
  }

  return sendToPIStream(
    {
      message: request,
      agentId: agentId || 'default',
      sessionId,
      cwd,
    },
    onChunk,
    onThinking,
    onToolEvent,
    userId,
  );
};

const uploadFile = async (
  { filePath, sessionId, agentId, path: uploadPath, originalFilename },
  userId,
) => {
  if (!isPIConfigured()) {
    return { success: false, error: 'PI not configured' };
  }

  if (!sessionId) {
    return { success: false, error: 'sessionId is required for PI upload' };
  }

  if (!agentId) {
    return { success: false, error: 'agentId is required for PI upload' };
  }

  const axios = createAxiosInstance();
  const FormData = require('form-data');
  const fs = require('fs');

  const headers = {
    'api-key': PI_API_KEY,
  };
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('sessionId', sessionId);
    form.append('agentId', agentId);
    if (uploadPath) {
      form.append('path', uploadPath);
    }
    if (originalFilename) {
      form.append('originalFilename', originalFilename);
    }

    const uploadUrl = `${PI_HOST}/upload`;
    logger.info(`[PIService] uploadFile: POST ${uploadUrl}`);
    logger.info(
      `[PIService] uploadFile params: sessionId=${sessionId}, agentId=${agentId}, path=${uploadPath || '(root)'}, originalFilename=${originalFilename || '(none)'}`,
    );

    const response = await axios.post(uploadUrl, form, {
      headers: {
        ...headers,
        ...form.getHeaders(),
      },
      timeout: 60000,
    });

    logger.info(`[PIService] uploadFile success: ${JSON.stringify(response.data)}`);
    return { success: true, data: response.data };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    const errorDetails = error.response?.data;
    const errorStatus = error.response?.status;
    logger.error(
      `[PIService] uploadFile failed: status=${errorStatus}, message=${errorMessage}`,
      errorDetails,
    );
    return { success: false, error: errorMessage };
  }
};

const getPIFiles = async ({ sessionId }, userId) => {
  if (!isPIConfigured()) {
    return { success: false, error: 'PI not configured' };
  }

  const axios = createAxiosInstance();

  const headers = {
    'api-key': PI_API_KEY,
  };
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  try {
    const response = await axios.get(`${PI_HOST}/files/${sessionId}`, {
      headers,
      timeout: 30000,
    });

    return { success: true, data: response.data };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    logger.error(`[PIService] getPIFiles failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

const downloadPIFile = async ({ sessionId, filename, agentId }, userId) => {
  if (!isPIConfigured()) {
    return { success: false, error: 'PI not configured' };
  }

  const axios = createAxiosInstance();
  const effectiveAgentId = agentId || 'default';

  const headers = {
    'api-key': PI_API_KEY,
  };
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  try {
    const response = await axios.get(`${PI_HOST}/files/download`, {
      params: {
        agentId: effectiveAgentId,
        sessionId,
        filename,
      },
      headers,
      responseType: 'arraybuffer',
      timeout: 60000,
    });

    return {
      success: true,
      data: {
        buffer: response.data,
        mimeType: response.headers['content-type'],
        size: response.data.length,
      },
    };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    logger.error(`[PIService] downloadPIFile failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

const deletePIFile = async ({ sessionId, filename, agentId }, userId) => {
  if (!isPIConfigured()) {
    return { success: false, error: 'PI not configured' };
  }

  const axios = createAxiosInstance();
  const effectiveAgentId = agentId || 'default';

  const headers = {
    'Content-Type': 'application/json',
    'api-key': PI_API_KEY,
  };
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  try {
    await axios.delete(`${PI_HOST}/files`, {
      headers,
      data: {
        sessionId,
        agentId: effectiveAgentId,
        originalFilename: filename,
      },
      timeout: 30000,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    return { success: false, error: errorMessage };
  }
};

const isArtifactRequest = (text, files) => {
  const artifactKeywords = [
    'generate document',
    'create document',
    'write code',
    'generate code',
    'create artifact',
    '生成文档',
    '写代码',
    '生成代码',
    '生成artifacts',
    'artifacts',
    'react component',
    'vue component',
    'html page',
    'svg',
  ];

  const textLower = (text || '').toLowerCase();

  for (const keyword of artifactKeywords) {
    if (textLower.includes(keyword.toLowerCase())) {
      return true;
    }
  }

  if (files && files.length > 0) {
    const codeExtensions = [
      '.js',
      '.ts',
      '.py',
      '.java',
      '.go',
      '.rs',
      '.cpp',
      '.c',
      '.rb',
      '.jsx',
      '.tsx',
      '.vue',
      '.html',
    ];
    for (const file of files) {
      const filename = file.filename || file.name || '';
      if (codeExtensions.some((ext) => filename.endsWith(ext))) {
        return true;
      }
    }
  }

  return false;
};

const readMemoryDetail = async ({ memoryId, userId }) => {
  try {
    const client = await getMongoClient();
    const db = client.db();

    // Query memory entry by _id and userId
    const memoryEntry = await db.collection('memoryentries').findOne({
      _id: new mongoose.Types.ObjectId(memoryId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!memoryEntry) {
      return { success: false, error: 'Memory entry not found' };
    }

    const result = {
      success: true,
      data: {
        key: memoryEntry.key,
        value: memoryEntry.value,
        type: memoryEntry.type,
        updated_at: memoryEntry.updated_at,
      },
    };

    // If source.messageIds exists, fetch the original messages
    if (
      memoryEntry.source &&
      memoryEntry.source.messageIds &&
      memoryEntry.source.messageIds.length > 0
    ) {
      const messageIds = memoryEntry.source.messageIds;
      const messages = await db
        .collection('messages')
        .find({ messageId: { $in: messageIds } })
        .sort({ createdAt: 1 })
        .toArray();

      result.data.messages = messages.map((msg) => ({
        messageId: msg.messageId,
        sender: msg.sender,
        text: msg.text,
        createdAt: msg.createdAt,
      }));
    }

    return result;
  } catch (error) {
    logger.error(`[PIService] readMemoryDetail failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

const buildSkillMessage = (skillName, input) => {
  const trimmedInput = typeof input === 'string' ? input.trim() : '';
  if (!trimmedInput) {
    return `/skill:${skillName}`;
  }
  return `/skill:${skillName}\n\n${trimmedInput}`;
};

/**
 * Canonical pi file download link shared by every consumer
 * (collectPiGeneratedFiles, one-pi buildFileLinks, execute_skill tool
 * results, GallerySkillTaskRun.files) so all surfaces emit identical URLs.
 */
const buildPiFileDownloadUrl = (agentId, sessionId, path) =>
  `/arp/api/pi/files/download?agentId=${encodeURIComponent(String(agentId))}&sessionId=${encodeURIComponent(String(sessionId))}&path=${encodeURIComponent(String(path))}`;

/**
 * List files generated in a pi session (recursive, optionally filtered by
 * mtime) as structured records with download URLs.
 *
 * Single shared implementation for all pi file-collection consumers:
 * - execute_skill tool results (files attached to the agent message)
 * - GallerySkillTaskRun.files
 * - one-pi chat buildFileLinks
 */
const collectPiGeneratedFiles = async (agentId, sessionId, userId, modifiedSince) => {
  if (!agentId || !sessionId) {
    return [];
  }

  try {
    let url = `${PI_HOST}/files?agentId=${encodeURIComponent(String(agentId))}&sessionId=${encodeURIComponent(String(sessionId))}&recursive=true`;
    if (modifiedSince) {
      url += `&modifiedSince=${encodeURIComponent(new Date(modifiedSince).toISOString())}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'api-key': PI_API_KEY, 'X-User-Id': String(userId ?? 'system') },
    });

    if (!response.ok) {
      logger.warn('[PIService] collectPiGeneratedFiles: PI files API returned', {
        status: response.status,
      });
      return [];
    }

    const data = await response.json();
    return (data.files || [])
      .filter((f) => !f.isDirectory)
      .map((f) => {
        const filePath = f.path || f.name;
        return {
          name: (filePath || '').split('/').pop(),
          path: filePath,
          url: buildPiFileDownloadUrl(agentId, sessionId, filePath),
          mimeType: f.mimeType || null,
          size: f.size || null,
        };
      });
  } catch (error) {
    logger.warn('[PIService] collectPiGeneratedFiles failed:', { error: error.message });
    return [];
  }
};

/** Backwards-compatible alias for existing executeSkill call sites. */
const collectSkillFiles = collectPiGeneratedFiles;

/** Max files kept after dedupe/truncation (shared across consumers). */
const MAX_PI_RESULT_FILES = 10;

/**
 * Shared post-processing for pi file lists:
 * - optional text filter: keep only files whose basename or path is mentioned
 *   in `text` (pass null/undefined to keep all)
 * - dedupe by basename
 * - truncate to MAX_PI_RESULT_FILES
 *
 * Used by one-pi buildFileLinks and GallerySkillTaskRun.files so both
 * surfaces apply identical filtering rules.
 */
const filterPiResultFiles = (files, text = null) => {
  if (!files || files.length === 0) {
    return [];
  }

  const pool =
    text != null
      ? files.filter((f) => {
          const basename = (f.path || f.name || '').split('/').pop();
          return text.includes(basename) || (f.path && text.includes(f.path));
        })
      : files;

  const seen = new Set();
  const uniqueFiles = [];
  for (const f of pool) {
    const base = (f.path || f.name || '').split('/').pop();
    if (!seen.has(base)) {
      seen.add(base);
      uniqueFiles.push(f);
    }
  }

  return uniqueFiles.slice(0, MAX_PI_RESULT_FILES);
};

/**
 * Executes a skill on the PI backend via `/prompt` with a `/skill:${skillName}`
 * message (same trigger format as GallerySkillTaskExecutor), using the current
 * agentId/sessionId/userId. Streams progress via callbacks and returns the
 * collected output plus files generated during the run.
 */
const executeSkill = async (
  { skillName, input, agentId, sessionId, parentMessageId, agentSystemPrompt },
  onChunk,
  onThinking,
  onToolEvent,
  userId,
) => {
  if (!isPIConfigured()) {
    return { success: false, error: 'PI not configured' };
  }
  if (!skillName) {
    return { success: false, error: 'skillName is required' };
  }

  const finalAgentId = agentId || 'default';
  const message = buildSkillMessage(skillName, input);
  const startedAt = new Date();

  // Skills commonly run for minutes. Stream live output up to a deadline,
  // then stop reading and let pi finish in the background (pi's /prompt has
  // no disconnect abort): its messages still persist at parentMessageId and
  // the skill task (created by pi for /skill: turns) keeps updating the task
  // panel. 0 disables the deadline (wait forever).
  const deadlineMs = Number(process.env.PI_SKILL_TIMEOUT_MS ?? 60_000);
  let timedOut = false;

  try {
    // /execute-agent-skill: the outer agent's system prompt is APPENDED to
    // pi's base prompt (pi keeps its tool catalog and the DMP suffix). Without
    // one (e.g. no job metadata), fall back to pi.system.
    const useAgentPrompt =
      typeof agentSystemPrompt === 'string' && agentSystemPrompt.trim().length > 0;
    const response = await fetch(`${PI_HOST}/execute-agent-skill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': PI_API_KEY,
        'X-User-Id': String(userId),
      },
      body: JSON.stringify({
        skillName,
        input: input || '',
        agentId: finalAgentId,
        sessionId,
        stream: true,
        parentMessageId,
        ...(useAgentPrompt
          ? { agentSystemPrompt }
          : { fallbackSystemPrompt: await getPiSystemPrompt() }),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('[PIService] executeSkill failed:', errText);
      return { success: false, error: errText };
    }

    let output = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = null;

    while (true) {
      const readPromise = reader.read();
      const result = await (deadlineMs > 0
        ? Promise.race([
            readPromise,
            new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), deadlineMs)),
          ]).then((r) => r)
        : readPromise);

      if (result.__timeout) {
        timedOut = true;
        break;
      }
      if (result.done) {
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) {
          continue;
        }

        let data;
        try {
          data = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (currentEvent === 'error') {
          logger.error('[PIService] executeSkill PI error:', data.message);
          return { success: false, error: data.message || 'PI returned an error' };
        }

        if (currentEvent === 'thinking') {
          if (data.type === 'thinking_delta' && data.delta && onThinking) {
            onThinking({ delta: data.delta });
          }
          continue;
        }

        if (currentEvent === 'tool_start' && onToolEvent) {
          onToolEvent({ type: 'tool_start', toolName: data.toolName, args: data.args });
          continue;
        }

        if (currentEvent === 'tool_end' && onToolEvent) {
          onToolEvent({ type: 'tool_end', toolName: data.toolName });
          continue;
        }

        if (data.type === 'text_delta' && data.delta) {
          output += data.delta;
          if (onChunk) {
            onChunk(data.delta);
          }
        }
      }
    }

    if (timedOut) {
      // Abandon the stream; pi keeps executing server-side. Collect files
      // produced so far so the turn's tool output can still reference them;
      // files generated after this point appear in the conversation (pi
      // persists its messages) and via the pi files API on later turns.
      try {
        await reader.cancel();
      } catch {
        /* socket already gone */
      }
      logger.info(
        `[PIService] executeSkill deadline (${deadlineMs}ms) reached for ${skillName}; continuing in background`,
      );
      const filesSoFar = await collectSkillFiles(finalAgentId, sessionId, userId, startedAt);
      return {
        success: true,
        background: true,
        data: {
          skillName,
          message,
          output,
          files: filesSoFar,
          note:
            `Skill "${skillName}" is still running in the background (over ${Math.round(deadlineMs / 1000)}s). ` +
            'Its output and generated files will appear in the conversation and the task panel when it finishes. ' +
            'Tell the user it is in progress and finish your turn without waiting.',
        },
      };
    }

    const files = await collectSkillFiles(finalAgentId, sessionId, userId, startedAt);

    return {
      success: true,
      data: {
        skillName,
        message,
        output,
        files,
      },
    };
  } catch (error) {
    logger.error('[PIService] executeSkill error:', error.message);
    return { success: false, error: error.message };
  }
};

const getToolDefinitions = () => {
  return [
    {
      type: 'function',
      function: {
        name: 'read_memory_detail',
        description:
          '读取长期记忆的详细信息。当需要了解记忆摘要背后的完整上下文时，使用记忆ID调用此工具获取原始对话内容。',
        parameters: {
          type: 'object',
          properties: {
            memoryId: {
              type: 'string',
              description: '记忆ID，在注入的记忆格式中「记忆ID:」后面的值',
            },
          },
          required: ['memoryId'],
        },
      },
    },
    {
      name: 'office_skills',
      description: `Create or modify files of any type.

Use this tool for ANY file operations - simply pass the user's original request directly:
- Create new files
- Modify existing files
- Add content to files
- Update specific sections, lines, or chapters
- Delete content from files
- Generate artifacts, React/Vue components, HTML pages, SVG graphics, UI components

DO NOT interpret or restructure the user's request. Pass the user's original message directly as the 'request' parameter.

Supported file types: docx, xlsx, pptx, pdf, txt, md, json, yaml, js, ts, py, html, css, svg, and any other file type.`,
      parameters: {
        type: 'object',
        properties: {
          request: {
            type: 'string',
            description:
              'The user request - can describe what file to create/modify, requirements for artifacts, components, UI, etc. Pass it exactly as stated without modification.',
          },
        },
        required: ['request'],
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute_skill',
        description:
          "Execute a registered skill by name. Only use skills listed in the <available_skills> section. Pass the user request in the input parameter exactly as stated. If the skill output asks for confirmation, options, or any user decision, relay the full options in your visible reply and stop to wait for the user's answer — never confirm or choose on the user's behalf, and never re-invoke the skill before the user has explicitly responded.",
        parameters: {
          type: 'object',
          properties: {
            skillName: {
              type: 'string',
              description: 'The skill name exactly as listed in <available_skills>.',
            },
            input: {
              type: 'string',
              description: "The user's request related to this skill, passed as stated.",
            },
          },
          required: ['skillName', 'input'],
        },
      },
    },
  ];
};

const handlePIToolCall = async (
  { name, arguments: args, sessionId, cwd, agentId, parentMessageId, agentSystemPrompt },
  onChunk,
  onThinking,
  onToolEvent,
  userId,
) => {
  const finalAgentId = agentId || 'default';

  // Handle read_memory_detail tool
  if (name === 'read_memory_detail') {
    if (!userId) {
      return { success: false, error: 'User ID is required to read memory detail' };
    }
    if (!args.memoryId) {
      return { success: false, error: 'memoryId is required' };
    }
    return readMemoryDetail({
      memoryId: args.memoryId,
      userId,
    });
  }

  if (name === 'execute_skill') {
    if (!args.skillName) {
      return { success: false, error: 'skillName is required' };
    }
    return executeSkill(
      {
        skillName: args.skillName,
        input: args.input || args.request || '',
        agentId: finalAgentId,
        sessionId,
        parentMessageId,
        agentSystemPrompt,
      },
      onChunk,
      onThinking,
      onToolEvent,
      userId,
    );
  }

  if (name !== 'office_skills') {
    return { success: false, error: `Unknown PI tool: ${name}` };
  }

  if (onChunk) {
    return generateDocumentStream(
      {
        request: args.request || args.requirements,
        sessionId,
        cwd,
        agentId: finalAgentId,
      },
      onChunk,
      onThinking,
      onToolEvent,
      userId,
    );
  }

  return generateDocument(
    {
      request: args.request || args.requirements,
      sessionId,
      cwd,
      agentId: finalAgentId,
    },
    userId,
  );
};

module.exports = {
  isPIConfigured,
  sendToPI,
  sendToPIStream,
  executeCode,
  executeCodeStream,
  executeSkill,
  generateDocument,
  generateDocumentStream,
  uploadFile,
  getPIFiles,
  downloadPIFile,
  deletePIFile,
  isArtifactRequest,
  getToolDefinitions,
  handlePIToolCall,
  collectPiGeneratedFiles,
  buildPiFileDownloadUrl,
  filterPiResultFiles,
  MAX_PI_RESULT_FILES,
  PI_HOST,
  PI_API_KEY,
};
