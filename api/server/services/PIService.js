const { logger } = require('@librechat/data-schemas');
const { createAxiosInstance, getPiSystemPrompt } = require('@librechat/api');
const { PermissionBits, ResourceType } = require('librechat-data-provider');
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

/**
 * Uploads a file to the PI workspace, either from a path on disk or from an
 * in-memory buffer (used by execute_code output syncing).
 * @param {Object} args
 * @param {string} [args.filePath] - Path on disk to upload (mutually exclusive with buffer).
 * @param {Buffer} [args.buffer] - In-memory buffer to upload (mutually exclusive with filePath).
 * @param {string} [args.filename] - Filename for the buffer variant.
 * @param {string} args.sessionId
 * @param {string} args.agentId
 * @param {string} [args.path] - Optional relative path in the workspace.
 * @param {string} [args.originalFilename]
 * @param {string} [userId]
 * @returns {Promise<{success: boolean; data?: object; error?: string}>}
 */
const uploadFile = async (
  { filePath, buffer, filename, sessionId, agentId, path: uploadPath, originalFilename },
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

  if (!filePath && buffer == null) {
    return { success: false, error: 'filePath or buffer is required for PI upload' };
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
    if (buffer != null) {
      const effectiveName = filename || originalFilename || 'file';
      form.append('file', buffer, {
        filename: effectiveName,
        contentType: 'application/octet-stream',
      });
    } else {
      form.append('file', fs.createReadStream(filePath));
    }
    form.append('sessionId', sessionId);
    form.append('agentId', agentId);
    if (uploadPath) {
      form.append('path', uploadPath);
    }
    const effectiveOriginalName = originalFilename || filename;
    if (effectiveOriginalName) {
      form.append('originalFilename', effectiveOriginalName);
    }

    const uploadUrl = `${PI_HOST}/upload`;
    logger.info(`[PIService] uploadFile: POST ${uploadUrl}`);
    logger.info(
      `[PIService] uploadFile params: sessionId=${sessionId}, agentId=${agentId}, path=${uploadPath || '(root)'}, source=${buffer != null ? 'buffer' : filePath}, originalFilename=${effectiveOriginalName || '(none)'}`,
    );

    const response = await axios.post(uploadUrl, form, {
      headers: {
        ...headers,
        ...form.getHeaders(),
      },
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
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

/**
 * Downloads a file from the pi workspace.
 * @param {Object} args
 * @param {string} args.sessionId
 * @param {string} [args.filename] - Filename (flat lookup).
 * @param {string} [args.path] - Workspace path (supports nested files); preferred over filename.
 * @param {string} [args.agentId]
 * @param {string} [userId]
 */
const downloadPIFile = async ({ sessionId, filename, agentId, path: filePath }, userId) => {
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
        ...(filename != null ? { filename } : {}),
        ...(filePath != null ? { path: filePath } : {}),
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

const buildSkillMessage = (skillName, input) => {
  const trimmedInput = typeof input === 'string' ? input.trim() : '';
  if (!trimmedInput) {
    return `/skill:${skillName}`;
  }
  return `/skill:${skillName}\n\n${trimmedInput}`;
};

/**
 * Rewrite execute_code sandbox paths (/mnt/data/<name>) found in skill input
 * to workspace-relative names. Skills run on the pi backend against the
 * workspace, where /mnt/data/ does not exist — LLMs sometimes copy the
 * execute_code toolContext paths into execute_skill input, which would make
 * the skill look for a nonexistent location. Normalization is deterministic
 * so every slip is corrected regardless of prompt compliance.
 */
const sanitizeSkillInput = (input) => {
  if (typeof input !== 'string') {
    return input;
  }
  return input.replace(/\/mnt\/data\/([^\s'"`),;]+)/gi, (_match, name) => name);
};

/**
 * Read a system prompt's content by key for the read_prompt tool call.
 * Access is granted when the user holds VIEW permission on the prompt
 * (resourceType `systemPrompt`) or when the key is configured on the
 * calling agent (mainPromptKey / knowledgePromptKeys — author-curated).
 */
const readPrompt = async ({ key, userId, agentId }) => {
  try {
    if (!key) {
      return { success: false, error: 'key is required' };
    }

    const client = await getMongoClient();
    const db = client.db();
    const promptDoc = await db.collection('systemprompts').findOne({ key });
    if (!promptDoc) {
      return { success: false, error: `Prompt not found: ${key}` };
    }

    let allowed = false;
    if (userId) {
      // Lazy require to avoid load-order cycles with ~/models ↔ PermissionService
      const { checkPermission } = require('./PermissionService');
      allowed = await checkPermission({
        userId,
        resourceType: ResourceType.SYSTEM_PROMPT,
        resourceId: promptDoc._id,
        requiredPermission: PermissionBits.VIEW,
      });
    }

    if (!allowed && agentId && agentId !== 'default') {
      const agentDoc = await db
        .collection('agents')
        .findOne({ id: agentId }, { projection: { mainPromptKey: 1, knowledgePromptKeys: 1 } });
      allowed =
        agentDoc?.mainPromptKey === key || (agentDoc?.knowledgePromptKeys || []).includes(key);
    }

    if (!allowed) {
      return { success: false, error: `No permission to read prompt: ${key}` };
    }

    return { success: true, data: { key, content: promptDoc.content } };
  } catch (error) {
    logger.error(`[PIService] readPrompt failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Entries never returned by listPiFiles: dependency installs (an in-skill
 * `npm install` creates thousands of files) and dot segments (.git clones,
 * .package-lock.json) are noise for every consumer — <attachments> prompt
 * inventories, execute_code syncing and result-file footers alike. Skill
 * work/temp dirs stay listed: the model must discover and read them in later
 * turns; footers drop them separately via filterPiResultFiles.
 */
const isExcludedListPath = (filePath) =>
  String(filePath || '')
    .split('/')
    .some((segment) => segment === 'node_modules' || (segment.length > 0 && segment.startsWith('.')));

/**
 * Canonical recursive pi workspace file listing shared by every consumer
 * (collectPiGeneratedFiles, <attachments> prompts, execute_code syncing,
 * the read_text_file tool). Returns normalized records with canonical
 * download URLs (buildPiFileDownloadUrl); dependency-install and dotfile
 * entries are excluded at this source (isExcludedListPath).
 *
 * @param {string} agentId
 * @param {string} sessionId
 * @param {string} [userId]
 * @param {string|Date} [modifiedSince] - optional mtime filter
 * @returns {Promise<Array<{name: string; path: string; url: string; mimeType: string|null; size: number|null; lastModified: string|null}>>}
 */
const PI_FILES_LIST_TIMEOUT_MS = 15_000;
/** Max wait for /execute-agent-skill response headers (stream body is governed by the idle deadline). */
const PI_HEADER_TIMEOUT_MS = 30_000;

const listPiFiles = async (agentId, sessionId, userId, modifiedSince) => {
  if (!agentId || !sessionId) {
    return [];
  }

  try {
    let url = `${PI_HOST}/files?agentId=${encodeURIComponent(String(agentId))}&sessionId=${encodeURIComponent(String(sessionId))}&recursive=true`;
    if (modifiedSince) {
      url += `&modifiedSince=${encodeURIComponent(new Date(modifiedSince).toISOString())}`;
    }

    // Hard timeout: this listing runs inside the response path (footer
    // building) — a hung pi must degrade to "no footer", never block the
    // final event.
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'api-key': PI_API_KEY, 'X-User-Id': String(userId ?? 'system') },
      signal: AbortSignal.timeout(PI_FILES_LIST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn('[PIService] listPiFiles: PI files API returned', { status: response.status });
      return [];
    }

    const data = await response.json();
    return (data.files || [])
      .filter((f) => !f.isDirectory && !isExcludedListPath(f.path || f.name))
      .map((f) => {
        const filePath = f.path || f.name;
        const mimeType = f.mimeType || null;
        return {
          name: (filePath || '').split('/').pop(),
          path: filePath,
          url: buildPiFileDownloadUrl(agentId, sessionId, filePath),
          mimeType,
          size: f.size || null,
          lastModified: f.lastModified || null,
          isText: isTextFile(filePath || '', mimeType),
        };
      });
  } catch (error) {
    logger.warn('[PIService] listPiFiles failed:', { error: error.message });
    return [];
  }
};

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.ini',
  '.cfg',
  '.conf',
  '.toml',
  '.env',
  '.log',
  '.svg',
  '.graphql',
  '.proto',
  '.vue',
  '.svelte',
]);

const TEXT_MIME_PREFIXES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
];

const isTextFile = (filename, mimeType) => {
  if (mimeType && TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
    return true;
  }
  const dot = filename.lastIndexOf('.');
  if (dot === -1) {
    return false;
  }
  return TEXT_EXTENSIONS.has(filename.slice(dot).toLowerCase());
};

const READ_TEXT_MAX_BYTES = 2 * 1024 * 1024;
const READ_TEXT_MAX_CHARS = 100_000;

/**
 * Normalize a path passed to the read_text_file tool to the pi workspace
 * namespace. LLMs frequently confuse the execute_code sandbox namespace
 * (/mnt/data/<name>) with workspace-relative paths, so both a leading
 * /mnt/data/ segment and any leading slashes are stripped.
 */
const normalizePiWorkspacePath = (filePath) =>
  String(filePath)
    .replace(/^\/mnt\/data\//i, '')
    .replace(/^\/+/, '');

/**
 * Read a text file from the pi workspace for the read_text_file tool.
 * Downloads the file bytes from pi over HTTP (downloadPIFile) into memory —
 * no local filesystem or temp dir involved. Only text files are readable,
 * binary types must go through execute_code or configured skills.
 */
const readPiTextFile = async ({ agentId, sessionId, path: filePath }, userId) => {
  if (!filePath) {
    return { success: false, error: 'path is required' };
  }

  const normalizedPath = normalizePiWorkspacePath(filePath);
  const download = await downloadPIFile({ agentId, sessionId, path: normalizedPath }, userId);
  if (!download.success) {
    return {
      success: false,
      error: `Failed to read "${filePath}": ${download.error}. Use the <path> values listed in the <attachments> section of the system prompt (workspace-relative paths, not /mnt/data/ paths).`,
    };
  }

  const { buffer, mimeType } = download.data;
  if (!isTextFile(normalizedPath, mimeType)) {
    return {
      success: false,
      error: `"${normalizedPath}" is not a text file. Only text files can be read with this tool; process other file types via execute_code or a configured skill.`,
    };
  }
  if (buffer.length > READ_TEXT_MAX_BYTES) {
    return {
      success: false,
      error: `"${normalizedPath}" is too large to read (${buffer.length} bytes, max ${READ_TEXT_MAX_BYTES}). Use execute_code to process it instead.`,
    };
  }

  let content = buffer.toString('utf-8');
  if (content.length > READ_TEXT_MAX_CHARS) {
    content =
      content.slice(0, READ_TEXT_MAX_CHARS) +
      `\n\n[... truncated at ${READ_TEXT_MAX_CHARS} characters]`;
  }
  return { success: true, data: { path: normalizedPath, content } };
};

/**
 * Canonical pi file download link shared by every consumer
 * (collectPiGeneratedFiles, one-pi buildFileLinks, execute_skill tool
 * results, GallerySkillTaskRun.files) so all surfaces emit identical URLs.
 */
const buildPiFileDownloadUrl = (agentId, sessionId, path) =>
  `/arp/api/pi/files/download?agentId=${encodeURIComponent(String(agentId))}&sessionId=${encodeURIComponent(String(sessionId))}&path=${encodeURIComponent(String(path))}`;

/**
 * Clock-skew grace for mtime filtering: callers derive `modifiedSince` from
 * the LOCAL clock (turn start), but pi stamps file mtimes with the PI SERVER
 * clock. A local clock even ~20s ahead filters out files generated during the
 * turn (pi's comparison is strictly `>`), so widen the window before sending.
 */
const PI_FILES_SINCE_GRACE_MS = 5 * 60_000;

/**
 * List files generated in a pi session (recursive, optionally filtered by
 * mtime) as structured records with download URLs, `lastModified` kept so
 * downstream selection (filterPiResultFiles) can sort by recency.
 *
 * Thin wrapper over the canonical listPiFiles, kept for existing consumers:
 * - execute_skill tool results (files attached to the agent message)
 * - GallerySkillTaskRun.files
 * - one-pi chat buildFileLinks
 *
 * Older files that slip in through the grace window are excluded downstream
 * by the text-mention filter (filterPiResultFiles).
 */
const collectPiGeneratedFiles = (agentId, sessionId, userId, modifiedSince) =>
  listPiFiles(
    agentId,
    sessionId,
    userId,
    modifiedSince != null
      ? new Date(new Date(modifiedSince).getTime() - PI_FILES_SINCE_GRACE_MS)
      : undefined,
  );

/** Backwards-compatible alias for existing executeSkill call sites. */
const collectSkillFiles = collectPiGeneratedFiles;

/** Max files kept after dedupe/truncation (shared across consumers). */
const MAX_PI_RESULT_FILES = 10;

/**
 * Whether a filename/path is mentioned in `text` as a whole token (word
 * boundary), not as a substring — `sheet1.xml` must not match text that only
 * contains `sheet1.xml.bak` or a longer path embedding it.
 */
const isMentionedInText = (name, text) => {
  if (!name || !text) {
    return false;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^\\w./-])${escaped}($|[^\\w./-])`);
  return pattern.test(text);
};

/**
 * Intermediate-artifact directories created by skills during a run (unpack
 * workdirs, temp stages, in-skill dependency installs). Files under them are
 * build intermediates, not deliverables — excluded from result-file footers
 * even when the skill's prose mentions them (skills routinely narrate "edited
 * sharedStrings.xml in ./xlsx_work/" while the actual deliverable is the
 * repacked original; an in-skill `npm install` must not flood the footer
 * with node_modules either).
 */
const INTERMEDIATE_DIR_PATTERN = /(^|\/)(node_modules|[^/]*_work\d*|work|temp|tmp|\.tmp)(\/|$)/i;

const isIntermediateArtifact = (filePath) => INTERMEDIATE_DIR_PATTERN.test(String(filePath || ''));

/** File mtime as a sortable number; missing/invalid mtimes sort oldest. */
const mtimeOf = (file) => {
  const t = Date.parse(file?.lastModified);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Shared post-processing for pi file lists:
 * - hygiene filter (both modes): drop hidden entries and intermediate
 *   artifacts (node_modules, skill work/temp dirs)
 * - optional text filter: keep only files whose basename or path is mentioned
 *   in `text` (whole-token match; pass null/undefined to keep all). The text
 *   must be the assistant's PROSE output — never tool_call output, which
 *   enumerates every workspace file and would defeat the filter.
 * - sort by lastModified desc (stable; missing mtimes last) before dedupe, so
 *   basename duplicates collapse onto their newest copy and the cap keeps
 *   the most recent deliverables
 * - dedupe by basename
 * - truncate to MAX_PI_RESULT_FILES
 *
 * Used by one-pi buildFileLinks, execute_skill footers, BackgroundSkillFiles
 * and GallerySkillTaskRun.files so all surfaces apply identical filtering
 * rules.
 */
const filterPiResultFiles = (files, text = null) => {
  if (!files || files.length === 0) {
    return [];
  }

  const isHiddenEntry = (f) => ((f.path || f.name || '').split('/').pop() || '').startsWith('.');

  const pool = files.filter((f) => {
    if (isHiddenEntry(f) || isIntermediateArtifact(f.path || f.name)) {
      return false;
    }
    if (text == null) {
      return true;
    }
    const basename = (f.path || f.name || '').split('/').pop();
    return isMentionedInText(basename, text) || isMentionedInText(f.path, text);
  });

  pool.sort((a, b) => mtimeOf(b) - mtimeOf(a));

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
 * Build the canonical "📎 下载文件：[📄 name](url)" markdown footer from an
 * already-collected pi file list (collectPiGeneratedFiles output). Shared by
 * the one-pi chat buildFileLinks surface and BackgroundSkillFiles so both
 * emit identical link markdown. Returns null when there is nothing to show.
 */
const buildPiFileLinks = (files) => {
  if (!files || files.length === 0) {
    return null;
  }
  const links = files.map((f) => `[📄 ${f.name}](${f.url})`);
  return '\n\n---\n📎 下载文件：' + links.join('  ');
};

/**
 * Persist the pi file-links footer onto an already-saved response message
 * so the links survive page refresh. Matches by the messageId STRING field —
 * NOT _id (an ObjectId; passing the messageId uuid to findByIdAndUpdate is a
 * silent CastError). Appends to `text` and, only when the message has
 * content parts, a trailing TEXT part.
 * @param {string} messageId
 * @param {string} links
 */
const appendPiLinksToSavedMessage = async (messageId, links) => {
  if (!messageId || !links) {
    return;
  }
  try {
    const { Message } = require('~/db/models');
    // Stored message content parts keep the server shape (text as plain
    // string) — same as BaseClient's editedContent writes.
    await Message.updateOne({ messageId }, [
      {
        $set: {
          text: { $concat: [{ $ifNull: ['$text', ''] }, links] },
          content: {
            $cond: [
              { $isArray: '$content' },
              {
                $concatArrays: ['$content', [{ type: 'text', text: links }]],
              },
              '$$REMOVE',
            ],
          },
        },
      },
    ]);
  } catch (error) {
    logger.warn('[PIService] appendPiLinksToSavedMessage failed:', error.message);
  }
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
  const effectiveInput = sanitizeSkillInput(input || '');
  const message = buildSkillMessage(skillName, effectiveInput);
  const startedAt = new Date();

  // Skills commonly run for minutes. Stream live output up to a deadline,
  // then stop reading and let pi finish in the background (pi's /prompt has
  // no disconnect abort): its messages still persist at parentMessageId and
  // the skill task (created by pi for /skill: turns) keeps updating the task
  // panel. 0 disables the deadline (wait forever).
  const deadlineMs = Number(process.env.PI_SKILL_TIMEOUT_MS ?? 600_000);
  let timedOut = false;

  try {
    // /execute-agent-skill: the outer agent's system prompt is APPENDED to
    // pi's base prompt (pi keeps its tool catalog and the DMP suffix). Without
    // one (e.g. no job metadata), fall back to pi.system.
    const useAgentPrompt =
      typeof agentSystemPrompt === 'string' && agentSystemPrompt.trim().length > 0;
    // Header-wait guard: the idle-read deadline below only starts once the
    // fetch resolves, so a pi that accepts the connection but never sends
    // headers would hang the tool call forever. Abort only during the header
    // wait; once streaming starts, the per-read deadline governs.
    const headerAbort = new AbortController();
    const headerTimer = setTimeout(() => headerAbort.abort(), PI_HEADER_TIMEOUT_MS);
    const response = await fetch(`${PI_HOST}/execute-agent-skill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': PI_API_KEY,
        'X-User-Id': String(userId),
      },
      body: JSON.stringify({
        skillName,
        input: effectiveInput,
        agentId: finalAgentId,
        sessionId,
        stream: true,
        parentMessageId,
        ...(useAgentPrompt
          ? { agentSystemPrompt }
          : { fallbackSystemPrompt: await getPiSystemPrompt() }),
      }),
      signal: headerAbort.signal,
    });
    clearTimeout(headerTimer);

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
      let result;
      if (deadlineMs > 0) {
        // Idle timeout: the timer is per-read and cleared once the race
        // settles, so continuous output keeps resetting it and losing timers
        // don't pile up for the full deadlineMs window.
        let timer;
        const timeoutPromise = new Promise((resolve) => {
          timer = setTimeout(() => resolve({ __timeout: true }), deadlineMs);
        });
        try {
          result = await Promise.race([readPromise, timeoutPromise]);
        } finally {
          clearTimeout(timer);
        }
      } else {
        result = await readPromise;
      }

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
      // Hygiene filter (no summary text exists yet): in-skill npm installs
      // and unpack dirs must not flood the tool output's Generated Files
      // list; newest-first cap keeps it bounded.
      const filesSoFar = filterPiResultFiles(
        await collectSkillFiles(finalAgentId, sessionId, userId, startedAt),
      );
      return {
        success: true,
        background: true,
        data: {
          skillName,
          message,
          output,
          files: filesSoFar,
          startedAt: startedAt.toISOString(),
          note:
            `Skill "${skillName}" is still running in the background (over ${Math.round(deadlineMs / 1000)}s). ` +
            'Its output and generated files will appear in the conversation and the task panel when it finishes. ' +
            'Tell the user it is in progress and finish your turn without waiting.',
        },
      };
    }

    const files = filterPiResultFiles(
      await collectSkillFiles(finalAgentId, sessionId, userId, startedAt),
    );

    return {
      success: true,
      data: {
        skillName,
        message,
        output,
        files,
        startedAt: startedAt.toISOString(),
      },
    };
  } catch (error) {
    logger.error('[PIService] executeSkill error:', error.message);
    return { success: false, error: error.message };
  }
};

const handlePIToolCall = async (
  { name, arguments: args, sessionId, agentId, parentMessageId, agentSystemPrompt },
  onChunk,
  onThinking,
  onToolEvent,
  userId,
) => {
  const finalAgentId = agentId || 'default';

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

  if (name === 'read_prompt') {
    if (!args.key) {
      return { success: false, error: 'key is required' };
    }
    return readPrompt({
      key: args.key,
      userId,
      agentId: finalAgentId,
    });
  }

  return { success: false, error: `Unknown PI tool: ${name}` };
};

module.exports = {
  isPIConfigured,
  sendToPI,
  sendToPIStream,
  executeCode,
  executeCodeStream,
  executeSkill,
  uploadFile,
  getPIFiles,
  downloadPIFile,
  deletePIFile,
  isArtifactRequest,
  handlePIToolCall,
  collectPiGeneratedFiles,
  buildPiFileDownloadUrl,
  buildPiFileLinks,
  appendPiLinksToSavedMessage,
  filterPiResultFiles,
  isIntermediateArtifact,
  MAX_PI_RESULT_FILES,
  listPiFiles,
  readPiTextFile,
  PI_HOST,
  PI_API_KEY,
};
