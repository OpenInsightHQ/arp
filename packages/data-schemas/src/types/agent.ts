import { Document, Types } from 'mongoose';
import type { GraphEdge, AgentToolOptions, AgentSkill } from 'librechat-data-provider';

export interface ISupportContact {
  name?: string;
  email?: string;
}

export interface IAgent extends Omit<Document, 'model'> {
  id: string;
  name?: string;
  description?: string;
  instructions?: string;
  /** Key into the systemprompts collection; used as instructions when `instructions` is empty */
  mainPromptKey?: string;
  /** systemprompts keys exposed to the agent via <available_prompts> / read_prompt */
  knowledgePromptKeys?: string[];
  avatar?: {
    filepath: string;
    source: string;
  };
  provider: string;
  model: string;
  model_parameters?: Record<string, unknown>;
  artifacts?: string;
  access_level?: number;
  recursion_limit?: number;
  tools?: string[];
  tool_kwargs?: Array<unknown>;
  actions?: string[];
  author: Types.ObjectId;
  authorName?: string;
  hide_sequential_outputs?: boolean;
  end_after_tools?: boolean;
  /** @deprecated Use edges instead */
  agent_ids?: string[];
  edges?: GraphEdge[];
  /** @deprecated Use ACL permissions instead */
  isCollaborative?: boolean;
  conversation_starters?: string[];
  tool_resources?: unknown;
  projectIds?: Types.ObjectId[];
  versions?: Omit<IAgent, 'versions'>[];
  category: string;
  support_contact?: ISupportContact;
  is_promoted?: boolean;
  /** MCP server names extracted from tools for efficient querying */
  mcpServerNames?: string[];
  /** Per-tool configuration (defer_loading, allowed_callers) */
  tool_options?: AgentToolOptions;
  /** Skills executable via the execute_skill tool (PI /prompt `/skill:` trigger) */
  skills?: AgentSkill[];
  /** Dataset ID for vocabulary search */
  datasetId?: string;
}
