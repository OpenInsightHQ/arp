import type { Document, Types } from 'mongoose';

export interface ISystemPromptVersion {
  version: number;
  content: string;
  updatedBy?: string;
  changeNote: string;
  piPrompt: boolean;
  piSavePath: string;
  createdAt: Date;
}

export interface ISystemPrompt extends Document {
  key: string;
  description: string;
  category: string;
  content: string;
  changeNote: string;
  isSystem: boolean;
  piPrompt: boolean;
  piSavePath: string;
  defaultContent: string;
  updatedBy?: string;
  versionHistory: ISystemPromptVersion[];
  createdAt?: Date;
  updatedAt?: Date;
}