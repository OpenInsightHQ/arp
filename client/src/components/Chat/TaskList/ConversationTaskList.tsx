/* eslint-disable i18next/no-literal-string */
import React, { useState, useEffect, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import {
  Clock,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import { cn } from '~/utils';
import store from '~/store';
import {
  getTasksByConversation,
  clearCompletedTasks,
  updateTaskQueueItem,
  type TaskQueueItem,
} from 'librechat-data-provider';
import TaskForm from './TaskForm';

interface ConversationTaskListProps {
  conversationId: string;
  index?: number;
}

const statusConfig: Record<string, { icon: React.ReactNode; color: string }> = {
  pending: { icon: <Clock className="h-3.5 w-3.5" />, color: 'text-amber-500' },
  accepted: { icon: <Clock className="h-3.5 w-3.5" />, color: 'text-amber-500' },
  in_progress: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, color: 'text-blue-500' },
  waiting_agent: { icon: <Clock className="h-3.5 w-3.5" />, color: 'text-purple-500' },
  running: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, color: 'text-blue-500' },
  completed: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-500' },
  rejected: { icon: <AlertCircle className="h-3.5 w-3.5" />, color: 'text-red-500' },
  failed: { icon: <AlertCircle className="h-3.5 w-3.5" />, color: 'text-red-500' },
  aborted: { icon: <AlertCircle className="h-3.5 w-3.5" />, color: 'text-gray-500' },
  dismissed: { icon: <AlertCircle className="h-3.5 w-3.5" />, color: 'text-gray-500' },
};

const INTERACTIVE_STATUSES = ['pending', 'accepted'];
const TERMINAL_STATUSES = ['completed', 'rejected', 'dismissed', 'failed', 'aborted'];

export default function ConversationTaskList({
  conversationId,
  index = 0,
}: ConversationTaskListProps) {
  const [tasks, setTasks] = useState<TaskQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [clearing, setClearing] = useState(false);
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(index));

  const fetchTasks = useCallback(async () => {
    try {
      const data = await getTasksByConversation(conversationId);
      setTasks(data.tasks ?? []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleClearCompleted = useCallback(async () => {
    setClearing(true);
    try {
      await clearCompletedTasks(conversationId);
      await fetchTasks();
      setShowHistory(false);
    } catch {
      /* keep current list on failure */
    } finally {
      setClearing(false);
    }
  }, [conversationId, fetchTasks]);

  if (loading) return null;

  // Active = anything not in a terminal state. The panel only renders while
  // there is live work in this conversation; once every task is finished
  // (or there are none) it disappears. Finished history stays reachable
  // via the global task center.
  const activeTasks = tasks.filter((t) => !TERMINAL_STATUSES.includes(t.status));
  if (activeTasks.length === 0) return null;

  // Rendering groups within active tasks (mutually exclusive):
  const interactiveTasks = activeTasks.filter(
    (t) => INTERACTIVE_STATUSES.includes(t.status) && t.type !== 'subagent',
  );
  const queuedTasks = activeTasks.filter(
    (t) => t.status === 'waiting_agent' && t.type !== 'subagent',
  );
  // Everything else active: running, in_progress, and subagent tasks queued
  // for dispatch or executing.
  const executionTasks = activeTasks.filter(
    (t) => !interactiveTasks.includes(t) && !queuedTasks.includes(t),
  );

  const finishedTasks = tasks.filter((t) => TERMINAL_STATUSES.includes(t.status));
  // newest finished first for the history view
  const finishedNewestFirst = [...finishedTasks].reverse();

  return (
    <div className="bg-surface-secondary/50 max-h-[300px] overflow-y-auto border-t border-border-light">
      <button
        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-tertiary"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        <span>Tasks</span>
        <span className="rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
          {activeTasks.length} active
        </span>
        {finishedTasks.length > 0 && (
          <span className="rounded-full bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-bold text-text-secondary">
            {finishedTasks.length} done
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-2 px-4 pb-3">
          {executionTasks.map((task) => (
            <TaskCard
              key={task._id}
              task={task}
              onSubmitted={fetchTasks}
              running
              streaming={isSubmitting}
            />
          ))}
          {queuedTasks.map((task) => (
            <TaskCard
              key={task._id}
              task={task}
              onSubmitted={fetchTasks}
              queued
              streaming={isSubmitting}
            />
          ))}
          {interactiveTasks.map((task) => (
            <TaskCard key={task._id} task={task} onSubmitted={fetchTasks} interactive />
          ))}

          {finishedTasks.length > 0 && (
            <div className="pt-1">
              <div className="flex items-center justify-between">
                <button
                  className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary"
                  onClick={() => setShowHistory(!showHistory)}
                >
                  {showHistory ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronUp className="h-3 w-3" />
                  )}
                  Completed ({finishedTasks.length})
                </button>
                <button
                  className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-red-500"
                  disabled={clearing}
                  onClick={handleClearCompleted}
                >
                  <Trash2 className="h-3 w-3" />
                  {clearing ? 'Clearing...' : 'Clear'}
                </button>
              </div>
              {showHistory && (
                <div className="mt-1 space-y-1">
                  {finishedNewestFirst.map((task) => (
                    <TaskCard key={task._id} task={task} onSubmitted={fetchTasks} compact />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onSubmitted,
  interactive = false,
  running = false,
  queued = false,
  compact = false,
  streaming = true,
}: {
  task: TaskQueueItem;
  onSubmitted: () => void;
  interactive?: boolean;
  running?: boolean;
  queued?: boolean;
  compact?: boolean;
  streaming?: boolean;
}) {
  const config = statusConfig[task.status] ?? statusConfig.pending;
  const [updating, setUpdating] = useState(false);

  const handleStatusUpdate = async (status: TaskQueueItem['status']) => {
    setUpdating(true);
    try {
      await updateTaskQueueItem(task._id, { status });
      onSubmitted();
    } catch {
      /* leave as-is on failure */
    } finally {
      setUpdating(false);
    }
  };

  // 流式输出结束后仍处于活动态的任务，允许手动完结/取消
  const showManualActions = !streaming && !interactive;

  return (
    <div
      className={cn(
        'rounded-lg border',
        compact ? 'p-2 opacity-75' : 'p-3',
        interactive
          ? 'border-amber-300/50 bg-amber-50/30 dark:border-amber-500/20 dark:bg-amber-500/5'
          : queued
            ? 'border-purple-300/50 bg-purple-50/30 dark:border-purple-500/20 dark:bg-purple-500/5'
            : running
              ? 'border-blue-300/50 bg-blue-50/30 dark:border-blue-500/20 dark:bg-blue-500/5'
              : 'border-border-light bg-surface-primary',
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn('mt-0.5', config.color)}>{config.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-text-primary">{task.title}</div>
          {!compact && task.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
              {task.description}
            </div>
          )}
          {queued && streaming && (
            <div className="mt-0.5 text-[10px] text-purple-500">已响应，等待 AI 下一轮处理</div>
          )}
          {task.resultSummary && (task.status === 'completed' || task.status === 'failed') && (
            <div className="bg-surface-tertiary/50 mt-1 line-clamp-3 rounded p-1.5 text-xs text-text-secondary">
              {task.resultSummary}
            </div>
          )}
          {interactive && <TaskForm task={task} onSubmitted={onSubmitted} />}
          {!compact && task.subagentName && (
            <div className="mt-1 text-[10px] text-text-tertiary">Subagent: {task.subagentName}</div>
          )}
        </div>
        {showManualActions && (
          <div className="ml-2 flex shrink-0 items-center gap-1.5">
            <button
              className="rounded border border-emerald-300/50 px-1.5 py-0.5 text-[11px] text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
              disabled={updating}
              onClick={() => handleStatusUpdate('completed')}
            >
              完成
            </button>
            <button
              className="rounded border border-border-light px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:text-red-500 disabled:opacity-50"
              disabled={updating}
              onClick={() => handleStatusUpdate(queued ? 'rejected' : 'aborted')}
            >
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
