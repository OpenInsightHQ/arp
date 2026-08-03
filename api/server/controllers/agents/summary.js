const { logger } = require('@librechat/data-schemas');
const {
  Providers,
  createMetadataAggregator,
} = require('@librechat/agents');
const {
  ContentTypes,
  EModelEndpoint,
} = require('librechat-data-provider');
const { getBufferString } = require('@langchain/core/messages');
const {
  omitTitleOptions,
  getProviderConfig,
  createSafeUser,
  resolveHeaders,
  getSystemPromptOrSeed,
} = require('@librechat/api');
const db = require('~/models');

function sanitizeForPromptTemplate(text) {
  if (typeof text !== 'string' || !text) {
    return text;
  }
  return text.replace(/{/g, '\uFF5B').replace(/}/g, '\uFF5D');
}

function formatChunksForSummary(textChunks) {
  const fullResponseText = textChunks.join('');
  if (fullResponseText) {
    return `已得到的执行输出：\n${fullResponseText}`;
  }
  return '（暂无可用的执行输出日志）';
}

function formatContentPartsForSummary(contentParts) {
  if (!Array.isArray(contentParts) || contentParts.length === 0) {
    return null;
  }

  const lines = [];
  for (const part of contentParts) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    if (part.type === ContentTypes.TEXT) {
      const value = part[ContentTypes.TEXT];
      let text = '';
      if (typeof value === 'string') {
        text = value;
      } else if (value && typeof value === 'object' && typeof value.value === 'string') {
        text = value.value;
      }
      if (text) {
        lines.push(text.trim());
      }
    } else if (part.type === ContentTypes.TOOL_CALL && part.tool_call) {
      const tc = part.tool_call;
      const name = tc.name || 'unknown';
      let outputStr = '';
      if (typeof tc.output === 'string') {
        outputStr = tc.output;
      } else if (tc.output && typeof tc.output === 'object') {
        outputStr =
          typeof tc.output.content === 'string'
            ? tc.output.content
            : JSON.stringify(tc.output);
      }
      lines.push(`[调用工具 ${name}] ${outputStr || '(无输出)'}`);
    }
  }

  if (lines.length === 0) {
    return null;
  }

  const joined = lines.join('\n').trim();
  const MAX_CHARS = 1500;
  return joined.length > MAX_CHARS ? `${joined.slice(0, MAX_CHARS)}…` : joined;
}

async function getSummaryTemplate() {
  return await getSystemPromptOrSeed('agents.summary');
}

function fillSummaryTemplate(template, lastQuestion, lastMessagesText, agentOutputsText) {
  if (typeof template !== 'string') {
    return null;
  }
  return template
    .replace(/\{lastQuestion\}/g, lastQuestion || '（未能获取）')
    .replace(/\{lastMessagesText\}/g, lastMessagesText || '（暂无）')
    .replace(/\{agentOutputsText\}/g, agentOutputsText);
}

async function generateSummaryPrompt(lastQuestion, lastMessagesText, agentOutputsText) {
  const template = await getSummaryTemplate();

  if (template) {
    return fillSummaryTemplate(template, lastQuestion, lastMessagesText, agentOutputsText);
  }

  const fallbackTemplate =
    `你是OpenInsight数据分析师，请根据下列信息尽可能回答用户问题：\n\n` +
    `【用户最后一个问题】\n${lastQuestion || '（未能获取）'}\n\n` +
    `【最近七条与用户的对话消息】\n${lastMessagesText || '（暂无）'}\n\n` +
    `【已获取的分析结果】\n${agentOutputsText}\n\n` +
    `回答要求：\n` +
    `1、数据非常敏感，所以严格按照调用产生的结果信息操作，避免通知知识产生的幻觉。\n` +
    `2、用户是业务用户，不理解SQL，不理解数据库，不要沟通技术问题，要的是数据分析结果。\n` +
    `3、用户需求如果涉及到输出报告，用artifacts形式渲染展示出来。直接创建Artifacts，不要先生成网页。\n` +
    `4、禁止过渡解读，以事实数据为主，辅助数据解读，不要扮演业务专家的角色，你只是一个数据分析师。\n` +
    `5、仅总结，不要输出任何对话信息，直接输出结果。`;

  return fallbackTemplate;
}

function buildFallbackSummary({ inputContent, agentOutputsText }) {
  if (!agentOutputsText) {
    return '正在处理您的请求，当前已获取部分中间结果。如需继续分析，请再次提问。';
  }

  const sections = [];
  sections.push(agentOutputsText);
  sections.push(
    '\n以上是当前已获取的分析结果。如需继续深入分析，请再次提问。',
  );
  return sections.join('\n').trim();
}

function buildModelFallbackSummary({ inputContent, agentOutputsText }) {
  if (!inputContent || inputContent.length < 50) {
    return buildFallbackSummary({ inputContent, agentOutputsText });
  }

  const sections = [];
  sections.push(`【执行状态和结果】\n${inputContent}`);
  sections.push(
    '【对用户问题的处理】\n' +
      '仅根据当前信息，暂时无法判断是否已经充分回答您的问题。' +
      '如需继续执行智能体以获取更多步骤和信息，请回复"是"；' +
      '若希望在此停止，请回复"否"。',
  );
  return sections.join('\n\n');
}

async function summarizeOnRecursionLimit({
  run,
  agent,
  req,
  appConfig,

  conversationId,
  userId,
  signal,

  userQuestion,
  recentMessagesText,
  agentOutputsText,
  contentParts,

  messageId,
  parentMessageId,
}) {
  let endpoint = agent.endpoint;
  let clientOptions = {
    model: agent.model || agent.model_parameters?.model,
  };

  let providerConfig;
  try {
    providerConfig = getProviderConfig({ provider: endpoint, appConfig });
  } catch (err) {
    logger.warn('[summary.js #summarizeOnRecursionLimit] Failed to get provider config', err);
    return {
      summaryText: buildModelFallbackSummary({ inputContent: null, agentOutputsText }),
      summaryGenerated: false,
      collectedMetadata: [],
    };
  }

  const endpointConfig =
    appConfig.endpoints?.all ??
    appConfig.endpoints?.[endpoint] ??
    providerConfig.customEndpointConfig;

  let options;
  try {
    options = await providerConfig.getOptions({
      req,
      endpoint,
      model_parameters: clientOptions,
      db: {
        getUserKey: db.getUserKey,
        getUserKeyValues: db.getUserKeyValues,
      },
    });
  } catch (err) {
    logger.warn('[summary.js #summarizeOnRecursionLimit] Failed to get provider options', err);
    return {
      summaryText: buildModelFallbackSummary({ inputContent: null, agentOutputsText }),
      summaryGenerated: false,
      collectedMetadata: [],
    };
  }

  let provider = options.provider ?? providerConfig.overrideProvider ?? agent.provider;
  if (
    endpoint === EModelEndpoint.azureOpenAI &&
    options.llmConfig?.azureOpenAIApiInstanceName == null
  ) {
    provider = Providers.OPENAI;
  } else if (
    endpoint === EModelEndpoint.azureOpenAI &&
    options.llmConfig?.azureOpenAIApiInstanceName != null &&
    provider !== Providers.AZURE
  ) {
    provider = Providers.AZURE;
  }

  clientOptions = { ...options.llmConfig };
  if (options.configOptions) {
    clientOptions.configuration = options.configOptions;
  }
  if (clientOptions.maxTokens != null) {
    delete clientOptions.maxTokens;
  }
  if (clientOptions?.modelKwargs?.max_completion_tokens != null) {
    delete clientOptions.modelKwargs.max_completion_tokens;
  }
  if (clientOptions?.modelKwargs?.max_output_tokens != null) {
    delete clientOptions.modelKwargs.max_output_tokens;
  }

  clientOptions = Object.fromEntries(
    Object.entries(clientOptions).filter(([key]) => !omitTitleOptions.has(key)),
  );

  if (clientOptions?.configuration?.defaultHeaders != null) {
    clientOptions.configuration.defaultHeaders = resolveHeaders({
      headers: clientOptions.configuration.defaultHeaders,
      user: createSafeUser(req?.user),
      body: {
        messageId: messageId || '',
        conversationId: conversationId || '',
        parentMessageId: parentMessageId || '',
      },
    });
  }

  const sanitizedUserQuestion = sanitizeForPromptTemplate(userQuestion);
  const sanitizedRecentMessages = sanitizeForPromptTemplate(recentMessagesText);
  agentOutputsText = sanitizeForPromptTemplate(agentOutputsText);

  const infoSections = [];
  infoSections.push(
    `1）用户最后一个问题：\n${sanitizedUserQuestion || '（未能获取）'}`,
  );
  infoSections.push(
    `2）最近 7 条用户与系统/助手的对话消息（从旧到新）：\n${sanitizedRecentMessages || '（暂无）'}`,
  );
  infoSections.push(
    `3）每个智能体执行的输出结果：\n${agentOutputsText}`,
  );
  const inputContent = infoSections.join('\n\n').trim();

  const fallbackText = buildModelFallbackSummary({ inputContent, agentOutputsText });

  if (!inputContent || inputContent.length < 50) {
    return { summaryText: fallbackText, summaryGenerated: false, collectedMetadata: [] };
  }

  const { handleLLMEnd, collected: collectedMetadata } = createMetadataAggregator();

  const summaryTitlePrompt = await generateSummaryPrompt(sanitizedUserQuestion, sanitizedRecentMessages, agentOutputsText);

  let titleResult;
  try {
    titleResult = await run.generateTitle({
      provider,
      clientOptions,
      inputText: inputContent,
      contentParts: [],
      titleMethod: 'completion',
      titlePrompt: summaryTitlePrompt,
      chainOptions: {
        signal,
        callbacks: [{ handleLLMEnd }],
        configurable: {
          thread_id: conversationId,
          user_id: userId,
        },
      },
    });
  } catch (genErr) {
    logger.error(
      '[summary.js #summarizeOnRecursionLimit] Error generating summary with model',
      genErr,
    );
    return { summaryText: fallbackText, summaryGenerated: false, collectedMetadata };
  }

  const summaryText =
    titleResult && typeof titleResult.text !== 'undefined'
      ? String(titleResult.text).trim()
      : titleResult && typeof titleResult.title !== 'undefined'
        ? String(titleResult.title).trim()
        : '';

  if (!summaryText) {
    return { summaryText: fallbackText, summaryGenerated: false, collectedMetadata };
  }

  return { summaryText, summaryGenerated: true, collectedMetadata };
}

module.exports = {
  sanitizeForPromptTemplate,
  formatChunksForSummary,
  formatContentPartsForSummary,
  generateSummaryPrompt,
  buildFallbackSummary,
  buildModelFallbackSummary,
  summarizeOnRecursionLimit,
};