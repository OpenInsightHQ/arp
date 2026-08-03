import systemPromptSchema from '~/schema/systemPrompt';
import type { ISystemPrompt } from '~/types';

export function createSystemPromptModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.SystemPrompt ||
    mongoose.model<ISystemPrompt>('SystemPrompt', systemPromptSchema)
  );
}