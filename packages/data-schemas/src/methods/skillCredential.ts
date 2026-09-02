import crypto from 'crypto';
import type { Model, FilterQuery } from 'mongoose';
import type {
  CredentialResourceType,
  CredentialStatus,
  ISkillCredential,
  SkillCredentialStatus,
} from '~/types';
import { ADMIN_CREDENTIAL_USER_ID } from '~/types';

const CIPHER = 'aes-256-gcm';
const IV_LENGTH = 12;
const MASTER_KEY_ENV = 'PI_CREDENTIAL_MASTER_KEY';

/**
 * Skill credential methods with AES-256-GCM encryption.
 *
 * Cipher interop with pi (Node) and dmp (Java): 12-byte random IV, 128-bit
 * tag stored SEPARATELY from the ciphertext — Node's createCipheriv emits
 * them separately, Java's doFinal concatenates ciphertext||tag and splits.
 * Plaintext is the JSON object `{ secretKey: value }`.
 *
 * Plaintext values never leave this module except via `getCredentialValues`
 * (server-internal use only). Listing endpoints use `getCredentialStatus`.
 */
export function createSkillCredentialMethods(mongoose: typeof import('mongoose')) {
  const SkillCredential = mongoose.models.SkillCredential as Model<ISkillCredential>;

  let warnedAboutKey = false;
  function getMasterKey(): Buffer | null {
    const raw = process.env[MASTER_KEY_ENV];
    if (!raw) {
      return null;
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      if (!warnedAboutKey) {
        console.error(
          `[SkillCredential] ${MASTER_KEY_ENV} must be base64-encoded 32 bytes (got ${key.length}); credential store disabled`,
        );
        warnedAboutKey = true;
      }
      return null;
    }
    return key;
  }

  /** Whether credentials can be written/decrypted in this process. */
  function isCryptoConfigured(): boolean {
    return getMasterKey() !== null;
  }

  function encryptValues(values: Record<string, string>, key: Buffer) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(CIPHER, key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(values), 'utf-8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  }

  function decryptDoc(doc: ISkillCredential, key: Buffer): Record<string, string> {
    const decipher = crypto.createDecipheriv(CIPHER, key, Buffer.from(doc.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(doc.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(doc.data, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf-8'));
  }

  function ownerFilter(
    userId: string,
    resourceType: CredentialResourceType,
    resourceName: string,
  ): FilterQuery<ISkillCredential> {
    return { userId, resourceType, resourceName };
  }

  /**
   * Upserts an encrypted credential binding for a user.
   * Fails closed when no master key is configured.
   */
  async function bindCredential(
    userId: string,
    resourceType: CredentialResourceType,
    resourceName: string,
    values: Record<string, string>,
  ): Promise<void> {
    const key = getMasterKey();
    if (!key) {
      throw new Error(`Credential store requires a valid ${MASTER_KEY_ENV}`);
    }
    if (!values || Object.keys(values).length === 0) {
      throw new Error('Credential values must not be empty');
    }
    const encrypted = encryptValues(values, key);
    await SkillCredential.updateOne(
      ownerFilter(userId, resourceType, resourceName),
      {
        $set: {
          userId,
          resourceType,
          resourceName,
          cipher: CIPHER,
          ...encrypted,
          keyVersion: 1,
          status: 'active',
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  async function unbindCredential(
    userId: string,
    resourceType: CredentialResourceType,
    resourceName: string,
  ): Promise<void> {
    await SkillCredential.deleteOne(ownerFilter(userId, resourceType, resourceName));
  }

  /**
   * Decrypts and returns the user's binding values (server-internal only —
   * never expose via HTTP APIs).
   */
  async function getCredentialValues(
    userId: string,
    resourceType: CredentialResourceType,
    resourceName: string,
  ): Promise<Record<string, string> | null> {
    const key = getMasterKey();
    if (!key) {
      return null;
    }
    const doc = await SkillCredential.findOne(
      ownerFilter(userId, resourceType, resourceName),
    ).lean<ISkillCredential | null>();
    if (!doc) {
      return null;
    }
    try {
      return decryptDoc(doc, key);
    } catch (error) {
      console.error(
        `[SkillCredential] decrypt failed for ${resourceType}/${resourceName} (wrong master key or corrupted document):`,
        (error as Error).message,
      );
      return null;
    }
  }

  /** Whether the user has a binding (no decryption — safe for status endpoints). */
  async function isCredentialBound(
    userId: string,
    resourceType: CredentialResourceType,
    resourceName: string,
  ): Promise<boolean> {
    const doc = await SkillCredential.findOne(ownerFilter(userId, resourceType, resourceName))
      .select('_id')
      .lean();
    return doc != null;
  }

  /** Sanitized binding view — cipher fields never included. */
  async function getCredentialStatus(
    userId: string,
    resourceType: CredentialResourceType,
    resourceName: string,
  ): Promise<SkillCredentialStatus> {
    const doc = await SkillCredential.findOne(
      ownerFilter(userId, resourceType, resourceName),
    ).lean<ISkillCredential | null>();
    return {
      resourceType,
      resourceName,
      configured: doc != null,
      status: doc?.status,
      lastVerifiedAt: doc?.lastVerifiedAt ?? null,
      updatedAt: doc?.updatedAt ?? null,
    };
  }

  /** Records a verification outcome on the user's binding. */
  async function markCredentialStatus(
    userId: string,
    resourceType: CredentialResourceType,
    resourceName: string,
    status: CredentialStatus,
  ): Promise<void> {
    await SkillCredential.updateOne(ownerFilter(userId, resourceType, resourceName), {
      $set: { status, lastVerifiedAt: new Date() },
    });
  }

  return {
    isCryptoConfigured,
    bindCredential,
    unbindCredential,
    getCredentialValues,
    isCredentialBound,
    getCredentialStatus,
    markCredentialStatus,
  };
}

export type SkillCredentialMethods = ReturnType<typeof createSkillCredentialMethods>;

export { ADMIN_CREDENTIAL_USER_ID };
