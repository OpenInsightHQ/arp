import React, { useCallback } from 'react';
import { WandSparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TooltipAnchor, Button } from '@librechat/client';
import { useLocalize } from '~/hooks';

interface ArtifactsGalleryButtonProps {
  isSmallScreen?: boolean;
  toggleNav: () => void;
}

export default function ArtifactsGalleryButton({
  isSmallScreen,
  toggleNav,
}: ArtifactsGalleryButtonProps) {
  const navigate = useNavigate();
  const localize = useLocalize();

  const handleClick = useCallback(() => {
    navigate('/artifacts');
    if (isSmallScreen) {
      toggleNav();
    }
  }, [navigate, isSmallScreen, toggleNav]);

  return (
    <TooltipAnchor
      description={localize('com_ui_artifacts_gallery') || '工作台'}
      render={
        <Button
          variant="outline"
          data-testid="nav-artifacts-gallery-button"
          aria-label={localize('com_ui_artifacts_gallery') || '工作台'}
          className="rounded-full border-none bg-transparent p-2 hover:bg-surface-hover md:rounded-xl"
          onClick={handleClick}
        >
          <WandSparkles className="icon-sm text-text-primary" aria-hidden="true" />
        </Button>
      }
    />
  );
}
