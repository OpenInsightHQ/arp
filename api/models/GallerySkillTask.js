const mongoose = require('mongoose');

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

const TASK_STATUSES = ['not_started', 'running', 'success', 'failed', 'failed_paused', 'paused'];
const TASK_FREQUENCIES = ['minute', 'hourly', 'daily', 'weekly', 'monthly'];

const gallerySkillTaskSchema = new Schema(
  {
    taskId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    taskName: {
      type: String,
      required: true,
      maxlength: 200,
    },
    description: {
      type: String,
      default: '',
    },
    skillName: {
      type: String,
      required: true,
      index: true,
    },
    skillAuthor: {
      type: String,
      default: null,
    },
    skillSource: {
      type: String,
      enum: ['my', 'repo', 'enterprise'],
      default: 'my',
    },
    skillMetadataSnapshot: {
      type: Schema.Types.Mixed,
      default: {},
    },
    parameters: {
      type: Schema.Types.Mixed,
      default: {},
    },
    frequency: {
      type: String,
      enum: TASK_FREQUENCIES,
      required: true,
      index: true,
    },
    interval: {
      type: Number,
      default: null,
    },
    scheduleTime: {
      type: String,
      default: '09:00',
    },
    timezone: {
      type: String,
      default: 'Asia/Shanghai',
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: 'not_started',
      index: true,
    },
    nextRunAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastRunAt: {
      type: Date,
      default: null,
    },
    lastDurationMs: {
      type: Number,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    maxRetries: {
      type: Number,
      default: 2,
    },
  },
  { timestamps: true, collection: 'galleryskilltasks' },
);

gallerySkillTaskSchema.index({ userId: 1, updatedAt: -1 });
gallerySkillTaskSchema.index({ userId: 1, status: 1, nextRunAt: 1 });
gallerySkillTaskSchema.index({ userId: 1, frequency: 1, nextRunAt: 1 });

const GallerySkillTask =
  mongoose.models.GallerySkillTask || mongoose.model('GallerySkillTask', gallerySkillTaskSchema);

const generateGallerySkillTaskId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `task_${timestamp}_${random}`;
};

const toSkillTaskResponse = (task) => ({
  id: task.taskId,
  taskName: task.taskName,
  description: task.description || '',
  skillName: task.skillName,
  skillAuthor: task.skillAuthor,
  skillSource: task.skillSource,
  skillMetadataSnapshot: task.skillMetadataSnapshot || {},
  parameters: task.parameters || {},
  frequency: task.frequency,
  interval: task.interval,
  scheduleTime: task.scheduleTime,
  timezone: task.timezone,
  enabled: task.enabled,
  status: task.status,
  nextRunAt: task.nextRunAt?.toISOString?.() || null,
  lastRunAt: task.lastRunAt?.toISOString?.() || null,
  lastDurationMs: task.lastDurationMs,
  lastError: task.lastError,
  failureCount: task.failureCount || 0,
  maxRetries: task.maxRetries || 2,
  createdAt: task.createdAt?.toISOString?.(),
  updatedAt: task.updatedAt?.toISOString?.(),
});

module.exports = {
  GallerySkillTask,
  TASK_STATUSES,
  TASK_FREQUENCIES,
  generateGallerySkillTaskId,
  toSkillTaskResponse,
};
