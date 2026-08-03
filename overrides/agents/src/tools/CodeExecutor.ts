import { z } from 'zod';
import { config } from 'dotenv';
import fetch, { RequestInit } from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { tool, DynamicStructuredTool } from '@langchain/core/tools';
import { getEnvironmentVariable } from '@langchain/core/utils/env';
import type * as t from '@/types';
import { EnvVar, Constants } from '@/common';

config();

export const imageExtRegex = /\.(jpg|jpeg|png|gif|webp)$/i;
export const getCodeBaseURL = (): string =>
  getEnvironmentVariable(EnvVar.CODE_BASEURL) ?? Constants.OFFICIAL_CODE_BASEURL;

const imageMessage = 'Image is already displayed to the user';
const otherMessage = 'File is already downloaded by the user';
const accessMessage =
  'Note: Files are READ-ONLY. Save changes to NEW filenames. To access these files in future executions, provide the `session_id` as a parameter (not in your code).';
const emptyOutputMessage = "stdout: Empty. Ensure you're writing output explicitly.\n";

const DEFAULT_TIMEOUT_MS = 180000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

const isRetryableError = (error: Error): boolean => {
  const message = error.message.toLowerCase();
  return (
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('network error') ||
    message.includes('failed to fetch')
  );
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const createAbortControllerWithTimeout = (
  timeoutMs: number,
): {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
} => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
};

const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const { controller, timeoutId } = createAbortControllerWithTimeout(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

const CodeExecutionToolSchema = z.object({
  lang: z
    .enum(['py', 'js', 'ts', 'c', 'cpp', 'java', 'php', 'rs', 'go', 'd', 'f90', 'r'])
    .describe('The programming language or runtime to execute the code in.'),
  code: z.string()
    .describe(`The complete, self-contained code to execute, without any truncation or minimization.
- The environment is stateless; variables and imports don't persist between executions.
- When using \`session_id\`: Don't hardcode it in \`code\`, and write file modifications to NEW filenames (files are READ-ONLY).
- Input code **IS ALREADY** displayed to the user, so **DO NOT** repeat it in your response unless asked.
- Output code **IS NOT** displayed to the user, so **DO** write all desired output explicitly.
- IMPORTANT: You MUST explicitly print/output ALL results you want the user to see.
- py: This is not a Jupyter notebook environment. Use \`print()\` for all outputs.
- py: Matplotlib: Use \`plt.savefig()\` to save plots as files.
- js: use the \`console\` or \`process\` methods for all outputs.
- r: IMPORTANT: No X11 display available. ALL graphics MUST use Cairo library (library(Cairo)).
- Other languages: use appropriate output functions.`),
  session_id: z
    .string()
    .optional()
    .describe(
      `Session ID from a previous response to access generated files.
- Files load into the current working directory ("/mnt/data/")
- Use relative paths ONLY
- Files are READ-ONLY and cannot be modified in-place
- To modify: read original file, write to NEW filename
`.trim(),
    ),
  args: z
    .array(z.string())
    .optional()
    .describe(
      'Additional arguments to execute the code with. This should only be used if the input code requires additional arguments to run.',
    ),
});

const baseEndpoint = getCodeBaseURL();
const EXEC_ENDPOINT = `${baseEndpoint}/exec`;

function createCodeExecutionTool(
  params: t.CodeExecutionToolParams = {},
): DynamicStructuredTool<typeof CodeExecutionToolSchema> {
  const apiKey =
    params[EnvVar.CODE_API_KEY] ??
    params.apiKey ??
    getEnvironmentVariable(EnvVar.CODE_API_KEY) ??
    '';
  if (!apiKey) {
    throw new Error('No API key provided for code execution tool.');
  }

  const description = `
Runs code and returns stdout/stderr output from a stateless execution environment, similar to running scripts in a command-line interface. Each execution is isolated and independent.

Usage:
- Always include lang (required). Choose one of: py, js, ts, c, cpp, java, php, rs, go, d, f90, r.
- Always include code (required) as a complete, self-contained program.
- Network access is available (WAN enabled); use it only when needed and follow user instructions.
- MASSIVE_API_KEY is available for finance data; use it with the massive SDK or HTTPS requests when needed.
- Massive API base URL is https://api.massive.com (do not use api.massiveapi.com).
- The environment is stateless and isolated per execution.
- To provide files to the user: save to "/mnt/data/<filename>" and ensure the file exists. The UI will show a "Generated files" list; reference that list and do not fabricate download links.
- NEVER use this tool to execute malicious code.
`.trim();

  return tool<typeof CodeExecutionToolSchema>(
    async ({ lang, code, session_id, ...rest }) => {
      const postData = {
        lang,
        code,
        ...rest,
        ...params,
      };

      if (session_id != null && session_id.length > 0) {
        try {
          const filesEndpoint = `${baseEndpoint}/files/${session_id}?detail=full`;
          const fetchOptions: RequestInit = {
            method: 'GET',
            headers: {
              'User-Agent': 'LibreChat/1.0',
              'X-API-Key': apiKey,
            },
          };

          if (process.env.PROXY != null && process.env.PROXY !== '') {
            fetchOptions.agent = new HttpsProxyAgent(process.env.PROXY);
          }

          const response = await fetch(filesEndpoint, fetchOptions);
          if (!response.ok) {
            throw new Error(`Failed to fetch files for session: ${response.status}`);
          }

          const files = await response.json();
          if (Array.isArray(files) && files.length > 0) {
            const fileReferences: t.CodeEnvFile[] = files.map((file) => {
              // Extract the ID from the file name (part after session ID prefix and before extension)
              const nameParts = file.name.split('/');
              const id = nameParts.length > 1 ? nameParts[1].split('.')[0] : '';

              return {
                session_id,
                id,
                name: file.metadata['original-filename'],
              };
            });

            if (!postData.files) {
              postData.files = fileReferences;
            } else if (Array.isArray(postData.files)) {
              postData.files = [...postData.files, ...fileReferences];
            }
          }
        } catch {
          // eslint-disable-next-line no-console
          console.warn(`Failed to fetch files for session: ${session_id}`);
        }
      }

      const executeWithRetry = async (): Promise<{
        result: t.ExecuteResult;
        attempts: number;
      }> => {
        const fetchOptions: RequestInit = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'LibreChat/1.0',
            'X-API-Key': apiKey,
          },
          body: JSON.stringify(postData),
        };

        if (process.env.PROXY != null && process.env.PROXY !== '') {
          fetchOptions.agent = new HttpsProxyAgent(process.env.PROXY);
        }

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const response = await fetchWithTimeout(
              EXEC_ENDPOINT,
              fetchOptions,
              DEFAULT_TIMEOUT_MS,
            );

            if (!response.ok) {
              const errorText = await response.text().catch(() => '');
              throw new Error(
                `HTTP error! status: ${response.status}${errorText ? ` - ${errorText}` : ''}`,
              );
            }

            const result: t.ExecuteResult = await response.json();
            return { result, attempts: attempt + 1 };
          } catch (error) {
            lastError = error as Error;

            if (attempt < MAX_RETRIES && isRetryableError(lastError)) {
              // eslint-disable-next-line no-console
              console.warn(
                `[CodeExecutor] Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${lastError.message}. Retrying...`,
              );
              await sleep(RETRY_DELAY_MS * (attempt + 1));
              continue;
            }

            throw lastError;
          }
        }

        throw lastError || new Error('Unknown error during code execution');
      };

      try {
        const { result, attempts } = await executeWithRetry();

        if (attempts > 1) {
          // eslint-disable-next-line no-console
          console.warn(`[CodeExecutor] Request succeeded on attempt ${attempts}`);
        }

        let formattedOutput = '';
        if (result.stdout) {
          formattedOutput += `stdout:\n${result.stdout}\n`;
        } else {
          formattedOutput += emptyOutputMessage;
        }
        if (result.stderr) formattedOutput += `stderr:\n${result.stderr}\n`;
        if (result.files && result.files.length > 0) {
          formattedOutput += 'Generated files:\n';

          const fileCount = result.files.length;
          for (let i = 0; i < fileCount; i++) {
            const file = result.files[i];
            const isImage = imageExtRegex.test(file.name);
            formattedOutput += `- /mnt/data/${file.name} | ${isImage ? imageMessage : otherMessage}`;

            if (i < fileCount - 1) {
              formattedOutput += fileCount <= 3 ? ', ' : ',\n';
            }
          }

          formattedOutput += `\nsession_id: ${result.session_id}\n\n${accessMessage}`;
          return [
            formattedOutput.trim(),
            {
              session_id: result.session_id,
              files: result.files,
            },
          ];
        }

        return [formattedOutput.trim(), { session_id: result.session_id }];
      } catch (error) {
        const errorMessage = (error as Error | undefined)?.message || 'Unknown error';
        throw new Error(`Execution error:\n\n${errorMessage}`);
      }
    },
    {
      name: Constants.EXECUTE_CODE,
      description,
      schema: CodeExecutionToolSchema,
      responseFormat: Constants.CONTENT_AND_ARTIFACT,
    },
  );
}

export { createCodeExecutionTool };
