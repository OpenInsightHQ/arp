import React, { useState } from 'react';
import { QrCode, Copy, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Button,
  Spinner,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useToastContext,
} from '@librechat/client';
import { dataService, apiBaseUrl } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

export default function ShareArtifactDialog({
  artifactId,
  artifactTitle,
  trigger,
}) {
  const { showToast } = useToastContext();
  const localize = useLocalize();
  
  const [open, setOpen] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [shareData, setShareData] = useState(null);

  const handleCreateShare = async () => {
    try {
      setIsCreating(true);
      const result = await dataService.createGalleryArtifactShare(artifactId);
      const shareUrl = `${apiBaseUrl()}/artifact/share/${result.shareId}`;
      const fullUrl = `${window.location.origin}${shareUrl}`;
      
      setShareData({
        shareId: result.shareId,
        url: shareUrl,
      });
      
      try {
        await navigator.clipboard.writeText(fullUrl);
      } catch {
        // HTTP 环境下 clipboard API 不可用，走 fallback
        const textarea = document.createElement('textarea');
        textarea.value = fullUrl;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast({
        message: localize('com_arp_share_created_copied'),
        status: 'success',
      });
    } catch (error) {
      console.error('Failed to create share:', error);
      showToast({
        message: localize('com_arp_share_create_failed'),
        status: 'error',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareData?.url) return;
    
    try {
      const fullUrl = `${window.location.origin}${shareData.url}`;
      try {
        await navigator.clipboard.writeText(fullUrl);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = fullUrl;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast({
        message: localize('com_arp_link_copied'),
        status: 'success',
      });
    } catch {
      showToast({
        message: localize('com_arp_copy_failed'),
        status: 'error',
      });
    }
  };

  return (
    <>
      <div onClick={() => setOpen(true)}>
        {trigger || (
          <button className="p-2 rounded-full text-text-primary hover:bg-surface-hover transition-colors">
            <QrCode className="h-4 w-4" />
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{localize('com_arp_generate_link')}</DialogTitle>
          </DialogHeader>

          <div className="py-4">
            {!shareData ? (
              <div className="text-center py-8">
                <p className="text-text-secondary mb-4">
                  {localize('com_arp_share_desc')}
                </p>
                <p className="text-sm text-text-secondary">
                  {localize('com_arp_share_auto_update_hint')}
                </p>
                <Button
                  variant="submit"
                  onClick={handleCreateShare}
                  disabled={isCreating}
                  className="mt-4"
                >
                  {isCreating ? <Spinner className="size-4" /> : localize('com_arp_create_share_link')}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg bg-surface-secondary p-4">
                  <h3 className="font-medium text-text-primary mb-2">{artifactTitle}</h3>
                  <p className="text-sm text-text-secondary mb-3">
                    {localize('com_arp_share_created_desc')}
                  </p>
                  
                  <div className="flex items-center gap-2 rounded-md bg-surface-primary p-2">
                    <div className="flex-1 break-all text-sm text-text-secondary">
                      {`${window.location.origin}${shareData.url}`}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyLink}
                      className="shrink-0"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </div>

                {showQR && (
                  <div className="flex justify-center py-4">
                    <QRCodeSVG
                      value={`${window.location.origin}${shareData.url}`}
                      size={200}
                      marginSize={2}
                      className="rounded-lg"
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowQR(!showQR)}
                    className="flex-1"
                  >
                    <QrCode className="size-4 mr-2" />
                    {showQR ? localize('com_arp_hide_qr') : localize('com_arp_show_qr')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCopyLink}
                    className="flex-1"
                  >
                    <Copy className="size-4 mr-2" />
                    {localize('com_arp_copy_link')}
                  </Button>
                </div>

                <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3">
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {localize('com_arp_share_tip')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
