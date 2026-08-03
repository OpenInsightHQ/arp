import type { PublishArtifactPayload } from 'librechat-data-provider';

export type SelectedArtifactForPublish = {
  id: string;
  title?: string;
  type?: string;
  messageId?: string;
  content?: string;
};

type PublishSettings = {
  title: string;
  conversationId: string;
  autoUpdate: boolean;
  updateFrequency: 'daily' | 'weekly' | 'monthly';
  updateTime: string;
  agentId: string | null;
  agentName: string | null;
};

export const buildArtifactPublishPayload = (
  artifact: SelectedArtifactForPublish,
  settings: PublishSettings,
): PublishArtifactPayload => {
  if (!artifact.id || !artifact.messageId) {
    throw new Error('The selected artifact identity is incomplete');
  }

  const type =
    artifact.type === 'skill' || artifact.type === 'code' || artifact.type === 'application/react'
      ? 'SKILL'
      : 'HTML';

  return {
    title: settings.title.trim(),
    type,
    sourceArtifactId: artifact.id,
    conversationId: settings.conversationId,
    messageId: artifact.messageId,
    targetMessageId: artifact.messageId,
    content: artifact.content ?? '',
    autoUpdate: settings.autoUpdate,
    updateFrequency: settings.autoUpdate ? settings.updateFrequency : null,
    updateTime: settings.autoUpdate ? settings.updateTime : null,
    isPublic: true,
    agentId: settings.agentId,
    agentName: settings.agentName,
  };
};
