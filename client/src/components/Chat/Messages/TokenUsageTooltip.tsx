import type { TMessage } from 'librechat-data-provider';
import { HoverCard, HoverCardContent, HoverCardPortal, HoverCardTrigger } from '@librechat/client';
import useLocalize from '~/hooks/useLocalize';

const formatTokens = (value: number) => Math.max(0, value).toLocaleString();

type TokenUsageTooltipProps = Pick<
  TMessage,
  | 'inputTokenCount'
  | 'tokenCount'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'inputTokens'
  | 'outputTokens'
>;

export default function TokenUsageTooltip({
  inputTokenCount,
  tokenCount,
  cacheReadTokens,
  cacheWriteTokens,
  inputTokens,
  outputTokens,
}: TokenUsageTooltipProps) {
  const localize = useLocalize();
  const input = Math.max(0, inputTokenCount ?? 0);
  const output = Math.max(0, tokenCount ?? 0);
  const total = input + output;
  const cacheRead = Math.max(0, cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, cacheWriteTokens ?? 0);
  const cacheMiss = Math.max(0, input - cacheRead - cacheWrite);
  const cacheHitRate = input > 0 ? (cacheRead / input) * 100 : 0;

  /* Latest model call usage */
  const hasLastCall = inputTokens != null || outputTokens != null;

  const valueClassName = 'min-w-20 text-right font-mono tabular-nums';
  const rowClassName = 'grid grid-cols-[minmax(0,1fr)_minmax(5rem,auto)] items-center gap-4';
  const sectionTitle = 'pt-2 border-t border-border-medium mt-2 text-text-secondary font-medium';

  const detail = (
    <div className="w-full min-w-0 space-y-3 text-sm">
      <div className={`${rowClassName} border-b border-border-medium pb-2 font-medium`}>
        <span className="min-w-0">{localize('com_ui_token_usage_details')}</span>
        <span className={valueClassName}>{formatTokens(total)}</span>
      </div>
      <div className="space-y-1.5">
        <div className={rowClassName}>
          <span className="min-w-0">{localize('com_ui_input')}</span>
          <span className={valueClassName}>{formatTokens(input)}</span>
        </div>
        <div className="space-y-1 pl-3 text-text-secondary">
          <div className={rowClassName}>
            <span className="min-w-0">{localize('com_ui_token_cache_hit')}</span>
            <span className={valueClassName}>{formatTokens(cacheRead)}</span>
          </div>
          <div className={rowClassName}>
            <span className="min-w-0">{localize('com_ui_token_cache_miss')}</span>
            <span className={valueClassName}>{formatTokens(cacheMiss)}</span>
          </div>
          <div className={rowClassName}>
            <span className="min-w-0">{localize('com_ui_token_cache_write')}</span>
            <span className={valueClassName}>{formatTokens(cacheWrite)}</span>
          </div>
        </div>
        <div className={rowClassName}>
          <span className="min-w-0">{localize('com_ui_token_output')}</span>
          <span className={valueClassName}>{formatTokens(output)}</span>
        </div>
      </div>
      <div className={`${rowClassName} border-t border-border-medium pt-2`}>
        <span className="min-w-0">{localize('com_ui_token_cache_hit_rate')}</span>
        <span className={valueClassName}>{cacheHitRate.toFixed(1)}%</span>
      </div>
      {hasLastCall && (
        <div className="space-y-1.5">
          <div className={sectionTitle}>{localize('com_ui_token_last_call')}</div>
          <div className={rowClassName}>
            <span className="min-w-0">{localize('com_ui_token_input_excl_cache')}</span>
            <span className={valueClassName}>{formatTokens(Math.max(0, inputTokens ?? 0))}</span>
          </div>
          <div className={rowClassName}>
            <span className="min-w-0">{localize('com_ui_token_output')}</span>
            <span className={valueClassName}>{formatTokens(Math.max(0, outputTokens ?? 0))}</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="flex items-center gap-2">
          <span title={localize('com_ui_token_input_count')}>In: {formatTokens(input)}</span>
          <span title={localize('com_ui_token_output_count')}>Out: {formatTokens(output)}</span>
        </span>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent
          side="top"
          align="center"
          collisionPadding={16}
          className="w-80 max-w-[calc(100vw-2rem)] p-4"
        >
          {detail}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
