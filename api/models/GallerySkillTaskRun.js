const mongoose = require('mongoose');

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

const RUN_STATUSES = ['running', 'success', 'failed', 'cancelled'];
const RUN_TRIGGERS = ['auto', 'manual'];

const fileSchema = new Schema(
  {
    name: { type: String, required: true },
    path: { type: String, default: null },
    url: { type: String, default: null },
    mimeType: { type: String, default: null },
    size: { type: Number, default: null },
  },
  { _id: false },
);

const logSchema = new Schema(
  {
    level: {
      type: String,
      enum: ['info', 'warn', 'error', 'debug'],
      default: 'info',
    },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const gallerySkillTaskRunSchema = new Schema(
  {
    runId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    taskId: {
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
    skillName: {
      type: String,
      required: true,
      index: true,
    },
    taskNameSnapshot: {
      type: String,
      default: '',
    },
    triggeredBy: {
      type: String,
      enum: RUN_TRIGGERS,
      default: 'auto',
      index: true,
    },
    status: {
      type: String,
      enum: RUN_STATUSES,
      default: 'running',
      index: true,
    },
    parameters: {
      type: Schema.Types.Mixed,
      default: {},
    },
    textOutput: {
      type: String,
      default: '',
    },
    files: {
      type: [fileSchema],
      default: [],
    },
    logs: {
      type: [logSchema],
      default: [],
    },
    error: {
      message: { type: String, default: null },
      stack: { type: String, default: null },
      code: { type: String, default: null },
    },
    sessionId: {
      type: String,
      default: null,
      index: true,
    },
    conversationId: {
      type: String,
      default: null,
      index: true,
    },
    agentId: {
      type: String,
      default: null,
      index: true,
    },
    prompt: {
      type: String,
      default: '',
    },
    startedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    durationMs: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true, collection: 'galleryskilltaskruns' },
);

gallerySkillTaskRunSchema.index({ userId: 1, taskId: 1, startedAt: -1 });
gallerySkillTaskRunSchema.index({ userId: 1, skillName: 1, startedAt: -1 });
gallerySkillTaskRunSchema.index({ userId: 1, status: 1, startedAt: -1 });

const GallerySkillTaskRun =
  mongoose.models.GallerySkillTaskRun ||
  mongoose.model('GallerySkillTaskRun', gallerySkillTaskRunSchema);

const generateGallerySkillTaskRunId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `run_${timestamp}_${random}`;
};

const toSkillTaskRunResponse = (run) => ({
  id: run.runId,
  taskId: run.taskId,
  skillName: run.skillName,
  taskNameSnapshot: run.taskNameSnapshot,
  triggeredBy: run.triggeredBy,
  status: run.status,
  parameters: run.parameters || {},
  textOutput: run.textOutput || '',
  files: run.files || [],
  logs: run.logs || [],
  error: run.error || null,
  sessionId: run.sessionId,
  conversationId: run.conversationId,
  agentId: run.agentId,
  prompt: run.prompt || '',
  startedAt: run.startedAt?.toISOString?.() || null,
  completedAt: run.completedAt?.toISOString?.() || null,
  durationMs: run.durationMs,
  createdAt: run.createdAt?.toISOString?.(),
  updatedAt: run.updatedAt?.toISOString?.(),
});

module.exports = {
  GallerySkillTaskRun,
  RUN_STATUSES,
  RUN_TRIGGERS,
  generateGallerySkillTaskRunId,
  toSkillTaskRunResponse,
};
