'use strict';

var openai$1 = require('openai');
var xai = require('@langchain/xai');
var outputs = require('@langchain/core/outputs');
var messages = require('@langchain/core/messages');
require('@langchain/core/utils/function_calling');
var deepseek = require('@langchain/deepseek');
var openai = require('@langchain/openai');
var index = require('./utils/index.cjs');
require('../../common/enum.cjs');
require('nanoid');
require('../../messages/core.cjs');
var run = require('../../utils/run.cjs');
require('js-tiktoken/lite');
require('zod-to-json-schema');

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const iife = (fn) => fn();
function isHeaders(headers) {
    return (typeof Headers !== 'undefined' &&
        headers !== null &&
        typeof headers === 'object' &&
        Object.prototype.toString.call(headers) === '[object Headers]');
}
function normalizeHeaders(headers) {
    const output = iife(() => {
        // If headers is a Headers instance
        if (isHeaders(headers)) {
            return headers;
        }
        // If headers is an array of [key, value] pairs
        else if (Array.isArray(headers)) {
            return new Headers(headers);
        }
        // If headers is a NullableHeaders-like object (has 'values' property that is a Headers)
        else if (typeof headers === 'object' &&
            headers !== null &&
            'values' in headers &&
            isHeaders(headers.values)) {
            return headers.values;
        }
        // If headers is a plain object
        else if (typeof headers === 'object' && headers !== null) {
            const entries = Object.entries(headers)
                .filter(([, v]) => typeof v === 'string')
                .map(([k, v]) => [k, v]);
            return new Headers(entries);
        }
        return new Headers();
    });
    return Object.fromEntries(output.entries());
}
function createAbortHandler(controller) {
    return function () {
        controller.abort();
    };
}
class CustomOpenAIClient extends openai.OpenAIClient {
    abortHandler;
    async fetchWithTimeout(url, init, ms, controller) {
        const { signal, ...options } = init || {};
        const handler = createAbortHandler(controller);
        this.abortHandler = handler;
        if (signal)
            signal.addEventListener('abort', handler, { once: true });
        const timeout = setTimeout(() => handler, ms);
        const fetchOptions = {
            signal: controller.signal,
            ...options,
        };
        if (fetchOptions.method != null) {
            // Custom methods like 'patch' need to be uppercased
            // See https://github.com/nodejs/undici/issues/2294
            fetchOptions.method = fetchOptions.method.toUpperCase();
        }
        return (
        // use undefined this binding; fetch errors if bound to something else in browser/cloudflare
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        /** @ts-ignore */
        this.fetch.call(undefined, url, fetchOptions).finally(() => {
            clearTimeout(timeout);
        }));
    }
}
class CustomAzureOpenAIClient extends openai$1.AzureOpenAI {
    abortHandler;
    async fetchWithTimeout(url, init, ms, controller) {
        const { signal, ...options } = init || {};
        const handler = createAbortHandler(controller);
        this.abortHandler = handler;
        if (signal)
            signal.addEventListener('abort', handler, { once: true });
        const timeout = setTimeout(() => handler, ms);
        const fetchOptions = {
            signal: controller.signal,
            ...options,
        };
        if (fetchOptions.method != null) {
            // Custom methods like 'patch' need to be uppercased
            // See https://github.com/nodejs/undici/issues/2294
            fetchOptions.method = fetchOptions.method.toUpperCase();
        }
        return (
        // use undefined this binding; fetch errors if bound to something else in browser/cloudflare
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        /** @ts-ignore */
        this.fetch.call(undefined, url, fetchOptions).finally(() => {
            clearTimeout(timeout);
        }));
    }
}
/** @ts-expect-error We are intentionally overriding `getReasoningParams` */
class ChatOpenAI extends openai.ChatOpenAI {
    _lc_stream_delay;
    constructor(fields) {
        super(fields);
        this._lc_stream_delay = fields?._lc_stream_delay;
    }
    get exposedClient() {
        return this.client;
    }
    static lc_name() {
        return 'LibreChatOpenAI';
    }
    _getClientOptions(options) {
        if (!this.client) {
            const openAIEndpointConfig = {
                baseURL: this.clientConfig.baseURL,
            };
            const endpoint = openai.getEndpoint(openAIEndpointConfig);
            const params = {
                ...this.clientConfig,
                baseURL: endpoint,
                timeout: this.timeout,
                maxRetries: 0,
            };
            if (params.baseURL == null) {
                delete params.baseURL;
            }
            this.client = new CustomOpenAIClient(params);
        }
        const requestOptions = {
            ...this.clientConfig,
            ...options,
        };
        return requestOptions;
    }
    /**
     * Returns backwards compatible reasoning parameters from constructor params and call options
     * @internal
     */
    getReasoningParams(options) {
        // apply options in reverse order of importance -- newer options supersede older options
        let reasoning;
        if (this.reasoning !== undefined) {
            reasoning = {
                ...reasoning,
                ...this.reasoning,
            };
        }
        if (options?.reasoning !== undefined) {
            reasoning = {
                ...reasoning,
                ...options.reasoning,
            };
        }
        return reasoning;
    }
    _getReasoningParams(options) {
        return this.getReasoningParams(options);
    }
    async *_streamResponseChunks(messages, options, runManager) {
        if (!this._useResponseApi(options)) {
            return yield* this._streamResponseChunks2(messages, options, runManager);
        }
        const streamIterable = await this.responseApiWithRetry({
            ...this.invocationParams(options, { streaming: true }),
            input: index._convertMessagesToOpenAIResponsesParams(messages, this.model, this.zdrEnabled),
            stream: true,
        }, options);
        for await (const data of streamIterable) {
            const chunk = index._convertOpenAIResponsesDeltaToBaseMessageChunk(data);
            if (chunk == null)
                continue;
            yield chunk;
            if (this._lc_stream_delay != null) {
                await run.sleep(this._lc_stream_delay);
            }
            await runManager?.handleLLMNewToken(chunk.text || '', undefined, undefined, undefined, undefined, { chunk });
        }
        return;
    }
    async *_streamResponseChunks2(messages$1, options, runManager) {
        const messagesMapped = index._convertMessagesToOpenAIParams(messages$1, this.model);
        const params = {
            ...this.invocationParams(options, {
                streaming: true,
            }),
            messages: messagesMapped,
            stream: true,
            stream_options: { include_usage: true },
        };
        let defaultRole;
        const streamIterable = await this.completionWithRetry(params, options);
        let usage;
        for await (const data of streamIterable) {
            const choice = data.choices[0];
            if (data.usage) {
                usage = data.usage;
                if (!global.__lcUsage) global.__lcUsage = [];
                global.__lcUsage.push({ input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens });
            }
            if (!choice) {
                continue;
            }
            const { delta } = choice;
            if (!delta) {
                continue;
            }
            const chunk = this._convertOpenAIDeltaToBaseMessageChunk(delta, data, defaultRole);
            if ('reasoning_content' in delta) {
                chunk.additional_kwargs.reasoning_content = delta.reasoning_content;
            }
            else if ('reasoning' in delta) {
                chunk.additional_kwargs.reasoning_content = delta.reasoning;
            }
            if ('provider_specific_fields' in delta) {
                chunk.additional_kwargs.provider_specific_fields =
                    delta.provider_specific_fields;
            }
            defaultRole = delta.role ?? defaultRole;
            const newTokenIndices = {
                prompt: options.promptIndex ?? 0,
                completion: choice.index ?? 0,
            };
            if (typeof chunk.content !== 'string') {
                // eslint-disable-next-line no-console
                console.log('[WARNING]: Received non-string content from OpenAI. This is currently not supported.');
                continue;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const generationInfo = { ...newTokenIndices };
            if (choice.finish_reason != null) {
                generationInfo.finish_reason = choice.finish_reason;
                // Only include system fingerprint in the last chunk for now
                // to avoid concatenation issues
                generationInfo.system_fingerprint = data.system_fingerprint;
                generationInfo.model_name = data.model;
                generationInfo.service_tier = data.service_tier;
            }
            if (this.logprobs == true) {
                generationInfo.logprobs = choice.logprobs;
            }
            const generationChunk = new outputs.ChatGenerationChunk({
                message: chunk,
                text: chunk.content,
                generationInfo,
            });
            yield generationChunk;
            if (this._lc_stream_delay != null) {
                await run.sleep(this._lc_stream_delay);
            }
            await runManager?.handleLLMNewToken(generationChunk.text || '', newTokenIndices, undefined, undefined, undefined, { chunk: generationChunk });
        }
        if (usage) {
            const inputTokenDetails = {
                ...(usage.prompt_tokens_details?.audio_tokens != null && {
                    audio: usage.prompt_tokens_details.audio_tokens,
                }),
                ...(usage.prompt_tokens_details?.cached_tokens != null && {
                    cache_read: usage.prompt_tokens_details.cached_tokens,
                }),
            };
            const outputTokenDetails = {
                ...(usage.completion_tokens_details?.audio_tokens != null && {
                    audio: usage.completion_tokens_details.audio_tokens,
                }),
                ...(usage.completion_tokens_details?.reasoning_tokens != null && {
                    reasoning: usage.completion_tokens_details.reasoning_tokens,
                }),
            };
            const generationChunk = new outputs.ChatGenerationChunk({
                message: new messages.AIMessageChunk({
                    content: '',
                    response_metadata: {
                        usage: { ...usage },
                    },
                    usage_metadata: {
                        input_tokens: usage.prompt_tokens,
                        output_tokens: usage.completion_tokens,
                        total_tokens: usage.total_tokens,
                        ...(Object.keys(inputTokenDetails).length > 0 && {
                            input_token_details: inputTokenDetails,
                        }),
                        ...(Object.keys(outputTokenDetails).length > 0 && {
                            output_token_details: outputTokenDetails,
                        }),
                    },
                }),
                text: '',
            });
            yield generationChunk;
            if (this._lc_stream_delay != null) {
                await run.sleep(this._lc_stream_delay);
            }
        }
        if (options.signal?.aborted === true) {
            throw new Error('AbortError');
        }
    }
}
/** @ts-expect-error We are intentionally overriding `getReasoningParams` */
class AzureChatOpenAI extends openai.AzureChatOpenAI {
    _lc_stream_delay;
    constructor(fields) {
        super(fields);
        this._lc_stream_delay = fields?._lc_stream_delay;
    }
    get exposedClient() {
        return this.client;
    }
    static lc_name() {
        return 'LibreChatAzureOpenAI';
    }
    /**
     * Returns backwards compatible reasoning parameters from constructor params and call options
     * @internal
     */
    getReasoningParams(options) {
        if (!index.isReasoningModel(this.model)) {
            return;
        }
        // apply options in reverse order of importance -- newer options supersede older options
        let reasoning;
        if (this.reasoning !== undefined) {
            reasoning = {
                ...reasoning,
                ...this.reasoning,
            };
        }
        if (options?.reasoning !== undefined) {
            reasoning = {
                ...reasoning,
                ...options.reasoning,
            };
        }
        return reasoning;
    }
    _getReasoningParams(options) {
        return this.getReasoningParams(options);
    }
    _getClientOptions(options) {
        if (!this.client) {
            const openAIEndpointConfig = {
                azureOpenAIApiDeploymentName: this.azureOpenAIApiDeploymentName,
                azureOpenAIApiInstanceName: this.azureOpenAIApiInstanceName,
                azureOpenAIApiKey: this.azureOpenAIApiKey,
                azureOpenAIBasePath: this.azureOpenAIBasePath,
                azureADTokenProvider: this.azureADTokenProvider,
                baseURL: this.clientConfig.baseURL,
            };
            const endpoint = openai.getEndpoint(openAIEndpointConfig);
            const params = {
                ...this.clientConfig,
                baseURL: endpoint,
                timeout: this.timeout,
                maxRetries: 0,
            };
            if (!this.azureADTokenProvider) {
                params.apiKey = openAIEndpointConfig.azureOpenAIApiKey;
            }
            if (params.baseURL == null) {
                delete params.baseURL;
            }
            const defaultHeaders = normalizeHeaders(params.defaultHeaders);
            params.defaultHeaders = {
                ...params.defaultHeaders,
                'User-Agent': defaultHeaders['User-Agent'] != null
                    ? `${defaultHeaders['User-Agent']}: librechat-azure-openai-v2`
                    : 'librechat-azure-openai-v2',
            };
            this.client = new CustomAzureOpenAIClient({
                apiVersion: this.azureOpenAIApiVersion,
                azureADTokenProvider: this.azureADTokenProvider,
                ...params,
            });
        }
        const requestOptions = {
            ...this.clientConfig,
            ...options,
        };
        if (this.azureOpenAIApiKey != null) {
            requestOptions.headers = {
                'api-key': this.azureOpenAIApiKey,
                ...requestOptions.headers,
            };
            requestOptions.query = {
                'api-version': this.azureOpenAIApiVersion,
                ...requestOptions.query,
            };
        }
        return requestOptions;
    }
    async *_streamResponseChunks(messages, options, runManager) {
        if (!this._useResponseApi(options)) {
            return yield* super._streamResponseChunks(messages, options, runManager);
        }
        const streamIterable = await this.responseApiWithRetry({
            ...this.invocationParams(options, { streaming: true }),
            input: index._convertMessagesToOpenAIResponsesParams(messages, this.model, this.zdrEnabled),
            stream: true,
        }, options);
        for await (const data of streamIterable) {
            const chunk = index._convertOpenAIResponsesDeltaToBaseMessageChunk(data);
            if (chunk == null)
                continue;
            yield chunk;
            if (this._lc_stream_delay != null) {
                await run.sleep(this._lc_stream_delay);
            }
            await runManager?.handleLLMNewToken(chunk.text || '', undefined, undefined, undefined, undefined, { chunk });
        }
        return;
    }
}
class ChatDeepSeek extends deepseek.ChatDeepSeek {
    get exposedClient() {
        return this.client;
    }
    static lc_name() {
        return 'LibreChatDeepSeek';
    }
    _convertMessages(messages) {
        return index._convertMessagesToOpenAIParams(messages, this.model, {
            includeReasoningContent: true,
        });
    }
    async _generate(messages, options, runManager) {
        const params = this.invocationParams(options);
        if (params.stream === true) {
            return super._generate(messages, options ?? {}, runManager);
        }
        const messagesMapped = this._convertMessages(messages);
        const data = await this.completionWithRetry({
            ...params,
            stream: false,
            messages: messagesMapped,
        }, {
            signal: options?.signal,
            ...options?.options,
        });
        const { completion_tokens, prompt_tokens, total_tokens } = data.usage ?? {};
        const generations = [];
        for (const part of data.choices ?? []) {
            const text = part.message.content ?? '';
            const generation = {
                text: typeof text === 'string' ? text : '',
                message: this._convertResponseToMessage(part, data),
            };
            generation.generationInfo = {
                ...(part.finish_reason != null
                    ? { finish_reason: part.finish_reason }
                    : {}),
                ...(part.logprobs ? { logprobs: part.logprobs } : {}),
            };
            generations.push(generation);
        }
        return {
            generations,
            llmOutput: {
                tokenUsage: {
                    completionTokens: completion_tokens,
                    promptTokens: prompt_tokens,
                    totalTokens: total_tokens,
                },
            },
        };
    }
    _convertResponseToMessage(choice, data) {
        const { message } = choice;
        const rawToolCalls = message.tool_calls;
        const toolCalls = rawToolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}'),
            type: 'tool_call',
        }));
        const additional_kwargs = {};
        if (rawToolCalls) {
            additional_kwargs.tool_calls = rawToolCalls;
        }
        if ('reasoning_content' in message &&
            message.reasoning_content != null &&
            message.reasoning_content !== '') {
            additional_kwargs.reasoning_content = message.reasoning_content;
        }
        else if ('reasoning' in message &&
            message.reasoning != null &&
            message.reasoning !== '') {
            additional_kwargs.reasoning_content = message.reasoning;
        }
        return new messages.AIMessage({
            content: message.content ?? '',
            tool_calls: toolCalls,
            additional_kwargs,
            usage_metadata: data.usage
                ? {
                    input_tokens: data.usage.prompt_tokens,
                    output_tokens: data.usage.completion_tokens,
                    total_tokens: data.usage.total_tokens,
                }
                : undefined,
            response_metadata: {
                model_name: data.model,
                system_fingerprint: data.system_fingerprint,
                finish_reason: choice.finish_reason,
            },
        });
    }
    _getClientOptions(options) {
        if (!this.client) {
            const openAIEndpointConfig = {
                baseURL: this.clientConfig.baseURL,
            };
            const endpoint = openai.getEndpoint(openAIEndpointConfig);
            const params = {
                ...this.clientConfig,
                baseURL: endpoint,
                timeout: this.timeout,
                maxRetries: 0,
            };
            if (params.baseURL == null) {
                delete params.baseURL;
            }
            this.client = new CustomOpenAIClient(params);
        }
        const requestOptions = {
            ...this.clientConfig,
            ...options,
        };
        return requestOptions;
    }
    async *_streamResponseChunks(messages$1, options, runManager) {
        const messagesMapped = index._convertMessagesToOpenAIParams(messages$1, this.model, {
            includeReasoningContent: true,
        });
        const params = {
            ...this.invocationParams(options, {
                streaming: true,
            }),
            messages: messagesMapped,
            stream: true,
        };
        let defaultRole;
        const streamIterable = await this.completionWithRetry(params, options);
        let usage;
        for await (const data of streamIterable) {
            const choice = data.choices[0];
            if (data.usage) {
                usage = data.usage;
                if (!global.__lcUsage) global.__lcUsage = [];
                global.__lcUsage.push({ input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens });
            }
            if (!choice) {
                continue;
            }
            const { delta } = choice;
            if (!delta) {
                continue;
            }
            const chunk = this._convertOpenAIDeltaToBaseMessageChunk(delta, data, defaultRole);
            if ('reasoning_content' in delta) {
                chunk.additional_kwargs.reasoning_content = delta.reasoning_content;
            }
            else if ('reasoning' in delta) {
                chunk.additional_kwargs.reasoning_content = delta.reasoning;
            }
            defaultRole = delta.role ?? defaultRole;
            const newTokenIndices = {
                prompt: options.promptIndex ?? 0,
                completion: choice.index ?? 0,
            };
            if (typeof chunk.content !== 'string') {
                // eslint-disable-next-line no-console
                console.log('[WARNING]: Received non-string content from OpenAI. This is currently not supported.');
                continue;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const generationInfo = { ...newTokenIndices };
            if (choice.finish_reason != null) {
                generationInfo.finish_reason = choice.finish_reason;
                generationInfo.system_fingerprint = data.system_fingerprint;
                generationInfo.model_name = data.model;
                generationInfo.service_tier = data.service_tier;
            }
            if (this.logprobs == true) {
                generationInfo.logprobs = choice.logprobs;
            }
            const generationChunk = new outputs.ChatGenerationChunk({
                message: chunk,
                text: chunk.content,
                generationInfo,
            });
            yield generationChunk;
            await runManager?.handleLLMNewToken(generationChunk.text || '', newTokenIndices, undefined, undefined, undefined, { chunk: generationChunk });
        }
        if (usage) {
            const inputTokenDetails = {
                ...(usage.prompt_tokens_details?.audio_tokens != null && {
                    audio: usage.prompt_tokens_details.audio_tokens,
                }),
                ...(usage.prompt_tokens_details?.cached_tokens != null && {
                    cache_read: usage.prompt_tokens_details.cached_tokens,
                }),
            };
            const outputTokenDetails = {
                ...(usage.completion_tokens_details?.audio_tokens != null && {
                    audio: usage.completion_tokens_details.audio_tokens,
                }),
                ...(usage.completion_tokens_details?.reasoning_tokens != null && {
                    reasoning: usage.completion_tokens_details.reasoning_tokens,
                }),
            };
            const generationChunk = new outputs.ChatGenerationChunk({
                message: new messages.AIMessageChunk({
                    content: '',
                    response_metadata: {
                        usage: { ...usage },
                    },
                    usage_metadata: {
                        input_tokens: usage.prompt_tokens,
                        output_tokens: usage.completion_tokens,
                        total_tokens: usage.total_tokens,
                        ...(Object.keys(inputTokenDetails).length > 0 && {
                            input_token_details: inputTokenDetails,
                        }),
                        ...(Object.keys(outputTokenDetails).length > 0 && {
                            output_token_details: outputTokenDetails,
                        }),
                    },
                }),
                text: '',
            });
            yield generationChunk;
        }
        if (options.signal?.aborted === true) {
            throw new Error('AbortError');
        }
    }
}
class ChatMoonshot extends ChatOpenAI {
    static lc_name() {
        return 'LibreChatMoonshot';
    }
    _convertMessages(messages) {
        return index._convertMessagesToOpenAIParams(messages, this.model, {
            includeReasoningContent: true,
        });
    }
    async _generate(messages, options, runManager) {
        const params = this.invocationParams(options);
        if (params.stream === true) {
            return super._generate(messages, options, runManager);
        }
        const messagesMapped = this._convertMessages(messages);
        const data = await this.completionWithRetry({
            ...params,
            stream: false,
            messages: messagesMapped,
        }, {
            signal: options.signal,
            ...options.options,
        });
        const { completion_tokens, prompt_tokens, total_tokens } = data.usage ?? {};
        const generations = [];
        for (const part of data.choices ?? []) {
            const text = part.message.content ?? '';
            const generation = {
                text: typeof text === 'string' ? text : '',
                message: this._convertResponseToMessage(part, data),
            };
            generation.generationInfo = {
                ...(part.finish_reason ? { finish_reason: part.finish_reason } : {}),
                ...(part.logprobs ? { logprobs: part.logprobs } : {}),
            };
            generations.push(generation);
        }
        return {
            generations,
            llmOutput: {
                tokenUsage: {
                    completionTokens: completion_tokens,
                    promptTokens: prompt_tokens,
                    totalTokens: total_tokens,
                },
            },
        };
    }
    _convertResponseToMessage(choice, data) {
        const { message } = choice;
        const rawToolCalls = message.tool_calls;
        const toolCalls = rawToolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}'),
            type: 'tool_call',
        }));
        const additional_kwargs = {};
        if (rawToolCalls) {
            additional_kwargs.tool_calls = rawToolCalls;
        }
        if ('reasoning_content' in message &&
            message.reasoning_content != null &&
            message.reasoning_content !== '') {
            additional_kwargs.reasoning_content = message.reasoning_content;
        }
        else if ('reasoning' in message &&
            message.reasoning != null &&
            message.reasoning !== '') {
            additional_kwargs.reasoning_content = message.reasoning;
        }
        return new messages.AIMessage({
            content: message.content ?? '',
            tool_calls: toolCalls,
            additional_kwargs,
            usage_metadata: data.usage
                ? {
                    input_tokens: data.usage.prompt_tokens,
                    output_tokens: data.usage.completion_tokens,
                    total_tokens: data.usage.total_tokens,
                }
                : undefined,
            response_metadata: {
                model_name: data.model,
                system_fingerprint: data.system_fingerprint,
                finish_reason: choice.finish_reason,
            },
        });
    }
    async *_streamResponseChunks(messages$1, options, runManager) {
        const messagesMapped = index._convertMessagesToOpenAIParams(messages$1, this.model, {
            includeReasoningContent: true,
        });
        const params = {
            ...this.invocationParams(options, {
                streaming: true,
            }),
            messages: messagesMapped,
            stream: true,
        };
        let defaultRole;
        const streamIterable = await this.completionWithRetry(params, options);
        let usage;
        for await (const data of streamIterable) {
            const choice = data.choices[0];
            if (data.usage) {
                usage = data.usage;
                if (!global.__lcUsage) global.__lcUsage = [];
                global.__lcUsage.push({ input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens });
            }
            if (!choice) {
                continue;
            }
            const { delta } = choice;
            if (!delta) {
                continue;
            }
            const chunk = this._convertOpenAIDeltaToBaseMessageChunk(delta, data, defaultRole);
            if ('reasoning_content' in delta) {
                chunk.additional_kwargs.reasoning_content = delta.reasoning_content;
            }
            else if ('reasoning' in delta) {
                chunk.additional_kwargs.reasoning_content = delta.reasoning;
            }
            defaultRole = delta.role ?? defaultRole;
            const newTokenIndices = {
                prompt: options.promptIndex ?? 0,
                completion: choice.index ?? 0,
            };
            if (typeof chunk.content !== 'string') {
                // eslint-disable-next-line no-console
                console.log('[WARNING]: Received non-string content from OpenAI. This is currently not supported.');
                continue;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const generationInfo = { ...newTokenIndices };
            if (choice.finish_reason != null) {
                generationInfo.finish_reason = choice.finish_reason;
                generationInfo.system_fingerprint = data.system_fingerprint;
                generationInfo.model_name = data.model;
                generationInfo.service_tier = data.service_tier;
            }
            if (this.logprobs == true) {
                generationInfo.logprobs = choice.logprobs;
            }
            const generationChunk = new outputs.ChatGenerationChunk({
                message: chunk,
                text: chunk.content,
                generationInfo,
            });
            yield generationChunk;
            if (this._lc_stream_delay != null) {
                await run.sleep(this._lc_stream_delay);
            }
            await runManager?.handleLLMNewToken(generationChunk.text || '', newTokenIndices, undefined, undefined, undefined, { chunk: generationChunk });
        }
        if (usage) {
            const inputTokenDetails = {
                ...(usage.prompt_tokens_details?.audio_tokens != null && {
                    audio: usage.prompt_tokens_details.audio_tokens,
                }),
                ...(usage.prompt_tokens_details?.cached_tokens != null && {
                    cache_read: usage.prompt_tokens_details.cached_tokens,
                }),
            };
            const outputTokenDetails = {
                ...(usage.completion_tokens_details?.audio_tokens != null && {
                    audio: usage.completion_tokens_details.audio_tokens,
                }),
                ...(usage.completion_tokens_details?.reasoning_tokens != null && {
                    reasoning: usage.completion_tokens_details.reasoning_tokens,
                }),
            };
            const generationChunk = new outputs.ChatGenerationChunk({
                message: new messages.AIMessageChunk({
                    content: '',
                    response_metadata: {
                        usage: { ...usage },
                    },
                    usage_metadata: {
                        input_tokens: usage.prompt_tokens,
                        output_tokens: usage.completion_tokens,
                        total_tokens: usage.total_tokens,
                        ...(Object.keys(inputTokenDetails).length > 0 && {
                            input_token_details: inputTokenDetails,
                        }),
                        ...(Object.keys(outputTokenDetails).length > 0 && {
                            output_token_details: outputTokenDetails,
                        }),
                    },
                }),
                text: '',
            });
            yield generationChunk;
            if (this._lc_stream_delay != null) {
                await run.sleep(this._lc_stream_delay);
            }
        }
        if (usage) {
            this._lastStreamUsage = {
                input_tokens: usage.prompt_tokens,
                output_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            };
        }
        if (options.signal?.aborted === true) {
            throw new Error('AbortError');
        }
    }
}
class ChatXAI extends xai.ChatXAI {
    _lc_stream_delay;
    constructor(fields) {
        super(fields);
        this._lc_stream_delay = fields?._lc_stream_delay;
        const customBaseURL = fields?.configuration?.baseURL ?? fields?.clientConfig?.baseURL;
        if (customBaseURL != null && customBaseURL) {
            this.clientConfig = {
                ...this.clientConfig,
                baseURL: customBaseURL,
            };
            // Reset the client to force recreation with new config
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.client = undefined;
        }
    }
    static lc_name() {
        return 'LibreChatXAI';
    }
    get exposedClient() {
        return this.client;
    }
    _getClientOptions(options) {
        if (!this.client) {
            const openAIEndpointConfig = {
                baseURL: this.clientConfig.baseURL,
            };
            const endpoint = openai.getEndpoint(openAIEndpointConfig);
            const params = {
                ...this.clientConfig,
                baseURL: endpoint,
                timeout: this.timeout,
                maxRetries: 0,
            };
            if (params.baseURL == null) {
                delete params.baseURL;
            }
            this.client = new CustomOpenAIClient(params);
        }
        const requestOptions = {
            ...this.clientConfig,
            ...options,
        };
        return requestOptions;
    }
    async *_streamResponseChunks(messages$1, options, runManager) {
        const messagesMapped = index._convertMessagesToOpenAIParams(messages$1, this.model);
        const params = {
            ...this.invocationParams(options, {
                streaming: true,
            }),
            messages: messagesMapped,
            stream: true,
        };
        let defaultRole;
        const streamIterable = await this.completionWithRetry(params, options);
        let usage;
        for await (const data of streamIterable) {
            const choice = data.choices[0];
            if (data.usage) {
                usage = data.usage;
                if (!global.__lcUsage) global.__lcUsage = [];
                global.__lcUsage.push({ input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens });
            }
            if (!choice) {
                continue;
            }
            const { delta } = choice;
            if (!delta) {
                continue;
            }
            const chunk = this._convertOpenAIDeltaToBaseMessageChunk(delta, data, defaultRole);
            if (chunk.usage_metadata != null) {
                chunk.usage_metadata = {
                    input_tokens: chunk.usage_metadata.input_tokens ?? 0,
                    output_tokens: chunk.usage_metadata.output_tokens ?? 0,
                    total_tokens: chunk.usage_metadata.total_tokens ?? 0,
                };
            }
            if ('reasoning_content' in delta) {
                chunk.additional_kwargs.reasoning_content = delta.reasoning_content;
            }
            defaultRole = delta.role ?? defaultRole;
            const newTokenIndices = {
                prompt: options.promptIndex ?? 0,
                completion: choice.index ?? 0,
            };
            if (typeof chunk.content !== 'string') {
                // eslint-disable-next-line no-console
                console.log('[WARNING]: Received non-string content from OpenAI. This is currently not supported.');
                continue;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const generationInfo = { ...newTokenIndices };
            if (choice.finish_reason != null) {
                generationInfo.finish_reason = choice.finish_reason;
                // Only include system fingerprint in the last chunk for now
                // to avoid concatenation issues
                generationInfo.system_fingerprint = data.system_fingerprint;
                generationInfo.model_name = data.model;
                generationInfo.service_tier = data.service_tier;
            }
            if (this.logprobs == true) {
                generationInfo.logprobs = choice.logprobs;
            }
            const generationChunk = new outputs.ChatGenerationChunk({
                message: chunk,
                text: chunk.content,
                generationInfo,
            });
            yield generationChunk;
            if (this._lc_stream_delay != null) {
                await run.sleep(this._lc_stream_delay);
            }
            await runManager?.handleLLMNewToken(generationChunk.text || '', newTokenIndices, undefined, undefined, undefined, { chunk: generationChunk });
        }
        if (usage) {
            // Type assertion for xAI-specific usage structure
            const xaiUsage = usage;
            const inputTokenDetails = {
                // Standard OpenAI fields
                ...(usage.prompt_tokens_details?.audio_tokens != null && {
                    audio: usage.prompt_tokens_details.audio_tokens,
                }),
                ...(usage.prompt_tokens_details?.cached_tokens != null && {
                    cache_read: usage.prompt_tokens_details.cached_tokens,
                }),
                // Add xAI-specific prompt token details if they exist
                ...(xaiUsage.prompt_tokens_details?.text_tokens != null && {
                    text: xaiUsage.prompt_tokens_details.text_tokens,
                }),
                ...(xaiUsage.prompt_tokens_details?.image_tokens != null && {
                    image: xaiUsage.prompt_tokens_details.image_tokens,
                }),
            };
            const outputTokenDetails = {
                // Standard OpenAI fields
                ...(usage.completion_tokens_details?.audio_tokens != null && {
                    audio: usage.completion_tokens_details.audio_tokens,
                }),
                ...(usage.completion_tokens_details?.reasoning_tokens != null && {
                    reasoning: usage.completion_tokens_details.reasoning_tokens,
                }),
                // Add xAI-specific completion token details if they exist
                ...(xaiUsage.completion_tokens_details?.accepted_prediction_tokens !=
                    null && {
                    accepted_prediction: xaiUsage.completion_tokens_details.accepted_prediction_tokens,
                }),
                ...(xaiUsage.completion_tokens_details?.rejected_prediction_tokens !=
                    null && {
                    rejected_prediction: xaiUsage.completion_tokens_details.rejected_prediction_tokens,
                }),
            };
            const generationChunk = new outputs.ChatGenerationChunk({
                message: new messages.AIMessageChunk({
                    content: '',
                    response_metadata: {
                        usage: { ...usage },
                        // Include xAI-specific metadata if it exists
                        ...(xaiUsage.num_sources_used != null && {
                            num_sources_used: xaiUsage.num_sources_used,
                        }),
                    },
                    usage_metadata: {
                        input_tokens: usage.prompt_tokens,
                        output_tokens: usage.completion_tokens,
                        total_tokens: usage.total_tokens,
                        ...(Object.keys(inputTokenDetails).length > 0 && {
                            input_token_details: inputTokenDetails,
                        }),
                        ...(Object.keys(outputTokenDetails).length > 0 && {
                            output_token_details: outputTokenDetails,
                        }),
                    },
                }),
                text: '',
            });
            yield generationChunk;
            if (this._lc_stream_delay != null) {
                await run.sleep(this._lc_stream_delay);
            }
        }
        if (options.signal?.aborted === true) {
            throw new Error('AbortError');
        }
    }
}

exports.AzureChatOpenAI = AzureChatOpenAI;
exports.ChatDeepSeek = ChatDeepSeek;
exports.ChatMoonshot = ChatMoonshot;
exports.ChatOpenAI = ChatOpenAI;
exports.ChatXAI = ChatXAI;
exports.CustomAzureOpenAIClient = CustomAzureOpenAIClient;
exports.CustomOpenAIClient = CustomOpenAIClient;
exports.isHeaders = isHeaders;
exports.normalizeHeaders = normalizeHeaders;
//# sourceMappingURL=index.cjs.map
