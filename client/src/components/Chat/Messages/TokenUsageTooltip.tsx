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
  | 'totalInputTokens'
  | 'totalOutputTokens'
  | 'totalCacheReadTokens'
  | 'totalCacheWriteTokens'
>;

export default function TokenUsageTooltip({
  inputTokenCount,
  tokenCount,
  cacheReadTokens,
  cacheWriteTokens,
  inputTokens,
  outputTokens,
  totalInputTokens,
  totalOutputTokens,
  totalCacheReadTokens,
  totalCacheWriteTokens,
}: TokenUsageTooltipProps) {
  const localize = useLocalize();
  /*
    Turn-cumulative usage only (shared caliber with the pi backend): the same
    values drive the In/Out summary and the tooltip so the two always agree.
    Messages recorded before this caliber existed fall back to the per-call
    fields, then to the legacy inputTokenCount (full prompt incl. cache).
  */
  const cacheRead = Math.max(0, totalCacheReadTokens ?? cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, totalCacheWriteTokens ?? cacheWriteTokens ?? 0);
  const input = Math.max(
    0,
    totalInputTokens ?? inputTokens ?? Math.max(0, (inputTokenCount ?? 0) - cacheRead - cacheWrite),
  );
  const output = Math.max(0, totalOutputTokens ?? outputTokens ?? tokenCount ?? 0);
  const total = input + output + cacheRead + cacheWrite;

  const valueClassName = 'min-w-20 text-right font-mono tabular-nums';
  const rowClassName = 'grid grid-cols-[minmax(0,1fr)_minmax(5rem,auto)] items-center gap-4';

  const detail = (
    <div className="w-full min-w-0 space-y-3 text-sm">
      <div className={`${rowClassName} border-b border-border-medium pb-2 font-medium`}>
        <span className="min-w-0">{localize('com_ui_token_turn_totals')}</span>
      </div>
      <div className="space-y-1.5">
        <div className={rowClassName}>
          <span className="min-w-0">{localize('com_ui_token_input_excl_cache')}</span>
          <span className={valueClassName}>{formatTokens(input)}</span>
        </div>
        <div className="space-y-1 pl-3 text-text-secondary">
          <div className={rowClassName}>
            <span className="min-w-0">{localize('com_ui_token_cache_hit')}</span>
            <span className={valueClassName}>{formatTokens(cacheRead)}</span>
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
        <div className={`${rowClassName} border-t border-border-medium pt-2`}>
          <span className="min-w-0">{localize('com_ui_token_sum')}</span>
          <span className={valueClassName}>{formatTokens(total)}</span>
        </div>
      </div>
    </div>
  );

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="flex items-center gap-2">
          <span title={localize('com_ui_token_input_excl_cache')}>
            {localize('com_ui_token_in')} {formatTokens(input)}
          </span>
          <span title={localize('com_ui_token_output')}>
            {localize('com_ui_token_out')} {formatTokens(output)}
          </span>
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
