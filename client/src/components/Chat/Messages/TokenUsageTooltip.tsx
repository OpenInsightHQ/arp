import type { TMessage } from 'librechat-data-provider';
import {
  HoverCard,
  HoverCardContent,
  HoverCardPortal,
  HoverCardTrigger,
} from '@librechat/client';

const formatTokens = (value: number) => Math.max(0, value).toLocaleString();

type TokenUsageTooltipProps = Pick<
  TMessage,
  'inputTokenCount' | 'tokenCount' | 'cacheReadTokens' | 'cacheWriteTokens'
>;

export default function TokenUsageTooltip({
  inputTokenCount,
  tokenCount,
  cacheReadTokens,
  cacheWriteTokens,
}: TokenUsageTooltipProps) {
  const input = Math.max(0, inputTokenCount ?? 0);
  const output = Math.max(0, tokenCount ?? 0);
  const total = input + output;
  const cacheRead = Math.max(0, cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, cacheWriteTokens ?? 0);
  const cacheMiss = Math.max(0, input - cacheRead - cacheWrite);
  const cacheHitRate = input > 0 ? (cacheRead / input) * 100 : 0;

  const valueClassName = 'min-w-20 text-right font-mono tabular-nums';
  const rowClassName = 'grid grid-cols-[minmax(0,1fr)_minmax(5rem,auto)] items-center gap-4';

  const detail = (
    <div className="w-full min-w-0 space-y-3 text-sm">
      <div className={`${rowClassName} border-b border-border-medium pb-2 font-medium`}>
        <span className="min-w-0">Token 消耗明细</span>
        <span className={valueClassName}>{formatTokens(total)}</span>
      </div>
      <div className="space-y-1.5">
        <div className={rowClassName}>
          <span className="min-w-0">输入</span>
          <span className={valueClassName}>{formatTokens(input)}</span>
        </div>
        <div className="space-y-1 pl-3 text-text-secondary">
          <div className={rowClassName}>
            <span className="min-w-0">缓存命中</span>
            <span className={valueClassName}>{formatTokens(cacheRead)}</span>
          </div>
          <div className={rowClassName}>
            <span className="min-w-0">缓存未命中</span>
            <span className={valueClassName}>{formatTokens(cacheMiss)}</span>
          </div>
          <div className={rowClassName}>
            <span className="min-w-0">缓存写入</span>
            <span className={valueClassName}>{formatTokens(cacheWrite)}</span>
          </div>
        </div>
        <div className={rowClassName}>
          <span className="min-w-0">输出</span>
          <span className={valueClassName}>{formatTokens(output)}</span>
        </div>
      </div>
      <div className={`${rowClassName} border-t border-border-medium pt-2`}>
        <span className="min-w-0">缓存命中率</span>
        <span className={valueClassName}>{cacheHitRate.toFixed(1)}%</span>
      </div>
    </div>
  );

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="cursor-help font-mono text-xs text-text-secondary underline decoration-dotted underline-offset-4">
          In: {formatTokens(input)} / Out: {formatTokens(output)} / Cache:{' '}
          {formatTokens(cacheRead)}
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
