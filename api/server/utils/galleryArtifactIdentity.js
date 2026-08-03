function compareMessagesChronologically(a, b) {
  const createdAtDiff = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  const idDiff = String(a._id || '').localeCompare(String(b._id || ''));
  if (idDiff !== 0) {
    return idDiff;
  }

  return String(a.messageId || '').localeCompare(String(b.messageId || ''));
}

function getMessagesThroughTarget(messages, targetMessageId) {
  if (!targetMessageId) {
    return null;
  }

  const sortedMessages = [...messages].sort(compareMessagesChronologically);
  const targetIndex = sortedMessages.findIndex((message) => message.messageId === targetMessageId);
  if (targetIndex < 0) {
    return null;
  }

  return sortedMessages.slice(0, targetIndex + 1);
}

function getGalleryVersionProvenance(artifact) {
  return {
    sourceArtifactId: artifact?.sourceArtifactId || null,
    targetMessageId: artifact?.targetMessageId || artifact?.messageId || null,
  };
}

function buildSolidificationArtifactQuery({ artifactId, userId, conversationId, targetMessageId }) {
  return {
    galleryArtifactId: artifactId,
    userId,
    conversationId,
    targetMessageId,
  };
}

module.exports = {
  buildSolidificationArtifactQuery,
  compareMessagesChronologically,
  getMessagesThroughTarget,
  getGalleryVersionProvenance,
};
