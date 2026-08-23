import React, { useRef, useState, useMemo } from 'react';
import { useRecoilState } from 'recoil';
import * as Ariakit from '@ariakit/react';
import { FileSearch, FileUpIcon, FileType2Icon } from 'lucide-react';
import {
  FileUpload,
  TooltipAnchor,
  DropdownPopup,
  AttachmentIcon,
  SharePointIcon,
} from '@librechat/client';
import { EToolResources, defaultAgentCapabilities } from 'librechat-data-provider';
import {
  useAgentToolPermissions,
  useAgentCapabilities,
  useGetAgentsConfig,
  useFileHandling,
  useLocalize,
  usePiFileUpload,
} from '~/hooks';
import useSharePointFileHandling from '~/hooks/Files/useSharePointFileHandling';
import { SharePointPickerDialog } from '~/components/SharePoint';
import { useGetStartupConfig } from '~/data-provider';
import { ephemeralAgentByConvoId } from '~/store';
import { MenuItemProps } from '~/common';
import { cn } from '~/utils';

interface AttachFileMenuProps {
  agentId?: string | null;
  endpoint?: string | null;
  disabled?: boolean | null;
  conversationId: string;
}

const AttachFileMenu = ({ agentId, disabled, conversationId }: AttachFileMenuProps) => {
  const localize = useLocalize();
  const isUploadDisabled = disabled ?? false;
  const inputRef = useRef<HTMLInputElement>(null);
  const piInputRef = useRef<HTMLInputElement>(null);
  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(
    ephemeralAgentByConvoId(conversationId),
  );
  const [toolResource, setToolResource] = useState<EToolResources | undefined>();
  const { handleFileChange } = useFileHandling();
  const { uploadFilesToPi } = usePiFileUpload();
  const { handleSharePointFiles, isProcessing, downloadProgress } = useSharePointFileHandling({
    toolResource,
  });

  const { agentsConfig } = useGetAgentsConfig();
  const { data: startupConfig } = useGetStartupConfig();
  const sharePointEnabled = startupConfig?.sharePointFilePickerEnabled;

  const [isSharePointDialogOpen, setIsSharePointDialogOpen] = useState(false);

  /** TODO: Ephemeral Agent Capabilities
   * Allow defining agent capabilities on a per-endpoint basis
   * Use definition for agents endpoint for ephemeral agents
   * */
  const capabilities = useAgentCapabilities(agentsConfig?.capabilities ?? defaultAgentCapabilities);

  const { fileSearchAllowedByAgent } = useAgentToolPermissions(agentId, ephemeralAgent);

  const handleUploadClick = () => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.value = '';
    inputRef.current.click();
  };

  const handlePiUploadClick = () => {
    if (!piInputRef.current) {
      return;
    }
    piInputRef.current.value = '';
    piInputRef.current.click();
  };

  const dropdownItems = useMemo(() => {
    const piUploadItem: MenuItemProps = {
      label: localize('com_ui_upload_pi_file'),
      onClick: handlePiUploadClick,
      icon: <FileUpIcon className="icon-md" />,
    };

    const items: MenuItemProps[] = [piUploadItem];

    if (capabilities.contextEnabled) {
      items.push({
        label: localize('com_ui_upload_ocr_text'),
        onClick: () => {
          setToolResource(EToolResources.context);
          handleUploadClick();
        },
        icon: <FileType2Icon className="icon-md" />,
      });
    }

    if (capabilities.fileSearchEnabled && fileSearchAllowedByAgent) {
      items.push({
        label: localize('com_ui_upload_file_search'),
        onClick: () => {
          setToolResource(EToolResources.file_search);
          setEphemeralAgent((prev) => ({
            ...prev,
            [EToolResources.file_search]: true,
          }));
          handleUploadClick();
        },
        icon: <FileSearch className="icon-md" />,
      });
    }

    if (sharePointEnabled) {
      const sharePointItems: MenuItemProps[] = [piUploadItem];
      if (capabilities.contextEnabled) {
        sharePointItems.push({
          label: localize('com_ui_upload_ocr_text'),
          onClick: () => {
            setToolResource(EToolResources.context);
            setIsSharePointDialogOpen(true);
          },
          icon: <FileType2Icon className="icon-md" />,
        });
      }
      if (capabilities.fileSearchEnabled && fileSearchAllowedByAgent) {
        sharePointItems.push({
          label: localize('com_ui_upload_file_search'),
          onClick: () => {
            setToolResource(EToolResources.file_search);
            setEphemeralAgent((prev) => ({
              ...prev,
              [EToolResources.file_search]: true,
            }));
            setIsSharePointDialogOpen(true);
          },
          icon: <FileSearch className="icon-md" />,
        });
      }
      items.push({
        label: localize('com_files_upload_sharepoint'),
        onClick: () => {},
        icon: <SharePointIcon className="icon-md" />,
        subItems: sharePointItems,
      });
    }

    return items;
  }, [
    localize,
    capabilities,
    setToolResource,
    setEphemeralAgent,
    sharePointEnabled,
    fileSearchAllowedByAgent,
    setIsSharePointDialogOpen,
  ]);

  const menuTrigger = (
    <TooltipAnchor
      render={
        <Ariakit.MenuButton
          disabled={isUploadDisabled}
          id="attach-file-menu-button"
          aria-label="Attach File Options"
          className={cn(
            'flex size-9 items-center justify-center rounded-full p-1 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-50',
            isPopoverActive && 'bg-surface-hover',
          )}
        >
          <div className="flex w-full items-center justify-center gap-2">
            <AttachmentIcon />
          </div>
        </Ariakit.MenuButton>
      }
      id="attach-file-menu-button"
      description={localize('com_sidepanel_attach_files')}
      disabled={isUploadDisabled}
    />
  );
  const handleSharePointFilesSelected = async (sharePointFiles: any[]) => {
    try {
      await handleSharePointFiles(sharePointFiles);
      setIsSharePointDialogOpen(false);
    } catch (error) {
      console.error('SharePoint file processing error:', error);
    }
  };

  return (
    <>
      <FileUpload
        ref={inputRef}
        handleFileChange={(e) => {
          handleFileChange(e, toolResource);
        }}
      >
        <input
          ref={piInputRef}
          multiple
          type="file"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              uploadFilesToPi(e.target.files);
            }
            e.target.value = '';
          }}
        />
        <DropdownPopup
          menuId="attach-file-menu"
          className="overflow-visible"
          isOpen={isPopoverActive}
          setIsOpen={setIsPopoverActive}
          modal={true}
          unmountOnHide={true}
          trigger={menuTrigger}
          items={dropdownItems}
          iconClassName="mr-0"
        />
      </FileUpload>
      <SharePointPickerDialog
        isOpen={isSharePointDialogOpen}
        onOpenChange={setIsSharePointDialogOpen}
        onFilesSelected={handleSharePointFilesSelected}
        isDownloading={isProcessing}
        downloadProgress={downloadProgress}
      />
    </>
  );
};

export default React.memo(AttachFileMenu);
