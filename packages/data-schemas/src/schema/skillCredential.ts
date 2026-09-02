import { Schema } from 'mongoose';
import type { ISkillCredential } from '~/types';

const skillCredentialSchema = new Schema<ISkillCredential>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resourceType: { type: String, enum: ['skill', 'mcp'], required: true },
    resourceName: { type: String, required: true },
    cipher: { type: String, default: 'aes-256-gcm' },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    data: { type: String, required: true },
    keyVersion: { type: Number, default: 1 },
    lastVerifiedAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'invalid'], default: 'active' },
  },
  { timestamps: true },
);

skillCredentialSchema.index({ userId: 1, resourceType: 1, resourceName: 1 }, { unique: true });

export default skillCredentialSchema;
