const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');

/**
 * GalleryLike Schema - 点赞关系持久化
 */
const galleryLikeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    galleryArtifactId: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    unique: true,
    timestamps: false,
  },
);

// 复合唯一索引： 一个用户对一个作品只能有一条点赞记录
galleryLikeSchema.index({ userId: 1, galleryArtifactId: 1 }, { unique: true });

const GalleryLike = mongoose.models.GalleryLike || mongoose.model('GalleryLike', galleryLikeSchema);

/**
 * GalleryArtifact Schema
 */
const galleryArtifactSchema = new mongoose.Schema(
  {
    galleryArtifactId: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
    },
    type: {
      type: String,
      enum: ['HTML', 'SKILL'],
      default: 'HTML',
      index: true,
    },
    content: {
      type: String,
      default: '',
    },
    preview: {
      type: String,
      default: null,
    },
    conversationId: {
      type: String,
      default: null,
      index: true,
    },
    sourceArtifactId: {
      type: String,
      default: null,
    },
    messageId: {
      type: String,
      default: null,
    },
    targetMessageId: {
      type: String,
      default: null,
    },
    messages: {
      type: mongoose.Schema.Types.Mixed,
      default: [],
    },
    autoUpdate: {
      type: Boolean,
      default: false,
    },
    updateFrequency: {
      type: String,
      default: null,
      enum: ['realtime', 'hourly', 'daily', 'weekly', 'monthly', null],
    },
    updateTime: {
      type: String,
      default: null,
    },
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    likeCount: {
      type: Number,
      default: 0,
    },
    // 关联调度配置（如果有）
    scheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GallerySchedule',
      default: null,
    },
    // PI 服务 Skill 信息
    skillId: {
      type: String,
      default: null,
    },
    skillPath: {
      type: String,
      default: null,
    },
    // Agent 信息
    agentId: {
      type: String,
      default: null,
    },
    agentName: {
      type: String,
      default: null,
    },
    // 当前版本号
    currentVersion: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
    collection: 'galleryartifacts',
  },
);

// 复合索引： 用户 + 更新时间
galleryArtifactSchema.index({ userId: 1, updatedAt: -1 });
galleryArtifactSchema.index({ userId: 1, type: 1, updatedAt: -1 });
galleryArtifactSchema.index({ isPublic: 1, updatedAt: -1 });
galleryArtifactSchema.index(
  { userId: 1, sourceArtifactId: 1, targetMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sourceArtifactId: { $type: 'string' },
      targetMessageId: { $type: 'string' },
    },
  },
);

const GalleryArtifact = mongoose.models.GalleryArtifact || mongoose.model('GalleryArtifact', galleryArtifactSchema);

const GALLERY_LIST_PROJECTION = [
  '_id',
  'galleryArtifactId',
  'userId',
  'title',
  'type',
  'content',
  'preview',
  'conversationId',
  'sourceArtifactId',
  'messageId',
  'targetMessageId',
  'isPublic',
  'viewCount',
  'likeCount',
  'createdAt',
  'updatedAt',
].join(' ');

/**
 * 生成唯一 galleryArtifactId
 */
const generateGalleryArtifactId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `gal_${timestamp}_${random}`;
};

/**
 * 获取用户的作品列表（包括自己的 + 授权给自己的）
 */
const getGalleryArtifacts = async (userId, params = {}) => {
  const {
    pageParam,
    pageSize = 20,
    sortBy = 'updatedAt',
    sortDirection = 'desc',
    type,
    search,
  } = params;

  // 1. 先查询 ACL，找到授权给当前用户的作品 ID
  const AclEntry = mongoose.model('AclEntry');
  const [aclEntries, publicAclEntries] = await Promise.all([
    AclEntry.find({
      principalType: 'user',  // 注意：小写，与数据库中的一致
      principalId: new mongoose.Types.ObjectId(userId),
      resourceType: 'galleryArtifact',
    }).select('resourceId').lean(),
    // 2. 查询 PUBLIC 授权的作品（授权给所有用户）
    AclEntry.find({
      principalType: 'public',
      resourceType: 'galleryArtifact',
    }).select('resourceId').lean(),
  ]);
  
  const authorizedArtifactIds = [
    ...aclEntries.map(entry => entry.resourceId),
    ...publicAclEntries.map(entry => entry.resourceId),
  ];

  // 2. 构建查询条件：自己的作品 OR 授权给自己的作品
  const filter = {
    $or: [
      { userId: new mongoose.Types.ObjectId(userId) },  // 自己的作品
      { _id: { $in: authorizedArtifactIds } },  // 授权给自己的作品
    ],
  };

  // 类型过滤
  if (type) {
    if (['HTML', 'SKILL'].includes(type)) {
      filter.$or[0].type = type;
      filter.$or[1].type = type;
    } else {
      logger.warn('[getGalleryArtifacts] Invalid type filter:', type, 'Expected: HTML or SKILL');
      return {
        artifacts: [],
        nextCursor: null,
        hasNextPage: false,
      };
    }
  }

  // 搜索过滤 - 支持 title、content、type 多字段搜索
  if (search && search.trim()) {
    const searchQuery = search.trim();
    
    // 构建多字段搜索条件（OR 逻辑）
    const searchConditions = [
      { title: { $regex: searchQuery, $options: 'i' } },  // 标题搜索
      { content: { $regex: searchQuery, $options: 'i' } }, // 内容搜索
    ];
    
    // 如果搜索词匹配类型，也加入搜索条件
    if (['HTML', 'SKILL'].includes(searchQuery.toUpperCase())) {
      searchConditions.push({ type: searchQuery.toUpperCase() });
    }
    
    // 将搜索条件应用到两个 $or 分支
    filter.$or[0].$and = searchConditions;
    filter.$or[1].$and = searchConditions;
  }

  // 游标分页
  if (pageParam) {
    filter._id = sortDirection === 'desc' ? { $lt: pageParam } : { $gt: pageParam };
  }

  const sort = { [sortBy]: sortDirection === 'desc' ? -1 : 1 };

  const artifacts = await GalleryArtifact.find(filter)
    .select(GALLERY_LIST_PROJECTION)
    .sort(sort)
    .limit(pageSize + 1)
    .lean();

  const hasNextPage = artifacts.length > pageSize;
  const result = hasNextPage ? artifacts.slice(0, pageSize) : artifacts;
  const nextCursor = hasNextPage ? result[result.length - 1]._id : null;

  // 查询用户信息
  const userIds = result.map(a => a.userId).filter(Boolean);
  const artifactIds = result.map(a => a.galleryArtifactId);
  const { GallerySchedule } = require('./GallerySchedule');
  const [users, schedules] = await Promise.all([
    userIds.length > 0
      ? mongoose.model('User').find({ _id: { $in: userIds } })
        .select('name username avatar')
        .lean()
        .catch((e) => {
          logger.error('[getGalleryArtifacts] Error fetching users:', e.message);
          return [];
        })
      : Promise.resolve([]),
    GallerySchedule.find({
      galleryArtifactId: { $in: artifactIds }
    }).lean(),
  ]);

  const usersMap = new Map();
  users.forEach(u => {
    usersMap.set(u._id.toString(), u);
  });
  const schedulesMap = new Map();
  schedules.forEach(s => {
    schedulesMap.set(s.galleryArtifactId, s);
  });

  return {
    artifacts: result.map((a) => {
      const user = usersMap.get(a.userId?.toString());
      const schedule = schedulesMap.get(a.galleryArtifactId);
      
      return {
        id: a.galleryArtifactId,
        title: a.title,
        type: a.type,
        content: a.content || '',
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        preview: a.preview,
        conversationId: a.conversationId,
        sourceArtifactId: a.sourceArtifactId,
        messageId: a.messageId,
        targetMessageId: a.targetMessageId,
        isPublic: a.isPublic,
        viewCount: a.viewCount,
        likes: a.likeCount || 0,
        likeCount: a.likeCount || 0,
        user: user ? {
          id: a.userId?.toString(),
          username: user.username || user.name,
          name: user.name,
          avatar: user.avatar,
        } : {
          id: a.userId?.toString(),
        },
        // 定时任务状态
        schedule: schedule ? {
          enabled: schedule.enabled,
          runStatus: schedule.runStatus,
          consecutiveFailures: schedule.consecutiveFailures || 0,
          disabledReason: schedule.disabledReason,
          lastError: schedule.lastError,
          nextRunAt: schedule.nextRunAt?.toISOString?.(),
        } : null,
      };
    }),
    nextCursor,
    hasNextPage
  };
};

/**
 * 获取公开作品列表
 */
const getPublicGalleryArtifacts = async (params = {}) => {
  const {
    pageParam,
    pageSize = 20,
    sortBy = 'updatedAt',
    sortDirection = 'desc',
    type,
    search,
  } = params;

  const filter = { isPublic: true };

  // 类型过滤
  if (type) {
    if (['HTML', 'SKILL'].includes(type)) {
      filter.type = type;
    } else {
      logger.warn('[getPublicGalleryArtifacts] Invalid type filter:', type, 'Expected: HTML or SKILL');
      return {
        artifacts: [],
        nextCursor: null,
        hasNextPage: false,
      };
    }
  }

  // 搜索过滤 - 支持 title、content、type 多字段搜索
  if (search && search.trim()) {
    const searchQuery = search.trim();
    
    // 构建多字段搜索条件（OR 逻辑）
    const searchConditions = [
      { title: { $regex: searchQuery, $options: 'i' } },  // 标题搜索
      { content: { $regex: searchQuery, $options: 'i' } }, // 内容搜索
    ];
    
    // 如果搜索词匹配类型，也加入搜索条件
    if (['HTML', 'SKILL'].includes(searchQuery.toUpperCase())) {
      searchConditions.push({ type: searchQuery.toUpperCase() });
    }
    
    // 使用 $or 组合多个搜索条件
    if (searchConditions.length > 0) {
      filter.$or = searchConditions;
    }
  }

  // 游标分页
  if (pageParam) {
    filter._id = sortDirection === 'desc' ? { $lt: pageParam } : { $gt: pageParam };
  }

  const sort = { [sortBy]: sortDirection === 'desc' ? -1 : 1 };

  const artifacts = await GalleryArtifact.find(filter)
    .select(GALLERY_LIST_PROJECTION)
    .sort(sort)
    .limit(pageSize + 1)
    .lean();

  const hasNextPage = artifacts.length > pageSize;
  const result = hasNextPage ? artifacts.slice(0, pageSize) : artifacts;
  const nextCursor = hasNextPage ? result[result.length - 1]._id : null;

  // 查询用户信息
  const userIds = result.map(a => a.userId).filter(Boolean);
  const usersMap = new Map();
  
  if (userIds.length > 0) {
    try {
      const User = mongoose.model('User');
      const users = await User.find({ _id: { $in: userIds } })
        .select('name username avatar')
        .lean();
      
      users.forEach(u => {
        usersMap.set(u._id.toString(), u);
      });
    } catch (e) {
      logger.error('[getPublicGalleryArtifacts] Error fetching users:', e.message);
    }
  }

  return {
    artifacts: result.map((a) => {
      const user = usersMap.get(a.userId?.toString());
      return {
        id: a.galleryArtifactId,
        title: a.title,
        type: a.type,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        preview: a.preview,
        content: a.content || '',
        conversationId: a.conversationId,
        sourceArtifactId: a.sourceArtifactId,
        messageId: a.messageId,
        targetMessageId: a.targetMessageId,
        isPublic: a.isPublic,
        viewCount: a.viewCount,
        likes: a.likeCount || 0,
        likeCount: a.likeCount || 0,
        user: user ? {
          id: a.userId?.toString(),
          username: user.username || user.name,
          name: user.name,
          avatar: user.avatar,
        } : {
          id: a.userId?.toString(),
        },
      };
    }),
    nextCursor,
    hasNextPage
  };
};

/**
 * 根据ID获取作品详情
 */
const getGalleryArtifactById = async (galleryArtifactId, userId) => {
  let artifact;
  
  if (userId) {
    const AclEntry = mongoose.model('AclEntry');
    const aclEntry = await AclEntry.findOne({
      principalType: { $in: ['user', 'public'] },
      resourceType: 'galleryArtifact',
      $or: [
        { principalId: new mongoose.Types.ObjectId(userId) },
        { principalType: 'public' },
      ],
    }).lean();
    
    artifact = await GalleryArtifact.findOne({
      galleryArtifactId,
      $or: [
        { userId: new mongoose.Types.ObjectId(userId) },
        { _id: aclEntry?.resourceId },
        { isPublic: true },
      ],
    }).lean();
  } else {
    artifact = await GalleryArtifact.findOne({ galleryArtifactId, isPublic: true }).lean();
  }


  if (!artifact) {
    return null;
  }

  // 增加浏览计数（不触发 updatedAt 更新）
  await GalleryArtifact.updateOne(
    { galleryArtifactId },
    { $inc: { viewCount: 1 } },
    { timestamps: false },
  );

  // 检查用户是否点赞过(从数据库读取)
  const isLiked = userId ? await checkUserLike(galleryArtifactId, userId) : false;

  return {
    _id: artifact._id,
    id: artifact.galleryArtifactId,
    title: artifact.title,
    type: artifact.type,
    content: artifact.content,
    preview: artifact.preview,
    conversationId: artifact.conversationId,
    sourceArtifactId: artifact.sourceArtifactId,
    messageId: artifact.messageId,
    targetMessageId: artifact.targetMessageId,
    messages: artifact.messages,
    autoUpdate: artifact.autoUpdate,
    updateFrequency: artifact.updateFrequency,
    updateTime: artifact.updateTime,
    isPublic: artifact.isPublic,
    viewCount: artifact.viewCount + 1,
    likeCount: artifact.likeCount,
    isLiked,
    userId: artifact.userId?.toString(),
    agentId: artifact.agentId,
    agentName: artifact.agentName,
    scheduleId: artifact.scheduleId,
    schedule: artifact.schedule,
    currentVersion: artifact.currentVersion,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
};

/**
 * 创建新作品
 */
const createGalleryArtifact = async (data) => {
  logger.info('[createGalleryArtifact] Starting creation', { 
    userId: data.userId, 
    userIdType: typeof data.userId,
    title: data.title,
    agentId: data.agentId,
    agentName: data.agentName,
    scheduleId: data.scheduleId
  });
  
  const galleryArtifactId = generateGalleryArtifactId();

  const artifact = await GalleryArtifact.create({
    galleryArtifactId,
    userId: data.userId,
    title: data.title,
    type: data.type || 'HTML',
    content: data.content || '',
    preview: data.preview || null,
    conversationId: data.conversationId || null,
    sourceArtifactId: data.sourceArtifactId || null,
    messageId: data.messageId || null,
    targetMessageId: data.targetMessageId || null,
    messages: data.messages || [],
    autoUpdate: data.autoUpdate || false,
    updateFrequency: data.updateFrequency || null,
    isPublic: data.isPublic || false,
    agentId: data.agentId || null,
    agentName: data.agentName || null,
    scheduleId: data.scheduleId || null,
  });

  logger.info('[createGalleryArtifact] Created successfully', { 
    galleryArtifactId: artifact.galleryArtifactId,
    id: artifact._id
  });

  // 自动给创建者赋予 Owner 权限
  try {
    const { grantPermission } = require('~/server/services/PermissionService');
    if (data.userId) {
      await grantPermission({
        resourceType: 'galleryArtifact',
        resourceId: artifact._id,
        principalId: data.userId,
        principalType: 'user',
        accessRoleId: 'galleryArtifact_owner',
      });
      logger.info('[createGalleryArtifact] Owner permission granted', { 
        userId: data.userId,
        artifactId: artifact._id 
      });
    }
  } catch (err) {
    logger.error('[createGalleryArtifact] Failed to grant owner permission', { 
      error: err.message,
      stack: err.stack
    });
  }

  return {
    id: artifact.galleryArtifactId,
    title: artifact.title,
    type: artifact.type,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
};

/**
 * 更新作品
 */
const updateGalleryArtifact = async (galleryArtifactId, userId, updates) => {
  const updateData = {};

  if (updates.title !== undefined) {
    updateData.title = updates.title;
  }
  if (updates.content !== undefined) {
    updateData.content = updates.content;
  }
  if (updates.preview !== undefined) {
    updateData.preview = updates.preview;
  }
  if (updates.isPublic !== undefined) {
    updateData.isPublic = updates.isPublic;
  }
  if (updates.autoUpdate !== undefined) {
    updateData.autoUpdate = updates.autoUpdate;
  }
  if (updates.updateFrequency !== undefined) {
    updateData.updateFrequency = updates.updateFrequency;
  }
  if (updates.updateTime !== undefined) {
    updateData.updateTime = updates.updateTime;
  }
  if (updates.messages !== undefined) {
    updateData.messages = updates.messages;
  }
  if (updates.agentId !== undefined) {
    updateData.agentId = updates.agentId;
  }
  if (updates.agentName !== undefined) {
    updateData.agentName = updates.agentName;
  }
  if (updates.scheduleId !== undefined) {
    updateData.scheduleId = updates.scheduleId;
  }

  if (Object.keys(updateData).length === 0) {
    return null;
  }

  const artifact = await GalleryArtifact.findOneAndUpdate(
    { galleryArtifactId, userId },
    { $set: updateData },
    { new: true },
  ).lean();

  if (!artifact) {
    return null;
  }

  return {
    id: artifact.galleryArtifactId,
    title: artifact.title,
    type: artifact.type,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
    isPublic: artifact.isPublic,
  };
};

/**
 * 删除作品
 */
const deleteGalleryArtifact = async (galleryArtifactId, userId) => {
  const result = await GalleryArtifact.findOneAndDelete({ galleryArtifactId, userId });
  return result !== null;
};

// 用户点赞记录（内存缓存，简单实现）
const userLikes = new Map(); // key: `${userId}:${galleryArtifactId}`
const userBookmarks = new Map();

/**
 * 检查用户是否点赞过(从数据库读取)
 */
const checkUserLike = async (galleryArtifactId, userId) => {
  const like = await GalleryLike.findOne({ userId, galleryArtifactId }).lean();
  return !!like;
};

/**
 * 点赞/取消点赞(持久化到数据库)
 */
const toggleGalleryLike = async (galleryArtifactId, userId) => {
  const existingLike = await GalleryLike.findOne({ userId, galleryArtifactId }).lean();

  if (existingLike) {
    // 取消点赞
    await GalleryLike.deleteOne({ userId, galleryArtifactId });
    await GalleryArtifact.updateOne({ galleryArtifactId }, { $inc: { likeCount: -1 } });
  } else {
    // 点赞
    await GalleryLike.create({ userId, galleryArtifactId });
    await GalleryArtifact.updateOne({ galleryArtifactId }, { $inc: { likeCount: 1 } });
  }

  // 获取最新的点赞数
  const artifact = await GalleryArtifact.findOne({ galleryArtifactId }).lean();
  const newLikeCount = artifact?.likeCount || 0;

  return {
    isLiked: !existingLike,
    likeCount: newLikeCount
  };
};

/**
 * 收藏/取消收藏(暂保留内存实现，后续可改为数据库)
 */
const toggleGalleryBookmark = async (galleryArtifactId, userId) => {
  const key = `${userId}:${galleryArtifactId}`;
  const isBookmarked = userBookmarks.get(key) || false;

  if (isBookmarked) {
    userBookmarks.delete(key);
    return { isBookmarked: false };
  } else {
    userBookmarks.set(key, true);
    return { isBookmarked: true };
  }
};

module.exports = {
  GalleryArtifact,
  getGalleryArtifacts,
  getPublicGalleryArtifacts,
  getGalleryArtifactById,
  createGalleryArtifact,
  updateGalleryArtifact,
  deleteGalleryArtifact,
  toggleGalleryLike,
  toggleGalleryBookmark,
};
