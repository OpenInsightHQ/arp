import { useState, useRef, useMemo } from 'react';
import { Sparkles, Upload, Search } from 'lucide-react';
import { Spinner, useToastContext } from '@librechat/client';
import { useMySkillsQuery, useUploadSkillMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import SkillList from './SkillList';
import SkillEmptyState from './SkillEmptyState';

type SkillPanelProps = {
  onNavigate?: () => void;
};

export default function SkillPanel({ onNavigate }: SkillPanelProps = {}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState('');
  const { data, isLoading } = useMySkillsQuery();

  const uploadMutation = useUploadSkillMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_skill_uploaded'), status: 'success' });
    },
    onError: () => {
      showToast({ message: localize('com_ui_skill_upload_failed'), status: 'error' });
    },
  });

  const filteredSkills = useMemo(() => {
    if (!data?.skills) {
      return [];
    }
    const trimmed = filter.trim().toLowerCase();
    if (!trimmed) {
      return data.skills;
    }
    return data.skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(trimmed) ||
        skill.description?.toLowerCase().includes(trimmed),
    );
  }, [data?.skills, filter]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    uploadMutation.mutate(formData);
    e.target.value = '';
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-5 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">
          {localize('com_nav_my_skills')}
        </span>
        {data?.skills && (
          <span className="ml-auto text-xs text-text-secondary">{data.skills.length}</span>
        )}
      </div>

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={localize('com_ui_search_skills')}
            className="w-full rounded-lg border border-border-light bg-transparent py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
          />
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isLoading}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-submit px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-surface-submit-hover disabled:opacity-50"
        >
          {uploadMutation.isLoading ? (
            <Spinner className="size-4" />
          ) : (
            <Upload className="size-4" />
          )}
          {localize('com_ui_upload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      ) : filteredSkills.length === 0 ? (
        <SkillEmptyState isFiltered={filter.trim().length > 0} />
      ) : (
        <SkillList skills={filteredSkills} onNavigate={onNavigate} />
      )}
    </div>
  );
}
