import { Schema } from 'mongoose';
import { conversationPreset } from './defaults';
import { IConversation } from '~/types';

const convoSchema: Schema<IConversation> = new Schema(
  {
    conversationId: {
      type: String,
      unique: true,
      required: true,
      index: true,
      meiliIndex: true,
    },
    title: {
      type: String,
      default: 'New Chat',
      meiliIndex: true,
    },
    user: {
      type: String,
      index: true,
      meiliIndex: true,
    },
    messages: [{ type: Schema.Types.ObjectId, ref: 'Message' }],
    ...conversationPreset,
    agent_id: {
      type: String,
    },
    tags: {
      type: [String],
      default: [],
      meiliIndex: true,
    },
    files: {
      type: [String],
    },
    /*
     * Reason the last message in this conversation finished.
     * Mirrors the `finish_reason` of the most recently saved message
     * (e.g. 'stop', 'tool_calls', 'recursion_limit', 'rate_limit', 'error').
     */
    finish_reason: {
      type: String,
    },
    expiredAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

convoSchema.index({ expiredAt: 1 }, { expireAfterSeconds: 0 });
convoSchema.index({ createdAt: 1, updatedAt: 1 });
convoSchema.index({ conversationId: 1, user: 1 }, { unique: true });

// index for MeiliSearch sync operations
convoSchema.index({ _meiliIndex: 1, expiredAt: 1 });

export default convoSchema;
