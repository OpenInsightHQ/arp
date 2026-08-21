const express = require('express');
const { Tokenizer, generateCheckAccess } = require('@librechat/api');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  getAllUserMemories,
  toggleUserMemories,
  createMemory,
  deleteMemory,
  setMemory,
} = require('~/models');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const { getRoleByName } = require('~/models/Role');

const router = express.Router();

function getMemoryByKey(memories, key) {
  for (const m of memories) {
    if (m.key === key) {
      return m;
    }
  }
  return undefined;
}

const memoryPayloadLimit = express.json({ limit: '100kb' });

const checkMemoryRead = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.READ],
  getRoleByName,
});
const checkMemoryCreate = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.CREATE],
  getRoleByName,
});
const checkMemoryUpdate = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.UPDATE],
  getRoleByName,
});
const checkMemoryDelete = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.UPDATE],
  getRoleByName,
});
const checkMemoryOptOut = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.OPT_OUT],
  getRoleByName,
});

/**
 * GET /memories
 * Returns all memories for the authenticated user, sorted by updated_at (newest first).
 * Also includes memory usage percentage based on token limit.
 */
router.get('/', requireJwtAuth, checkMemoryRead, configMiddleware, async (req, res) => {
  try {
    const memories = await getAllUserMemories(req.user.id);

    const sortedMemories = memories.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

    const totalTokens = memories.reduce((sum, memory) => {
      return sum + (memory.tokenCount || 0);
    }, 0);

    const appConfig = req.config;
    const memoryConfig = appConfig?.memory;
    const tokenLimit = memoryConfig?.tokenLimit;
    const charLimit = memoryConfig?.charLimit || 10000;

    let usagePercentage = null;
    if (tokenLimit && tokenLimit > 0) {
      usagePercentage = Math.min(100, Math.round((totalTokens / tokenLimit) * 100));
    }

    res.json({
      memories: sortedMemories,
      totalTokens,
      tokenLimit: tokenLimit || null,
      charLimit,
      usagePercentage,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /memories
 * Creates a new memory entry for the authenticated user.
 * Body: { key: string, value: string }
 * Returns 201 and { created: true, memory: <createdDoc> } when successful.
 */
router.post('/', requireJwtAuth, memoryPayloadLimit, checkMemoryCreate, configMiddleware, async (req, res) => {
  const { key, value } = req.body;

  if (typeof key !== 'string' || key.trim() === '') {
    return res.status(400).json({ error: 'Key is required and must be a non-empty string.' });
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return res.status(400).json({ error: 'Value is required and must be a non-empty string.' });
  }

  const appConfig = req.config;
  const memoryConfig = appConfig?.memory;
  const charLimit = memoryConfig?.charLimit || 10000;

  if (key.length > 1000) {
    return res.status(400).json({
      error: `Key exceeds maximum length of 1000 characters. Current length: ${key.length} characters.`,
    });
  }

  if (value.length > charLimit) {
    return res.status(400).json({
      error: `Value exceeds maximum length of ${charLimit} characters. Current length: ${value.length} characters.`,
    });
  }

  try {
    const tokenCount = Tokenizer.getTokenCount(value, 'o200k_base');

    const memories = await getAllUserMemories(req.user.id);

    const appConfig = req.config;
    const memoryConfig = appConfig?.memory;
    const tokenLimit = memoryConfig?.tokenLimit;

    if (tokenLimit) {
      const currentTotalTokens = memories.reduce(
        (sum, memory) => sum + (memory.tokenCount || 0),
        0,
      );
      if (currentTotalTokens + tokenCount > tokenLimit) {
        return res.status(400).json({
          error: `Adding this memory would exceed the token limit of ${tokenLimit}. Current usage: ${currentTotalTokens} tokens.`,
        });
      }
    }

    const result = await createMemory({
      userId: req.user.id,
      key: key.trim(),
      value: value.trim(),
      tokenCount,
    });

    if (!result.ok) {
      return res.status(500).json({ error: 'Failed to create memory.' });
    }

    const updatedMemories = await getAllUserMemories(req.user.id);
    const newMemory = getMemoryByKey(updatedMemories, key.trim());

    res.status(201).json({ created: true, memory: newMemory });
  } catch (error) {
    if (error.message && error.message.includes('already exists')) {
      return res.status(409).json({ error: 'Memory with this key already exists.' });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /memories/preferences
 * Updates the user's memory preferences (e.g., enabling/disabling memories).
 * Body: { memories: boolean }
 * Returns 200 and { updated: true, preferences: { memories: boolean } } when successful.
 */
router.patch('/preferences', requireJwtAuth, checkMemoryOptOut, async (req, res) => {
  const { memories } = req.body;

  if (typeof memories !== 'boolean') {
    return res.status(400).json({ error: 'memories must be a boolean value.' });
  }

  try {
    const updatedUser = await toggleUserMemories(req.user.id, memories);

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      updated: true,
      preferences: {
        memories: updatedUser.personalization?.memories ?? true,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /memories/:key
 * Updates the value of an existing memory entry for the authenticated user.
 * Body: { key?: string, value: string }
 * Returns 200 and { updated: true, memory: <updatedDoc> } when successful.
 */
router.patch('/:key', requireJwtAuth, memoryPayloadLimit, checkMemoryUpdate, configMiddleware, async (req, res) => {
  const { key: urlKey } = req.params;
  const { key: bodyKey, value } = req.body || {};

  if (typeof value !== 'string' || value.trim() === '') {
    return res.status(400).json({ error: 'Value is required and must be a non-empty string.' });
  }

  const newKey = bodyKey || urlKey;
  const appConfig = req.config;
  const memoryConfig = appConfig?.memory;
  const charLimit = memoryConfig?.charLimit || 10000;

  if (newKey.length > 1000) {
    return res.status(400).json({
      error: `Key exceeds maximum length of 1000 characters. Current length: ${newKey.length} characters.`,
    });
  }

  if (value.length > charLimit) {
    return res.status(400).json({
      error: `Value exceeds maximum length of ${charLimit} characters. Current length: ${value.length} characters.`,
    });
  }

  try {
    const tokenCount = Tokenizer.getTokenCount(value, 'o200k_base');

    const memories = await getAllUserMemories(req.user.id);
    const existingMemory = getMemoryByKey(memories, urlKey);

    if (!existingMemory) {
      return res.status(404).json({ error: 'Memory not found.' });
    }

    if (newKey !== urlKey) {
      const keyExists = getMemoryByKey(memories, newKey);
      if (keyExists) {
        return res.status(409).json({ error: 'Memory with this key already exists.' });
      }

      const createResult = await createMemory({
        userId: req.user.id,
        key: newKey,
        value,
        tokenCount,
      });

      if (!createResult.ok) {
        return res.status(500).json({ error: 'Failed to create new memory.' });
      }

      const deleteResult = await deleteMemory({ userId: req.user.id, key: urlKey });
      if (!deleteResult.ok) {
        return res.status(500).json({ error: 'Failed to delete old memory.' });
      }
    } else {
      const result = await setMemory({
        userId: req.user.id,
        key: newKey,
        value,
        tokenCount,
      });

      if (!result.ok) {
        return res.status(500).json({ error: 'Failed to update memory.' });
      }
    }

    const updatedMemories = await getAllUserMemories(req.user.id);
    const updatedMemory = getMemoryByKey(updatedMemories, newKey);

    res.json({ updated: true, memory: updatedMemory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /memories/:key
 * Deletes a memory entry for the authenticated user.
 * Returns 200 and { deleted: true } when successful.
 */
router.delete('/:key', requireJwtAuth, checkMemoryDelete, async (req, res) => {
  const { key } = req.params;

  try {
    const result = await deleteMemory({ userId: req.user.id, key });

    if (!result.ok) {
      return res.status(404).json({ error: 'Memory not found.' });
    }

    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /memories/confirm
 * Confirms a pending memory suggestion: creates the MemoryEntry and updates the message attachments.
 * Body: { messageId: string, key: string, value: string, category: string }
 */
router.post('/confirm', (req, res, next) => { console.log('[MEMCONFIRM] Request received, headers:', JSON.stringify(req.headers).substring(0, 200)); next(); }, requireJwtAuth, (req, res, next) => { console.log('[MEMCONFIRM] After requireJwtAuth, user:', req.user?.id); next(); }, memoryPayloadLimit, checkMemoryCreate, (req, res, next) => { console.log('[MEMCONFIRM] After checkMemoryCreate'); next(); }, configMiddleware, async (req, res) => {
  const { messageId, key, value, category } = req.body || {};
  console.log('[MEMCONFIRM] Handler reached, body:', JSON.stringify({ messageId, key, value: value?.substring(0,50), category }));
  if (!messageId || !key || !value || !category) {
    return res.status(400).json({ error: 'messageId, key, value, and category are required' });
  }

  try {
    // Create the memory entry
    const tokenCount = Tokenizer.getTokenCount(value, 'o200k_base');
    const result = await setMemory({
      userId: req.user.id,
      key,
      value,
      tokenCount,
      type: category,
    });

    if (!result.ok) {
      return res.status(500).json({ error: 'Failed to create memory' });
    }

    // Update message attachments status so it persists across page reloads
    const Message = require('~/db/models').Message;
    const msg = await Message.findOne({ messageId, user: req.user.id });
    if (msg) {
      const attachments = (msg.attachments || []).map((att) => {
        const mem = att?.memory;
        if (mem?.type === 'suggestion' && mem?.key === key) {
          return { ...att, memory: { ...mem, status: 'confirmed' } };
        }
        return att;
      });
      await Message.updateOne(
        { messageId, user: req.user.id },
        { $set: { attachments } },
      );
    }

    res.json({ confirmed: true, key, category });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /memories/dismiss
 * Dismisses a pending memory suggestion: updates the message attachments status only.
 * Body: { messageId: string, key: string }
 */
router.post('/dismiss', requireJwtAuth, memoryPayloadLimit, configMiddleware, async (req, res) => {
  const { messageId, key } = req.body || {};
  if (!messageId || !key) {
    return res.status(400).json({ error: 'messageId and key are required' });
  }

  try {
    const Message = require('~/db/models').Message;
    const msg = await Message.findOne({ messageId, user: req.user.id });
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const attachments = (msg.attachments || []).map((att) => {
      const mem = att?.memory;
      if (mem?.type === 'suggestion' && mem?.key === key) {
        return { ...att, memory: { ...mem, status: 'dismissed' } };
      }
      return att;
    });
    await Message.updateOne(
      { messageId, user: req.user.id },
      { $set: { attachments } },
    );

    res.json({ dismissed: true, key });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
