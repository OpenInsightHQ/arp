const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

/**
 * GalleryVersion Schema
 * 存储报告的版本历史
 */
const galleryVersionSchema = new Schema(
  {
    galleryArtifactId: {
      type: String,
      required: true,
    },
    sourceArtifactId: {
      type: String,
      default: null,
    },
    targetMessageId: {
      type: String,
      default: null,
    },
    version: {
      type: Number,
      required: true,
    },
    html: {
      type: String,
      required: true,
    },
    createdBy: {
      type: String,
      enum: ['user', 'consolidation', 'update_agent', 'scheduler', 'manual'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
    },
    errorMessage: {
      type: String,
      default: null,
    },
    sqlMessage: {
      type: String,
      default: null,
    },
    dataSnapshot: {
      type: Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      sqlExecutionTime: {
        type: Number,
        default: null,
      },
      agentModel: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    collection: 'galleryversions',
  }
);

// 复合索引：galleryArtifactId + version（唯一）
galleryVersionSchema.index({ galleryArtifactId: 1, version: 1 }, { unique: true });
galleryVersionSchema.index({ galleryArtifactId: 1, createdAt: -1 });

const GalleryVersion = mongoose.models.GalleryVersion || mongoose.model('GalleryVersion', galleryVersionSchema);

module.exports = {
  GalleryVersion,
};
