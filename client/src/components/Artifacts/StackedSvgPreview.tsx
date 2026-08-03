import { memo, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import type { Artifact } from '~/common';
import store from '~/store';
import { BlobIframe } from './ArtifactPreview';

export const SVG_ARTIFACT_TYPE = 'image/svg+xml';

const FALLBACK_HEIGHT_PX = 420;
const MAX_HEIGHT_PX = 800;
/** Intrinsic ratio below this falls back to fixed height (avoids paper-thin slivers). */
const MIN_RATIO = 0.2;
/** Intrinsic ratio above this falls back to fixed height (avoids skyscraper iframes). */
const MAX_RATIO = 4;

type Dimensions = { width: number; height: number } | null;

/** Parses intrinsic width/height from an SVG document (viewBox preferred, then width/height attrs). */
function getSvgDimensions(svg: string): Dimensions {
  const viewBox = svg.match(
    /viewBox=["']\s*[\d.eE+-]+(?:\s+[\d.eE+-]+){2}\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s*["']/i,
  );
  if (viewBox) {
    const width = parseFloat(viewBox[1]);
    const height = parseFloat(viewBox[2]);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  const widthMatch = svg.match(/<svg[^>]*\swidth=["']([\d.eE+-]+)/i);
  const heightMatch = svg.match(/<svg[^>]*\sheight=["']([\d.eE+-]+)/i);
  if (widthMatch && heightMatch) {
    const width = parseFloat(widthMatch[1]);
    const height = parseFloat(heightMatch[1]);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  return null;
}

/**
 * Returns SVG artifacts belonging to `group`, keyed by `identifier` (falling back to `id`),
 * keeping the newest version of each part (by lastUpdateTime) and ordering by first appearance.
 * An update that reuses an identifier replaces that row in place instead of appending.
 */
export function getGroupedSvgArtifacts(
  artifacts: Record<string, Artifact | undefined> | null,
  group: string,
): Artifact[] {
  const groups = new Map<string, { latest: Artifact; earliestTime: number }>();
  for (const a of Object.values(artifacts ?? {})) {
    if (a == null || a.type !== SVG_ARTIFACT_TYPE || (a.group ?? '').trim() !== group) {
      continue;
    }
    if ((a.content?.length ?? 0) === 0) {
      continue;
    }
    const key = a.identifier?.trim() || a.id;
    const t = a.lastUpdateTime ?? 0;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { latest: a, earliestTime: t });
      continue;
    }
    if (t > (existing.latest.lastUpdateTime ?? 0)) {
      existing.latest = a;
    }
    if (t < existing.earliestTime) {
      existing.earliestTime = t;
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => a.earliestTime - b.earliestTime)
    .map((g) => g.latest);
}

interface StackedSvgPreviewProps {
  group: string;
  refreshNonce?: number;
}

function StackedSvgPreviewBase({ group, refreshNonce }: StackedSvgPreviewProps) {
  const artifacts = useRecoilValue(store.artifactsState);
  const svgArtifacts = useMemo(() => getGroupedSvgArtifacts(artifacts, group), [artifacts, group]);

  if (svgArtifacts.length === 0) {
    return null;
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-auto p-3">
      {svgArtifacts.map((artifact, index) => {
        const content = artifact.content ?? '';
        const dimensions = getSvgDimensions(content);
        const ratio =
          dimensions != null && dimensions.height > 0 ? dimensions.width / dimensions.height : null;
        const useAspect = ratio != null && ratio >= MIN_RATIO && ratio <= MAX_RATIO;
        const label = artifact.title?.trim() || `SVG ${index + 1}`;

        return (
          <div key={artifact.identifier?.trim() || artifact.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 px-1">
              <span className="text-sm font-medium text-text-primary">{label}</span>
              {artifact.identifier && (
                <span className="truncate text-xs text-text-secondary">{artifact.identifier}</span>
              )}
            </div>
            <div
              className="relative w-full overflow-hidden rounded-md border border-border-light bg-white"
              style={
                useAspect && ratio != null
                  ? { aspectRatio: String(ratio), maxHeight: `${MAX_HEIGHT_PX}px` }
                  : { height: `${FALLBACK_HEIGHT_PX}px` }
              }
            >
              <BlobIframe
                html={content}
                mimeType={SVG_ARTIFACT_TYPE}
                title={label}
                refreshNonce={refreshNonce}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const StackedSvgPreview = memo(StackedSvgPreviewBase);
