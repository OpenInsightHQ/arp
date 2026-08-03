jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const {
  buildSolidificationArtifactQuery,
  getMessagesThroughTarget,
  getGalleryVersionProvenance,
} = require('./galleryArtifactIdentity');

describe('gallery report message boundary', () => {
  test('sorts deterministically, includes the target, and excludes later messages', () => {
    const messages = [
      { _id: '3', messageId: 'later', createdAt: '2026-01-01T00:00:02.000Z' },
      { _id: '2', messageId: 'target', createdAt: '2026-01-01T00:00:01.000Z' },
      { _id: '1', messageId: 'before', createdAt: '2026-01-01T00:00:01.000Z' },
    ];

    expect(
      getMessagesThroughTarget(messages, 'target').map((message) => message.messageId),
    ).toEqual(['before', 'target']);
  });

  test('does not fall back to the whole conversation when the target is missing', () => {
    expect(getMessagesThroughTarget([{ messageId: 'message-1' }], 'missing')).toBeNull();
    expect(getMessagesThroughTarget([{ messageId: 'message-1' }], null)).toBeNull();
  });
});

describe('gallery solidification identity', () => {
  test('binds owner, conversation, gallery record, and persisted target', () => {
    expect(
      buildSolidificationArtifactQuery({
        artifactId: 'gallery-1',
        userId: 'user-1',
        conversationId: 'conversation-1',
        targetMessageId: 'message-1',
      }),
    ).toEqual({
      galleryArtifactId: 'gallery-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      targetMessageId: 'message-1',
    });
  });
});

describe('gallery version provenance', () => {
  test('keeps the published report source and message anchor', () => {
    expect(
      getGalleryVersionProvenance({
        sourceArtifactId: 'artifact-a',
        targetMessageId: 'message-2',
        messageId: 'legacy-message',
      }),
    ).toEqual({
      sourceArtifactId: 'artifact-a',
      targetMessageId: 'message-2',
    });
  });

  test('keeps legacy message provenance when targetMessageId is absent', () => {
    expect(getGalleryVersionProvenance({ messageId: 'legacy-message' })).toEqual({
      sourceArtifactId: null,
      targetMessageId: 'legacy-message',
    });
  });
});

describe('gallery provenance schema', () => {
  test('stores report identity on artifacts with a legacy-safe partial unique index', () => {
    const { GalleryArtifact } = require('../../models/GalleryArtifact');
    const identityIndex = GalleryArtifact.schema
      .indexes()
      .find(
        ([fields]) =>
          fields.userId === 1 && fields.sourceArtifactId === 1 && fields.targetMessageId === 1,
      );

    expect(GalleryArtifact.schema.path('sourceArtifactId')).toBeDefined();
    expect(identityIndex?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: {
        sourceArtifactId: { $type: 'string' },
        targetMessageId: { $type: 'string' },
      },
    });
  });

  test('stores report provenance on every gallery version', () => {
    const { GalleryVersion } = require('../../models/GalleryVersion');

    expect(GalleryVersion.schema.path('sourceArtifactId')).toBeDefined();
    expect(GalleryVersion.schema.path('targetMessageId')).toBeDefined();
  });

  test('indexes SQL and schedule records without a legacy-breaking uniqueness migration', () => {
    const { GallerySqlQuery } = require('../../models/GallerySqlQuery');
    const { GallerySchedule } = require('../../models/GallerySchedule');
    const sqlIndex = GallerySqlQuery.schema
      .indexes()
      .find(([fields]) => fields.galleryArtifactId === 1);
    const scheduleIndex = GallerySchedule.schema
      .indexes()
      .find(([fields]) => fields.galleryArtifactId === 1);

    expect(sqlIndex).toBeDefined();
    expect(scheduleIndex).toBeDefined();
    expect(sqlIndex?.[1].unique).not.toBe(true);
    expect(scheduleIndex?.[1].unique).not.toBe(true);
    expect(GallerySqlQuery.schema.path('sourceArtifactId')).toBeDefined();
    expect(GallerySqlQuery.schema.path('targetMessageId')).toBeDefined();
  });
});
