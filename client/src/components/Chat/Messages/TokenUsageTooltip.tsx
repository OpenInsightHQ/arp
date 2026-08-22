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
  const hasCacheBreakdown = cacheReadTokens != null && cacheWriteTokens != null;
  const cacheRead = Math.max(0, cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, cacheWriteTokens ?? 0);
  const cacheMiss = Math.max(0, input - cacheRead - cacheWrite);
  const cacheHitRate = input > 0 ? (cacheRead / input) * 100 : 0;

  const detail = (
    <div className="w-72 space-y-3 p-1 text-sm">
      <div className="flex items-center justify-between border-b border-border-medium pb-2 font-medium">
        <span>Token 消耗明细</span>
        <span>{formatTokens(total)}</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between">
          <span>输入</span>
          <span className="font-mono">{formatTokens(input)}</span>
        </div>
        {hasCacheBreakdown && (
          <div className="space-y-1 pl-3 text-text-secondary">
            <div className="flex justify-between">
              <span>缓存命中</span>
              <span className="font-mono">{formatTokens(cacheRead)}</span>
            </div>
            <div className="flex justify-between">
              <span>缓存未命中</span>
              <span className="font-mono">{formatTokens(cacheMiss)}</span>
            </div>
            <div className="flex justify-between">
              <span>缓存写入</span>
              <span className="font-mono">{formatTokens(cacheWrite)}</span>
            </div>
          </div>
        )}
        <div className="flex justify-between">
          <span>输出</span>
          <span className="font-mono">{formatTokens(output)}</span>
        </div>
      </div>
      {hasCacheBreakdown && (
        <div className="flex justify-between border-t border-border-medium pt-2">
          <span>缓存命中率</span>
          <span className="font-mono">{cacheHitRate.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="cursor-help font-mono text-xs text-text-secondary underline decoration-dotted underline-offset-4">
          In: {formatTokens(input)} / Out: {formatTokens(output)}
          {hasCacheBreakdown ? ` / Cache: ${formatTokens(cacheRead)}` : ''}
        </span>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent side="top" className="w-72">
          {detail}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
