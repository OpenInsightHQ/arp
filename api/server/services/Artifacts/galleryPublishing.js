const crypto = require('crypto');

const createGalleryArtifactId = () =>
  `gal_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

const getPublishIdentity = ({ sourceArtifactId, targetMessageId, messageId }) => {
  const normalizedSourceArtifactId =
    typeof sourceArtifactId === 'string' ? sourceArtifactId.trim() : '';
  let normalizedTargetMessageId = '';
  if (typeof targetMessageId === 'string' && targetMessageId.trim()) {
    normalizedTargetMessageId = targetMessageId.trim();
  } else if (typeof messageId === 'string') {
    normalizedTargetMessageId = messageId.trim();
  }

  if (!normalizedSourceArtifactId) {
    const error = new Error('sourceArtifactId is required');
    error.statusCode = 400;
    throw error;
  }
  if (!normalizedTargetMessageId) {
    const error = new Error('targetMessageId is required');
    error.statusCode = 400;
    throw error;
  }
  if (
    typeof messageId === 'string' &&
    messageId.trim() &&
    typeof targetMessageId === 'string' &&
    targetMessageId.trim() &&
    messageId.trim() !== targetMessageId.trim()
  ) {
    const error = new Error(
      'messageId and targetMessageId must identify the same selected version',
    );
    error.statusCode = 400;
    throw error;
  }

  return {
    sourceArtifactId: normalizedSourceArtifactId,
    targetMessageId: normalizedTargetMessageId,
  };
};

const buildPublishIdentityFilter = (userId, identity) => ({
  userId,
  sourceArtifactId: identity.sourceArtifactId,
  targetMessageId: identity.targetMessageId,
});

const getMutableArtifactFields = (payload) => ({
  title: payload.title,
  type: payload.type || 'HTML',
  content: payload.content || '',
  preview: payload.preview ?? null,
  autoUpdate: Boolean(payload.autoUpdate),
  updateFrequency: payload.updateFrequency || null,
  updateTime: payload.updateTime || null,
  isPublic: Boolean(payload.isPublic),
  agentId: payload.agentId || null,
  agentName: payload.agentName || null,
});

const getVersionIdentity = (artifact) => ({
  sourceArtifactId: artifact.sourceArtifactId ?? null,
  targetMessageId: artifact.targetMessageId ?? artifact.messageId ?? null,
});

const upsertPublishedArtifact = async ({ GalleryArtifact, userId, payload }) => {
  const identity = getPublishIdentity(payload);
  const identityFilter = buildPublishIdentityFilter(userId, identity);
  const candidateGalleryArtifactId = createGalleryArtifactId();
  const mutableFields = getMutableArtifactFields(payload);
  const update = {
    $set: mutableFields,
    $setOnInsert: {
      galleryArtifactId: candidateGalleryArtifactId,
      userId,
      sourceArtifactId: identity.sourceArtifactId,
      targetMessageId: identity.targetMessageId,
      messageId: identity.targetMessageId,
      conversationId: payload.conversationId || null,
      currentVersion: 0,
    },
  };

  let artifact;
  try {
    artifact = await GalleryArtifact.findOneAndUpdate(identityFilter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    artifact = await GalleryArtifact.findOneAndUpdate(
      identityFilter,
      { $set: mutableFields },
      { new: true },
    );
    if (!artifact) {
      throw error;
    }
  }

  return {
    artifact,
    created: artifact.galleryArtifactId === candidateGalleryArtifactId,
    identity,
  };
};

const upsertLegacyPublishedArtifact = async ({ GalleryArtifact, userId, payload }) => {
  const messageId = payload.messageId || payload.targetMessageId || null;
  const legacyFilter = {
    userId,
    conversationId: payload.conversationId || null,
    messageId,
    $or: [
      { sourceArtifactId: { $exists: false } },
      { sourceArtifactId: null },
      { sourceArtifactId: '' },
    ],
  };
  const mutableFields = getMutableArtifactFields(payload);
  let artifact = await GalleryArtifact.findOneAndUpdate(
    legacyFilter,
    {
      $set: {
        ...mutableFields,
        targetMessageId: payload.targetMessageId || messageId,
      },
    },
    { new: true },
  );

  if (artifact) {
    return { artifact, created: false, identity: null };
  }

  artifact = await GalleryArtifact.create({
    galleryArtifactId: createGalleryArtifactId(),
    userId,
    ...mutableFields,
    conversationId: payload.conversationId || null,
    sourceArtifactId: null,
    messageId,
    targetMessageId: payload.targetMessageId || messageId,
    currentVersion: 0,
  });

  return { artifact, created: true, identity: null };
};

const appendGalleryVersion = async ({ GalleryArtifact, GalleryVersion, artifact, versionData }) => {
  const identity = getVersionIdentity(artifact);
  const updatedArtifact = await GalleryArtifact.findOneAndUpdate(
    {
      galleryArtifactId: artifact.galleryArtifactId,
      userId: artifact.userId,
      sourceArtifactId: identity.sourceArtifactId,
      targetMessageId: identity.targetMessageId,
    },
    { $inc: { currentVersion: 1 } },
    { new: true },
  );

  if (!updatedArtifact) {
    throw new Error('Gallery artifact identity changed while appending a version');
  }

  const version = updatedArtifact.currentVersion;
  const versionRecord = await GalleryVersion.create({
    galleryArtifactId: updatedArtifact.galleryArtifactId,
    version,
    sourceArtifactId: identity.sourceArtifactId,
    targetMessageId: identity.targetMessageId,
    ...versionData,
  });

  return { artifact: updatedArtifact, versionRecord, version };
};

const upsertGallerySqlQueries = async ({
  GallerySqlQuery,
  artifact,
  userId,
  queries,
  extractedBy,
}) => {
  const identity = getVersionIdentity(artifact);
  const mutableFields = {
    queries,
    extractedBy: extractedBy || 'agent',
    sourceArtifactId: identity.sourceArtifactId,
    targetMessageId: identity.targetMessageId,
  };
  try {
    return await GallerySqlQuery.findOneAndUpdate(
      { galleryArtifactId: artifact.galleryArtifactId },
      {
        $set: mutableFields,
        $setOnInsert: {
          galleryArtifactId: artifact.galleryArtifactId,
          userId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
    return GallerySqlQuery.findOneAndUpdate(
      { galleryArtifactId: artifact.galleryArtifactId },
      { $set: mutableFields },
      { new: true },
    );
  }
};

module.exports = {
  appendGalleryVersion,
  buildPublishIdentityFilter,
  getPublishIdentity,
  getVersionIdentity,
  upsertGallerySqlQueries,
  upsertLegacyPublishedArtifact,
  upsertPublishedArtifact,
};
