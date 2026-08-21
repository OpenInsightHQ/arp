import type { Types } from 'mongoose';
import { replaceSpecialVars, PermissionBits, ResourceType } from 'librechat-data-provider';
import type { ISystemPrompt } from '@librechat/data-schemas';
import { AccessControlService } from '~/acl/accessControlService';
import { getLangText } from '~/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SystemPromptModel: any = null;
let mongooseInstance: typeof import('mongoose') | null = null;
let aclService: AccessControlService | null = null;

function getModel() {
  if (!SystemPromptModel) {
    throw new Error(
      'SystemPrompt model not initialized. Call initializeSystemPromptService first.',
    );
  }
  return SystemPromptModel;
}

function getAclService(): AccessControlService | null {
  if (!aclService && mongooseInstance) {
    aclService = new AccessControlService(mongooseInstance);
  }
  return aclService;
}

export function initializeSystemPromptService(mongoose: typeof import('mongoose')) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
  const { createSystemPromptModel } = require('@librechat/data-schemas') as any;
  SystemPromptModel = createSystemPromptModel(mongoose);
  mongooseInstance = mongoose;
}

export async function getSystemPrompt(key: string): Promise<string | null> {
  const Model = getModel();
  const doc: ISystemPrompt | null = await Model.findOne({ key }).lean();
  if (doc) {
    return replaceSpecialVars({ text: doc.content });
  }
  return null;
}

/**
 * Returns the system prompt content for `key` from the database.
 *
 * Seeding of built-in system prompts is handled by the dmp project
 * (`init-data/system-prompts/*.yaml`); this service only reads.
 */
export async function getSystemPromptOrSeed(key: string): Promise<string | null> {
  return getSystemPrompt(key);
}

function formatAvailablePromptEntry(prompt: Pick<ISystemPrompt, 'key' | 'description'>): string {
  return `  <prompt>\n    <name>${prompt.key}</name>\n    <description>${prompt.description}</description>\n  </prompt>`;
}

/**
 * Builds the `<available_prompts>` XML for explicit agent-configured keys
 * (`knowledgePromptKeys`), listing each prompt's key and description so the
 * LLM can fetch full content via the `read_prompt` tool.
 */
export async function buildAvailablePromptsPrompt(
  keys: string[] | undefined,
): Promise<string | null> {
  if (!keys || keys.length === 0) {
    return null;
  }

  const uniqueKeys = [...new Set(keys)];
  const Model = getModel();
  const docs: ISystemPrompt[] = await Model.find({ key: { $in: uniqueKeys } }).lean();
  const docsByKey = new Map(docs.map((doc) => [doc.key, doc]));

  const entries = uniqueKeys
    .map((key) => docsByKey.get(key))
    .filter((doc): doc is ISystemPrompt => doc != null)
    .map(formatAvailablePromptEntry)
    .join('\n');

  if (!entries) {
    return null;
  }

  return `<available_prompts>\n${entries}\n</available_prompts>`;
}

/**
 * Returns system prompts within the user's permission scope
 * (resourceType `systemPrompt`, VIEW bit). Without a userId, only publicly
 * granted prompts are returned.
 */
async function getAccessibleSystemPrompts(
  userId?: string,
  role?: string,
): Promise<ISystemPrompt[]> {
  const acl = getAclService();
  if (!acl) {
    return [];
  }

  let resourceIds: Types.ObjectId[];
  if (userId) {
    resourceIds = await acl.findAccessibleResources({
      userId,
      role,
      resourceType: ResourceType.SYSTEM_PROMPT,
      requiredPermissions: PermissionBits.VIEW,
    });
  } else {
    resourceIds = await acl.findPubliclyAccessibleResources({
      resourceType: ResourceType.SYSTEM_PROMPT,
      requiredPermissions: PermissionBits.VIEW,
    });
  }

  if (resourceIds.length === 0) {
    return [];
  }

  const Model = getModel();
  return Model.find({
    _id: { $in: resourceIds },
    piPrompt: true,
    piSavePath: { $ne: '', $exists: true },
  })
    .sort({ key: 1 })
    .lean();
}

/**
 * Returns the `pi.system` prompt with an `<available_prompts>` section listing
 * the system prompts the given user has permission to view
 * (resourceType `systemPrompt`).
 */
export async function getPiSystemPrompt(
  lang?: string,
  userId?: string,
  role?: string,
): Promise<string | null> {
  const basePrompt = await getSystemPrompt('pi.system');
  if (!basePrompt) {
    return null;
  }

  const langText = getLangText(lang);
  const resolvedBasePrompt = /{{lang}}/i.test(basePrompt)
    ? basePrompt.replace(/{{lang}}/gi, langText)
    : basePrompt;

  const accessiblePrompts = await getAccessibleSystemPrompts(userId, role);
  if (accessiblePrompts.length === 0) {
    return resolvedBasePrompt;
  }

  const promptEntries = accessiblePrompts.map(formatAvailablePromptEntry).join('\n');

  return `${resolvedBasePrompt}\n\n<available_prompts>\n${promptEntries}\n</available_prompts>`;
}

export async function getSystemPromptDoc(key: string): Promise<ISystemPrompt | null> {
  const Model = getModel();
  return Model.findOne({ key }).lean();
}

export async function listSystemPrompts(category?: string): Promise<ISystemPrompt[]> {
  const Model = getModel();
  const filter = category ? { category } : {};
  return Model.find(filter).sort({ category: 1, key: 1 }).lean();
}

export async function updateSystemPrompt(
  key: string,
  data: {
    content: string;
    changeNote: string;
    updatedBy: string;
    piPrompt?: boolean;
    piSavePath?: string;
  },
): Promise<ISystemPrompt | null> {
  const Model = getModel();
  const doc = await Model.findOne({ key });
  if (!doc) {
    return null;
  }

  const currentVersion =
    doc.versionHistory.length > 0
      ? Math.max(...doc.versionHistory.map((v: { version: number }) => v.version))
      : 0;

  doc.content = data.content;
  doc.changeNote = data.changeNote;
  doc.updatedBy = data.updatedBy;
  if (data.piPrompt !== undefined) {
    doc.piPrompt = data.piPrompt;
  }
  if (data.piSavePath !== undefined) {
    doc.piSavePath = data.piSavePath;
  }
  doc.versionHistory.push({
    version: currentVersion + 1,
    content: data.content,
    updatedBy: data.updatedBy,
    changeNote: data.changeNote,
    piPrompt: data.piPrompt ?? doc.piPrompt,
    piSavePath: data.piSavePath ?? doc.piSavePath,
    createdAt: new Date(),
  });

  await doc.save();
  return doc.toObject() as ISystemPrompt;
}

export async function resetSystemPrompt(key: string): Promise<ISystemPrompt | null> {
  const Model = getModel();
  const doc = await Model.findOne({ key });
  if (!doc) {
    return null;
  }

  const currentVersion =
    doc.versionHistory.length > 0
      ? Math.max(...doc.versionHistory.map((v: { version: number }) => v.version))
      : 0;

  doc.content = doc.defaultContent;
  doc.changeNote = 'Reset to default';
  doc.updatedBy = 'system';
  doc.versionHistory.push({
    version: currentVersion + 1,
    content: doc.defaultContent,
    updatedBy: 'system',
    changeNote: 'Reset to default',
    piPrompt: false,
    piSavePath: '',
    createdAt: new Date(),
  });

  await doc.save();
  return doc.toObject() as ISystemPrompt;
}
