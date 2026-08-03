import { useState, useMemo, memo, useCallback, useRef, useId } from 'react';
import { useAtom } from 'jotai';
import type { MouseEvent, FocusEvent } from 'react';
import type { TMessageContentParts } from 'librechat-data-provider';
import { ContentTypes } from 'librechat-data-provider';
import { ThinkingContent, ThinkingButton, FloatingThinkingBar } from './Thinking';
import { showThinkingAtom } from '~/store/showThinking';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type ThinkingProcessProps = {
  parts: TMessageContentParts[];
  isSubmitting: boolean;
  isLatestMessage: boolean;
};

/**
 * ThinkingProcess - Aggregates all THINK + TOOL_CALL parts into a single collapsible
 * "思考过程" block, 100% reusing Reasoning's UI components and animation.
 *
 * Differences from Reasoning:
 * - Takes an array of parts instead of a single reasoning string
 * - THINK texts are concatenated; TOOL_CALL names shown as compact step list
 * - Shows "N 个工具步骤" summary when collapsed
 * - Copy content includes tool steps
 */
const ThinkingProcess = memo(({ parts, isSubmitting, isLatestMessage }: ThinkingProcessProps) => {
  const contentId = useId();
  const localize = useLocalize();
  const [showThinking] = useAtom(showThinkingAtom);
  const [isExpanded, setIsExpanded] = useState(showThinking);
  const [isBarVisible, setIsBarVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const effectiveIsSubmitting = isLatestMessage ? isSubmitting : false;

  const label = effectiveIsSubmitting
    ? localize('com_ui_thinking')
    : localize('com_ui_thoughts');

  // Build combined reasoning text and tool step summaries
  const { reasoningText, toolSteps, copyContent } = useMemo(() => {
    const thinkTexts: string[] = [];
    const steps: { name: string; completed: boolean }[] = [];

    parts.forEach((part) => {
      if (part.type === ContentTypes.THINK) {
        const raw = typeof part.think === 'string' ? part.think : part.think?.value;
        if (typeof raw === 'string' && raw.trim()) {
          const cleaned = raw
            .replace(/^<think>\s*/, '')
            .replace(/\s*<\/think>$/, '')
            .trim();
          thinkTexts.push(cleaned);
        }
      } else if (part.type === ContentTypes.TOOL_CALL) {
        const toolCall = part[ContentTypes.TOOL_CALL];
        if (toolCall && typeof toolCall === 'object' && 'name' in toolCall) {
          const name = (toolCall as { name?: string }).name || '';
          const completed = !effectiveIsSubmitting && ((toolCall as { progress?: number }).progress ?? 0) >= 1;
          steps.push({ name, completed });
        }
      }
    });

    const text = thinkTexts.join('\n\n');
    const copyParts: string[] = [];
    if (text) { copyParts.push(text); }
    if (steps.length > 0) {
      copyParts.push(steps.map((s) => `${s.completed ? '✓' : '⏳'} ${s.name}`).join('\n'));
    }

    return { reasoningText: text, toolSteps: steps, copyContent: copyParts.join('\n\n---\n\n') };
  }, [parts, effectiveIsSubmitting]);

  const handleClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsExpanded((prev) => !prev);
  }, []);

  const handleFocus = useCallback(() => {
    setIsBarVisible(true);
  }, []);

  const handleBlur = useCallback((e: FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsBarVisible(false);
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsBarVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!containerRef.current?.contains(document.activeElement)) {
      setIsBarVisible(false);
    }
  }, []);

  const hasContent = reasoningText.length > 0 || toolSteps.length > 0;
  if (!hasContent) {
    return null;
  }

  // Summary shown when collapsed
  const collapsibleLabel = !isExpanded && toolSteps.length > 0
    ? `${label}  ${toolSteps.length} ${localize('com_ui_tool_steps')}`
    : label;

  return (
    <div
      ref={containerRef}
      className="group/reasoning"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="group/thinking-container">
        <div className="mb-2 pb-2 pt-2">
          <ThinkingButton
            isExpanded={isExpanded}
            onClick={handleClick}
            label={collapsibleLabel}
            content={copyContent}
            contentId={contentId}
          />
        </div>
        <div
          id={contentId}
          role="group"
          aria-label={label}
          aria-hidden={!isExpanded || undefined}
          className={cn('grid transition-all duration-300 ease-out', isExpanded && 'mb-4')}
          style={{
            gridTemplateRows: isExpanded ? '1fr' : '0fr',
          }}
        >
          <div className="relative overflow-hidden">
            <ThinkingContent>
              {reasoningText}
              {toolSteps.length > 0 && (
                <div className={cn(reasoningText && 'mt-3 pt-3 border-t border-border-light')}>
                  {toolSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 py-0.5 text-sm">
                      <span className={cn(
                        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs',
                        step.completed
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-surface-tertiary text-text-secondary',
                      )}>
                        {step.completed ? '✓' : '·'}
                      </span>
                      <span className="text-text-secondary font-mono text-xs">{step.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {effectiveIsSubmitting && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-text-secondary" />
                  {localize('com_ui_processing')}
                </div>
              )}
            </ThinkingContent>
            <FloatingThinkingBar
              isVisible={isBarVisible && isExpanded}
              isExpanded={isExpanded}
              onClick={handleClick}
              content={copyContent}
              contentId={contentId}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

ThinkingProcess.displayName = 'ThinkingProcess';
export default ThinkingProcess;
