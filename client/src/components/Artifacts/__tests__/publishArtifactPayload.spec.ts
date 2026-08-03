import { buildArtifactPublishPayload } from '../publishArtifactPayload';

const settings = {
  title: 'Selected report',
  conversationId: 'conversation-1',
  autoUpdate: false,
  updateFrequency: 'daily' as const,
  updateTime: '09:00',
  agentId: 'agent-1',
  agentName: 'Agent',
};

describe('buildArtifactPublishPayload', () => {
  test.each([
    ['V1', 'message-1', '<html>version 1</html>'],
    ['V2', 'message-2', '<html>version 2</html>'],
    ['V3', 'message-3', '<html>version 3</html>'],
  ])('publishes the currently selected %s identity and content', (_version, messageId, content) => {
    expect(
      buildArtifactPublishPayload(
        {
          id: 'artifact-a',
          messageId,
          content,
          type: 'text/html',
        },
        settings,
      ),
    ).toMatchObject({
      sourceArtifactId: 'artifact-a',
      messageId,
      targetMessageId: messageId,
      content,
    });
  });

  test('rejects an incomplete selected Artifact identity', () => {
    expect(() =>
      buildArtifactPublishPayload({ id: 'artifact-a', content: 'report' }, settings),
    ).toThrow('selected artifact identity is incomplete');
  });
});
