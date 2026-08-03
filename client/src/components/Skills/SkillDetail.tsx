/* eslint-disable i18next/no-literal-string */
import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ExternalLink, FileText, FolderOpen, Play, Settings2, XCircle } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Spinner } from '@librechat/client';
import {
  useCreateGallerySkillTaskMutation,
  useDeleteGallerySkillTaskMutation,
  useGallerySkillRunsQuery,
  useGallerySkillTasksQuery,
  useMySkillsQuery,
  useRunGallerySkillTaskMutation,
  useSkillDetailQuery,
  useUpdateGallerySkillTaskMutation,
} from '~/data-provider';
import type { GallerySkillTask } from 'librechat-data-provider';
import SkillTaskCard from '~/components/ArtifactsGallery/SkillTaskCard';
import SkillTaskEditDialog from '~/components/ArtifactsGallery/SkillTaskEditDialog';
import type { SkillTaskAction } from '~/components/ArtifactsGallery/SkillTaskCard';
import { cn } from '~/utils';
import { useLocalize } from '~/hooks';

const formatDateTime = (dateString?: string): string => {
  if (!dateString) {
    return '-';
  }

  return new Date(dateString).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatParameters = (parameters: string | undefined, localize: ReturnType<typeof useLocalize>) => {
  if (!parameters?.trim()) {
    return localize('com_skill_no_parameters');
  }

  try {
    return JSON.stringify(JSON.parse(parameters), null, 2);
  } catch {
    return parameters;
  }
};

const getCellValue = (row: Record<string, string>, keys: string[]) => {
  const key = keys.find((item) => row[item]);
  return key ? row[key] : '';
};

const DetailTable = ({
  columns,
  rows,
  emptyText,
}: {
  columns: Array<{ label: string; keys: string[] }>;
  rows?: Array<Record<string, string>>;
  emptyText: string;
}) => {
  if (!rows?.length) {
    return (
      <div className="mt-4 rounded-xl bg-[#f5f5f7] p-4 text-sm text-text-secondary dark:bg-[#242424] dark:text-gray-300">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl bg-[#f5f5f7] dark:bg-[#242424]">
      <div className="grid gap-3 px-4 py-3 text-xs font-medium text-text-secondary dark:text-gray-400 md:grid-cols-4">
        {columns.map((column) => (
          <div key={column.label}>{column.label}</div>
        ))}
      </div>
      <div className="divide-y divide-white/70 dark:divide-white/5">
        {rows.map((row, index) => (
          <div
            key={`${getCellValue(row, columns[0].keys)}-${index}`}
            className="grid gap-3 px-4 py-3 text-sm leading-6 text-text-primary dark:text-gray-100 md:grid-cols-4"
          >
            {columns.map((column) => (
              <div key={column.label} className="min-w-0 break-words">
                {getCellValue(row, column.keys) || '-'}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

const buildSkillStructure = (localize: ReturnType<typeof useLocalize>, detail?: {
  structure?: {
    hasSkillMd: boolean;
    hasScripts: boolean;
    hasReferences: boolean;
    hasAssets: boolean;
    scripts: string[];
    references: string[];
    assets: string[];
  };
}) => [
  {
    name: 'SKILL.md',
    tag: localize('com_skill_required'),
    exists: detail?.structure?.hasSkillMd,
    description: localize('com_skill_structure_skill_md_desc'),
    children: [localize('com_skill_structure_skill_md_child_1'), localize('com_skill_structure_skill_md_child_2')],
    files: detail?.structure?.hasSkillMd ? ['SKILL.md'] : [],
  },
  {
    name: 'scripts/',
    tag: localize('com_skill_optional'),
    exists: detail?.structure?.hasScripts,
    description: localize('com_skill_structure_scripts_desc'),
    files: detail?.structure?.scripts || [],
  },
  {
    name: 'references/',
    tag: localize('com_skill_optional'),
    exists: detail?.structure?.hasReferences,
    description: localize('com_skill_structure_references_desc'),
    files: detail?.structure?.references || [],
  },
  {
    name: 'assets/',
    tag: localize('com_skill_optional'),
    exists: detail?.structure?.hasAssets,
    description: localize('com_skill_structure_assets_desc'),
    files: detail?.structure?.assets || [],
  },
];

export default function SkillDetail() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { skillName = '' } = useParams();
  const decodedSkillName = decodeURIComponent(skillName);
  const { data, isLoading } = useMySkillsQuery();
  const { data: detail, isLoading: isDetailLoading } = useSkillDetailQuery(decodedSkillName);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [frequency, setFrequency] = useState<'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly'>(
    'daily',
  );
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [interval, setInterval] = useState('30');
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'definition' | 'tasks' | 'runs'>('definition');
  const [editingTask, setEditingTask] = useState<GallerySkillTask | null>(null);
  const { data: skillTasksData, isLoading: isSkillTasksLoading } = useGallerySkillTasksQuery({
    skillName: decodedSkillName,
  });
  const { data: skillRunsData, isLoading: isSkillRunsLoading } = useGallerySkillRunsQuery({
    skillName: decodedSkillName,
  });
  const createTask = useCreateGallerySkillTaskMutation({
    onSuccess: () => {
      setShowPublishDialog(false);
      queryClient.invalidateQueries(['galleryArtifacts', 'skill-tasks']);
      setActiveTab('tasks');
      navigate(`/skills/${encodeURIComponent(decodedSkillName)}`);
    },
  });
  const updateTask = useUpdateGallerySkillTaskMutation({
    onSuccess: () => {
      setEditingTask(null);
      queryClient.invalidateQueries(['galleryArtifacts', 'skill-tasks']);
    },
  });
  const deleteTask = useDeleteGallerySkillTaskMutation({
    onSuccess: () => {
      queryClient.invalidateQueries(['galleryArtifacts', 'skill-tasks']);
      queryClient.invalidateQueries(['galleryArtifacts', 'skill-runs']);
    },
  });
  const runTask = useRunGallerySkillTaskMutation({
    onSuccess: () => {
      queryClient.invalidateQueries(['galleryArtifacts', 'skill-tasks']);
      queryClient.invalidateQueries(['galleryArtifacts', 'skill-runs']);
      setActiveTab('runs');
    },
  });

  const skill = useMemo(
    () => data?.skills?.find((item) => item.name === decodedSkillName),
    [data?.skills, decodedSkillName],
  );
  const structure = useMemo(() => buildSkillStructure(localize, detail), [detail, localize]);
  const description = detail?.metadata?.description || skill?.description || localize('com_skill_no_description');
  const author =
    detail?.metadata?.author ||
    detail?.metadata?.作者 ||
    detail?.metadata?.owner ||
    detail?.metadata?.creator ||
    detail?.author ||
    localize('com_skill_unknown_author');
  const parameterRows = detail?.parameters || [];
  const skillTasks = skillTasksData?.tasks || [];
  const skillRuns = skillRunsData?.runs || [];

  const openPublishDialog = () => {
    setTaskName(`${decodedSkillName} ${localize('com_skill_tasks')}`);
    const defaults = parameterRows.reduce<Record<string, string>>((result, row) => {
      const name = getCellValue(row, ['参数', 'Parameter', 'name']);
      const defaultValue = getCellValue(row, ['默认值', 'Default', 'default']);
      if (name) {
        result[name] = defaultValue;
      }
      return result;
    }, {});
    setParameterValues(defaults);
    setShowPublishDialog(true);
  };

  const handlePublishTask = () => {
    createTask.mutate({
      taskName,
      description,
      skillName: decodedSkillName,
      skillAuthor: author,
      skillSource: 'my',
      skillMetadataSnapshot: detail?.metadata || {},
      parameters: parameterValues,
      frequency,
      interval: frequency === 'minute' || frequency === 'hourly' ? Number(interval) : null,
      scheduleTime,
      timezone: 'Asia/Shanghai',
    });
  };

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
    <div className="relative flex h-full flex-col overflow-hidden bg-[#f6f6f7] text-text-primary dark:bg-[#101010] dark:text-white">
      <div className="absolute left-0 right-0 top-0 z-30 px-4 pt-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between rounded-full bg-white/90 px-3 py-2 shadow-xl backdrop-blur-xl dark:bg-[#242424]/90 dark:shadow-black/40">
          <button
            type="button"
            onClick={() => navigate('/artifacts?tab=SKILL')}
            className="flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-text-secondary transition hover:bg-surface-secondary hover:text-text-primary dark:text-gray-200 dark:hover:bg-[#303030] dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            {localize('com_skill_back')}
          </button>

          <div className="min-w-0 flex-1 px-4 text-center">
            <div className="truncate text-sm font-semibold text-text-primary dark:text-white">
              {decodedSkillName}
            </div>
            <div className="truncate text-xs text-text-secondary dark:text-gray-400">{localize('com_nav_my_skills')}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openPublishDialog}
              className="flex h-9 items-center gap-2 rounded-full bg-[#7948ea] px-4 text-sm font-medium text-white transition hover:bg-[#6d3fda]"
            >
              <Play className="h-4 w-4" />
              {localize('com_skill_publish_task')}
            </button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface-secondary hover:text-text-primary dark:text-gray-200 dark:hover:bg-[#303030] dark:hover:text-white"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-5 pb-10 pt-24">
        <div className="mx-auto max-w-5xl space-y-6">
          {isLoading || isDetailLoading ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-2xl bg-white shadow-sm dark:bg-[#1a1a1a]">
              <Spinner className="size-7" />
            </div>
          ) : !skill ? (
            <div className="rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-[#1a1a1a]">
              <h1 className="text-xl font-semibold">{localize('com_skill_not_found')}</h1>
              <p className="mt-2 text-sm text-text-secondary dark:text-gray-400">
                {localize('com_skill_not_found_desc')}
              </p>
            </div>
          ) : (
            <>
              <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                <div>
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#7948ea]/10 px-3 py-1 text-xs font-medium text-[#7948ea] dark:bg-[#7948ea]/20 dark:text-[#bba8ff]">
                    <FileText className="h-3.5 w-3.5" />
                    {localize('com_skill_overview')}
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight text-text-primary dark:text-white">
                    {skill.name}
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary dark:text-gray-300">
                    {description}
                  </p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-[#f5f5f7] p-4 text-sm dark:bg-[#242424]">
                      <div className="text-xs text-text-secondary dark:text-gray-400">{localize('com_skill_author')}</div>
                      <div className="mt-1 truncate font-medium text-text-primary dark:text-white">
                        {author}
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#f5f5f7] p-4 text-sm dark:bg-[#242424]">
                      <div className="text-xs text-text-secondary dark:text-gray-400">{localize('com_skill_last_updated')}</div>
                      <div className="mt-1 font-medium text-text-primary dark:text-white">
                        {formatDateTime(skill.lastModified)}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl bg-white p-2 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                <div className="flex flex-wrap gap-2">
                  {[
                    ['definition', localize('com_skill_definition')],
                    ['tasks', `${localize('com_skill_tasks')} ${skillTasks.length}`],
                    ['runs', localize('com_skill_run_history')],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setActiveTab(value as typeof activeTab)}
                      className={cn(
                        'h-9 rounded-xl px-4 text-sm font-medium transition',
                        activeTab === value
                          ? 'bg-[#7948ea] text-white shadow-sm'
                          : 'text-text-secondary hover:bg-[#f5f5f7] hover:text-text-primary dark:text-gray-300 dark:hover:bg-[#242424] dark:hover:text-white',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              {activeTab === 'definition' ? (
                <div className="min-w-0 space-y-6">
                  <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-[#7948ea]" />
                      <h2 className="text-base font-semibold text-text-primary dark:text-white">
                        {localize('com_skill_structure')}
                      </h2>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-text-secondary dark:text-gray-300">
                      {localize('com_skill_structure_desc')}
                    </p>

                    <div className="mt-5 space-y-3">
                      {structure.map((item) => (
                        <div
                          key={item.name}
                          className="rounded-xl bg-[#f5f5f7] p-4 dark:bg-[#242424]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {item.exists ? (
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7948ea]" />
                                ) : (
                                  <XCircle className="h-4 w-4 shrink-0 text-text-secondary dark:text-gray-500" />
                                )}
                                <div className="font-mono text-sm font-semibold text-text-primary dark:text-white">
                                  {item.name}
                                </div>
                              </div>
                              <p className="mt-1 text-sm leading-6 text-text-secondary dark:text-gray-300">
                                {item.description}
                              </p>
                            </div>
                            <span
                              className={cn(
                                'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
                                item.exists
                                  ? 'bg-white text-text-secondary dark:bg-[#303030] dark:text-gray-300'
                                  : 'bg-white text-text-secondary dark:bg-[#303030] dark:text-gray-300',
                              )}
                            >
                              {item.exists ? localize('com_skill_existing') : item.tag}
                            </span>
                          </div>
                          {item.children ? (
                            <div className="mt-3 space-y-2 border-l-2 border-[#7948ea]/30 pl-3 dark:border-[#7948ea]/50">
                              {item.children.map((child) => (
                                <div
                                  key={child}
                                  className="text-sm leading-6 text-text-secondary dark:text-gray-300"
                                >
                                  {child}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {item.files.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {item.files.map((file) => (
                                <span
                                  key={file}
                                  className="rounded-full bg-white px-2.5 py-1 font-mono text-xs text-text-secondary dark:bg-[#303030] dark:text-gray-300"
                                >
                                  {file}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                    <h2 className="text-base font-semibold text-text-primary dark:text-white">
                      {localize('com_skill_parameters')}
                    </h2>
                    <DetailTable
                      columns={[
                        { label: localize('com_skill_col_parameter'), keys: ['参数', 'Parameter', 'name'] },
                        { label: localize('com_skill_col_type'), keys: ['类型', 'Type', 'type'] },
                        { label: localize('com_skill_col_default'), keys: ['默认值', 'Default', 'default'] },
                        { label: localize('com_skill_col_description'), keys: ['说明', 'Description', 'description'] },
                      ]}
                      rows={detail?.parameters}
                      emptyText={formatParameters(skill.parameters, localize)}
                    />
                  </section>

                  <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                    <h2 className="text-base font-semibold text-text-primary dark:text-white">
                      {localize('com_skill_output_files')}
                    </h2>
                    <DetailTable
                      columns={[
                        { label: localize('com_skill_col_file'), keys: ['文件', 'File', 'file'] },
                        { label: localize('com_skill_col_description'), keys: ['说明', 'Description', 'description'] },
                        { label: localize('com_skill_col_type'), keys: ['类型', 'Type', 'type'] },
                        { label: localize('com_skill_col_usage'), keys: ['用途', 'Usage', 'usage'] },
                      ]}
                      rows={detail?.outputs}
                      emptyText={localize('com_skill_no_output_definition')}
                    />
                  </section>

                  <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                    <h2 className="text-base font-semibold text-text-primary dark:text-white">
                      SKILL.md
                    </h2>
                    <pre className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-[#f5f5f7] p-4 text-sm leading-6 text-text-primary dark:bg-[#242424] dark:text-gray-100">
                      {detail?.skillMd || localize('com_skill_no_skill_md')}
                    </pre>
                  </section>
                </div>
              ) : null}

              {activeTab === 'tasks' ? (
                <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                  <div>
                    <h2 className="text-base font-semibold text-text-primary dark:text-white">
                      {localize('com_skill_published_tasks')}
                    </h2>
                    <p className="mt-1 text-sm text-text-secondary dark:text-gray-300">
                      {localize('com_skill_no_tasks')}
                    </p>
                  </div>

                  {isSkillTasksLoading ? (
                    <div className="mt-5 rounded-xl bg-[#f5f5f7] p-6 text-center text-sm text-text-secondary dark:bg-[#242424] dark:text-gray-300">
                      {localize('com_skill_tasks_loading')}
                    </div>
                  ) : skillTasks.length === 0 ? (
                    <div className="mt-5 rounded-xl bg-[#f5f5f7] p-6 text-center text-sm text-text-secondary dark:bg-[#242424] dark:text-gray-300">
                      {localize('com_skill_no_tasks')}
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {skillTasks.map((task) => (
                        <SkillTaskCard
                          key={task.id}
                          task={task}
                          compact
                          onAction={handleTaskAction}
                          disabled={updateTask.isLoading || runTask.isLoading || deleteTask.isLoading}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {activeTab === 'runs' ? (
                <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                  <h2 className="text-base font-semibold text-text-primary dark:text-white">
                    {localize('com_skill_run_history')}
                  </h2>
                  {isSkillRunsLoading ? (
                    <div className="mt-5 rounded-xl bg-[#f5f5f7] p-6 text-center text-sm text-text-secondary dark:bg-[#242424] dark:text-gray-300">
                      {localize('com_skill_loading_runs')}
                    </div>
                  ) : skillRuns.length === 0 ? (
                    <div className="mt-5 rounded-xl bg-[#f5f5f7] p-6 text-sm leading-6 text-text-secondary dark:bg-[#242424] dark:text-gray-300">
                      {localize('com_skill_no_runs')}
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {skillRuns.map((run) => (
                        <div key={run.id} className="rounded-xl bg-[#f5f5f7] p-4 dark:bg-[#242424]">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="font-medium text-text-primary dark:text-white">
                                {run.taskNameSnapshot || run.skillName}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary dark:text-gray-300">
                                <span>{run.status}</span>
                                <span>{run.triggeredBy === 'manual' ? localize('com_skill_manual') : localize('com_skill_auto')}</span>
                                <span>{localize('com_skill_started')}{formatDateTime(run.startedAt || undefined)}</span>
                                {run.durationMs ? <span>{Math.round(run.durationMs / 1000)}s</span> : null}
                                {run.files?.length ? <span>{run.files.length} {localize('com_skill_output_files')}</span> : null}
                              </div>
                              {run.prompt ? (
                                <div className="mt-3 rounded-lg bg-white p-3 font-mono text-xs leading-5 text-text-secondary dark:bg-[#303030] dark:text-gray-300">
                                  {run.prompt}
                                </div>
                              ) : null}
                              {run.textOutput ? (
                                <div className="mt-3 line-clamp-3 text-sm leading-6 text-text-secondary dark:text-gray-300">
                                  {run.textOutput}
                                </div>
                              ) : null}
                              {run.error?.message ? (
                                <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-200">
                                  {run.error.message}
                                </div>
                              ) : null}
                              {run.files?.length ? (
                                <div className="mt-3 space-y-2 rounded-lg bg-white p-3 dark:bg-[#303030]">
                                  <div className="text-xs font-medium text-text-primary dark:text-white">{localize('com_skill_output_files')}</div>
                                  {run.files.map((file) => (
                                    <a
                                      key={`${run.id}-${file.path || file.name}`}
                                      href={file.url || '#'}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-2 text-xs text-[#7948ea] hover:underline dark:text-[#b49cff]"
                                      onClick={(event) => !file.url && event.preventDefault()}
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                      <span className="truncate">{file.path || file.name}</span>
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                              {run.logs?.length ? (
                                <div className="mt-3 space-y-1 rounded-lg bg-white p-3 font-mono text-xs leading-5 text-text-secondary dark:bg-[#303030] dark:text-gray-300">
                                  {run.logs.map((log, index) => (
                                    <div key={`${run.id}-log-${index}`}>
                                      [{log.level}] {log.message}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                              <button
                                type="button"
                                onClick={() => navigate(`/skills/${encodeURIComponent(decodedSkillName)}/runs/${encodeURIComponent(run.id)}`)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-xs font-medium text-text-secondary shadow-sm hover:bg-surface-active-alt hover:text-text-primary dark:bg-[#303030] dark:text-gray-200 dark:hover:bg-[#3a3a3a]"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {localize('com_skill_open_run_session')}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </>
          )}
        </div>
      </main>

      <SkillTaskEditDialog
        task={editingTask}
        open={Boolean(editingTask)}
        isSaving={updateTask.isLoading}
        onOpenChange={(open) => !open && setEditingTask(null)}
        onChange={setEditingTask}
        onSave={handleSaveEditingTask}
      />

      <Dialog.Root open={showPublishDialog} onOpenChange={setShowPublishDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 dark:bg-black/70" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#1f1f1f] dark:text-white">
            <Dialog.Title className="text-lg font-semibold">{localize('com_skill_publish_dialog_title')}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-text-secondary dark:text-gray-300">
              {localize('com_skill_publish_dialog_desc')}
            </Dialog.Description>

            <div className="mt-5 space-y-5">
              <label className="block">
                <span className="text-sm font-medium text-text-primary dark:text-white">
                  {localize('com_skill_task_name')}
                </span>
                <input
                  value={taskName}
                  onChange={(event) => setTaskName(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg bg-[#f5f5f7] px-3 text-sm text-text-primary outline-none dark:bg-[#2a2a2a] dark:text-white"
                />
              </label>

              {parameterRows.length > 0 ? (
                <div>
                  <div className="text-sm font-medium text-text-primary dark:text-white">{localize('com_skill_parameters')}</div>
                  <div className="mt-2 space-y-3">
                    {parameterRows.map((row) => {
                      const name = getCellValue(row, ['参数', 'Parameter', 'name']);
                      const descriptionText = getCellValue(row, ['说明', 'Description', 'description']);
                      return (
                        <label key={name} className="block rounded-xl bg-[#f5f5f7] p-3 dark:bg-[#2a2a2a]">
                          <span className="font-mono text-xs font-semibold text-text-primary dark:text-white">
                            {name}
                          </span>
                          {descriptionText ? (
                            <span className="ml-2 text-xs text-text-secondary dark:text-gray-400">
                              {descriptionText}
                            </span>
                          ) : null}
                          <input
                            value={parameterValues[name] || ''}
                            onChange={(event) =>
                              setParameterValues((current) => ({
                                ...current,
                                [name]: event.target.value,
                              }))
                            }
                            className="mt-2 h-9 w-full rounded-lg bg-white px-3 text-sm text-text-primary outline-none dark:bg-[#1f1f1f] dark:text-white"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="text-sm font-medium text-text-primary dark:text-white">{localize('com_skill_frequency')}</div>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {[
                    ['minute', localize('com_skill_minutes')],
                    ['hourly', localize('com_skill_hours')],
                    ['daily', localize('com_skill_daily')],
                    ['weekly', localize('com_skill_weekly')],
                    ['monthly', localize('com_skill_monthly')],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFrequency(value as typeof frequency)}
                      className={cn(
                        'h-10 rounded-lg text-sm font-medium transition',
                        frequency === value
                          ? 'bg-[#7948ea] text-white'
                          : 'bg-[#f5f5f7] text-text-secondary hover:bg-surface-active-alt dark:bg-[#2a2a2a] dark:text-gray-200 dark:hover:bg-[#333333]',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {(frequency === 'minute' || frequency === 'hourly') ? (
                <label className="block">
                  <span className="text-sm font-medium text-text-primary dark:text-white">
                    {localize('com_skill_interval')}
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={interval}
                    onChange={(event) => setInterval(event.target.value)}
                    className="mt-2 h-10 w-full rounded-lg bg-[#f5f5f7] px-3 text-sm text-text-primary outline-none dark:bg-[#2a2a2a] dark:text-white"
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="text-sm font-medium text-text-primary dark:text-white">
                    {localize('com_skill_schedule_time')}
                  </span>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                    className="mt-2 h-10 w-full rounded-lg bg-[#f5f5f7] px-3 text-sm text-text-primary outline-none dark:bg-[#2a2a2a] dark:text-white"
                  />
                </label>
              )}
            </div>

            {createTask.isError ? (
              <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-200">
                {localize('com_skill_publish_failed')}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button className="h-9 rounded-lg px-4 text-sm font-medium text-text-secondary hover:bg-surface-secondary dark:text-gray-200 dark:hover:bg-[#303030]">
                  {localize('com_skill_cancel')}
                </button>
              </Dialog.Close>
              <button
                type="button"
                disabled={!taskName.trim() || createTask.isLoading}
                onClick={handlePublishTask}
                className="h-9 rounded-lg bg-[#7948ea] px-4 text-sm font-medium text-white hover:bg-[#6d3fda] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createTask.isLoading ? localize('com_skill_publishing') : localize('com_skill_confirm_publish')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
