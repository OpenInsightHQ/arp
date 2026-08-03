import { useCallback, useMemo } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useLocation } from 'react-router-dom';
import type { Artifact } from '~/common';
import { isArtifactRoute } from '~/utils';
import store from '~/store';

/**
 * Mapping from a code block's `language-xxx` lang token to an artifact MIME type
 * that the rendering layer (ArtifactPreview) knows how to render in the right
 * panel. Keys are lowercased lang tokens produced by rehype-highlight.
 *
 * Scope is intentionally narrow: only `html` is supported, since that's the
 * only format requested for right-panel preview from a code block. Mermaid /
 * SVG / ECharts already render inline (see MarkdownComponents.tsx), and
 * markdown blocks are kept as-is per product decision.
 */
const LANG_TO_ARTIFACT_TYPE: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
};

/** Returns the canonical artifact type for a code-block lang, or null if unsupported. */
export function langToArtifactType(lang: string | null | undefined): string | null {
  if (!lang) {
    return null;
  }
  return LANG_TO_ARTIFACT_TYPE[lang.toLowerCase()] ?? null;
}

type UseCodePreviewParams = {
  /** Code-block language token, e.g. "html" / "markdown". */
  lang: string | null | undefined;
  /** Raw code content (trimmed of any wrapper fence by the caller as needed). */
  content: string;
  /** Message id from useMessageContext, used for stable keying. */
  messageId: string | null | undefined;
  /** Code-block index inside the message part (from useCodeBlockContext). */
  blockIndex: number;
};

/**
 * Promotes a markdown code block into the right-hand artifacts panel on demand.
 *
 * Mirrors the exact state mutations performed by `ArtifactButton.handleClick`
 * (`client/src/components/Artifacts/ArtifactButton.tsx:59`):
 *   1. set `artifactsVisibility` to true (mounts the panel)
 *   2. upsert the synthesized artifact into `artifactsState`
 *   3. set `currentArtifactId` so the panel selects it
 *
 * The synthesized artifact uses a stable, content-derived key so repeated
 * clicks on the same block do not create duplicates, and live-updating a
 * streaming block just refreshes the existing entry.
 *
 * No-op when not on a route that hosts the artifacts panel (`/c/*`, `/share/*`),
 * matching ArtifactButton's own guard at `ArtifactButton.tsx:40`.
 */
export function useCodePreview({ lang, content, messageId, blockIndex }: UseCodePreviewParams) {
  const location = useLocation();
  const setArtifactsVisible = useSetRecoilState(store.artifactsVisibility);
  const setArtifacts = useSetRecoilState(store.artifactsState);
  const setCurrentArtifactId = useSetRecoilState(store.currentArtifactId);
  const currentArtifactId = useRecoilValue(store.currentArtifactId);

  const artifactType = useMemo(() => langToArtifactType(lang), [lang]);

  const artifactKey = useMemo(() => {
    if (!artifactType || !messageId) {
      return '';
    }
    return `codeblock_${messageId}_${blockIndex}_${artifactType}`;
  }, [artifactType, messageId, blockIndex]);

  const openPreview = useCallback(() => {
    if (!artifactType || !artifactKey || !messageId) {
      return;
    }
    if (!isArtifactRoute(location.pathname)) {
      return;
    }

    const now = Date.now();
    const artifact: Artifact = {
      id: artifactKey,
      identifier: artifactKey,
      title: `${lang ?? artifactType} · preview`,
      type: artifactType,
      content,
      messageId,
      index: blockIndex,
      lastUpdateTime: now,
    };

    setArtifactsVisible(true);
    setArtifacts((prev) => {
      if (prev?.[artifactKey]?.content === content) {
        return prev;
      }
      return { ...prev, [artifactKey]: artifact };
    });
    setCurrentArtifactId(artifactKey);
  }, [
    artifactType,
    artifactKey,
    messageId,
    content,
    blockIndex,
    lang,
    location.pathname,
    setArtifactsVisible,
    setArtifacts,
    setCurrentArtifactId,
  ]);

  const isActive = currentArtifactId === artifactKey && artifactKey !== '';

  return { canPreview: artifactType !== null, openPreview, isActive };
}
