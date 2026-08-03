'use strict';

var dotenv = require('dotenv');
var fetch = require('node-fetch');
var httpsProxyAgent = require('https-proxy-agent');
var tools = require('@langchain/core/tools');
var env = require('@langchain/core/utils/env');
var _enum = require('../common/enum.cjs');

dotenv.config();
const imageExtRegex = /\.(jpg|jpeg|png|gif|webp)$/i;
const getCodeBaseURL = () => env.getEnvironmentVariable(_enum.EnvVar.CODE_BASEURL) ??
    _enum.Constants.OFFICIAL_CODE_BASEURL;
const imageMessage = 'Image is already displayed to the user';
const otherMessage = 'File is already downloaded by the user';
const accessMessage = 'Note: Files from previous executions are automatically available and can be modified.';
const emptyOutputMessage = 'stdout: Empty. Ensure you\'re writing output explicitly.\n';

const DEFAULT_TIMEOUT_MS = 180000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

const isRetryableError = (error) => {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createAbortControllerWithTimeout = (timeoutMs) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return { controller, timeoutId };
};

const fetchWithTimeout = async (url, options, timeoutMs) => {
    const { controller, timeoutId } = createAbortControllerWithTimeout(timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    }
    finally {
        clearTimeout(timeoutId);
    }
};
const SUPPORTED_LANGUAGES = [
    'py',
    'js',
    'ts',
    'c',
    'cpp',
    'java',
    'php',
    'rs',
    'go',
    'd',
    'f90',
    'r',
    'bash',
];
const CodeExecutionToolSchema = {
    type: 'object',
    properties: {
        lang: {
            type: 'string',
            enum: SUPPORTED_LANGUAGES,
            description: 'The programming language or runtime to execute the code in.',
        },
        code: {
            type: 'string',
            description: `The complete, self-contained code to execute, without any truncation or minimization.
- The environment is stateless; variables and imports don't persist between executions.
- Generated files from previous executions are automatically available in "/mnt/data/".
- Files from previous executions are automatically available and can be modified in place.
- Input code **IS ALREADY** displayed to the user, so **DO NOT** repeat it in your response unless asked.
- Output code **IS NOT** displayed to the user, so **DO** write all desired output explicitly.
- IMPORTANT: You MUST explicitly print/output ALL results you want the user to see.
- py: This is not a Jupyter notebook environment. Use \`print()\` for all outputs.
- py: Matplotlib: Use \`plt.savefig()\` to save plots as files.
- js: use the \`console\` or \`process\` methods for all outputs.
- r: IMPORTANT: No X11 display available. ALL graphics MUST use Cairo library (library(Cairo)).
- Other languages: use appropriate output functions.`,
        },
        args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional arguments to execute the code with. This should only be used if the input code requires additional arguments to run.',
        },
    },
    required: ['lang', 'code'],
};
const baseEndpoint = getCodeBaseURL();
const EXEC_ENDPOINT = `${baseEndpoint}/exec`;
const CodeExecutionToolDescription = `
Runs code and returns stdout/stderr output from a stateless execution environment, similar to running scripts in a command-line interface. Each execution is isolated and independent.

Usage:
- No network access available.
- Generated files are automatically delivered; **DO NOT** provide download links.
- NEVER use this tool to execute malicious code.
`.trim();
const CodeExecutionToolName = _enum.Constants.EXECUTE_CODE;
const CodeExecutionToolDefinition = {
    name: CodeExecutionToolName,
    description: CodeExecutionToolDescription,
    schema: CodeExecutionToolSchema,
};
function createCodeExecutionTool(params = {}) {
    const apiKey = params[_enum.EnvVar.CODE_API_KEY] ??
        params.apiKey ??
        env.getEnvironmentVariable(_enum.EnvVar.CODE_API_KEY) ??
        '';
    if (!apiKey) {
        throw new Error('No API key provided for code execution tool.');
    }
    return tools.tool(async (rawInput, config) => {
        const { lang, code, ...rest } = rawInput;
        /**
         * Extract session context from config.toolCall (injected by ToolNode).
         * - session_id: For API to associate with previous session
         * - _injected_files: File refs to pass directly (avoids /files endpoint race condition)
         */
        const { session_id, _injected_files } = (config.toolCall ?? {});
        const postData = {
            lang,
            code,
            ...rest,
            ...params,
        };
        /**
         * File injection priority:
         * 1. Use _injected_files from ToolNode (avoids /files endpoint race condition)
         * 2. Fall back to fetching from /files endpoint if session_id provided but no injected files
         */
        if (_injected_files && _injected_files.length > 0) {
            postData.files = _injected_files;
        }
        else if (session_id != null && session_id.length > 0) {
            /** Fallback: fetch from /files endpoint (may have race condition issues) */
            try {
                const filesEndpoint = `${baseEndpoint}/files/${session_id}?detail=full`;
                const fetchOptions = {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'LibreChat/1.0',
                        'X-API-Key': apiKey,
                    },
                };
                if (process.env.PROXY != null && process.env.PROXY !== '') {
                    fetchOptions.agent = new httpsProxyAgent.HttpsProxyAgent(process.env.PROXY);
                }
                const response = await fetch(filesEndpoint, fetchOptions);
                if (!response.ok) {
                    throw new Error(`Failed to fetch files for session: ${response.status}`);
                }
                const files = await response.json();
                if (Array.isArray(files) && files.length > 0) {
                    const fileReferences = files.map((file) => {
                        const nameParts = file.name.split('/');
                        const id = nameParts.length > 1 ? nameParts[1].split('.')[0] : '';
                        return {
                            session_id,
                            id,
                            name: file.metadata['original-filename'],
                        };
                    });
                    postData.files = fileReferences;
                }
            }
            catch {
                // eslint-disable-next-line no-console
                console.warn(`Failed to fetch files for session: ${session_id}`);
            }
        }
        const executeWithRetry = async () => {
            const fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'LibreChat/1.0',
                    'X-API-Key': apiKey,
                },
                body: JSON.stringify(postData),
            };
            if (process.env.PROXY != null && process.env.PROXY !== '') {
                fetchOptions.agent = new httpsProxyAgent.HttpsProxyAgent(process.env.PROXY);
            }
            let lastError = null;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const response = await fetchWithTimeout(EXEC_ENDPOINT, fetchOptions, DEFAULT_TIMEOUT_MS);
                    if (!response.ok) {
                        const errorText = await response.text().catch(() => '');
                        throw new Error(`HTTP error! status: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
                    }
                    const result = await response.json();
                    return result;
                }
                catch (error) {
                    lastError = error;
                    if (attempt < MAX_RETRIES && isRetryableError(error)) {
                        console.warn(`[CodeExecutor] Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error.message}. Retrying...`);
                        await sleep(RETRY_DELAY_MS * (attempt + 1));
                        continue;
                    }
                    throw error;
                }
            }
            throw lastError || new Error('Unknown error during code execution');
        };

        try {
            const result = await executeWithRetry();
            let formattedOutput = '';
            if (result.stdout) {
                formattedOutput += `stdout:\n${result.stdout}\n`;
            }
            else {
                formattedOutput += emptyOutputMessage;
            }
            if (result.stderr)
                formattedOutput += `stderr:\n${result.stderr}\n`;
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
                formattedOutput += `\n\n${accessMessage}`;
                return [
                    formattedOutput.trim(),
                    {
                        session_id: result.session_id,
                        files: result.files,
                    },
                ];
            }
            return [formattedOutput.trim(), { session_id: result.session_id }];
        }
        catch (error) {
            throw new Error(`Execution error:\n\n${error?.message}`);
        }
    }, {
        name: CodeExecutionToolName,
        description: CodeExecutionToolDescription,
        schema: CodeExecutionToolSchema,
        responseFormat: _enum.Constants.CONTENT_AND_ARTIFACT,
    });
}

exports.CodeExecutionToolDefinition = CodeExecutionToolDefinition;
exports.CodeExecutionToolDescription = CodeExecutionToolDescription;
exports.CodeExecutionToolName = CodeExecutionToolName;
exports.CodeExecutionToolSchema = CodeExecutionToolSchema;
exports.createCodeExecutionTool = createCodeExecutionTool;
exports.getCodeBaseURL = getCodeBaseURL;
exports.imageExtRegex = imageExtRegex;
//# sourceMappingURL=CodeExecutor.cjs.map
