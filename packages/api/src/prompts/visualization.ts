import { ECHARTS_PROMPT } from './echarts';

export interface VisualizationPromptOptions {
  echartsPrompt?: boolean;
  dbPrompt?: string | null;
}

export function buildVisualizationPrompt(options: VisualizationPromptOptions): string {
  if (options.echartsPrompt === true) {
    return options.dbPrompt ?? ECHARTS_PROMPT;
  }

  return '';
}

export function appendUniquePrompt(
  existing: string | null | undefined,
  prompt: string,
): string | undefined {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return existing ?? undefined;
  }

  const current = existing ?? '';
  if (current.includes(trimmedPrompt)) {
    return current || undefined;
  }

  return current ? `${current}\n\n${trimmedPrompt}` : trimmedPrompt;
}
