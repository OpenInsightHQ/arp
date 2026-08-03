/* eslint-disable i18next/no-literal-string */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FolderOpen } from 'lucide-react';
import { Spinner } from '@librechat/client';
import { useGallerySkillRunsQuery } from '~/data-provider';
import MyFilesDialog from '~/components/Chat/Input/CodeInterpreter/MyFilesDialog';
import { useLocalize } from '~/hooks';

const formatDateTime = (dateString?: string | null): string => {
  if (!dateString) {
    return '-';
  }
  return new Date(dateString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function SkillRunConversation() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { skillName = '', runId = '' } = useParams();
  const decodedSkillName = decodeURIComponent(skillName);
  const decodedRunId = decodeURIComponent(runId);
  const [myFilesOpen, setMyFilesOpen] = useState(false);
  const { data, isLoading } = useGallerySkillRunsQuery({ skillName: decodedSkillName });
  const run = useMemo(
    () => data?.runs?.find((item) => item.id === decodedRunId),
    [data?.runs, decodedRunId],
  );

  return (
    <div className="flex h-full flex-col bg-[#f6f6f7] text-text-primary dark:bg-[#101010] dark:text-white">
      <div className="border-b border-black/5 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#1a1a1a]">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/skills/${encodeURIComponent(decodedSkillName)}`)}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary dark:text-gray-200 dark:hover:bg-[#303030] dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            {localize('com_skill_back_to_logs')}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{decodedSkillName}</div>
            <div className="truncate text-xs text-text-secondary dark:text-gray-400">
              {localize('com_skill_run_conversation')} · {decodedRunId}
            </div>
          </div>
          {run?.agentId && run.sessionId ? (
            <button
              type="button"
              onClick={() => setMyFilesOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary dark:text-gray-200 dark:hover:bg-[#303030] dark:hover:text-white"
              title="My Files"
            >
              <FolderOpen className="h-4 w-4" />
              My Files
            </button>
          ) : null}
        </div>
      </div>

      <main className="flex-1 overflow-auto px-4 py-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Spinner className="h-6 w-6" />
            </div>
          ) : !run ? (
            <div className="rounded-2xl bg-white p-8 text-center text-sm text-text-secondary shadow-sm dark:bg-[#1a1a1a] dark:text-gray-300">
              {localize('com_skill_run_not_found')}
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary dark:text-gray-300">
                  <span>{run.status}</span>
                  <span>{run.triggeredBy === 'manual' ? localize('com_skill_manual') : localize('com_skill_auto')}</span>
                  <span>{localize('com_skill_started')}{formatDateTime(run.startedAt)}</span>
                  {run.durationMs ? <span>{Math.round(run.durationMs / 1000)}s</span> : null}
                  {run.sessionId ? <span>Session：{run.sessionId}</span> : null}
                </div>
              </div>

              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-2xl bg-[#7948ea] px-4 py-3 text-sm leading-6 text-white shadow-sm">
                  <div className="mb-1 text-xs opacity-75">{localize('com_skill_user_message')}</div>
                  <pre className="whitespace-pre-wrap font-sans">{run.prompt || '/skill:' + run.skillName}</pre>
                </div>
              </div>

              <div className="flex justify-start">
                <div className="max-w-[82%] rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-text-primary shadow-sm dark:bg-[#1f1f1f] dark:text-gray-100">
                  <div className="mb-1 text-xs text-text-secondary dark:text-gray-400">{localize('com_skill_pi_output')}</div>
                  {run.textOutput ? (
                    <pre className="whitespace-pre-wrap font-sans">{run.textOutput}</pre>
                  ) : run.error?.message ? (
                    <div className="rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-500/15 dark:text-red-200">
                      {run.error.message}
                    </div>
                  ) : (
                    <span className="text-text-secondary dark:text-gray-400">{localize('com_skill_no_text_output')}</span>
                  )}
                </div>
              </div>

              {run.files?.length ? (
                <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                  <div className="text-sm font-semibold">{localize('com_skill_output_files')}</div>
                  <div className="mt-3 space-y-2">
                    {run.files.map((file) => (
                      <a
                        key={`${run.id}-${file.path || file.name}`}
                        href={file.url || '#'}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => !file.url && event.preventDefault()}
                        className="flex items-center gap-2 rounded-lg bg-[#f5f5f7] px-3 py-2 text-sm text-[#7948ea] hover:underline dark:bg-[#242424] dark:text-[#b49cff]"
                      >
                        <ExternalLink className="h-4 w-4" />
                        <span className="truncate">{file.path || file.name}</span>
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              {run.logs?.length ? (
                <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-[#1a1a1a] dark:shadow-black/30">
                  <div className="text-sm font-semibold">{localize('com_skill_run_logs')}</div>
                  <div className="mt-3 space-y-1 rounded-xl bg-[#f5f5f7] p-3 font-mono text-xs leading-5 text-text-secondary dark:bg-[#242424] dark:text-gray-300">
                    {run.logs.map((log, index) => (
                      <div key={`${run.id}-log-${index}`}>
                        [{log.level}] {log.message}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </main>
      {run?.agentId && run.sessionId ? (
        <MyFilesDialog
          agentId={run.agentId}
          sessionId={run.sessionId}
          isOpen={myFilesOpen}
          onOpenChange={setMyFilesOpen}
        />
      ) : null}
    </div>
  );
}
