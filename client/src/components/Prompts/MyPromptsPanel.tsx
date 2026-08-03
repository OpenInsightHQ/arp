import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, Search } from 'lucide-react';
import { Spinner } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type { TPromptGroup } from 'librechat-data-provider';
import { useGetAllPromptGroups } from '~/data-provider';
import { useHasAccess, useLocalize } from '~/hooks';
import AutoSendPrompt from './Groups/AutoSendPrompt';
import MyPromptsList from './MyPromptsList';
import MyPromptsEmptyState from './MyPromptsEmptyState';

export default function MyPromptsPanel({ onClose }: { onClose: () => void }) {
  const localize = useLocalize();
  const navigate = useNavigate();

  const [filter, setFilter] = useState('');
  const { data, isLoading } = useGetAllPromptGroups();

  const hasCreateAccess = useHasAccess({
    permissionType: PermissionTypes.PROMPTS,
    permission: Permissions.CREATE,
  });

  const filteredGroups = useMemo(() => {
    const groups = data ?? [];
    const trimmed = filter.trim().toLowerCase();
    if (!trimmed) {
      return groups;
    }
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(trimmed) ||
        group.oneliner?.toLowerCase().includes(trimmed) ||
        group.productionPrompt?.prompt?.toLowerCase().includes(trimmed),
    );
  }, [data, filter]);

  const openPrompt = (group: TPromptGroup) => {
    if (!group._id) {
      return;
    }
    navigate(`/d/prompts/${group._id}`);
    onClose();
  };

  const createPrompt = () => {
    navigate('/d/prompts/new');
    onClose();
  };

  const bodyContent = (() => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      );
    }
    if (filteredGroups.length === 0) {
      return <MyPromptsEmptyState isFiltered={filter.trim().length > 0} />;
    }
    return <MyPromptsList groups={filteredGroups} onOpen={openPrompt} />;
  })();

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <FileText className="size-5 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">
          {localize('com_nav_my_prompts')}
        </span>
        {data && <span className="ml-auto text-xs text-text-secondary">{data.length}</span>}
      </div>

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={localize('com_ui_search_prompts')}
            className="w-full rounded-lg border border-border-light bg-transparent py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
          />
        </div>
        {hasCreateAccess && (
          <button
            type="button"
            onClick={createPrompt}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-submit px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-surface-submit-hover"
          >
            <Plus className="size-4" />
            {localize('com_ui_create_prompt')}
          </button>
        )}
      </div>

      <div className="mb-3 flex items-center justify-end">
        <AutoSendPrompt className="text-xs dark:text-white" />
      </div>

      {bodyContent}
    </div>
  );
}
