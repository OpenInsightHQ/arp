import { useState } from 'react';
import { Trans } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
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
import { PermissionBits, ResourceType } from 'librechat-data-provider';
import type { TPromptGroup } from 'librechat-data-provider';
import { useDeletePromptGroup } from '~/data-provider';
import { useLocalize, useResourcePermissions } from '~/hooks';
import CategoryIcon from '~/components/Prompts/Groups/CategoryIcon';
import { cn } from '~/utils';

interface MyPromptsListProps {
  groups: TPromptGroup[];
  onOpen: (group: TPromptGroup) => void;
}

const formatDate = (date?: Date | string): string => {
  if (!date) {
    return '';
  }
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getSnippet = (group: TPromptGroup): string => {
  if (typeof group.oneliner === 'string' && group.oneliner.length > 0) {
    return group.oneliner;
  }
  return group.productionPrompt?.prompt ?? '';
};

const actionButtonClass = cn(
  'flex size-7 items-center justify-center rounded-md',
  'transition-colors duration-150',
  'text-text-secondary hover:text-text-primary',
  'hover:bg-surface-tertiary',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy',
);

export default function MyPromptsList({ groups, onOpen }: MyPromptsListProps) {
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <PromptGroupCard key={group._id ?? group.name} group={group} onOpen={onOpen} />
      ))}
    </div>
  );
}

interface PromptGroupCardProps {
  group: TPromptGroup;
  onOpen: (group: TPromptGroup) => void;
}

function PromptGroupCard({ group, onOpen }: PromptGroupCardProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const { hasPermission } = useResourcePermissions(ResourceType.PROMPTGROUP, group._id || '');
  const canDelete = hasPermission(PermissionBits.DELETE);

  const deleteMutation = useDeletePromptGroup({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_prompt_deleted', { 0: group.name }),
        status: 'success',
      });
      setIsConfirmOpen(false);
    },
    onError: () => {
      showToast({ message: localize('com_ui_prompt_delete_error'), status: 'error' });
    },
  });

  const snippet = getSnippet(group);
  const date = formatDate(group.updatedAt ?? group.createdAt);

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border-light bg-transparent px-3 py-2.5 transition-colors hover:bg-surface-secondary">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onOpen(group)}
        aria-label={localize('com_ui_rename_prompt_name', { name: group.name })}
      >
        <div className="flex items-center gap-2">
          <CategoryIcon
            category={group.category ?? ''}
            className="size-4 shrink-0"
            aria-hidden="true"
          />
          <span className="truncate text-sm font-semibold text-text-primary">{group.name}</span>
          {date && <span className="ml-auto shrink-0 text-xs text-text-secondary">{date}</span>}
        </div>
        {snippet && (
          <p className="mt-1 truncate text-sm text-text-secondary" title={snippet}>
            {snippet}
          </p>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {canDelete && (
          <OGDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
            <OGDialogTrigger asChild>
              <TooltipAnchor
                description={localize('com_ui_delete')}
                side="top"
                render={
                  <button
                    className={actionButtonClass}
                    aria-label={localize('com_ui_delete_prompt_name', { name: group.name })}
                  >
                    {deleteMutation.isLoading ? (
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
              title={localize('com_ui_delete_prompt')}
              className="w-11/12 max-w-lg"
              main={
                <Label className="text-left text-sm font-medium">
                  <Trans
                    i18nKey="com_ui_delete_confirm_strong"
                    values={{ title: group.name }}
                    components={{ strong: <strong /> }}
                  />
                </Label>
              }
              selection={{
                selectHandler: () => deleteMutation.mutate({ id: group._id ?? '' }),
                selectClasses:
                  'bg-red-700 dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-800 text-white',
                selectText: localize('com_ui_delete'),
              }}
            />
          </OGDialog>
        )}
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-text-secondary" />
      </div>
    </div>
  );
}
