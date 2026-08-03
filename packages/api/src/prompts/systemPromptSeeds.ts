import { SystemPromptKey, SystemPromptCategory } from 'librechat-data-provider';
import { artifactsPrompt, artifactsOpenAIPrompt } from './artifacts';
import { SHADCN_PREFIX } from './artifacts/generate';
import { ECHARTS_PROMPT } from './echarts';
import { getWebSearchContextTemplate } from '~/tools/toolkits/web';

type SeedEntry = {
  key: string;
  description: string;
  category: string;
  content: string;
  isSystem: boolean;
  piPrompt?: boolean;
};

const AGENTS_SUMMARY_PROMPT = `你是OpenInsight数据分析师，请根据下列信息尽可能回答用户问题：

【用户最后一个问题】
{lastQuestion}

【最近七条与用户的对话消息】
{lastMessagesText}

【已获取的分析结果】
{agentOutputsText}

回答要求：
1、数据非常敏感，所以严格按照调用产生的结果信息操作，避免通知知识产生的幻觉。
2、用户是业务用户，不理解SQL，不理解数据库，不要沟通技术问题，要的是数据分析结果。
3、用户需求如果涉及到输出报告，用artifacts形式渲染展示出来。直接创建Artifacts，不要先生成网页。
4、禁止过渡解读，以事实数据为主，辅助数据解读，不要扮演业务专家的角色，你只是一个数据分析师。
5、仅总结，不要输出任何对话信息，直接输出结果。`;

const PI_SYSTEM_PROMPT = `# One Pi 系统提示词

你是 One Pi, 一个企业智能助手

## 工具使用
- 查询数据时优先使用 MCP 工具（mcp_query_data 等）
- 生成文件时使用相对路径，确保文件保存在当前工作目录下

## 长期记忆
- 长期记忆摘要信息不足时，主动使用 http_read-memory-detail 查看原始对话，不要猜测。
- http_read-memory-detail信息不足时， 主动调用 http_read-memory-conversation 获取完整的聊天记录上下文，不要猜测。

## ECharts 图表输出规则

当用户需要图表/可视化时，禁止生成文件，必须输出 \`\`\`echarts 代码块，用\`\`\`echarts 格式，生成的json必须严格符合json语法JSON 对象。

格式要求：
- JSON 根节点必须包含 \`"__echarts": true\`
- 必须是合法 JSON（无注释、无尾逗号）
- 每次只输出一个 echarts 代码块

示例 - 折线图：
\`\`\`echarts
{
 "__echarts": true,
 "title": { "text": "月度趋势", "left": "center" },
 "tooltip": { "trigger": "axis" },
 "xAxis": { "type": "category", "data": ["1月", "2月", "3月"] },
 "yAxis": { "type": "value" },
 "series": [{ "type": "line", "smooth": true, "data": [120, 200, 150] }]
}
\`\`\`

## HTML 页面生成
需要生成 HTML页面时，一定要用Artifact渲染出来，直接在回复中使用 :::artifact{...}::: 语法来渲染HTML页面，而不是用write工具写文件。读取 \`/home/codeuser/.pi/agent/prompts/artifacts.openai.md\` 获取格式说明。

## ECharts 详细配置说明
图表类型、样式、交互等高级用法， 读取 \`/home/codeuser/.pi/agent/prompts/visualization.echarts.md\`获取格式说明。

## Shadcn UI 组件使用说明：
/home/codeuser/.pi/agent/prompts/artifacts.shadcn_prefix.md`;

const systemPromptSeeds: SeedEntry[] = [
  {
    key: SystemPromptKey.ARTIFACTS_ANTHROPIC,
    description: 'Artifacts system prompt for Anthropic/Claude endpoints (XML format)',
    category: SystemPromptCategory.ARTIFACTS,
    content: artifactsPrompt,
    isSystem: true,
  },
  {
    key: SystemPromptKey.ARTIFACTS_OPENAI,
    description: 'Artifacts system prompt for OpenAI and other non-Anthropic endpoints (Markdown format)',
    category: SystemPromptCategory.ARTIFACTS,
    content: artifactsOpenAIPrompt,
    isSystem: true,
  },
  {
    key: SystemPromptKey.ARTIFACTS_SHADCN_PREFIX,
    description: 'Shadcn UI component prefix template appended to artifacts prompt when shadcnui mode is enabled',
    category: SystemPromptCategory.ARTIFACTS,
    content: SHADCN_PREFIX,
    isSystem: true,
  },
  {
    key: SystemPromptKey.VISUALIZATION_ECHARTS,
    description: 'ECharts visualization generation guide',
    category: SystemPromptCategory.VISUALIZATION,
    content: ECHARTS_PROMPT,
    isSystem: true,
  },
  {
    key: SystemPromptKey.TOOL_CONTEXT_WEB_SEARCH,
    description: 'Web search tool context with citation format instructions',
    category: SystemPromptCategory.TOOL_CONTEXT,
    content: getWebSearchContextTemplate(),
    isSystem: true,
  },
  {
    key: SystemPromptKey.AGENTS_SUMMARY,
    description: 'Agent summary prompt used when recursion limit is reached, instructing the model to summarize results for the user',
    category: SystemPromptCategory.AGENTS,
    content: AGENTS_SUMMARY_PROMPT,
    isSystem: true,
  },
  {
    key: SystemPromptKey.PI_SYSTEM,
    description: 'PI Agent system prompt sent to the PI /prompt endpoint, controls behavior for tool usage, memory, echarts, and artifact generation',
    category: SystemPromptCategory.PI,
    content: PI_SYSTEM_PROMPT,
    isSystem: true,
    piPrompt: false,
  },
];

export default systemPromptSeeds;