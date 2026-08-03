import { Schema } from 'mongoose';
import type { ISystemPrompt, ISystemPromptVersion } from '~/types';

const systemPromptVersionSchema = new Schema<ISystemPromptVersion>(
  {
    version: {
      type: Number,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    updatedBy: {
      type: String,
    },
    changeNote: {
      type: String,
      default: '',
    },
    piPrompt: {
      type: Boolean,
      default: false,
    },
    piSavePath: {
      type: String,
      default: '',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const systemPromptSchema = new Schema<ISystemPrompt>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    description: {
      type: String,
      default: '',
    },
    category: {
      type: String,
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
    },
    changeNote: {
      type: String,
      default: '',
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    piPrompt: {
      type: Boolean,
      default: false,
    },
    piSavePath: {
      type: String,
      default: '',
    },
    defaultContent: {
      type: String,
      required: true,
    },
    updatedBy: {
      type: String,
    },
    versionHistory: {
      type: [systemPromptVersionSchema],
      default: [],
    },
  },
  { timestamps: true },
);

systemPromptSchema.index({ category: 1, key: 1 });
systemPromptSchema.index({ createdAt: 1, updatedAt: 1 });

export default systemPromptSchema;