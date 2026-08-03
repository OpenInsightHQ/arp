import React, { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { SandpackPreview, SandpackProvider } from '@codesandbox/sandpack-react/unstyled';
import { Spinner } from '@librechat/client';
import type {
  SandpackProviderProps,
  SandpackPreviewRef,
} from '@codesandbox/sandpack-react/unstyled';
import type { TStartupConfig } from 'librechat-data-provider';
import type { ArtifactFiles } from '~/common';
import { useWatermark } from '~/hooks/useWatermark';
import { useLocalize } from '~/hooks';
import {
  buildMarkdownHtml,
  buildMermaidHtml,
  getSharedOptions,
  normalizeLocalPaths,
  prepareArtifactHtml,
  sharedFiles,
} from '~/utils/artifacts';

/**
 * Strips width/height attributes from the ROOT <svg> element so the document
 * scales to fill its container (iframe viewport) instead of rendering at its
 * intrinsic pixel size (which overflows and forces scrollbars). viewBox is
 * preserved, so default preserveAspectRatio ("xMidYMid meet") scales the
 * content uniformly and centers it. Only the root svg is touched; nested
 * elements (rect/text/etc.) keep their width/height since those are viewBox
 * coordinate units, not document size.
 */
function stripSvgRootDimensions(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (match, attrs: string) => {
    // Only strip when viewBox is present — without it the SVG can't scale
    // uniformly and stripping would distort the content.
    if (!/viewbox\s*=/i.test(attrs)) {
      return match;
    }
    const stripped = attrs.replace(/\s+(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<svg${stripped}>`;
  });
}

/**
 * Generic blob-iframe renderer: builds a blob URL from HTML string,
 * handles cleanup. Shared by HTML, SVG, Markdown, Mermaid previews.
 *
 * Content streaming causes rapid blob-url changes that reload the iframe
 * dozens of times per second (flicker). A 250ms debounce on the html input
 * keeps the preview stable during generation and only refreshes after the
 * content settles.
 *
 * When `autoRefresh` is false (UI_PREVIEW_AUTO_REFRESH=false), the debounce
 * timer is bypassed entirely — the iframe is rendered directly from the
 * latest html with no timed refresh. In that mode callers are expected to
 * gate rendering behind a "generating" placeholder while the message is
 * still streaming, so the iframe only mounts once content is final.
 */
const useBlobIframe = (html: string, mimeType: string, autoRefresh = true) => {
  const [debouncedHtml, setDebouncedHtml] = useState(html);
  const latestHtmlRef = useRef(html);
  latestHtmlRef.current = html;

  useEffect(() => {
    if (!autoRefresh || html === debouncedHtml) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedHtml(latestHtmlRef.current);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [html, debouncedHtml, autoRefresh]);

  const effectiveHtml = autoRefresh ? debouncedHtml : html;

  const blobUrl = useMemo(() => {
    if (!effectiveHtml) {
      return '';
    }
    const content =
      mimeType === 'image/svg+xml' ? stripSvgRootDimensions(effectiveHtml) : effectiveHtml;
    const blob = new Blob([content], { type: mimeType });
    return URL.createObjectURL(blob);
  }, [effectiveHtml, mimeType]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  return blobUrl;
};

const PreviewPlaceholder = memo(() => {
  const localize = useLocalize();
  return (
    <div className="flex h-full w-full items-center justify-center text-text-secondary">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-6 w-6" />
        <span className="text-sm">{localize('com_ui_generating')}</span>
      </div>
    </div>
  );
});
PreviewPlaceholder.displayName = 'PreviewPlaceholder';

export const BlobIframe = memo(function ({
  html,
  mimeType,
  title,
  refreshNonce,
  sandbox,
  autoRefresh = true,
}: {
  html: string;
  mimeType: string;
  title: string;
  refreshNonce?: number;
  sandbox?: string;
  autoRefresh?: boolean;
}) {
  const blobUrl = useBlobIframe(html, mimeType, autoRefresh);
  if (!blobUrl) {
    return <PreviewPlaceholder />;
  }
  return (
    <iframe
      key={refreshNonce}
      src={blobUrl}
      title={title}
      className="h-full w-full border-0"
      sandbox={sandbox ?? 'allow-scripts allow-same-origin'}
    />
  );
});

const SandpackArtifactPreview = memo(function ({
  files,
  fileKey,
  template,
  sharedProps,
  previewRef,
  currentCode,
  startupConfig,
}: {
  files: ArtifactFiles;
  fileKey: string;
  template: SandpackProviderProps['template'];
  sharedProps: Partial<SandpackProviderProps>;
  previewRef: MutableRefObject<SandpackPreviewRef>;
  currentCode?: string;
  startupConfig?: TStartupConfig;
}) {
  const artifactFiles = useMemo(() => {
    if (Object.keys(files).length === 0) {
      return files;
    }
    const code = currentCode ?? '';
    if (!code) {
      return files;
    }
    return {
      ...files,
      [fileKey]: { code },
    };
  }, [currentCode, files, fileKey]);

  const options = useMemo(() => {
    const base = getSharedOptions(startupConfig?.tailwindCDNURL);
    if (!startupConfig) {
      return base;
    }
    return {
      ...base,
      bundlerURL: template === 'static' ? startupConfig.staticBundlerURL : startupConfig.bundlerURL,
    };
  }, [startupConfig, template]);

  if (Object.keys(artifactFiles).length === 0) {
    return <PreviewPlaceholder />;
  }

  return (
    <SandpackProvider
      files={{ ...artifactFiles, ...sharedFiles }}
      options={options}
      {...sharedProps}
      template={template}
    >
      <SandpackPreview
        showOpenInCodeSandbox={false}
        showRefreshButton={false}
        tabIndex={0}
        ref={previewRef}
      />
    </SandpackProvider>
  );
});

export const ArtifactPreview = memo(function ({
  files,
  fileKey,
  template,
  sharedProps,
  previewRef,
  currentCode,
  startupConfig,
  artifactType,
  refreshNonce,
  isSubmitting,
}: {
  files: ArtifactFiles;
  fileKey: string;
  template: SandpackProviderProps['template'];
  sharedProps: Partial<SandpackProviderProps>;
  previewRef: MutableRefObject<SandpackPreviewRef>;
  currentCode?: string;
  startupConfig?: TStartupConfig;
  artifactType?: string;
  refreshNonce?: number;
  isSubmitting?: boolean;
}) {
  const { artifacts, text, style } = useWatermark();
  const watermark = useMemo(
    () => (artifacts ? { text, ...style } : undefined),
    [artifacts, text, style],
  );
  const code = currentCode ?? (files[fileKey] as string | undefined) ?? '';

  const autoRefresh = startupConfig?.previewAutoRefresh !== false;
  const hidePreviewWhileGenerating = !autoRefresh && isSubmitting === true;

  if (!code) {
    return <PreviewPlaceholder />;
  }

  if (hidePreviewWhileGenerating) {
    return <PreviewPlaceholder />;
  }

  if (artifactType === 'text/html') {
    return (
      <BlobIframe
        html={prepareArtifactHtml(code, {
          tailwindCDNURL: startupConfig?.tailwindCDNURL,
          echartsCDNURL: startupConfig?.echartsCDNURL,
          watermark,
        })}
        mimeType="text/html"
        title="HTML Preview"
        refreshNonce={refreshNonce}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        autoRefresh={autoRefresh}
      />
    );
  }

  if (artifactType === 'image/svg+xml') {
    return (
      <BlobIframe
        html={normalizeLocalPaths(code)}
        mimeType="image/svg+xml"
        title="SVG Preview"
        refreshNonce={refreshNonce}
        autoRefresh={autoRefresh}
      />
    );
  }

  if (
    artifactType === 'text/markdown' ||
    artifactType === 'text/md' ||
    artifactType === 'text/plain'
  ) {
    return (
      <BlobIframe
        html={buildMarkdownHtml(code, startupConfig?.markedCDNURL, watermark)}
        mimeType="text/html"
        title="Markdown Preview"
        refreshNonce={refreshNonce}
        autoRefresh={autoRefresh}
      />
    );
  }

  if (artifactType === 'application/vnd.mermaid') {
    return (
      <BlobIframe
        html={buildMermaidHtml(code, startupConfig?.mermaidCDNURL, watermark)}
        mimeType="text/html"
        title="Mermaid Preview"
        refreshNonce={refreshNonce}
        autoRefresh={autoRefresh}
      />
    );
  }

  if (
    artifactType === 'application/vnd.react' ||
    artifactType === 'application/vnd.code-html'
  ) {
    return (
      <SandpackArtifactPreview
        files={files}
        fileKey={fileKey}
        template={template}
        sharedProps={sharedProps}
        previewRef={previewRef}
        currentCode={currentCode}
        startupConfig={startupConfig}
      />
    );
  }

  return (
    <BlobIframe
      html={prepareArtifactHtml(code, {
        tailwindCDNURL: startupConfig?.tailwindCDNURL,
        echartsCDNURL: startupConfig?.echartsCDNURL,
        watermark,
      })}
      mimeType="text/html"
      title="Preview"
      refreshNonce={refreshNonce}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      autoRefresh={autoRefresh}
    />
  );
});
