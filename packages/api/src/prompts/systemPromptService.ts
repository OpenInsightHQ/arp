import { replaceSpecialVars } from 'librechat-data-provider';
import type { ISystemPrompt } from '@librechat/data-schemas';
import { getLangText } from '~/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SystemPromptModel: any = null;

function getModel() {
  if (!SystemPromptModel) {
    throw new Error(
      'SystemPrompt model not initialized. Call initializeSystemPromptService first.',
    );
  }
  return SystemPromptModel;
}

export function initializeSystemPromptService(mongoose: typeof import('mongoose')) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
  const { createSystemPromptModel } = require('@librechat/data-schemas') as any;
  SystemPromptModel = createSystemPromptModel(mongoose);
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

export async function getPiSystemPrompt(lang?: string): Promise<string | null> {
  const basePrompt = await getSystemPrompt('pi.system');
  if (!basePrompt) {
    return null;
  }

  const langText = getLangText(lang);
  const resolvedBasePrompt = /{{lang}}/i.test(basePrompt)
    ? basePrompt.replace(/{{lang}}/gi, langText)
    : basePrompt;

  const Model = getModel();
  const piPrompts: ISystemPrompt[] = await Model.find({
    piPrompt: true,
    piSavePath: { $ne: '', $exists: true },
  })
    .sort({ key: 1 })
    .lean();

  if (piPrompts.length === 0) {
    return resolvedBasePrompt;
  }

  const promptEntries = piPrompts
    .map(
      (p) =>
        `  <prompt>\n    <name>${p.key}</name>\n    <description>${p.description}</description>\n    <location>${p.piSavePath}</location>\n  </prompt>`,
    )
    .join('\n');

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
