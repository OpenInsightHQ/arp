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
      enum: ['ai_pending', 'collaboration', 'manual', 'subagent'],
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

    // === 数据保留 ===
    // 软删除标记：用户清除后不再出现在任何任务列表，但文档保留供审计/回溯
    cleared: {
      type: Boolean,
      default: false,
      index: true,
    },
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
// 查询默认排除已清理任务（配合各路由的 cleared: { $ne: true } 过滤）
TaskQueueSchema.index({ sourceConversationId: 1, cleared: 1 });
// 数据保留：完结任务 7 天后由 TTL 回收。completedAt 仅在终态写入（现有 PATCH
// 逻辑），未完结任务无该字段永不过期。硬删仅由此 TTL 执行，应用层只做软删。
TaskQueueSchema.index({ completedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

const TaskQueue = mongoose.models.TaskQueue || mongoose.model('TaskQueue', TaskQueueSchema);

module.exports = { TaskQueue, TaskQueueSchema };
