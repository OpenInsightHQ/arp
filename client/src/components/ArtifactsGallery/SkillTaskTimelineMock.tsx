/* eslint-disable i18next/no-literal-string */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Clock3 } from 'lucide-react';
import { cn } from '~/utils';
import { useLocalize } from '~/hooks';
import SkillTaskCard from './SkillTaskCard';
import SkillTaskEditDialog from './SkillTaskEditDialog';
import type { SkillTaskAction } from './SkillTaskCard';
import {
  useDeleteGallerySkillTaskMutation,
  useGallerySkillTasksQuery,
  useRunGallerySkillTaskMutation,
  useUpdateGallerySkillTaskMutation,
} from '~/data-provider';
import type { GallerySkillTask } from 'librechat-data-provider';

type TaskStatus = 'success' | 'running' | 'not_started' | 'failed' | 'failed_paused' | 'paused';
type TaskFrequency = 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly';
type StatusFilter = TaskStatus | 'all';
type DateGroup = 'today' | 'tomorrow' | 'upcoming';

type SummaryCard = {
  key: StatusFilter;
  label: string;
  value: string;
  hint: string;
  tone: 'neutral' | 'blue' | 'red' | 'amber' | 'green';
};

const periodLabelKeys: Record<TaskFrequency | 'all', string> = {
  all: 'com_skill_all',
  minute: 'com_skill_minutes',
  hourly: 'com_skill_hours',
  daily: 'com_skill_daily',
  weekly: 'com_skill_weekly',
  monthly: 'com_skill_monthly',
};

const summaryToneClass: Record<SummaryCard['tone'], string> = {
  neutral:
    'bg-white text-text-primary shadow-sm dark:bg-[#242424] dark:text-white dark:shadow-black/20',
  blue: 'bg-blue-50 text-blue-800 shadow-sm dark:bg-[#182235] dark:text-blue-100 dark:shadow-black/20',
  red: 'bg-red-50 text-red-800 shadow-sm dark:bg-[#341b1f] dark:text-red-100 dark:shadow-black/20',
  amber:
    'bg-amber-50 text-amber-800 shadow-sm dark:bg-[#332716] dark:text-amber-100 dark:shadow-black/20',
  green:
    'bg-emerald-50 text-emerald-800 shadow-sm dark:bg-[#17291f] dark:text-emerald-100 dark:shadow-black/20',
};

const formatDateGroup = (dateString?: string | null): DateGroup => {
  if (!dateString) {
    return 'upcoming';
  }
  const target = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const key = target.toDateString();
  if (key === today.toDateString()) {
    return 'today';
  }
  if (key === tomorrow.toDateString()) {
    return 'tomorrow';
  }
  return 'upcoming';
};

const formatDateLabel = (group: DateGroup, localize: ReturnType<typeof useLocalize>, dateString?: string | null) => {
  if (group === 'today') {
    return localize('com_skill_today');
  }
  if (group === 'tomorrow') {
    return localize('com_skill_tomorrow');
  }
  if (!dateString) {
    return localize('com_skill_pending_calculation');
  }
  return new Date(dateString).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
};

const periodOptions: Array<TaskFrequency | 'all'> = [
  'all',
  'minute',
  'hourly',
  'daily',
  'weekly',
  'monthly',
];
const dateGroups: DateGroup[] = ['today', 'tomorrow', 'upcoming'];

const SkillTaskTimelineMock = ({ searchQuery = '' }: { searchQuery?: string }) => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('all');
  const [activePeriod, setActivePeriod] = useState<TaskFrequency | 'all'>('all');
  const [editingTask, setEditingTask] = useState<GallerySkillTask | null>(null);
  const { data, isLoading } = useGallerySkillTasksQuery({ search: searchQuery });
  const updateTask = useUpdateGallerySkillTaskMutation({
    onSuccess: () => setEditingTask(null),
  });
  const runTask = useRunGallerySkillTaskMutation();
  const deleteTask = useDeleteGallerySkillTaskMutation();

  const tasks = useMemo(() => data?.tasks || [], [data?.tasks]);

  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesStatus = activeStatus === 'all' || task.status === activeStatus;
      const matchesPeriod = activePeriod === 'all' || task.frequency === activePeriod;
      const matchesSearch =
        !query ||
        task.taskName.toLowerCase().includes(query) ||
        task.skillName.toLowerCase().includes(query);

      return matchesStatus && matchesPeriod && matchesSearch;
    });
  }, [activeStatus, activePeriod, searchQuery, tasks]);

  const summaryCards: SummaryCard[] = [
    {
      key: 'all',
      label: localize('com_skill_all_tasks'),
      value: String(tasks.length),
      hint: localize('com_skill_summary_all_hint'),
      tone: 'neutral',
    },
    {
      key: 'running',
      label: localize('com_skill_running'),
      value: String(tasks.filter((task) => task.status === 'running').length),
      hint: localize('com_skill_summary_running_hint'),
      tone: 'blue',
    },
    {
      key: 'not_started',
      label: localize('com_skill_pending'),
      value: String(tasks.filter((task) => task.status === 'not_started').length),
      hint: localize('com_skill_summary_pending_hint'),
      tone: 'green',
    },
    {
      key: 'failed_paused',
      label: localize('com_skill_failed_paused'),
      value: String(tasks.filter((task) => task.status === 'failed_paused').length),
      hint: localize('com_skill_summary_failed_hint'),
      tone: 'red',
    },
    {
      key: 'paused',
      label: localize('com_skill_paused'),
      value: String(tasks.filter((task) => task.status === 'paused').length),
      hint: localize('com_skill_summary_paused_hint'),
      tone: 'amber',
    },
  ];

  const groupedTasks = dateGroups
    .map((group) => ({
      group,
      label: formatDateLabel(group, localize, filteredTasks.find((task) => formatDateGroup(task.nextRunAt) === group)?.nextRunAt),
      tasks: filteredTasks.filter((task) => formatDateGroup(task.nextRunAt) === group),
    }))
    .filter((group) => group.tasks.length > 0);

  const handleTaskAction = (action: SkillTaskAction, task: GallerySkillTask) => {
    if (action === 'run') {
      runTask.mutate(task.id);
      return;
    }
    if (action === 'resume') {
      updateTask.mutate({ taskId: task.id, payload: { enabled: true, status: 'not_started' } });
      return;
    }
    if (action === 'toggle') {
      updateTask.mutate({ taskId: task.id, payload: { enabled: false, status: 'paused' } });
      return;
    }
    if (action === 'edit') {
      setEditingTask(task);
      return;
    }
    if (action === 'delete') {
      if (window.confirm(localize('com_skill_delete_confirm', { taskName: task.taskName }))) {
        deleteTask.mutate(task.id);
      }
    }
  };

  const handleSaveEditingTask = () => {
    if (!editingTask) {
      return;
    }
    updateTask.mutate({
      taskId: editingTask.id,
      payload: {
        taskName: editingTask.taskName,
        frequency: editingTask.frequency,
        interval:
          editingTask.frequency === 'minute' || editingTask.frequency === 'hourly'
            ? editingTask.interval || (editingTask.frequency === 'minute' ? 30 : 1)
            : null,
        scheduleTime: editingTask.scheduleTime || '09:00',
      },
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-1 sm:px-4">
      <div className="rounded-2xl bg-[#f5f5f7] p-5 shadow-sm dark:bg-[#171717] dark:shadow-black/30">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-text-secondary dark:text-gray-400">
              <CalendarDays className="h-4 w-4" />
              <span>{localize('com_skill_tasks_breadcrumb')}</span>
            </div>
            <h2 className="text-2xl font-semibold text-text-primary dark:text-white">{localize('com_skill_task_calendar')}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary dark:text-gray-300">
              {localize('com_skill_task_calendar_desc')}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {summaryCards.map((card) => (
            <button
              key={card.key}
              onClick={() => setActiveStatus(card.key)}
              className={cn(
                'rounded-xl p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#7948ea]/40',
                summaryToneClass[card.tone],
                activeStatus === card.key && 'ring-2 ring-[#7948ea] dark:ring-[#9b7cff]',
              )}
            >
              <div className="text-xs opacity-70">{card.label}</div>
              <div className="mt-2 text-2xl font-semibold">{card.value}</div>
              <div className="mt-1 text-xs opacity-70">{card.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-[#f5f5f7] p-4 shadow-sm dark:bg-[#171717] dark:shadow-black/30">
        <div className="mb-2 text-xs font-medium text-text-secondary dark:text-gray-400">
          {localize('com_skill_period_filter')}
        </div>
        <div className="flex flex-wrap gap-2">
          {periodOptions.map((period) => (
            <button
              key={period}
              onClick={() => setActivePeriod(period)}
              className={cn(
                'h-9 rounded-lg px-4 text-sm font-medium transition',
                activePeriod === period
                  ? 'bg-[#7948ea] text-white shadow-sm'
                  : 'bg-white text-text-secondary hover:bg-surface-active-alt hover:text-text-primary dark:bg-[#242424] dark:text-gray-200 dark:hover:bg-[#303030]',
              )}
            >
              {localize(periodLabelKeys[period])}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-[#f5f5f7] p-5 shadow-sm dark:bg-[#171717] dark:shadow-black/30">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-text-primary dark:text-white">
              {localize('com_skill_recent_task_calendar')}
            </h3>
            <p className="mt-1 text-sm text-text-secondary dark:text-gray-300">
              {localize('com_skill_recent_task_calendar_desc')}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-gray-400">
            <Clock3 className="h-4 w-4" />
            <span>{localize('com_skill_matching_tasks', { count: filteredTasks.length })}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-xl bg-white py-12 text-center text-sm text-text-secondary shadow-sm dark:bg-[#242424] dark:text-gray-300">
            {localize('com_skill_tasks_loading')}
          </div>
        ) : groupedTasks.length === 0 ? (
          <div className="rounded-xl bg-white py-12 text-center text-sm text-text-secondary shadow-sm dark:bg-[#242424] dark:text-gray-300">
            {localize('com_skill_tasks_empty')}
          </div>
        ) : (
          <div className="space-y-5">
            {groupedTasks.map((group) => (
              <section key={group.group}>
                <div className="mb-3 flex items-center gap-3">
                  <div className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-text-primary shadow-sm dark:bg-[#242424] dark:text-white">
                    {group.label}
                  </div>
                  <div className="dark:bg-white/8 h-px flex-1 bg-black/5" />
                </div>

                <div className="space-y-3">
                  {group.tasks.map((task) => (
                    <SkillTaskCard
                      key={task.id}
                      task={task}
                      onOpen={() => navigate(`/skills/${encodeURIComponent(task.skillName)}`)}
                      onAction={handleTaskAction}
                      disabled={updateTask.isLoading || runTask.isLoading || deleteTask.isLoading}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <SkillTaskEditDialog
        task={editingTask}
        open={Boolean(editingTask)}
        isSaving={updateTask.isLoading}
        onOpenChange={(open) => !open && setEditingTask(null)}
        onChange={setEditingTask}
        onSave={handleSaveEditingTask}
      />
    </div>
  );
};

export default SkillTaskTimelineMock;
