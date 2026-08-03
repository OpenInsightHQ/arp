const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

/**
 * GallerySqlQuery Schema
 * 存储报告关联的 SQL 查询语句
 */
const gallerySqlQuerySchema = new Schema(
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
    userId: {
      type: ObjectId,
      ref: 'User',
      required: true,
    },
    queries: [
      {
        sql: {
          type: String,
          required: true,
        },
        datasetId: {
          type: Number,
          default: null,
        },
        dataKey: {
          type: String,
          required: true,
        },
        description: {
          type: String,
          default: '',
        },
        resultShape: {
          type: String,
          enum: ['table', 'single_value', 'list'],
          default: 'table',
        },
        order: {
          type: Number,
          default: 0,
        },
        params: [
          {
            name: {
              type: String,
              default: '',
            },
            defaultValue: {
              type: String,
              default: '',
            },
            source: {
              type: String,
              enum: ['fixed', 'date_range', 'user_input'],
              default: 'fixed',
            },
          },
        ],
      },
    ],
    extractedBy: {
      type: String,
      enum: ['tool_calls', 'agent'],
      default: 'tool_calls',
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    collection: 'gallerysqlqueries',
  }
);

// 索引
gallerySqlQuerySchema.index({ galleryArtifactId: 1 });
gallerySqlQuerySchema.index({ userId: 1, galleryArtifactId: 1 });

const GallerySqlQuery = mongoose.models.GallerySqlQuery || mongoose.model('GallerySqlQuery', gallerySqlQuerySchema);

module.exports = {
  GallerySqlQuery,
};
