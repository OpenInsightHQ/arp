const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');

const { ObjectId } = mongoose.Schema.Types.ObjectId;

/**
 * GalleryRunLog Schema
 * 执行日志
 */
const galleryRunLogSchema = new mongoose.Schema(
  {
    _id: {
      type: ObjectId,
      required: true,
      auto: true,
    },
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
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
  { collection: 'galleryrunlogs' }
);

// 索引
galleryRunLogSchema.index({ scheduleId: 1, startedAt: -1 });
galleryRunLogSchema.index({ galleryArtifactId: 1, createdAt: -1 });
galleryRunLogSchema.index({ status: 1 });

const GalleryRunLog = mongoose.models.GalleryRunLog || mongoose.model('GalleryRunLog', galleryRunLogSchema);

module.exports = {
  GalleryRunLog
};
