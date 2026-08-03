import { logger } from '@librechat/data-schemas';
import { replaceSpecialVars } from 'librechat-data-provider';
import type { ISystemPrompt } from '@librechat/data-schemas';
import systemPromptSeeds from './systemPromptSeeds';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SystemPromptModel: any = null;

function getModel() {
  if (!SystemPromptModel) {
    throw new Error('SystemPrompt model not initialized. Call initializeSystemPromptService first.');
  }
  return SystemPromptModel;
}

export function initializeSystemPromptService(mongoose: typeof import('mongoose')) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { createSystemPromptModel } = require('@librechat/data-schemas') as any;
  SystemPromptModel = createSystemPromptModel(mongoose);
}

interface PiPromptResponse {
  success?: boolean;
  key?: string;
  path?: string;
}

async function callPiPromptsApi(
  piHost: string,
  piApiKey: string,
  key: string,
  content: string,
): Promise<string | null> {
  const url = `${piHost}/prompts`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': piApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key, content }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn(
        `[SystemPrompt] PI sync failed, key=${key}, status=${response.status}, body=${body}`,
      );
      return null;
    }

    const respBody: PiPromptResponse = await response.json();
    if (respBody.success !== true) {
      logger.warn(`[SystemPrompt] PI sync returned success=false, key=${key}`);
      return null;
    }

    const path = respBody.path ?? null;
    logger.info(`[SystemPrompt] PI prompt synced, key=${key}, path=${path}`);
    return path;
  } catch (err) {
    logger.warn(
      `[SystemPrompt] PI sync exception for key=${key}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function getSystemPrompt(key: string): Promise<string | null> {
  const Model = getModel();
  const doc: ISystemPrompt | null = await Model.findOne({ key }).lean();
  if (doc) {
    return replaceSpecialVars({ text: doc.content });
  }
  return null;
}

export async function getSystemPromptOrSeed(key: string): Promise<string | null> {
  const Model = getModel();
  const doc: ISystemPrompt | null = await Model.findOne({ key }).lean();
  if (doc) {
    return replaceSpecialVars({ text: doc.content });
  }

  const seed = systemPromptSeeds.find((s) => s.key === key);
  if (!seed) {
    logger.warn(`[SystemPrompt] No seed found for key: ${key}`);
    return null;
  }

  const created = await Model.create({
    key: seed.key,
    description: seed.description,
    category: seed.category,
    content: seed.content,
    changeNote: 'Initial seed',
    isSystem: seed.isSystem,
    piPrompt: seed.piPrompt ?? false,
    piSavePath: '',
    defaultContent: seed.content,
    updatedBy: 'system',
    versionHistory: [
      {
        version: 1,
        content: seed.content,
        updatedBy: 'system',
        changeNote: 'Initial seed',
        piPrompt: seed.piPrompt ?? false,
        piSavePath: '',
        createdAt: new Date(),
      },
    ],
  });

  logger.info(`[SystemPrompt] Seeded system prompt: ${key}`);
  return created.content;
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

export async function seedAllSystemPrompts(): Promise<void> {
  for (const seed of systemPromptSeeds) {
    await getSystemPromptOrSeed(seed.key);
  }
  logger.info('[SystemPrompt] All system prompts seeded');
}

export async function syncMissingSystemPrompts(): Promise<void> {
  const Model = getModel();
  const piHost = process.env.PI_HOST || process.env.PI_AGENT_URL;
  const piApiKey = process.env.PI_API_KEY;
  const piAvailable = !!(piHost && piApiKey);
  const piPending: ISystemPrompt[] = [];

  for (const seed of systemPromptSeeds) {
    const exists = await Model.exists({ key: seed.key });
    if (!exists) {
      await Model.create({
        key: seed.key,
        description: seed.description,
        category: seed.category,
        content: seed.content,
        changeNote: 'Initial seed',
        isSystem: seed.isSystem,
        piPrompt: seed.piPrompt ?? false,
        piSavePath: '',
        defaultContent: seed.content,
        updatedBy: 'system',
        versionHistory: [
          {
            version: 1,
            content: seed.content,
            updatedBy: 'system',
            changeNote: 'Initial seed',
            piPrompt: seed.piPrompt ?? false,
            piSavePath: '',
            createdAt: new Date(),
          },
        ],
      });
      logger.info(`[SystemPrompt] Synced missing system prompt: ${seed.key}`);
    } else {
      const doc = await Model.findOne({ key: seed.key }).lean();
      if (doc && doc.defaultContent !== seed.content) {
        const userCustomized = doc.content !== doc.defaultContent;
        await Model.updateOne(
          { key: seed.key },
          { $set: { defaultContent: seed.content, ...(!userCustomized && { content: seed.content }) } },
        );
        logger.info(
          `[SystemPrompt] Updated defaultContent for: ${seed.key} (seed changed)${
            userCustomized ? ', kept user-customized content' : ', also synced content'
          }`,
        );
      }
    }

    if (seed.piPrompt && piAvailable) {
      const doc: ISystemPrompt | null = await Model.findOne({ key: seed.key }).lean();
      if (doc && !doc.piSavePath) {
        piPending.push(doc);
      }
    }
  }

  for (const doc of piPending) {
    try {
      const piSavePath = await callPiPromptsApi(piHost!, piApiKey!, doc.key, doc.content);
      if (piSavePath !== null) {
        await Model.updateOne({ key: doc.key }, { $set: { piSavePath } });
      }
    } catch (err) {
      logger.warn(
        `[SystemPrompt] PI sync failed for ${doc.key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  logger.info('[SystemPrompt] Sync complete');
}