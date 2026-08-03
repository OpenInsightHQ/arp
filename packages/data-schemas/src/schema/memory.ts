import { Schema } from 'mongoose';
import type { IMemoryEntry } from '~/types/memory';

const MemoryEntrySchema: Schema<IMemoryEntry> = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true,
  },
  key: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => /^[a-z_]+$/.test(v),
      message: 'Key must only contain lowercase letters and underscores',
    },
  },
  value: {
    type: String,
    required: true,
  },
  tokenCount: {
    type: Number,
    default: 0,
  },
  type: {
    type: String,
    enum: ['profile', 'preference', 'constraint', 'knowledge'],
    default: 'knowledge',
  },
  source: {
    from: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    conversationId: { type: String, default: null },
    messageIds: [{ type: String, default: null }],
  },
  weight: {
    importance: { type: Number, default: 0.5, min: 0, max: 1 },
  },
  last_accessed_at: { type: Date, default: null },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

export default MemoryEntrySchema;
