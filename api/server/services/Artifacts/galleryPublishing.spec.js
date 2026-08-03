const {
  appendGalleryVersion,
  getPublishIdentity,
  upsertGallerySqlQueries,
  upsertLegacyPublishedArtifact,
  upsertPublishedArtifact,
} = require('./galleryPublishing');

const matches = (document, filter) =>
  Object.entries(filter).every(([key, value]) => {
    if (key === '$or') {
      return value.some((candidate) => matches(document, candidate));
    }
    if (value && typeof value === 'object' && '$exists' in value) {
      return Object.prototype.hasOwnProperty.call(document, key) === value.$exists;
    }
    return String(document[key]) === String(value);
  });

const applyUpdate = (document, update, inserted) => {
  if (inserted && update.$setOnInsert) {
    Object.assign(document, update.$setOnInsert);
  }
  if (update.$set) {
    Object.assign(document, update.$set);
  }
  for (const [key, amount] of Object.entries(update.$inc || {})) {
    document[key] = (document[key] || 0) + amount;
  }
  return document;
};

const createMemoryModel = () => {
  const records = [];
  return {
    records,
    async findOneAndUpdate(filter, update, options = {}) {
      let record = records.find((item) => matches(item, filter));
      const inserted = !record;
      if (!record && !options.upsert) {
        return null;
      }
      if (!record) {
        record = { _id: `record-${records.length + 1}` };
        records.push(record);
      }
      return applyUpdate(record, update, inserted);
    },
    async create(data) {
      const record = { _id: `record-${records.length + 1}`, ...data };
      records.push(record);
      return record;
    },
  };
};

const basePayload = (overrides = {}) => ({
  title: 'Report',
  sourceArtifactId: 'artifact-a',
  targetMessageId: 'message-1',
  messageId: 'message-1',
  conversationId: 'conversation-1',
  content: '<html>report</html>',
  ...overrides,
});

describe('atomic gallery publishing', () => {
  let GalleryArtifact;
  let GalleryVersion;

  beforeEach(() => {
    GalleryArtifact = createMemoryModel();
    GalleryVersion = createMemoryModel();
  });

  const publish = async (userId, payload) => {
    const published = await upsertPublishedArtifact({ GalleryArtifact, userId, payload });
    const version = await appendGalleryVersion({
      GalleryArtifact,
      GalleryVersion,
      artifact: published.artifact,
      versionData: { html: payload.content, createdBy: 'user', status: 'success' },
    });
    return { ...published, ...version };
  };

  test('one source Artifact with three Message IDs creates three Gallery V1 reports', async () => {
    for (const targetMessageId of ['message-1', 'message-2', 'message-3']) {
      const result = await publish(
        'user-1',
        basePayload({ messageId: targetMessageId, targetMessageId }),
      );
      expect(result.version).toBe(1);
    }

    expect(GalleryArtifact.records).toHaveLength(3);
    expect(new Set(GalleryArtifact.records.map((item) => item.galleryArtifactId)).size).toBe(3);
  });

  test('three source Artifact IDs with one Message ID creates three Gallery V1 reports', async () => {
    for (const sourceArtifactId of ['artifact-a', 'artifact-b', 'artifact-c']) {
      const result = await publish('user-1', basePayload({ sourceArtifactId }));
      expect(result.version).toBe(1);
    }

    expect(GalleryArtifact.records).toHaveLength(3);
  });

  test('exact republish appends Gallery V2 without affecting another report', async () => {
    const first = await publish('user-1', basePayload());
    const other = await publish(
      'user-1',
      basePayload({ messageId: 'message-2', targetMessageId: 'message-2' }),
    );
    const republished = await publish(
      'user-1',
      basePayload({ conversationId: 'different-provenance', content: '<html>updated</html>' }),
    );

    expect(republished.artifact.galleryArtifactId).toBe(first.artifact.galleryArtifactId);
    expect(republished.version).toBe(2);
    expect(other.artifact.currentVersion).toBe(1);
    expect(republished.artifact.conversationId).toBe('conversation-1');
    expect(GalleryArtifact.records).toHaveLength(2);
  });

  test('different users publish the same composite identity independently', async () => {
    const first = await publish('user-1', basePayload());
    const second = await publish('user-2', basePayload());

    expect(first.artifact.galleryArtifactId).not.toBe(second.artifact.galleryArtifactId);
    expect(GalleryArtifact.records).toHaveLength(2);
  });

  test('concurrent exact duplicate requests create one GalleryArtifact', async () => {
    const results = await Promise.all([
      publish('user-1', basePayload()),
      publish('user-1', basePayload()),
      publish('user-1', basePayload()),
    ]);

    expect(GalleryArtifact.records).toHaveLength(1);
    expect(new Set(results.map((result) => result.artifact.galleryArtifactId)).size).toBe(1);
    expect(GalleryVersion.records).toHaveLength(3);
  });

  test('every GalleryVersion carries source Artifact ID and target Message ID', async () => {
    await publish(
      'user-1',
      basePayload({
        sourceArtifactId: 'artifact-z',
        messageId: 'message-9',
        targetMessageId: 'message-9',
      }),
    );

    expect(GalleryVersion.records[0]).toMatchObject({
      sourceArtifactId: 'artifact-z',
      targetMessageId: 'message-9',
      version: 1,
    });
  });
});

describe('publish validation and SQL isolation', () => {
  test('rejects a missing source Artifact ID or selected Message ID', () => {
    expect(() => getPublishIdentity({ targetMessageId: 'message-1' })).toThrow(
      'sourceArtifactId is required',
    );
    expect(() => getPublishIdentity({ sourceArtifactId: 'artifact-a' })).toThrow(
      'targetMessageId is required',
    );
  });

  test('keeps the previous conversation and message match for legacy payloads only', async () => {
    const GalleryArtifact = createMemoryModel();
    const payload = {
      title: 'Legacy report',
      conversationId: 'conversation-1',
      messageId: 'message-1',
    };

    const first = await upsertLegacyPublishedArtifact({
      GalleryArtifact,
      userId: 'user-1',
      payload,
    });
    const second = await upsertLegacyPublishedArtifact({
      GalleryArtifact,
      userId: 'user-1',
      payload,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(GalleryArtifact.records).toHaveLength(1);
  });

  test.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
  ])('recognizes %s source Artifact IDs as legacy data', async (_label, sourceArtifactId) => {
    const GalleryArtifact = createMemoryModel();
    const legacyRecord = {
      galleryArtifactId: 'gallery-legacy',
      userId: 'user-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      title: 'Legacy report',
    };
    if (sourceArtifactId !== undefined) {
      legacyRecord.sourceArtifactId = sourceArtifactId;
    }
    await GalleryArtifact.create(legacyRecord);

    const result = await upsertLegacyPublishedArtifact({
      GalleryArtifact,
      userId: 'user-1',
      payload: {
        title: 'Updated legacy report',
        conversationId: 'conversation-1',
        messageId: 'message-1',
      },
    });

    expect(result.created).toBe(false);
    expect(result.artifact.galleryArtifactId).toBe('gallery-legacy');
    expect(GalleryArtifact.records).toHaveLength(1);
  });

  test('legacy request updates only a legacy record when a new identity record shares its origin', async () => {
    const GalleryArtifact = createMemoryModel();
    const sharedOrigin = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      targetMessageId: 'message-1',
    };
    const newRecord = await GalleryArtifact.create({
      galleryArtifactId: 'gallery-new',
      sourceArtifactId: 'artifact-a',
      title: 'New identity report',
      ...sharedOrigin,
    });
    const legacyRecord = await GalleryArtifact.create({
      galleryArtifactId: 'gallery-legacy',
      sourceArtifactId: null,
      title: 'Legacy report',
      ...sharedOrigin,
    });

    const result = await upsertLegacyPublishedArtifact({
      GalleryArtifact,
      userId: 'user-1',
      payload: {
        title: 'Updated legacy report',
        conversationId: 'conversation-1',
        messageId: 'message-1',
      },
    });

    expect(result.created).toBe(false);
    expect(result.artifact.galleryArtifactId).toBe('gallery-legacy');
    expect(legacyRecord.title).toBe('Updated legacy report');
    expect(newRecord.title).toBe('New identity report');
    expect(newRecord.sourceArtifactId).toBe('artifact-a');
  });

  test('legacy request creates a legacy record instead of touching a matching new identity record', async () => {
    const GalleryArtifact = createMemoryModel();
    const newRecord = await GalleryArtifact.create({
      galleryArtifactId: 'gallery-new',
      userId: 'user-1',
      sourceArtifactId: 'artifact-a',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      targetMessageId: 'message-1',
      title: 'New identity report',
    });

    const result = await upsertLegacyPublishedArtifact({
      GalleryArtifact,
      userId: 'user-1',
      payload: {
        title: 'Legacy report',
        conversationId: 'conversation-1',
        messageId: 'message-1',
      },
    });

    expect(result.created).toBe(true);
    expect(result.artifact.galleryArtifactId).not.toBe('gallery-new');
    expect(result.artifact.sourceArtifactId).toBeNull();
    expect(newRecord.title).toBe('New identity report');
    expect(GalleryArtifact.records).toHaveLength(2);
  });

  test('keeps SQL records isolated by GalleryArtifact and target Message ID', async () => {
    const GallerySqlQuery = createMemoryModel();
    const first = {
      galleryArtifactId: 'gallery-a',
      sourceArtifactId: 'artifact-a',
      targetMessageId: 'message-1',
    };
    const second = {
      galleryArtifactId: 'gallery-b',
      sourceArtifactId: 'artifact-a',
      targetMessageId: 'message-2',
    };

    await upsertGallerySqlQueries({
      GallerySqlQuery,
      artifact: first,
      userId: 'user-1',
      queries: [{ sql: 'SELECT 1' }],
      extractedBy: 'tool_calls',
    });
    await upsertGallerySqlQueries({
      GallerySqlQuery,
      artifact: second,
      userId: 'user-1',
      queries: [{ sql: 'SELECT 2' }],
      extractedBy: 'tool_calls',
    });
    await upsertGallerySqlQueries({
      GallerySqlQuery,
      artifact: second,
      userId: 'user-1',
      queries: [{ sql: 'SELECT 3' }],
      extractedBy: 'tool_calls',
    });

    expect(GallerySqlQuery.records).toHaveLength(2);
    expect(
      GallerySqlQuery.records.find((item) => item.galleryArtifactId === 'gallery-a'),
    ).toMatchObject({
      targetMessageId: 'message-1',
      queries: [{ sql: 'SELECT 1' }],
    });
    expect(
      GallerySqlQuery.records.find((item) => item.galleryArtifactId === 'gallery-b'),
    ).toMatchObject({
      targetMessageId: 'message-2',
      queries: [{ sql: 'SELECT 3' }],
    });
  });
});
