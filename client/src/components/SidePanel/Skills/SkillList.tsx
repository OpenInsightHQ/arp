import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TSkill } from 'librechat-data-provider';
import { Trans } from 'react-i18next';
import { Download, ChevronRight } from 'lucide-react';
import {
  Spinner,
  Label,
  OGDialog,
  TrashIcon,
  TooltipAnchor,
  OGDialogTrigger,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import { dataService } from 'librechat-data-provider';
import { useDeleteSkillMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface SkillListProps {
  skills: TSkill[];
  onNavigate?: () => void;
}

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export default function SkillList({ skills, onNavigate }: SkillListProps) {
  const navigate = useNavigate();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const deleteMutation = useDeleteSkillMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_skill_deleted'), status: 'success' });
      setDeleteName(null);
    },
    onError: () => {
      showToast({ message: localize('com_ui_skill_delete_failed'), status: 'error' });
    },
  });

  const handleDownload = async (skillName: string) => {
    setDownloading(skillName);
    try {
      const blob = await dataService.downloadSkill(skillName);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${skillName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      showToast({ message: localize('com_ui_skill_download_failed'), status: 'error' });
    } finally {
      setDownloading(null);
    }
  };

  const handleOpenSkill = (skillName: string) => {
    onNavigate?.();
    navigate(`/skills/${encodeURIComponent(skillName)}`);
  };

  const confirmDelete = () => {
    if (deleteName) {
      deleteMutation.mutate(deleteName);
    }
  };

  const actionButtonClass = cn(
    'flex size-7 items-center justify-center rounded-md',
    'transition-colors duration-150',
    'text-text-secondary hover:text-text-primary',
    'hover:bg-surface-tertiary',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy',
  );

  return (
    <>
      <div className="space-y-2">
        {skills.map((skill) => (
          <div
            key={skill.name}
            role="button"
            tabIndex={0}
            onClick={() => handleOpenSkill(skill.name)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleOpenSkill(skill.name);
              }
            }}
            className="flex cursor-pointer items-start gap-2 rounded-lg border border-border-light bg-transparent px-3 py-2.5 transition-colors hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-text-primary">
                  {skill.name}
                </span>
                <span className="ml-auto shrink-0 text-xs text-text-secondary">
                  {formatDate(skill.lastModified)}
                </span>
              </div>
              {skill.description && (
                <p className="mt-1 truncate text-sm text-text-secondary" title={skill.description}>
                  {skill.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <TooltipAnchor
                description={localize('com_ui_download')}
                side="top"
                render={
                  <button
                    className={actionButtonClass}
                    aria-label={localize('com_ui_download')}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDownload(skill.name);
                    }}
                    disabled={downloading === skill.name}
                  >
                    {downloading === skill.name ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                  </button>
                }
              />
              <OGDialog
                open={deleteName === skill.name}
                onOpenChange={(open) => !open && setDeleteName(null)}
              >
                <OGDialogTrigger asChild>
                  <TooltipAnchor
                    description={localize('com_ui_delete_skill')}
                    side="top"
                    render={
                      <button
                        className={actionButtonClass}
                        aria-label={localize('com_ui_delete')}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteName(skill.name);
                        }}
                      >
                        {deleteMutation.isLoading && deleteName === skill.name ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <TrashIcon className="size-3.5" />
                        )}
                      </button>
                    }
                  />
                </OGDialogTrigger>
                <OGDialogTemplate
                  showCloseButton={false}
                  title={localize('com_ui_delete_skill')}
                  className="w-11/12 max-w-lg"
                  main={
                    <Label className="text-left text-sm font-medium">
                      <Trans
                        i18nKey="com_ui_delete_confirm_strong"
                        values={{ title: skill.name }}
                        components={{ strong: <strong /> }}
                      />
                    </Label>
                  }
                  selection={{
                    selectHandler: confirmDelete,
                    selectClasses:
                      'bg-red-700 dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-800 text-white',
                    selectText: localize('com_ui_delete'),
                  }}
                />
              </OGDialog>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-text-secondary" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
