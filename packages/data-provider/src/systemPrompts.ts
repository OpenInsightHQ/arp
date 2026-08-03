export enum SystemPromptCategory {
  ARTIFACTS = 'artifacts',
  VISUALIZATION = 'visualization',
  TOOL_CONTEXT = 'tool_context',
  AGENTS = 'agents',
  PI = 'pi',
}

export enum SystemPromptKey {
  ARTIFACTS_ANTHROPIC = 'artifacts.anthropic',
  ARTIFACTS_OPENAI = 'artifacts.openai',
  ARTIFACTS_SHADCN_PREFIX = 'artifacts.shadcn_prefix',
  VISUALIZATION_ECHARTS = 'visualization.echarts',
  TOOL_CONTEXT_WEB_SEARCH = 'tool_context.web_search',
  AGENTS_SUMMARY = 'agents.summary',
  PI_SYSTEM = 'pi.system',
}