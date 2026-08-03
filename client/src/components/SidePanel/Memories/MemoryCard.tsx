import type { TUserMemory } from 'librechat-data-provider';
import MemoryCardActions from './MemoryCardActions';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MemoryCardProps {
  memory: TUserMemory;
  hasUpdateAccess: boolean;
}

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export default function MemoryCard({ memory, hasUpdateAccess }: MemoryCardProps) {
  const localize = useLocalize();

  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2.5',
        'border border-border-light bg-transparent',
        'hover:bg-surface-secondary',
      )}
    >
      {/* Row 1: Key + Token count + Actions */}
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-text-primary">{memory.key}</span>
        {memory.tokenCount !== undefined && (
          <span className="shrink-0 text-xs text-text-secondary">
            {memory.tokenCount}{' '}
            {localize(memory.tokenCount === 1 ? 'com_ui_token' : 'com_ui_tokens')}
          </span>
        )}
        {hasUpdateAccess && (
          <div className="ml-auto shrink-0">
            <MemoryCardActions memory={memory} />
          </div>
        )}
      </div>

      {/* Row 2: Value + Date */}
      <div className="mt-1 flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-text-primary" title={memory.value}>
          {memory.value}
        </p>
        <span className="shrink-0 text-xs text-text-secondary">
          {formatDate(memory.updated_at)}
        </span>
      </div>

      {/* Row 3: Source Info */}
      {memory.source && (
        <div className="mt-2 flex items-center gap-2">
          {memory.source.from && (
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                memory.source.from === 'auto'
                  ? 'bg-surface-tertiary text-text-secondary'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
              )}
            >
              {memory.source.from === 'auto'
                ? localize('com_ui_memory_auto')
                : localize('com_ui_memory_manual')}
            </span>
          )}
          {memory.source.conversationId && (
            <a
              href={`/c/${memory.source.conversationId}`}
              className="shrink-0 text-xs text-text-secondary underline hover:text-text-primary"
            >
              {localize('com_ui_memory_view_source')}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
