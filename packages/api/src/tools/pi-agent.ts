/**
 * @fileoverview PI Agent tool registry for LibreChat integration
 * Provides tool definitions for calling PI Agent's /prompt endpoint
 */

import type { LCToolRegistry, JsonSchemaType } from '@librechat/agents';
import type { ToolRegistryDefinition } from './registry/definitions';

const PI_HOST = process.env.PI_HOST || process.env.PI_AGENT_URL || 'http://localhost:3000';

export interface PIExecuteCodeParams {
  lang: string;
  code: string;
  session_id?: string;
}

export interface PIGenerateDocumentParams {
  format: 'docx' | 'xlsx' | 'pptx';
  content: string;
  filename?: string;
}

export interface PIGenerateArtifactParams {
  type: 'react' | 'vue' | 'html' | 'svg';
  code: string;
  title?: string;
}

export const executeCodeSchema: JsonSchemaType = {
  type: 'object',
  properties: {
    lang: {
      type: 'string',
      enum: ['py', 'js', 'ts', 'c', 'cpp', 'java', 'php', 'rs', 'go', 'd', 'f90', 'r'],
      description: 'Programming language to execute',
    },
    code: {
      type: 'string',
      description: 'Code to execute',
    },
    session_id: {
      type: 'string',
      description: 'Session ID from previous execution for file access',
    },
  },
  required: ['lang', 'code'],
};

export const generateDocumentSchema: JsonSchemaType = {
  type: 'object',
  properties: {
    format: {
      type: 'string',
      enum: ['docx', 'xlsx', 'pptx'],
      description: 'Document format',
    },
    content: {
      type: 'string',
      description: 'JSON string describing document content',
    },
    filename: {
      type: 'string',
      description: 'Optional filename',
    },
  },
  required: ['format', 'content'],
};

export const generateArtifactSchema: JsonSchemaType = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['react', 'vue', 'html', 'svg'],
      description: 'Artifact type',
    },
    code: {
      type: 'string',
      description: 'Component code',
    },
    title: {
      type: 'string',
      description: 'Optional display title',
    },
  },
  required: ['type', 'code'],
};

export interface PIAgentToolResult {
  content: string;
  files?: Array<{
    name: string;
    path: string;
    type: string;
    mimeType: string;
    size: number;
  }>;
  artifacts?: Array<{
    type: string;
    title: string;
    content: string;
    language?: string;
  }>;
}

export interface PIStreamResponse {
  sessionId?: string;
  agentId?: string;
  cwd?: string;
  newSession?: boolean;
  content?: string;
  error?: string;
  message?: string;
}

function parsePIErrorResponse(status: number, responseText: string): { errorMessage: string } {
  let errorMessage = responseText;
  try {
    const parsed = JSON.parse(responseText);
    if (parsed.error) {
      errorMessage = parsed.error;
    } else if (parsed.message) {
      errorMessage = parsed.message;
    }
  } catch {
    // Use the raw text if not JSON
  }
  return { errorMessage };
}

export async function executePIAgentTool(
  toolName: string,
  params: PIExecuteCodeParams | PIGenerateDocumentParams | PIGenerateArtifactParams,
  options?: { stream?: boolean },
): Promise<PIAgentToolResult> {
  let message = '';

  switch (toolName) {
    case 'execute_code': {
      const p = params as PIExecuteCodeParams;
      message = `Execute the following ${p.lang} code:\n\`\`\`${p.lang}\n${p.code}\n\`\`\``;
      break;
    }
    case 'generate_document': {
      const p = params as PIGenerateDocumentParams;
      message = `Generate a ${p.format.toUpperCase()} document with the following content:\n${p.content}`;
      break;
    }
    case 'generate_artifact': {
      const p = params as PIGenerateArtifactParams;
      message = `Generate a ${p.type} artifact:\n${p.code}`;
      break;
    }
    default:
      throw new Error(`Unknown PI tool: ${toolName}`);
  }

  const response = await fetch(`${PI_HOST}/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.PI_API_KEY || '',
      Accept: options?.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify({
      message,
      toolMode:
        toolName === 'execute_code'
          ? 'execute_code'
          : toolName === 'generate_document'
            ? 'generate_document'
            : 'generate_artifact',
      sessionId: (params as PIExecuteCodeParams).session_id,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    const { errorMessage } = parsePIErrorResponse(response.status, error);
    throw new Error(`PI Agent error ${response.status}: ${errorMessage}`);
  }

  if (options?.stream) {
    return handleStreamingResponse(response);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error);
  }
  if (result.message) {
    throw new Error(result.message);
  }
  return result;
}

async function handleStreamingResponse(response: Response): Promise<PIAgentToolResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let sessionId: string | undefined;
  let agentId: string | undefined;
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('event:') && !trimmed.startsWith('data:')) continue;

      const eventMatch = trimmed.match(/^event: (\w+)/);
      const dataMatch = trimmed.match(/^data: (.+)/);

      if (eventMatch && dataMatch) {
        const eventType = eventMatch[1];
        const dataStr = dataMatch[1];

        try {
          const data = JSON.parse(dataStr) as PIStreamResponse;

          if (eventType === 'session') {
            sessionId = data.sessionId;
            agentId = data.agentId;
          } else if (eventType === 'error') {
            const errorMessage = data.message ?? data.error;
            if (errorMessage) {
              throw new Error(errorMessage);
            }
          } else if (eventType === 'message' || eventType === 'content') {
            content += data.content ?? '';
          }
        } catch {
          // Ignore parse errors for incomplete chunks
        }
      }
    }
  }

  return { content };
}

export async function downloadPIFile(sessionId: string, filename: string): Promise<Blob> {
  const url = `${PI_HOST}/files/download?sessionId=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(filename)}`;
  const response = await fetch(url, {
    headers: {
      'X-API-Key': process.env.PI_API_KEY || '',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  return response.blob();
}

export const piToolRegistry: LCToolRegistry = new Map([
  [
    'execute_code',
    {
      name: 'execute_code',
      description: 'Execute code via PI Agent. Returns stdout/stderr output and generated files.',
      parameters: executeCodeSchema,
      allowed_callers: ['direct'],
    },
  ],
  [
    'generate_document',
    {
      name: 'generate_document',
      description: 'Generate Word, Excel, or PowerPoint documents via PI Agent.',
      parameters: generateDocumentSchema,
      allowed_callers: ['direct'],
    },
  ],
  [
    'generate_artifact',
    {
      name: 'generate_artifact',
      description: 'Generate React/Vue/HTML/SVG artifacts for interactive UI components.',
      parameters: generateArtifactSchema,
      allowed_callers: ['direct'],
    },
  ],
]);

export function getPIToolDefinitions(): ToolRegistryDefinition[] {
  return [
    {
      name: 'execute_code',
      description: 'Execute code and return output via PI Agent',
      schema: executeCodeSchema as ToolRegistryDefinition['schema'],
      toolType: 'custom',
    },
    {
      name: 'generate_document',
      description: 'Generate Word, Excel, or PowerPoint documents',
      schema: generateDocumentSchema as ToolRegistryDefinition['schema'],
      toolType: 'custom',
    },
    {
      name: 'generate_artifact',
      description: 'Generate React/Vue/HTML/SVG artifacts',
      schema: generateArtifactSchema as ToolRegistryDefinition['schema'],
      toolType: 'custom',
    },
  ];
}
