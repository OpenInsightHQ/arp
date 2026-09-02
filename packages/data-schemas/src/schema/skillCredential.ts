import { Schema } from 'mongoose';
import type { ISkillCredential } from '~/types';

/**
 * Collection is named explicitly `credentials` (shared with pi/dmp) — the
 * credential store is a general-purpose resource, not skill-specific.
 *
 * `iv`/`authTag`/`data` are NOT required: declaration-only documents (schema
 * declared by an admin, values pending) carry `schemaJson` without cipher
 * material. Resolution skips docs without `data`.
 */
const skillCredentialSchema = new Schema<ISkillCredential>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resourceType: { type: String, enum: ['skill', 'mcp', 'credential'], required: true },
    resourceName: { type: String, required: true },
    cipher: { type: String, default: 'aes-256-gcm' },
    iv: { type: String },
    authTag: { type: String },
    data: { type: String },
    keyVersion: { type: Number, default: 1 },
    lastVerifiedAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'invalid'], default: 'active' },
    schemaJson: { type: String },
  },
  { timestamps: true },
);

skillCredentialSchema.index({ userId: 1, resourceType: 1, resourceName: 1 }, { unique: true });

export default skillCredentialSchema;
