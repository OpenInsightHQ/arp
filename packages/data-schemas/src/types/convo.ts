import type { Document, Types } from 'mongoose';

// @ts-ignore
export interface IConversation extends Document {
  conversationId: string;
  title?: string;
  user?: string;
  messages?: Types.ObjectId[];
  // Fields provided by conversationPreset (adjust types as needed)
  endpoint?: string;
  endpointType?: string;
  model?: string;
  region?: string;
  chatGptLabel?: string;
  examples?: unknown[];
  modelLabel?: string;
  promptPrefix?: string;
  echartsPrompt?: boolean;
  temperature?: number;
  top_p?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  maxTokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  file_ids?: string[];
  resendImages?: boolean;
  promptCache?: boolean;
  thinking?: boolean;
  thinkingBudget?: number;
  effort?: string;
  system?: string;
  resendFiles?: boolean;
  imageDetail?: string;
  agent_id?: string;
  assistant_id?: string;
  instructions?: string;
  stop?: string[];
  isArchived?: boolean;
  iconURL?: string;
  greeting?: string;
  spec?: string;
  tags?: string[];
  tools?: string[];
  maxContextTokens?: number;
  toolCallVisible?: boolean;
  max_tokens?: number;
  reasoning_effort?: string;
  reasoning_summary?: string;
  verbosity?: string;
  useResponsesApi?: boolean;
  web_search?: boolean;
  disableStreaming?: boolean;
  fileTokenLimit?: number;
  // Additional fields
  files?: string[];
  /**
   * Reason the last message in this conversation finished.
   * Mirrors the most recent message's `finish_reason`
   * (e.g. 'stop', 'tool_calls', 'recursion_limit', 'rate_limit', 'error').
   */
  finish_reason?: string;
  expiredAt?: Date;
  source?: string;
  sourceDataId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
