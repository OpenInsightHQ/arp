import credentialSchema from '~/schema/credential';
import type { ICredential } from '~/types';

/**
 * Creates or returns the Credential model using the provided mongoose
 * instance and schema. The collection is named explicitly `credentials`
 * (shared with pi/dmp) — NOT the mongoose-default `skillcredentials`.
 */
export function createCredentialModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.Credential ||
    mongoose.model<ICredential>('Credential', credentialSchema, 'credentials')
  );
}
