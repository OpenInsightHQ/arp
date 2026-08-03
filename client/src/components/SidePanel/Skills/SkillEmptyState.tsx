import { Sparkles } from 'lucide-react';
import { useLocalize } from '~/hooks';

interface SkillEmptyStateProps {
  isFiltered?: boolean;
}

export default function SkillEmptyState({ isFiltered = false }: SkillEmptyStateProps) {
  const localize = useLocalize();

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border-light bg-transparent p-6 text-center">
      <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-surface-tertiary">
        <Sparkles className="size-5 text-text-secondary" aria-hidden="true" />
      </div>
      {isFiltered ? (
        <p className="text-sm text-text-secondary">{localize('com_ui_no_skills_match')}</p>
      ) : (
        <>
          <p className="text-sm font-medium text-text-primary">
            {localize('com_ui_no_skills_title')}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">{localize('com_ui_no_skills')}</p>
        </>
      )}
    </div>
  );
}
