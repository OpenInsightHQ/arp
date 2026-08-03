const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

/**
 * GallerySchedule Schema
 * 定时任务配置
 */
const galleryScheduleSchema = new Schema(
  {
    galleryArtifactId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    frequency: {
      type: String,
      enum: ['hourly', 'daily', 'weekly', 'monthly'],
      required: true,
    },
    updateTime: {
      type: String,
      default: '09:00',
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    nextRunAt: {
      type: Date,
      default: null,
    },
    lastRunAt: {
      type: Date,
      default: null,
    },
    runStatus: {
      type: String,
      enum: ['idle', 'running', 'success', 'failed'],
      default: 'idle',
    },
    lastError: {
      type: String,
      default: null,
    },
    consecutiveFailures: {
      type: Number,
      default: 0,
    },
    disabledReason: {
      type: String,
      default: null,
    },
    // AI 调用配置
    apiKey: {
      type: String,
      default: null,
    },
    model: {
      type: String,
      default: 'gpt-4o-mini',
    },
  },
  { timestamps: true, collection: 'galleryschedules' }
);

// 索引
galleryScheduleSchema.index({ nextRunAt: 1 });
galleryScheduleSchema.index({ userId: 1, enabled: 1, nextRunAt: 1 });
galleryScheduleSchema.index({ runStatus: 1 });

const GallerySchedule = mongoose.models.GallerySchedule || mongoose.model('GallerySchedule', galleryScheduleSchema);

/**
 * GalleryRunLog Schema
 * 执行日志
 */
const galleryRunLogSchema = new Schema(
  {
    scheduleId: {
      type: ObjectId,
      ref: 'GallerySchedule',
      required: true,
    },
    galleryArtifactId: {
      type: String,
      required: true,
    },
    userId: {
      type: ObjectId,
      ref: 'User',
      required: true,
    },
    triggeredBy: {
      type: String,
      enum: ['auto', 'manual'],
      required: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['running', 'success', 'failed'],
      default: 'running',
    },
    error: {
      type: String,
      default: null,
    },
    previousContent: {
      type: String,
      default: null,
    },
  },
  { timestamps: true, collection: 'galleryrunlogs' }
);

// 索引
galleryRunLogSchema.index({ scheduleId: 1, startedAt: -1 });
galleryRunLogSchema.index({ galleryArtifactId: 1, createdAt: -1 });
galleryRunLogSchema.index({ status: 1 });

const GalleryRunLog = mongoose.models.GalleryRunLog || mongoose.model('GalleryRunLog', galleryRunLogSchema);

/**
 * GalleryLike Schema
 * 点赞记录
 */
const galleryLikeSchema = new Schema(
  {
    userId: {
      type: ObjectId,
      ref: 'User',
      required: true,
    },
    galleryArtifactId: {
      type: String,
      required: true,
    },
  },
  { timestamps: true, collection: 'gallerylikes' }
);

// 索引：用户+作品必须唯一
galleryLikeSchema.index({ userId: 1, galleryArtifactId: 1 }, { unique: true });
galleryLikeSchema.index({ galleryArtifactId: 1, createdAt: -1 });

const GalleryLike = mongoose.models.GalleryLike || mongoose.model('GalleryLike', galleryLikeSchema);

/**
 * GalleryBookmark Schema
 * 收藏记录
 */
const galleryBookmarkSchema = new Schema(
  {
    userId: {
      type: ObjectId,
      ref: 'User',
      required: true,
    },
    galleryArtifactId: {
      type: String,
      required: true,
    },
  },
  { timestamps: true, collection: 'gallerybookmarks' }
);

// 索引：用户+作品收藏状态唯一
galleryBookmarkSchema.index({ userId: 1, galleryArtifactId: 1 }, { unique: true });
galleryBookmarkSchema.index({ galleryArtifactId: 1, createdAt: -1 });

const GalleryBookmark = mongoose.models.GalleryBookmark || mongoose.model('GalleryBookmark', galleryBookmarkSchema);

module.exports = {
  GallerySchedule,
  GalleryRunLog,
  GalleryLike,
  GalleryBookmark,
};
