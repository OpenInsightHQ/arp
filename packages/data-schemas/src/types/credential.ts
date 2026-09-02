import type * as mongoose from 'mongoose';

/** Sentinel ObjectId (all zeros) marking an admin-managed (shared) binding */
export const ADMIN_CREDENTIAL_USER_ID = '000000000000000000000000';

export type CredentialResourceType = 'skill' | 'mcp';
export type CredentialStatus = 'active' | 'invalid';

/** One declared secret field (declaration only — values live encrypted in ICredential) */
export interface ICredentialSchemaField {
  secretKey: string;
  displayName?: string;
  sensitive?: boolean;
  description?: string;
}

/**
 * Encrypted credential binding for a skill or MCP server.
 *
 * Cipher contract shared with pi / dmp (docs/credential-skill-dev-plan.md §3.3):
 * AES-256-GCM, 12-byte random IV, 128-bit auth tag stored separately from the
 * ciphertext (base64 fields `iv` / `authTag` / `data`), plaintext is the JSON
 * object `{ secretKey: value }`. Master key: base64 32-byte, env
 * `PI_CREDENTIAL_MASTER_KEY`.
 */
export interface ICredential {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  resourceType: CredentialResourceType;
  /** skill.name or mcpservers.serverName */
  resourceName: string;
  cipher: string;
  iv: string;
  authTag: string;
  data: string;
  keyVersion?: number;
  lastVerifiedAt?: Date | null;
  status?: CredentialStatus;
  /**
   * Plaintext credential-schema JSON — only used by declaration-only docs
   * (resourceType=credential) so bind forms can render without decrypting.
   */
  schemaJson?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Sanitized binding view for listing endpoints — never contains cipher material */
export interface CredentialStatusView {
  resourceType: CredentialResourceType;
  resourceName: string;
  configured: boolean;
  status?: CredentialStatus;
  lastVerifiedAt?: Date | null;
  updatedAt?: Date | null;
}
