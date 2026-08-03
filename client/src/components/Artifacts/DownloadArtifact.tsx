import { useState } from 'react';
import { Download, FileCode, FileText } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { Artifact } from '~/common';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@librechat/client';
import { useCodeState } from '~/Providers/EditorContext';
import useArtifactProps from '~/hooks/Artifacts/useArtifactProps';
import { useLocalize } from '~/hooks';
import { useWatermark } from '~/hooks/useWatermark';
import {
  buildMarkdownHtml,
  buildMermaidHtml,
  prepareArtifactHtmlForDownload,
} from '~/utils/artifacts';

const HTML_ARTIFACT_TYPES = new Set(['text/html', 'application/vnd.code-html']);
const RENDERABLE_HTML_TYPES = new Set([
  'text/html',
  'application/vnd.code-html',
  'image/svg+xml',
  'text/markdown',
  'text/md',
  'text/plain',
  'application/vnd.mermaid',
]);

/** Render width for the offscreen iframe. html2canvas captures the fully
 * rendered DOM at this width, so ECharts canvases are drawn correctly. The
 * resulting PDF is a pixel-perfect snapshot matching the HTML export. */
const RENDER_WIDTH = 1200;

const sanitizeFilename = (name?: string): string => {
  const trimmed = (name ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return trimmed || 'artifact';
};

const triggerBrowserDownload = (content: string, mimeType: string, filename: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

interface HtmlToPdfOptions {
  filename: string;
  onDone: () => void;
}

/** Renders HTML in an offscreen iframe so that <script> tags (ECharts,
 * Tailwind CDN, etc.) execute normally. Once rendering is complete,
 * html2canvas captures the iframe body as a high-resolution image and jsPDF
 * wraps it into a multi-page PDF. Because the screenshot is taken from the
 * live DOM (not during a browser print-layout switch), canvas charts look
 * identical to the HTML export. */
const htmlToPdf = (html: string, { filename, onDone }: HtmlToPdfOptions) => {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-99999px';
  iframe.style.top = '0';
  iframe.style.width = `${RENDER_WIDTH}px`;
  iframe.style.height = '800px';
  iframe.style.border = '0';
  iframe.style.background = '#ffffff';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.srcdoc = html;

  const cleanup = () => {
    if (iframe.parentNode) {
      document.body.removeChild(iframe);
    }
  };

  iframe.onload = () => {
    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) {
      onDone();
      cleanup();
      return;
    }
    window.setTimeout(async () => {
      try {
        const canvas = await html2canvas(iframeDoc.body, {
          scale: 1.5,
          useCORS: true,
          backgroundColor: '#ffffff',
          windowWidth: RENDER_WIDTH,
          width: RENDER_WIDTH,
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.85);
        const imgWidth = RENDER_WIDTH;
        const imgHeight = (canvas.height / canvas.width) * imgWidth;
        const pdf = new jsPDF({
          unit: 'px',
          format: [imgWidth, imgHeight],
          orientation: imgHeight > imgWidth ? 'portrait' : 'landscape',
          compress: true,
        });
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight, undefined, 'FAST');
        pdf.save(filename);
      } catch (error) {
        console.error('PDF generation failed:', error);
      } finally {
        cleanup();
        onDone();
      }
    }, 1200);
  };
  document.body.appendChild(iframe);
};

const DownloadArtifact = ({ artifact }: { artifact: Artifact }) => {
  const localize = useLocalize();
  const { currentCode } = useCodeState();
  const [isDownloading, setIsDownloading] = useState(false);
  const { fileKey } = useArtifactProps({ artifact });
  const { artifacts, text, style } = useWatermark();

  const rawContent = currentCode ?? artifact.content ?? '';
  const artifactType = artifact.type ?? '';
  const isHtmlArtifact = HTML_ARTIFACT_TYPES.has(artifactType);
  const canPrint = RENDERABLE_HTML_TYPES.has(artifactType) && rawContent.length > 0;
  const baseName = sanitizeFilename(artifact.title ?? fileKey);

  const buildRenderedHtml = (): string => {
    const watermark = artifacts ? { text, ...style } : undefined;
    if (HTML_ARTIFACT_TYPES.has(artifactType)) {
      return prepareArtifactHtmlForDownload(rawContent, { watermark });
    }
    if (artifactType === 'application/vnd.mermaid') {
      return buildMermaidHtml(rawContent);
    }
    if (
      artifactType === 'text/markdown' ||
      artifactType === 'text/md' ||
      artifactType === 'text/plain'
    ) {
      return buildMarkdownHtml(rawContent);
    }
    if (artifactType === 'image/svg+xml') {
      return prepareArtifactHtmlForDownload(rawContent, { watermark });
    }
    return '';
  };

  const handleDownloadHtml = () => {
    if (!rawContent) {
      return;
    }
    try {
      if (isHtmlArtifact) {
        const watermark = artifacts ? { text, ...style } : undefined;
        const content = prepareArtifactHtmlForDownload(rawContent, { watermark });
        triggerBrowserDownload(content, 'text/html', `${baseName}.html`);
        return;
      }
      const content = canPrint ? buildRenderedHtml() : rawContent;
      const extension = canPrint ? 'html' : (fileKey.split('.').pop() ?? 'txt');
      const mimeType = canPrint ? 'text/html' : 'text/plain';
      triggerBrowserDownload(content, mimeType, `${baseName}.${extension}`);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const handleDownloadPdf = () => {
    if (!canPrint) {
      return;
    }
    setIsDownloading(true);
    try {
      const html = buildRenderedHtml();
      htmlToPdf(html, {
        filename: `${baseName}.pdf`,
        onDone: () => setIsDownloading(false),
      });
    } catch (error) {
      console.error('PDF export failed:', error);
      setIsDownloading(false);
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          disabled={isDownloading || !rawContent}
          aria-label={localize('com_ui_download_artifact')}
        >
          <Download size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={2} className="min-w-[10rem]">
        <DropdownMenuItem
          className="cursor-pointer rounded-lg text-text-primary hover:bg-surface-hover focus:bg-surface-hover"
          onClick={handleDownloadHtml}
        >
          <FileCode className="mr-2 h-4 w-4" aria-hidden="true" />
          <span>{localize('com_ui_download_artifact_html')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canPrint}
          className="cursor-pointer rounded-lg text-text-primary hover:bg-surface-hover focus:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleDownloadPdf}
        >
          <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
          <span>{localize('com_ui_download_artifact_pdf')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default DownloadArtifact;
