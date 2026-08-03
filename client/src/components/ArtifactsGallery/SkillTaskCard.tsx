/* eslint-disable i18next/no-literal-string */
import { Pause, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { GallerySkillTask } from 'librechat-data-provider';
import { cn } from '~/utils';
import { useLocalize } from '~/hooks';

export type SkillTaskAction = 'run' | 'edit' | 'toggle' | 'resume' | 'delete';

const statusToneClass: Record<GallerySkillTask['status'], string> = {
  success:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-1 dark:ring-emerald-400/20',
  running:
    'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-1 dark:ring-blue-400/20',
  not_started:
    'bg-gray-100 text-gray-600 dark:bg-white/8 dark:text-gray-200 dark:ring-1 dark:ring-white/10',
  failed:
    'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200 dark:ring-1 dark:ring-red-400/20',
  failed_paused:
    'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200 dark:ring-1 dark:ring-red-400/20',
  paused:
    'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-1 dark:ring-amber-400/20',
};

const statusDotClass: Record<GallerySkillTask['status'], string> = {
  success: 'bg-emerald-500',
  running: 'bg-blue-500',
  not_started: 'bg-gray-400 dark:bg-gray-300',
  failed: 'bg-red-500',
  failed_paused: 'bg-red-500',
  paused: 'bg-amber-500',
};

const statusLabelKey: Record<GallerySkillTask['status'], string> = {
  success: 'com_skill_status_success',
  running: 'com_skill_status_running',
  not_started: 'com_skill_status_not_started',
  failed: 'com_skill_status_failed',
  failed_paused: 'com_skill_status_failed_paused',
  paused: 'com_skill_status_paused',
};

const frequencyLabelKey: Record<GallerySkillTask['frequency'], string> = {
  minute: 'com_skill_minutes',
  hourly: 'com_skill_hours',
  daily: 'com_skill_daily',
  weekly: 'com_skill_weekly',
  monthly: 'com_skill_monthly',
};

export const formatSkillTaskSchedule = (task: GallerySkillTask, localize: ReturnType<typeof useLocalize>) => {
  if (task.frequency === 'minute') {
    return localize('com_skill_every_minutes', { count: task.interval || 30 });
  }
  if (task.frequency === 'hourly') {
    return localize('com_skill_every_hours', { count: task.interval || 1 });
  }
  return `${localize(frequencyLabelKey[task.frequency])} ${task.scheduleTime || '09:00'}`;
};

export const formatSkillTaskDate = (dateString: string | null | undefined, localize: ReturnType<typeof useLocalize>) => {
  if (!dateString) {
    return localize('com_skill_pending_calculation');
  }
  return new Date(dateString).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function SkillTaskCard({
  task,
  compact = false,
  onOpen,
  onAction,
  disabled,
}: {
  task: GallerySkillTask;
  compact?: boolean;
  onOpen?: () => void;
  onAction?: (action: SkillTaskAction, task: GallerySkillTask) => void;
  disabled?: boolean;
}) {
  const localize = useLocalize();

  const handleAction = (event: React.MouseEvent, action: SkillTaskAction) => {
    event.stopPropagation();
    if (disabled) {
      return;
    }
    onAction?.(action, task);
  };

  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'rounded-2xl bg-white p-4 shadow-sm transition dark:bg-[#242424] dark:shadow-black/20',
        onOpen && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md dark:hover:bg-[#292929]',
        compact && 'rounded-xl bg-[#f5f5f7] shadow-none dark:bg-[#242424]',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full', statusDotClass[task.status])} />
            <span className="truncate font-medium text-text-primary dark:text-white">
              {task.taskName}
            </span>
          </div>
          <div className="mt-1 text-xs text-text-secondary dark:text-gray-400">
            {task.skillName}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary dark:text-gray-300">
            <span>{formatSkillTaskSchedule(task, localize)}</span>
            <span>{localize('com_skill_next')}{formatSkillTaskDate(task.nextRunAt, localize)}</span>
            <span>{localize('com_skill_last')}{formatSkillTaskDate(task.lastRunAt, localize)}</span>
            {task.lastDurationMs ? <span>{Math.round(task.lastDurationMs / 1000)}s</span> : null}
          </div>
          {task.lastError ? (
            <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-500/15 dark:text-red-200">
              {task.lastError}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', statusToneClass[task.status])}>
            {localize(statusLabelKey[task.status])}
          </span>
          <button
            type="button"
            onClick={(event) => handleAction(event, 'run')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-xs font-medium text-text-secondary shadow-sm hover:bg-surface-active-alt hover:text-text-primary dark:bg-[#303030] dark:text-gray-200 dark:hover:bg-[#3a3a3a]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {localize('com_skill_run_now')}
          </button>
          <button
            type="button"
            onClick={(event) => handleAction(event, 'edit')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-xs font-medium text-text-secondary shadow-sm hover:bg-surface-active-alt hover:text-text-primary dark:bg-[#303030] dark:text-gray-200 dark:hover:bg-[#3a3a3a]"
          >
            <Pencil className="h-3.5 w-3.5" />
            {localize('com_skill_edit')}
          </button>
          <button
            type="button"
            onClick={(event) => handleAction(event, !task.enabled || task.status === 'failed_paused' ? 'resume' : 'toggle')}
            className="inline-flex h-8 items-center rounded-lg bg-white px-2 text-text-secondary shadow-sm hover:bg-surface-active-alt hover:text-text-primary dark:bg-[#303030] dark:text-gray-200 dark:hover:bg-[#3a3a3a]"
            aria-label={!task.enabled || task.status === 'failed_paused' ? localize('com_skill_resume') : localize('com_skill_pause')}
          >
            {!task.enabled || task.status === 'failed_paused' ? (
              <Play className="h-3.5 w-3.5" />
            ) : (
              <Pause className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={(event) => handleAction(event, 'delete')}
            className="inline-flex h-8 items-center rounded-lg bg-white px-2 text-text-secondary shadow-sm hover:bg-red-50 hover:text-red-600 dark:bg-[#303030] dark:text-gray-200 dark:hover:bg-red-500/15 dark:hover:text-red-200"
            aria-label={localize('com_skill_delete_task')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
