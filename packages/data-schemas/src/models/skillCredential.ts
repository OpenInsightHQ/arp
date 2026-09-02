import skillCredentialSchema from '~/schema/skillCredential';
import type { ISkillCredential } from '~/types';

/**
 * Creates or returns the SkillCredential model using the provided mongoose instance and schema
 */
export function createSkillCredentialModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.SkillCredential ||
    mongoose.model<ISkillCredential>('SkillCredential', skillCredentialSchema)
  );
}
