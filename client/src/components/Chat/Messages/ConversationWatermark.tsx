import { memo, useMemo } from 'react';
import { useWatermark } from '~/hooks/useWatermark';
import { resolveWatermarkStyle, resolveWatermarkGrid } from '~/utils/watermark';
import type { WatermarkStyleOptions } from '~/utils/watermark';

type LayerProps = {
  text: string;
  style: WatermarkStyleOptions;
  /** CSS color the text should take on this layer (e.g. black/white). */
  color: string;
  /** Which resolved-opacity variant (light/dark/print) to apply. */
  variant: 'light' | 'dark' | 'print';
  visibilityClass: string;
};

const Layer = ({ text, style, color, variant, visibilityClass }: LayerProps) => {
  const { cols, rows } = resolveWatermarkGrid(style.density);
  const cells = useMemo(() => Array.from({ length: cols * rows }, (_, i) => i), [cols, rows]);
  const resolved = resolveWatermarkStyle(style);
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-[9999] select-none overflow-hidden ${visibilityClass}`}
    >
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          transform: `rotate(${resolved.rotation}deg) scale(1.4)`,
          transformOrigin: 'center',
        }}
      >
        {cells.map((i) => (
          <div key={i} className="flex items-center justify-center">
            <span
              className="whitespace-nowrap font-bold tracking-wider"
              style={{
                color: hexWithAlpha(color, resolved[variant]),
                fontSize: `${resolved.fontSize}px`,
              }}
            >
              {text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Combine a `#rrggbb`/named color base with an alpha value into an `rgba()` string. */
const hexWithAlpha = (color: string, alpha: number): string => {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
};

/**
 * Persistent tiled watermark overlay covering the whole conversation window.
 * Renders the watermark text as a grid of DOM spans, sparsely filling the
 * visible area at a slight tilt. Non-interactive (pointer-events:none) and
 * high z-index so it stays visible above messages without blocking interaction.
 *
 * Only renders when the `chat` watermark is enabled in startup config.
 */
const ConversationWatermark = () => {
  const { chat, text, style } = useWatermark();
  if (!chat) {
    return null;
  }
  return (
    <>
      <Layer
        text={text}
        style={style}
        color="#000000"
        variant="light"
        visibilityClass="dark:hidden"
      />
      <Layer
        text={text}
        style={style}
        color="#ffffff"
        variant="dark"
        visibilityClass="hidden dark:block"
      />
    </>
  );
};

export default memo(ConversationWatermark);
