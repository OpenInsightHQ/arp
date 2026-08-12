const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');

/**
 * TaskQueue Schema — Agent 间跨用户协作任务队列
 *
 * toUserId 是"谁的待办里会出现这条任务"，fromUserId 是"谁创建的"。
 * 任何 Agent 都可以往其他用户的 task_queue 添加任务（在允许的用户范围内）。
 */
const TaskQueueSchema = new mongoose.Schema(
  {
    // === 任务指派 ===
    toUserId: {
      type: String,
      required: true,
      index: true,
    },
    toAgentId: {
      type: String,
    },

    // === 任务来源 ===
    fromUserId: {
      type: String,
      required: true,
    },
    fromAgentId: {
      type: String,
    },

    // === 关联对话 ===
    sourceConversationId: {
      type: String,
    },
    sourceSessionId: {
      type: String,
    },
    sourceTurnSeq: {
      type: Number,
    },

    // === 任务内容 ===
    type: {
      type: String,
      enum: ['ai_pending', 'collaboration', 'manual'],
      default: 'ai_pending',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    status: {
      type: String,
      enum: [
        'pending',
        'accepted',
        'in_progress',
        'waiting_agent',
        'running',
        'completed',
        'rejected',
        'dismissed',
        'failed',
        'aborted',
      ],
      default: 'pending',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },

    // === 结构化表单 ===
    formType: {
      type: String,
      enum: ['free_text', 'choice', 'form', 'confirmation'],
      default: 'free_text',
    },
    choices: [
      {
        label: String,
        value: String,
        description: String,
      },
    ],
    fields: [
      {
        name: String,
        label: String,
        fieldType: {
          type: String,
          enum: ['text', 'textarea', 'number', 'select', 'multiselect', 'date'],
        },
        required: {
          type: Boolean,
          default: false,
        },
        options: [String],
        default: mongoose.Schema.Types.Mixed,
      },
    ],
    formResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // === Subagent 关联 ===
    subagentTaskId: {
      type: String,
    },
    subagentName: {
      type: String,
    },

    // === 扩展信息 ===
    metadata: {
      type: Object,
      default: {},
    },
    resultSummary: {
      type: String,
    },
    userResponse: {
      type: String,
    },

    // === 回调 ===
    callbackUrl: {
      type: String,
    },

    // === 时间 ===
    completedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// 复合索引
TaskQueueSchema.index({ toUserId: 1, status: 1 });
TaskQueueSchema.index({ fromUserId: 1, status: 1 });
TaskQueueSchema.index({ toUserId: 1, type: 1 });
TaskQueueSchema.index({ sourceConversationId: 1, sourceTurnSeq: 1 });
TaskQueueSchema.index({ subagentTaskId: 1 });

const TaskQueue = mongoose.models.TaskQueue || mongoose.model('TaskQueue', TaskQueueSchema);

module.exports = { TaskQueue, TaskQueueSchema };
