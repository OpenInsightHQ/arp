const { encodeEphemeralAgentId } = require('librechat-data-provider');
const { getCustomEndpointConfig, getPiSystemPrompt, getLangFromReq } = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const { GalleryArtifact } = require('~/models/GalleryArtifact');
const { GallerySqlQuery } = require('~/models/GallerySqlQuery');
const { GalleryVersion } = require('~/models/GalleryVersion');
const { getMessages } = require('~/models');
const { safeHttpStatus, sanitizeForLog } = require('~/server/utils/sanitize');
const {
  buildSolidificationArtifactQuery,
  getMessagesThroughTarget,
} = require('~/server/utils/galleryArtifactIdentity');
const {
  appendGalleryVersion,
  upsertGallerySqlQueries,
} = require('~/server/services/Artifacts/galleryPublishing');
const { collectPiGeneratedFiles, filterPiResultFiles, buildPiFileLinks } = require('~/server/services/PIService');

const PI_HOST = process.env.PI_HOST || process.env.PI_AGENT_URL || 'http://localhost:3000';
const PI_API_KEY = process.env.PI_API_KEY || 'testkey';

const MAX_FILE_LINKS = 10; // kept in sync with PIService.MAX_PI_RESULT_FILES

async function buildFileLinks(text, agentId, sessionId, userId, startTime) {
  if (!text || !agentId || !sessionId) return null;

  const realFiles = await collectPiGeneratedFiles(agentId, sessionId, userId, startTime);

  if (realFiles.length === 0) {
    console.log(`[buildFileLinks] No files for agentId=${agentId} sessionId=${sessionId} userId=${userId} — skipping link injection`);
    return null;
  }

  // Shared filtering: text-mention match, basename dedupe, cap at 10
  const uniqueFiles = filterPiResultFiles(realFiles, text);
  if (uniqueFiles.length === 0) return null;

  const truncated = uniqueFiles.length >= MAX_FILE_LINKS && realFiles.length > uniqueFiles.length;
  const links = buildPiFileLinks(uniqueFiles);
  if (!links) return null;

  const tail = truncated ? `  ...(+more)` : '';
  return links + tail;
}

function extractSqlFromToolCalls(messages) {
  const queries = [];
  let order = 1;

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        try {
          const args = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments || {};

          const sql = args.sql || args.query || args.sqlQuery || args.statement;
          if (sql && sql.trim().toUpperCase().startsWith('SELECT')) {
            queries.push({
              sql: sql.trim(),
              dataKey: `query_${order}`,
              description: args.question || args.description || `查询 ${order}`,
              resultShape: 'table',
              order,
            });
            order++;
          }
        } catch (e) {
          // ignore parse errors
        }
      }
    }
  }

  return queries;
}

async function handleArtifactSolidification(message, userId, conversationId) {
  let targetMessageId = null;
  let artifactId = null;

  const newFormatMatch = message.match(/<!--\s*SOLIDIFY:([A-Za-z0-9+/=]+)\s*-->/);
  if (newFormatMatch) {
    try {
      const context = JSON.parse(Buffer.from(newFormatMatch[1], 'base64').toString('utf8'));
      artifactId = context.artifactId;
      targetMessageId = context.targetMessageId;
      console.log('[PI Solidification] New format detected:', { artifactId, targetMessageId });
    } catch (e) {
      console.error('[PI Solidification] Failed to parse SOLIDIFY context:', e);
    }
  }

  if (!artifactId) {
    const legacyMatch = message.match(/^\[固化报告\](?:[\s\S]*?)targetMessageId:\s*([\w-]+)[\s\S]*?artifactId:\s*([\w-]+)/);
    if (legacyMatch) {
      targetMessageId = legacyMatch[1];
      artifactId = legacyMatch[2];
    }
  }

  if (!artifactId || !targetMessageId) {
    return { success: false };
  }

  console.log('[PI Solidification] Starting:', { targetMessageId, artifactId, userId: sanitizeForLog(userId), conversationId });

  try {
    const artifact = await GalleryArtifact.findOne(buildSolidificationArtifactQuery({
      artifactId,
      userId,
      conversationId,
      targetMessageId,
    }));
    if (!artifact) {
      return { success: false, error: 'Published report identity does not match this conversation and target' };
    }

    const reportTargetMessageId = artifact.targetMessageId;
    const messages = await getMessages({ conversationId, user: userId });
    console.log('[PI Solidification] Total messages:', messages.length);

    const conversationMessages = getMessagesThroughTarget(messages, reportTargetMessageId);
    if (!conversationMessages) {
      return { success: false, error: `Target message not found: ${reportTargetMessageId}` };
    }

    console.log('[PI Solidification] Conversation messages to solidify:', conversationMessages.length);

    if (conversationMessages.length === 0) {
      return { success: false, error: 'No messages to solidify' };
    }

    const piMessages = conversationMessages.map(msg => ({
      role: msg.isCreatedByUser ? 'user' : 'assistant',
      content: msg.text || '',
      tool_calls: msg.tool_calls ? msg.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        },
      })) : undefined,
    }));

    const inferredParams = {};
    for (const msg of conversationMessages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          try {
            const args = JSON.parse(tc.function?.arguments || '{}');
            for (const [key, value] of Object.entries(args)) {
              if (!key.toLowerCase().includes('key') &&
                  !key.toLowerCase().includes('secret') &&
                  !key.toLowerCase().includes('token') &&
                  !key.toLowerCase().includes('password')) {
                inferredParams[key] = value;
              }
            }
          } catch (e) {
            // ignore parse errors
          }
        }
      }
    }

    console.log('[PI Solidification] Inferred params:', Object.keys(inferredParams));

    const skillName = `artifact_${artifactId.slice(0, 8)}`;
    const generateUrl = `${PI_HOST}/skills/generate`;

    console.log('[PI Solidification] Calling PI /skills/generate:', generateUrl);

    const generateResponse = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': PI_API_KEY,
        'X-User-Id': userId,
      },
      body: JSON.stringify({
        messages: piMessages,
        skillName,
        params: inferredParams,
      }),
    });

    if (!generateResponse.ok) {
      const errText = await generateResponse.text();
      console.error('[PI Solidification] Generate error:', errText);
      return { success: false, error: `PI generate failed: ${errText}` };
    }

    const generateResult = await generateResponse.json();
    console.log('[PI Solidification] Generate result:', JSON.stringify(generateResult).slice(0, 500));

    const skillId = generateResult.skillId || generateResult.id || skillName;
    const skillPath = generateResult.skillPath || null;

    await GalleryArtifact.updateOne(
      { galleryArtifactId: artifactId, userId, conversationId, targetMessageId },
      { $set: { skillId, skillPath } }
    );

    console.log('[PI Solidification] Artifact updated:', { skillId, skillPath });

    const dbMessagesForExtraction = conversationMessages.map(msg => ({
      role: msg.isCreatedByUser ? 'user' : 'assistant',
      content: msg.text || '',
      tool_calls: msg.tool_calls ? msg.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        },
      })) : undefined,
    }));

    const extractedQueries = extractSqlFromToolCalls(dbMessagesForExtraction);
    console.log('[PI Solidification] Extracted SQL queries:', extractedQueries.length);

    if (extractedQueries.length > 0) {
      await upsertGallerySqlQueries({
        GallerySqlQuery,
        artifact,
        userId,
        queries: extractedQueries,
        extractedBy: 'tool_calls',
      });
      console.log('[PI Solidification] SQL queries saved:', extractedQueries.length);
    }

    try {
      const currentVersion = await GalleryVersion.findOne({
        galleryArtifactId: artifactId,
        version: artifact.currentVersion || 1,
      });

      if (currentVersion) {
        const versionResult = await appendGalleryVersion({
          GalleryArtifact,
          GalleryVersion,
          artifact,
          versionData: {
            html: currentVersion.html,
            createdBy: 'update_agent',
          },
        });
        console.log('[PI Solidification] New version created:', versionResult.version);
      }
    } catch (versionError) {
      console.error('[PI Solidification] Version update failed:', versionError.message);
    }

    return {
      success: true,
      artifactId,
      skillId,
      responseMessage: extractedQueries.length > 0
        ? `✅ 固化成功！已保存 ${extractedQueries.length} 条数据查询，Skill 已创建: ${skillId}，作品集将自动使用此 Skill 定时刷新数据。`
        : `✅ 固化成功！Skill 已创建: ${skillId}，作品集将自动使用此 Skill 定时刷新数据。`,
    };

  } catch (error) {
    console.error('[PI Solidification] Error:', error.message);
    return { success: false, error: error.message };
  }
}

function extractLastUserMessage(messages) {
  let lastUserMsg = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserMsg = messages[i];
      break;
    }
  }
  let userMessage = lastUserMsg?.content || '';

  if (typeof userMessage !== 'string') {
    if (Array.isArray(userMessage)) {
      userMessage = userMessage
        .filter(part => part.type === 'text')
        .map(part => part.text || '')
        .join('');
    } else if (userMessage && typeof userMessage === 'object') {
      userMessage = userMessage.text || userMessage.content || '';
    }
    userMessage = String(userMessage);
  }

  return userMessage;
}

function writeSseChunk(res, payload) {
  res.write('data: ' + JSON.stringify(payload) + '\n\n');
  if (typeof res.flush === 'function') {
    res.flush();
  }
}

function buildChunk(chatId, created, delta, finishReason = null) {
  return {
    id: chatId,
    object: 'chat.completion.chunk',
    created,
    model: 'one-pi',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function setSseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

async function sendSolidificationStream(res, chatId, created, content) {
  setSseHeaders(res);
  writeSseChunk(res, buildChunk(chatId, created, { role: 'assistant', content: '' }));

  const chunks = content.match(/.{1,50}/g) || [content];
  for (const chunk of chunks) {
    writeSseChunk(res, buildChunk(chatId, created, { content: chunk }));
    await new Promise(r => setTimeout(r, 20));
  }

  writeSseChunk(res, buildChunk(chatId, created, {}, 'stop'));
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleSolidificationRequest({ userMessage, userId, conversationId, stream, res }) {
  const isSolidificationRequest =
    userMessage.startsWith('[固化报告]') ||
    (userMessage.includes('<!-- SOLIDIFY:') && userMessage.includes('-->'));

  if (!isSolidificationRequest || userId === 'system' || !conversationId) {
    return null;
  }

  console.log('[PI Chat] Detected solidification request');
  const solidResult = await handleArtifactSolidification(userMessage, userId, conversationId);
  const chatId = 'chatcmpl-pi-' + Date.now();
  const created = Math.floor(Date.now() / 1000);

  if (solidResult.success) {
    const responseContent = solidResult.responseMessage;
    if (!stream) {
      return res.json({
        id: 'chatcmpl-pi-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'one-pi',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: responseContent },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
    await sendSolidificationStream(res, chatId, created, responseContent);
    return true;
  }

  const errorContent = `❌ 固化失败: ${solidResult.error}`;
  setSseHeaders(res);
  writeSseChunk(res, buildChunk(chatId, created, { role: 'assistant', content: '' }));
  writeSseChunk(res, buildChunk(chatId, created, { content: errorContent }));
  writeSseChunk(res, buildChunk(chatId, created, {}, 'stop'));
  res.write('data: [DONE]\n\n');
  res.end();
  return true;
}

async function runNonStreamingPI({ finalUserMessage, agentId, sessionId, userId, res, streamStartTime, systemPrompt }) {
  try {
    const response = await fetch(`${PI_HOST}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': PI_API_KEY,
        'X-User-Id': userId,
      },
      body: JSON.stringify({
        message: finalUserMessage,
        agentId,
        sessionId,
        cwd: null,
        stream: true,
        systemPrompt,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(safeHttpStatus(response.status)).json({ error: { message: errText } });
    }

    let fullContent = '';
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
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text_delta' && data.delta) {
              fullContent += data.delta;
            }
          } catch (e) { /* skip */ }
        }
      }
    }

    const fileLinks = await buildFileLinks(fullContent, agentId, sessionId, userId, streamStartTime);
    const finalContent = fileLinks ? fullContent + fileLinks : fullContent;

    return res.json({
      id: 'chatcmpl-pi-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'one-pi',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: finalContent },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (error) {
    console.error('[PI Chat] Error:', error.message);
    return res.status(500).json({ error: { message: error.message } });
  }
}

async function streamFromPI({ res, chatId, created, finalUserMessage, agentId, sessionId, userId, streamStartTime, systemPrompt, userMessageId, responseMessageId, parentMessageId }) {
  setSseHeaders(res);
  writeSseChunk(res, buildChunk(chatId, created, { role: 'assistant', content: '' }));

  const abortController = new AbortController();
  let clientDisconnected = false;
  let heartbeatInterval = null;
  let firstDataReceived = false;

  heartbeatInterval = setInterval(() => {
    if (clientDisconnected || firstDataReceived) {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      return;
    }
    if (!res.writableEnded) {
      res.write(': heartbeat\n\n');
      if (typeof res.flush === 'function') {
        res.flush();
      }
    }
  }, 2000);

  res.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      console.log(`[PI Chat] Client disconnected (stopping stream read), session ${sessionId}. PI generation continues for resume support.`);
    }
  });

  try {
    const response = await fetch(`${PI_HOST}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': PI_API_KEY,
        'X-User-Id': userId,
      },
      body: JSON.stringify({
        message: finalUserMessage,
        agentId,
        sessionId,
        cwd: null,
        stream: true,
        systemPrompt,
        userMessageId,
        responseMessageId,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[PI Chat] Error response:', errText);
      writeSseChunk(res, buildChunk(chatId, created, { content: '\nError: ' + errText }));
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = null;
    let piUsage = null;
    let piFullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstDataReceived) {
        firstDataReceived = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(line.slice(6));

          if (currentEvent === 'thinking') {
            if (data.type === 'thinking_delta' && data.delta) {
              writeSseChunk(res, buildChunk(chatId, created, { reasoning_content: data.delta }));
            }
            continue;
          }

          if (currentEvent === 'tool_start') {
            const toolName = data.toolName || 'unknown';
            let argsDisplay = '';
            if (data.args) {
              try {
                const parsed = typeof data.args === 'string' ? JSON.parse(data.args) : data.args;
                if (parsed.code) {
                  argsDisplay = parsed.code.substring(0, 200);
                } else if (parsed.command) {
                  argsDisplay = parsed.command.substring(0, 200);
                } else {
                  argsDisplay = JSON.stringify(parsed).substring(0, 200);
                }
              } catch (e) {
                argsDisplay = String(data.args).substring(0, 200);
              }
            }
            writeSseChunk(res, buildChunk(chatId, created, {
              reasoning_content: `\n🔧 调用 ${toolName} ${argsDisplay}\n`,
            }));
            continue;
          }

          if (currentEvent === 'tool_update') {
            // Live subagent progress: pi forwards subagent thinking/text/tool
            // deltas via tool_update events. Stream them into reasoning_content
            // so the UI shows subagent activity while the tool is still running.
            // Text is forwarded as-is (no added newline) so content deltas from
            // pi concatenate into a continuous paragraph.
            const partial = data.partialResult;
            const text = partial?.content?.[0]?.text;
            if (typeof text === 'string' && text.length > 0) {
              writeSseChunk(
                res,
                buildChunk(chatId, created, {
                  reasoning_content: text,
                }),
              );
            }
            continue;
          }

          if (currentEvent === 'tool_end') {
            const toolName = data.toolName || 'unknown';
            writeSseChunk(res, buildChunk(chatId, created, { reasoning_content: `✅ ${toolName} 完成\n` }));
            continue;
          }

          if (currentEvent === 'usage') {
            piUsage = data;
            continue;
          }

          if (data.type === 'text_delta' && data.delta) {
            piFullContent += data.delta;
            writeSseChunk(res, buildChunk(chatId, created, { content: data.delta }));
          }
        } catch (e) {
          // skip unparseable lines
        }
      }
    }

    if (piUsage) {
      res.write('data: ' + JSON.stringify({
        id: chatId,
        object: 'chat.completion.chunk',
        created,
        model: 'one-pi',
        choices: [],
        usage: {
          prompt_tokens: piUsage.prompt_tokens || 0,
          completion_tokens: piUsage.completion_tokens || 0,
          total_tokens: piUsage.total_tokens || 0,
          cache_read_tokens: piUsage.cache_read_tokens || 0,
          cache_write_tokens: piUsage.cache_write_tokens || 0,
          // Turn-cumulative counters from pi (ignored by LangChain, kept for
          // direct consumers of this SSE stream; the pi backend persists the
          // authoritative values on the message documents itself)
          totalInputTokens: piUsage.totalInputTokens || 0,
          totalOutputTokens: piUsage.totalOutputTokens || 0,
          totalCacheReadTokens: piUsage.totalCacheReadTokens || 0,
          totalCacheWriteTokens: piUsage.totalCacheWriteTokens || 0,
        },
      }) + '\n\n');
      if (typeof res.flush === 'function') {
        res.flush();
      }
    }

    const fileLinks = await buildFileLinks(piFullContent, agentId, sessionId, userId, streamStartTime);
    if (fileLinks) {
      writeSseChunk(res, buildChunk(chatId, created, { content: fileLinks }));
    }

    writeSseChunk(res, buildChunk(chatId, created, {}, 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    console.error('[PI Chat] Stream error:', error.message);
    writeSseChunk(res, buildChunk(chatId, created, { content: '\nStream error: ' + error.message }));
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/**
 * OpenAI-compatible PI chat completions handler.
 *
 * Translation layer between OpenAI-shaped requests and the PI backend
 * (conversation history, artifact solidification). The user's long-term
 * memory and <available_prompts> sections are appended by pi itself.
 *
 * Reused by:
 *   - POST /api/pi/chat/completions (routes/pi.js)
 *   - POST /api/agents/v2/chat/completions when model === 'one-pi' (routes/agents/v2.js)
 *   - POST /api/agents/v1/chat/completions when model === 'one-pi' (routes/agents/openai.js)
 */
const piChatCompletionsController = async (req, res) => {
  const { messages, stream = true, user } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages array is required' } });
  }

  const userMessage = extractLastUserMessage(messages);
  if (!userMessage) {
    return res.status(400).json({ error: { message: 'No user message found' } });
  }

  // Server-to-server call (agents graph → custom endpoint baseURL): no JWT on
  // this route, so the real user id arrives via the X-User-Id header staged by
  // buildPiForwardHeaders (initialize.ts) or the body `user` field. Falling
  // back to 'system' would list pi's per-user workspace as the wrong user →
  // empty file listing → no download links.
  const userId =
    req.user?.id || req.headers['x-user-id'] || user || 'system';
  const model = req.body.model || 'one-pi';
  const appConfig = await getAppConfig();
  const endpointConfig = getCustomEndpointConfig({ endpoint: 'pi', appConfig });
  const sender = endpointConfig?.modelDisplayLabel || undefined;
  const agentId = encodeEphemeralAgentId({ endpoint: 'pi', model, sender });
  const conversationId = req.headers['x-conversation-id'] || '';
  const sessionId = conversationId || 'new';
  const userMessageId = req.headers['x-user-message-id'] || undefined;
  const responseMessageId = req.headers['x-response-message-id'] || undefined;
  // Frontend-known message-tree mount point; forwarded to pi so persistence
  // pins to the correct parent instead of inferring "last message".
  const parentMessageId = req.headers['x-parent-message-id'] || undefined;

  const solidHandled = await handleSolidificationRequest({
    userMessage,
    userId,
    conversationId,
    stream,
    res,
  });
  if (solidHandled) {
    return;
  }

  const lang = getLangFromReq(req);
  const systemPrompt = await getPiSystemPrompt(lang);

  const streamStartTime = Date.now();

  if (!stream) {
    return runNonStreamingPI({
      finalUserMessage: userMessage,
      agentId,
      sessionId,
      userId,
      res,
      streamStartTime,
      systemPrompt,
      userMessageId,
      responseMessageId,
      parentMessageId,
    });
  }

  const chatId = 'chatcmpl-pi-' + Date.now();
  const created = Math.floor(Date.now() / 1000);

  return streamFromPI({
    res,
    chatId,
    created,
    finalUserMessage: userMessage,
    agentId,
    sessionId,
    userId,
    streamStartTime,
    systemPrompt,
    userMessageId,
    responseMessageId,
    parentMessageId,
  });
};

module.exports = {
  piChatCompletionsController,
  PI_HOST,
  PI_API_KEY,
};
