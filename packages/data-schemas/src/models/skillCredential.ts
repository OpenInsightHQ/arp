import skillCredentialSchema from '~/schema/skillCredential';
import type { ISkillCredential } from '~/types';

/**
 * Creates or returns the SkillCredential model using the provided mongoose
 * instance and schema. The collection is named explicitly `credentials`
 * (shared with pi/dmp) — NOT the mongoose-default `skillcredentials`.
 */
export function createSkillCredentialModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.SkillCredential ||
    mongoose.model<ISkillCredential>('SkillCredential', skillCredentialSchema, 'credentials')
  );
}
