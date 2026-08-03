import type { TUser } from 'librechat-data-provider';

export const DEFAULT_WATERMARK_TEMPLATE = '{department} - {name}';
/** Default opacity (light mode) when none is provided by startup config. */
export const DEFAULT_WATERMARK_OPACITY = 0.08;
/** Default font size (px) when none is provided by startup config. */
export const DEFAULT_WATERMARK_FONT_SIZE = 14;
/** Default tiling density (1-10) when none is provided by startup config. */
export const DEFAULT_WATERMARK_DENSITY = 5;
/** Default tilt angle (degrees) when none is provided by startup config. */
export const DEFAULT_WATERMARK_ROTATION = -10;
/** Grid produced at the default density — preserved as the historical baseline. */
const BASE_GRID = { cols: 4, rows: 6 } as const;
/** Density bounds; values outside are clamped by `resolveWatermarkGrid`. */
const MIN_DENSITY = 1;
const MAX_DENSITY = 10;
/** Rotation bounds (degrees); values outside are clamped by `resolveWatermarkStyle`. */
const MIN_ROTATION = -90;
const MAX_ROTATION = 90;

const WATERMARK_TAG_CLASS = 'lc-watermark';
const FONT_STACK = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

export type WatermarkStyleOptions = {
  /** Text opacity in the 0-1 range. Falls back to `DEFAULT_WATERMARK_OPACITY`. */
  opacity?: number;
  /** Font size in pixels. Falls back to `DEFAULT_WATERMARK_FONT_SIZE`. */
  fontSize?: number;
  /** Tiling density in the 1-10 range. Falls back to `DEFAULT_WATERMARK_DENSITY`. */
  density?: number;
  /** Tilt angle in degrees (clamped to ±90). Falls back to `DEFAULT_WATERMARK_ROTATION`. */
  rotation?: number;
};

const escapeXml = (input: string): string =>
  input.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

/** Resolve a user object into a watermark string using a `{name}/{department}` template. */
export function formatWatermark(template: string | undefined, user: TUser | undefined): string {
  const tmpl = template?.trim() || DEFAULT_WATERMARK_TEMPLATE;
  const values: Record<string, string> = {
    name: user?.name || user?.username || user?.email || 'Unknown',
    department: user?.department || '',
    username: user?.username || '',
    email: user?.email || '',
  };
  return tmpl.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Resolve raw watermark style overrides into normalized numeric values, applying
 * the documented defaults and clamping to sane ranges. Dark/print multipliers
 * mirror the original hand-tuned values so the configured opacity stays the
 * baseline while darker surfaces remain readable.
 */
export function resolveWatermarkStyle(opts: WatermarkStyleOptions): {
  light: number;
  dark: number;
  print: number;
  fontSize: number;
  rotation: number;
} {
  const light = clamp(opts.opacity ?? DEFAULT_WATERMARK_OPACITY, 0, 1);
  return {
    light,
    dark: clamp(light * 1.16, 0, 1),
    print: clamp(light * 3, 0, 1),
    fontSize: clamp(opts.fontSize ?? DEFAULT_WATERMARK_FONT_SIZE, 1, 200),
    rotation: clamp(opts.rotation ?? DEFAULT_WATERMARK_ROTATION, MIN_ROTATION, MAX_ROTATION),
  };
}

/**
 * Resolve a 1-10 density value into a concrete tile grid `{ cols, rows }`.
 * Density 5 reproduces the historical baseline (`BASE_GRID`); values above/below
 * scale both axes proportionally (clamped to a minimum of 1 cell each), so 1 is
 * a single tile and 10 is roughly double the baseline footprint.
 */
export function resolveWatermarkGrid(density?: number): { cols: number; rows: number } {
  const d = clamp(density ?? DEFAULT_WATERMARK_DENSITY, MIN_DENSITY, MAX_DENSITY);
  const scale = d / DEFAULT_WATERMARK_DENSITY;
  return {
    cols: Math.max(1, Math.round(BASE_GRID.cols * scale)),
    rows: Math.max(1, Math.round(BASE_GRID.rows * scale)),
  };
}

/**
 * Build a self-contained watermark snippet (CSS + full-viewport tiled layer) to
 * inject into a standalone HTML document rendered inside an artifact iframe.
 * Uses a DOM grid of rotated text spans so the watermark repeats sparsely
 * across the document at a slight tilt. Returns '' when there is no text.
 */
export function buildWatermarkHtml(text: string, opts?: WatermarkStyleOptions): string {
  if (!text) {
    return '';
  }
  const { cols, rows } = resolveWatermarkGrid(opts?.density);
  const safe = escapeXml(text);
  const cell = `<div><span>${safe}</span></div>`;
  const cells = cell.repeat(cols * rows);
  const style = resolveWatermarkStyle(opts ?? {});
  return (
    `<style>` +
    `.${WATERMARK_TAG_CLASS}{position:fixed;inset:0;z-index:99999;pointer-events:none;overflow:hidden;}` +
    `.${WATERMARK_TAG_CLASS} .grid{display:grid;width:100%;height:100%;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);transform:rotate(${style.rotation}deg) scale(1.4);transform-origin:center;}` +
    `.${WATERMARK_TAG_CLASS} .grid>div{display:flex;align-items:center;justify-content:center;}` +
    `.${WATERMARK_TAG_CLASS} span{white-space:nowrap;font-size:${style.fontSize}px;font-weight:700;letter-spacing:1px;font-family:${FONT_STACK};color:rgba(0,0,0,${style.light});}` +
    `@media (prefers-color-scheme:dark){.${WATERMARK_TAG_CLASS} span{color:rgba(255,255,255,${style.dark});}}` +
    `@media print{.${WATERMARK_TAG_CLASS} span{color:rgba(0,0,0,${style.print});}}` +
    `</style>` +
    `<div class="${WATERMARK_TAG_CLASS}" data-lc-watermark="1"><div class="grid">${cells}</div></div>`
  );
}
