import { useCallback } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { Sparkles } from 'lucide-react';
import { useRecoilState } from 'recoil';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { freezeModeState } from '~/store/freezeMode';
import { cn } from '~/utils';

export function FreezeButton() {
  const localize = useLocalize();
  const { conversation } = useChatContext();
  const [freezeState, setFreezeState] = useRecoilState(freezeModeState);
  const { isFreezeMode } = freezeState;

  const handleToggle = useCallback(() => {
    if (isFreezeMode) {
      // Exit freeze mode
      setFreezeState({
        isFreezeMode: false,
        startMsgId: null,
        endMsgId: null,
      });
    } else {
      // Enter freeze mode
      setFreezeState({
        isFreezeMode: true,
        startMsgId: null,
        endMsgId: null,
      });
    }
  }, [isFreezeMode, setFreezeState]);

  // Only show for PI endpoint (endpoint is stored as string, 'pi' is a custom endpoint)
  const isPIEndpoint = (conversation?.endpoint as string) === 'pi';
  if (!isPIEndpoint) {
    return null;
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <TooltipAnchor
        description={isFreezeMode ? localize('com_freeze_exit') : localize('com_freeze_button')}
        render={
          <button
            onClick={handleToggle}
            aria-label={isFreezeMode ? localize('com_freeze_exit') : localize('com_freeze_button')}
            aria-pressed={isFreezeMode}
            className={cn(
              'inline-flex size-10 flex-shrink-0 items-center justify-center rounded-xl border border-border-light text-text-primary transition-all ease-in-out',
              isFreezeMode
                ? 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900'
                : 'bg-presentation shadow-sm hover:bg-surface-active-alt',
            )}
          >
            <Sparkles className="icon-lg" aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}
