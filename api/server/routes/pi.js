const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireJwtAuth } = require('../middleware/');
const { piChatCompletionsController, buildSystemPromptWithMemory, PI_HOST, PI_API_KEY } = require('~/server/controllers/pi/chatCompletions');
const { getLangFromReq } = require('@librechat/api');
const { safeHttpStatus, sanitizeForLog } = require('~/server/utils/sanitize');

const PI_UPLOAD_LIMIT_MB = parseInt(process.env.PI_UPLOAD_LIMIT_MB || '1024', 10);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PI_UPLOAD_LIMIT_MB * 1024 * 1024 } });

async function forwardPIRequest(req, res, endpoint) {
  const query = req.query;
  const body = req.body || {};
  const agentId = query.agentId || body.agentId;
  const sessionId = query.sessionId || body.sessionId;
  const filename = query.filename || body.filename;
  const path = query.path || body.path;

  if (!agentId || !sessionId) {
    return res.status(400).json({ error: 'agentId and sessionId are required' });
  }

  const isDelete = req.method === 'DELETE';

  let url = `${PI_HOST}${endpoint}?agentId=${encodeURIComponent(String(agentId))}&sessionId=${encodeURIComponent(String(sessionId))}`;

  if (filename && !isDelete) {
    url += `&filename=${encodeURIComponent(String(filename))}`;
  }

  if (path) {
    url += `&path=${encodeURIComponent(String(path))}`;
  }

  console.log(`[PI Route] Forwarding to: ${url}, method: ${req.method}`);

  try {
    const headers = {
      'api-key': PI_API_KEY,
      'X-User-Id': req.user.id,
    };

    let reqBody;
    if (isDelete) {
      headers['Content-Type'] = 'application/json';
      reqBody = JSON.stringify({
        agentId: String(agentId),
        sessionId: String(sessionId),
        path: String(path || ''),
      });
    }

    const response = await fetch(url, {
      method: req.method,
      headers,
      body: reqBody,
    });

    console.log(`[PI Route] Response status: ${response.status}`);

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await response.json();
      console.log("[PI Route] Response body:", JSON.stringify(data));
      return res.status(safeHttpStatus(response.status)).json(data);
    }

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error(`[PI Route] Error: ${error.message}`, error.cause ?? '');
    return res.status(500).json({ error: error.message });
  }
}

async function forwardPIPostRequest(req, res, endpoint, options = {}) {
  const { agentId, sessionId } = req.body;

  if (!agentId || !sessionId) {
    return res.status(400).json({ error: 'agentId and sessionId are required' });
  }

  const url = `${PI_HOST}${endpoint}`;
  console.log(`[PI Route] POST Forwarding to: ${url}, body:`, JSON.stringify(req.body));

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': PI_API_KEY,
      'X-User-Id': req.user.id,
    },
    body: JSON.stringify(req.body),
  };

  if (options.timeoutMs) {
    fetchOptions.signal = AbortSignal.timeout(options.timeoutMs);
  }

  try {
    const response = await fetch(url, fetchOptions);

    console.log(`[PI Route] POST Response status: ${response.status}`);

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await response.json();
      console.log("[PI Route] POST Response body:", JSON.stringify(data));
      return res.status(safeHttpStatus(response.status)).json(data);
    }

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    const cause = error.cause ? ` (cause: ${error.cause.code || error.cause.message || error.cause})` : '';
    console.error(`[PI Route] POST Error: ${error.message}${cause}`);
    return res.status(500).json({ error: error.message });
  }
}

async function forwardPIUploadRequest(req, res, endpoint) {
  const { agentId, sessionId, path } = req.body;

  if (!agentId || !sessionId) {
    return res.status(400).json({ error: 'agentId and sessionId are required' });
  }

  const url = `${PI_HOST}${endpoint}`;
  console.log(`[PI Route] Upload to: ${url}`);

  try {
    const formData = new FormData();
    formData.append('agentId', String(agentId));
    formData.append('sessionId', String(sessionId));
    if (path) {
      formData.append('path', String(path));
    }
    if (req.file) {
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
      const utf8Filename = Buffer.from(req.file.originalname, 'latin1').toString('utf-8');
      formData.append('file', blob, utf8Filename);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': PI_API_KEY,
        'X-User-Id': req.user.id,
      },
      body: formData,
    });

    console.log(`[PI Route] Upload Response status: ${response.status}`);

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(safeHttpStatus(response.status)).json(data);
    }

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error(`[PI Route] Upload Error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
}

router.get('/files/upload-limits', requireJwtAuth, async (req, res) => {
  return res.json({ maxFileSizeMB: PI_UPLOAD_LIMIT_MB });
});

router.get('/files', requireJwtAuth, async (req, res) => {
  return forwardPIRequest(req, res, '/files');
});

router.get('/files/download', requireJwtAuth, async (req, res) => {
  return forwardPIRequest(req, res, '/files/download');
});

router.delete('/files', requireJwtAuth, async (req, res) => {
  return forwardPIRequest(req, res, '/files');
});

router.post('/files/mkdir', requireJwtAuth, async (req, res) => {
  return forwardPIPostRequest(req, res, '/files/mkdir');
});

router.post('/files/rename', requireJwtAuth, async (req, res) => {
  return forwardPIPostRequest(req, res, '/files/rename');
});

router.post('/files/move', requireJwtAuth, async (req, res) => {
  return forwardPIPostRequest(req, res, '/files/move');
});

router.post('/files/unzip', requireJwtAuth, async (req, res) => {
  return forwardPIPostRequest(req, res, '/files/unzip', { timeoutMs: 30 * 60 * 1000 });
});

router.post('/files/batch-delete', requireJwtAuth, async (req, res) => {
  return forwardPIPostRequest(req, res, '/files/batch-delete');
});

router.post('/files/upload', requireJwtAuth, upload.single('file'), async (req, res) => {
  return forwardPIUploadRequest(req, res, '/upload');
});

// POST /api/pi/prompt - SSE stream from PI Agent
router.post('/prompt', requireJwtAuth, async (req, res) => {
  const { message, agentId, sessionId, cwd, stream = true } = req.body;

  if (!message || !agentId || !sessionId) {
    return res.status(400).json({ error: 'message, agentId and sessionId are required' });
  }

  console.log('[PI Route] Prompt request:', { agentId: sanitizeForLog(agentId), sessionId: sanitizeForLog(sessionId), messageLength: sanitizeForLog(message.length) });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const response = await fetch(`${PI_HOST}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': PI_API_KEY,
        'X-User-Id': req.user.id,
      },
      body: JSON.stringify({ message, agentId, sessionId, cwd, stream, systemPrompt: await buildSystemPromptWithMemory({ userId: req.user.id, req, lang: getLangFromReq(req) }) }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[PI Route] Prompt error:', response.status, errText);
      res.write('event: error\ndata: ' + JSON.stringify({ error: errText }) + '\n\n');
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    } catch (pipeError) {
      console.error('[PI Route] Stream pipe error:', pipeError.message);
    }

    res.end();
  } catch (error) {
    console.error('[PI Route] Prompt error:', error.message);
    res.write('event: error\ndata: ' + JSON.stringify({ error: error.message }) + '\n\n');
    res.end();
  }
});

// POST /api/pi/chat/completions - OpenAI compatible translation layer
// JWT not required on this route: it is also reachable internally from
// /api/agents/v{1,2}/chat/completions (when model === 'one-pi'), where
// API-key auth has already populated req.user.
router.post('/chat/completions', piChatCompletionsController);

module.exports = router;
