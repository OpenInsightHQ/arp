/* eslint-disable i18next/no-literal-string */
import React, { useState, useEffect, useCallback } from 'react';
import { Clock, CheckCircle2, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '~/utils';
import { getTasksByConversation, type TaskQueueItem } from 'librechat-data-provider';
import TaskForm from './TaskForm';

interface ConversationTaskListProps {
  conversationId: string;
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

export default function ConversationTaskList({ conversationId }: ConversationTaskListProps) {
  const [tasks, setTasks] = useState<TaskQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

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

  if (loading || tasks.length === 0) return null;

  const interactiveTasks = tasks.filter((t) => INTERACTIVE_STATUSES.includes(t.status));
  const otherTasks = tasks.filter((t) => !INTERACTIVE_STATUSES.includes(t.status));

  return (
    <div
      className={cn(
        'border-t border-border-light',
        'bg-surface-secondary/50',
        'max-h-[300px] overflow-y-auto',
      )}
    >
      <button
        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-tertiary"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        <span>Tasks ({tasks.length})</span>
        {interactiveTasks.length > 0 && (
          <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">
            {interactiveTasks.length} pending
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-2 px-4 pb-3">
          {interactiveTasks.map((task) => (
            <TaskCard key={task._id} task={task} onSubmitted={fetchTasks} interactive />
          ))}
          {otherTasks.length > 0 && (
            <div className="space-y-1 pt-1">
              {otherTasks.slice(-3).map((task) => (
                <TaskCard key={task._id} task={task} onSubmitted={fetchTasks} />
              ))}
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
}: {
  task: TaskQueueItem;
  onSubmitted: () => void;
  interactive?: boolean;
}) {
  const config = statusConfig[task.status] ?? statusConfig.pending;

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        interactive
          ? 'border-amber-300/50 bg-amber-50/30 dark:border-amber-500/20 dark:bg-amber-500/5'
          : 'border-border-light bg-surface-primary',
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn('mt-0.5', config.color)}>{config.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-text-primary">{task.title}</div>
          {task.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
              {task.description}
            </div>
          )}
          {task.resultSummary && (task.status === 'completed' || task.status === 'failed') && (
            <div className="bg-surface-tertiary/50 mt-1 rounded p-1.5 text-xs text-text-secondary">
              {task.resultSummary}
            </div>
          )}
          {interactive && <TaskForm task={task} onSubmitted={onSubmitted} />}
          {task.subagentName && (
            <div className="mt-1 text-[10px] text-text-tertiary">Subagent: {task.subagentName}</div>
          )}
        </div>
      </div>
    </div>
  );
}
