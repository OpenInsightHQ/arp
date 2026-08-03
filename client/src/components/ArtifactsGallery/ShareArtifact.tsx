import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner } from '@librechat/client';
import { apiBaseUrl } from 'librechat-data-provider';
import { BlobIframe } from '~/components/Artifacts/ArtifactPreview';
import { prepareArtifactHtml } from '~/utils/artifacts';
import { useGetStartupConfig } from '~/data-provider';
import { useWatermark } from '~/hooks/useWatermark';
import { useLocalize } from '~/hooks';

export default function ShareArtifact() {
  const { shareId } = useParams();
  const { data: startupConfig } = useGetStartupConfig();
  const localize = useLocalize();
  const { artifacts, text, style } = useWatermark();
  const watermark = useMemo(
    () => (artifacts ? { text, ...style } : undefined),
    [artifacts, text, style],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState('');

  useEffect(() => {
    const fetchShare = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${apiBaseUrl()}/api/gallery/share/${shareId}/raw`, {
          method: 'GET',
          headers: {
            Accept: 'text/html',
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Share not found or is not public');
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        setHtmlContent(html);
      } catch (err) {
        console.error('Error fetching share:', err);
        setError(err instanceof Error ? err.message : 'Failed to load share');
      } finally {
        setLoading(false);
      }
    };

    if (shareId) {
      fetchShare();
    }
  }, [shareId]);

  const displayHtml = useMemo(
    () =>
      prepareArtifactHtml(htmlContent, {
        tailwindCDNURL: startupConfig?.tailwindCDNURL,
        echartsCDNURL: startupConfig?.echartsCDNURL,
        watermark,
      }),
    [htmlContent, startupConfig?.tailwindCDNURL, startupConfig?.echartsCDNURL, watermark],
  );

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="h-12 w-12 animate-spin" />
          <p className="text-gray-500">{localize('com_arp_loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-white">
        <div className="max-w-md text-center">
          <h1 className="mb-4 text-2xl font-bold text-gray-800">{localize('com_arp_share_not_found')}</h1>
          <p className="mb-6 text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full">
      <BlobIframe
        html={displayHtml}
        mimeType="text/html"
        title="Artifact Share"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
