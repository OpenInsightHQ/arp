const mongoose = require('mongoose');

const AclEntry =
  mongoose.models.AclEntry ||
  mongoose.model('AclEntry', new mongoose.Schema({}, { strict: false }));
const User =
  mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }));
const { GallerySchedule } = require('./GallerySchedule');
const {
  GalleryArtifact,
  getGalleryArtifacts,
  getPublicGalleryArtifacts,
} = require('./GalleryArtifact');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const queryFor = (value) => {
  const promise = value instanceof Promise ? value : Promise.resolve(value);
  const query = {
    select: jest.fn(),
    sort: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(() => promise),
  };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('gallery artifact list service', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const sharedArtifactId = new mongoose.Types.ObjectId();
  const publicArtifactId = new mongoose.Types.ObjectId();
  const createdAt = new Date('2026-07-01T00:00:00.000Z');
  const updatedAt = new Date('2026-07-02T00:00:00.000Z');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('preserves authorized results and enrichments while running independent reads in parallel', async () => {
    const userAcl = deferred();
    const publicAcl = deferred();
    const users = deferred();
    const schedules = deferred();
    const artifactQuery = queryFor([
      {
        _id: sharedArtifactId,
        galleryArtifactId: 'shared-report',
        userId: ownerId,
        title: 'Shared report',
        type: 'HTML',
        content: '<html>shared</html>',
        preview: 'preview.png',
        conversationId: 'conversation-1',
        sourceArtifactId: 'source-1',
        messageId: 'message-1',
        targetMessageId: 'message-1',
        isPublic: false,
        viewCount: 12,
        likeCount: 4,
        createdAt,
        updatedAt,
        messages: ['large unused payload'],
        currentVersion: 9,
      },
      {
        _id: publicArtifactId,
        galleryArtifactId: 'public-report',
        userId: ownerId,
        title: 'Public report',
        type: 'HTML',
        content: '<html>public</html>',
        isPublic: true,
        viewCount: 2,
        likeCount: 1,
        createdAt,
        updatedAt,
      },
    ]);

    jest
      .spyOn(AclEntry, 'find')
      .mockImplementation((filter) =>
        queryFor(filter.principalType === 'user' ? userAcl.promise : publicAcl.promise),
      );
    const artifactFind = jest.spyOn(GalleryArtifact, 'find').mockReturnValue(artifactQuery);
    const userFind = jest.spyOn(User, 'find').mockReturnValue(queryFor(users.promise));
    const scheduleFind = jest
      .spyOn(GallerySchedule, 'find')
      .mockReturnValue(queryFor(schedules.promise));

    const resultPromise = getGalleryArtifacts(ownerId.toString(), { type: 'HTML' });
    await flushPromises();

    expect(AclEntry.find).toHaveBeenCalledTimes(2);
    expect(artifactFind).not.toHaveBeenCalled();

    userAcl.resolve([{ resourceId: sharedArtifactId }]);
    publicAcl.resolve([{ resourceId: publicArtifactId }]);
    await flushPromises();

    expect(artifactFind).toHaveBeenCalledTimes(1);
    expect(userFind).toHaveBeenCalledTimes(1);
    expect(scheduleFind).toHaveBeenCalledTimes(1);

    users.resolve([
      { _id: ownerId, name: 'Report Owner', username: 'owner', avatar: 'avatar.png' },
    ]);
    schedules.resolve([
      {
        galleryArtifactId: 'shared-report',
        enabled: false,
        runStatus: 'failed',
        consecutiveFailures: 3,
        disabledReason: 'retry limit',
        lastError: 'timeout',
        nextRunAt: new Date('2026-07-03T00:00:00.000Z'),
      },
    ]);

    const result = await resultPromise;
    const filter = artifactFind.mock.calls[0][0];
    expect(filter.$or).toEqual([
      { userId: ownerId, type: 'HTML' },
      { _id: { $in: [sharedArtifactId, publicArtifactId] }, type: 'HTML' },
    ]);

    const projection = artifactQuery.select.mock.calls[0][0];
    expect(projection).toContain('content');
    expect(projection).not.toContain('messages');
    expect(projection).not.toContain('currentVersion');
    expect(projection).not.toContain('skillPath');

    expect(result.artifacts.map((artifact) => artifact.id)).toEqual([
      'shared-report',
      'public-report',
    ]);
    expect(result.artifacts[0]).toMatchObject({
      title: 'Shared report',
      content: '<html>shared</html>',
      likes: 4,
      likeCount: 4,
      viewCount: 12,
      user: {
        id: ownerId.toString(),
        username: 'owner',
        name: 'Report Owner',
        avatar: 'avatar.png',
      },
      schedule: {
        enabled: false,
        runStatus: 'failed',
        consecutiveFailures: 3,
        disabledReason: 'retry limit',
        lastError: 'timeout',
        nextRunAt: '2026-07-03T00:00:00.000Z',
      },
    });
    expect(result.artifacts[0]).not.toHaveProperty('messages');
    expect(result.artifacts[0]).not.toHaveProperty('currentVersion');
  });

  test('keeps public SKILL pagination and card fields with the safe projection', async () => {
    const firstId = new mongoose.Types.ObjectId();
    const secondId = new mongoose.Types.ObjectId();
    const artifactQuery = queryFor([
      {
        _id: firstId,
        galleryArtifactId: 'skill-1',
        userId: ownerId,
        title: 'Skill one',
        type: 'SKILL',
        content: 'skill content',
        preview: 'skill.png',
        likeCount: 7,
        createdAt,
        updatedAt,
      },
      {
        _id: secondId,
        galleryArtifactId: 'skill-2',
        userId: ownerId,
        title: 'Skill two',
        type: 'SKILL',
        content: 'second skill',
        createdAt,
        updatedAt,
      },
    ]);

    const artifactFind = jest.spyOn(GalleryArtifact, 'find').mockReturnValue(artifactQuery);
    jest
      .spyOn(User, 'find')
      .mockReturnValue(queryFor([{ _id: ownerId, name: 'Skill Owner', username: 'skill-owner' }]));

    const result = await getPublicGalleryArtifacts({ type: 'SKILL', pageSize: 1 });

    expect(artifactFind).toHaveBeenCalledWith({ isPublic: true, type: 'SKILL' });
    expect(artifactQuery.limit).toHaveBeenCalledWith(2);
    expect(artifactQuery.select.mock.calls[0][0]).not.toContain('messages');
    expect(result).toMatchObject({
      hasNextPage: true,
      nextCursor: firstId,
      artifacts: [
        {
          id: 'skill-1',
          type: 'SKILL',
          content: 'skill content',
          preview: 'skill.png',
          likes: 7,
          likeCount: 7,
          user: {
            id: ownerId.toString(),
            username: 'skill-owner',
            name: 'Skill Owner',
          },
        },
      ],
    });
  });
});
