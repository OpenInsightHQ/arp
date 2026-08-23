import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecoilRoot } from 'recoil';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AttachFileMenu from '../AttachFileMenu';

// Mock all the hooks
jest.mock('~/hooks', () => ({
  useAgentToolPermissions: jest.fn(),
  useAgentCapabilities: jest.fn(),
  useGetAgentsConfig: jest.fn(),
  useFileHandling: jest.fn(),
  useLocalize: jest.fn(),
  usePiFileUpload: jest.fn(),
}));

jest.mock('~/hooks/Files/usePiFileUpload', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('~/hooks/Files/useSharePointFileHandling', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: jest.fn(),
}));

jest.mock('~/components/SharePoint', () => ({
  SharePointPickerDialog: jest.fn(() => null),
}));

jest.mock('@librechat/client', () => {
  const React = jest.requireActual('react');
  return {
    FileUpload: React.forwardRef(({ children, handleFileChange }: any, ref: any) => (
      <div data-testid="file-upload">
        <input ref={ref} type="file" onChange={handleFileChange} data-testid="file-input" />
        {children}
      </div>
    )),
    TooltipAnchor: ({ render }: any) => render,
    DropdownPopup: ({ trigger, items, isOpen, setIsOpen }: any) => {
      const handleTriggerClick = () => {
        if (setIsOpen) {
          setIsOpen(!isOpen);
        }
      };

      return (
        <div>
          <div onClick={handleTriggerClick}>{trigger}</div>
          {isOpen && (
            <div data-testid="dropdown-menu">
              {items.map((item: any, idx: number) => (
                <button key={idx} onClick={item.onClick} data-testid={`menu-item-${idx}`}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    },
    AttachmentIcon: () => <span data-testid="attachment-icon">📎</span>,
    SharePointIcon: () => <span data-testid="sharepoint-icon">SP</span>,
  };
});

jest.mock('@ariakit/react', () => ({
  MenuButton: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

const mockUseAgentToolPermissions = jest.requireMock('~/hooks').useAgentToolPermissions;
const mockUseAgentCapabilities = jest.requireMock('~/hooks').useAgentCapabilities;
const mockUseGetAgentsConfig = jest.requireMock('~/hooks').useGetAgentsConfig;
const mockUseFileHandling = jest.requireMock('~/hooks').useFileHandling;
const mockUseLocalize = jest.requireMock('~/hooks').useLocalize;
const mockUsePiFileUpload = jest.requireMock('~/hooks').usePiFileUpload;
const mockUseSharePointFileHandling = jest.requireMock(
  '~/hooks/Files/useSharePointFileHandling',
).default;
const mockUseGetStartupConfig = jest.requireMock('~/data-provider').useGetStartupConfig;

describe('AttachFileMenu', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const mockHandleFileChange = jest.fn();
  const mockUploadFilesToPi = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockUseLocalize.mockReturnValue((key: string) => {
      const translations: Record<string, string> = {
        com_ui_upload_pi_file: 'Upload File',
        com_ui_upload_ocr_text: 'Upload OCR Text',
        com_ui_upload_file_search: 'Upload for File Search',
        com_sidepanel_attach_files: 'Attach Files',
        com_files_upload_sharepoint: 'Upload from SharePoint',
      };
      return translations[key] || key;
    });

    mockUseAgentCapabilities.mockReturnValue({
      contextEnabled: false,
      fileSearchEnabled: false,
      codeEnabled: false,
    });

    mockUseGetAgentsConfig.mockReturnValue({
      agentsConfig: {
        capabilities: {
          contextEnabled: false,
          fileSearchEnabled: false,
          codeEnabled: false,
        },
      },
    });

    mockUseFileHandling.mockReturnValue({
      handleFileChange: mockHandleFileChange,
    });

    mockUsePiFileUpload.mockReturnValue({
      uploadFilesToPi: mockUploadFilesToPi,
    });

    mockUseSharePointFileHandling.mockReturnValue({
      handleSharePointFiles: jest.fn(),
      isProcessing: false,
      downloadProgress: 0,
    });

    mockUseGetStartupConfig.mockReturnValue({
      data: {
        sharePointFilePickerEnabled: false,
      },
    });

    mockUseAgentToolPermissions.mockReturnValue({
      fileSearchAllowedByAgent: false,
      codeAllowedByAgent: false,
      provider: undefined,
    });
  });

  const renderAttachFileMenu = (props: any = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <RecoilRoot>
          <AttachFileMenu conversationId="test-conversation" {...props} />
        </RecoilRoot>
      </QueryClientProvider>,
    );
  };

  describe('Basic Rendering', () => {
    it('should render the attachment button', () => {
      renderAttachFileMenu();
      const button = screen.getByRole('button', { name: /attach file options/i });
      expect(button).toBeInTheDocument();
    });

    it('should be disabled when disabled prop is true', () => {
      renderAttachFileMenu({ disabled: true });
      const button = screen.getByRole('button', { name: /attach file options/i });
      expect(button).toBeDisabled();
    });

    it('should not be disabled when disabled prop is false', () => {
      renderAttachFileMenu({ disabled: false });
      const button = screen.getByRole('button', { name: /attach file options/i });
      expect(button).not.toBeDisabled();
    });
  });

  describe('Unified PI Upload', () => {
    it('should always show the PI upload item as the first option', () => {
      renderAttachFileMenu();

      const button = screen.getByRole('button', { name: /attach file options/i });
      fireEvent.click(button);

      expect(screen.getByText('Upload File')).toBeInTheDocument();
    });

    it('should NOT show removed provider/image/code upload options', () => {
      renderAttachFileMenu();

      const button = screen.getByRole('button', { name: /attach file options/i });
      fireEvent.click(button);

      expect(screen.queryByText('Upload to Provider')).not.toBeInTheDocument();
      expect(screen.queryByText('Upload Image')).not.toBeInTheDocument();
      expect(screen.queryByText('Upload Code Files')).not.toBeInTheDocument();
    });
  });

  describe('Agent Capabilities', () => {
    it('should show OCR Text option when context is enabled', () => {
      mockUseAgentCapabilities.mockReturnValue({
        contextEnabled: true,
        fileSearchEnabled: false,
        codeEnabled: false,
      });

      renderAttachFileMenu();

      const button = screen.getByRole('button', { name: /attach file options/i });
      fireEvent.click(button);

      expect(screen.getByText('Upload OCR Text')).toBeInTheDocument();
    });

    it('should show File Search option when enabled and allowed by agent', () => {
      mockUseAgentCapabilities.mockReturnValue({
        contextEnabled: false,
        fileSearchEnabled: true,
        codeEnabled: false,
      });

      mockUseAgentToolPermissions.mockReturnValue({
        fileSearchAllowedByAgent: true,
        codeAllowedByAgent: false,
        provider: undefined,
      });

      renderAttachFileMenu();

      const button = screen.getByRole('button', { name: /attach file options/i });
      fireEvent.click(button);

      expect(screen.getByText('Upload for File Search')).toBeInTheDocument();
    });

    it('should NOT show File Search when enabled but not allowed by agent', () => {
      mockUseAgentCapabilities.mockReturnValue({
        contextEnabled: false,
        fileSearchEnabled: true,
        codeEnabled: false,
      });

      mockUseAgentToolPermissions.mockReturnValue({
        fileSearchAllowedByAgent: false,
        codeAllowedByAgent: false,
        provider: undefined,
      });

      renderAttachFileMenu();

      const button = screen.getByRole('button', { name: /attach file options/i });
      fireEvent.click(button);

      expect(screen.queryByText('Upload for File Search')).not.toBeInTheDocument();
    });

    it('should NOT show Code Files option even when code capability is enabled', () => {
      mockUseAgentCapabilities.mockReturnValue({
        contextEnabled: false,
        fileSearchEnabled: false,
        codeEnabled: true,
      });

      mockUseAgentToolPermissions.mockReturnValue({
        fileSearchAllowedByAgent: false,
        codeAllowedByAgent: true,
        provider: undefined,
      });

      renderAttachFileMenu();

      const button = screen.getByRole('button', { name: /attach file options/i });
      fireEvent.click(button);

      expect(screen.queryByText('Upload Code Files')).not.toBeInTheDocument();
    });
  });

  describe('SharePoint Integration', () => {
    it('should show SharePoint option when enabled', () => {
      mockUseGetStartupConfig.mockReturnValue({
        data: {
          sharePointFilePickerEnabled: true,
        },
      });

      renderAttachFileMenu();

      const button = screen.getByRole('button', { name: /attach file options/i });
      fireEvent.click(button);

      expect(screen.getByText('Upload from SharePoint')).toBeInTheDocument();
    });

    it('should NOT show SharePoint option when disabled', () => {
      mockUseGetStartupConfig.mockReturnValue({
        data: {
          sharePointFilePickerEnabled: false,
        },
      });

      renderAttachFileMenu();

      const button = screen.getByRole('button', { name: /attach file options/i });
      fireEvent.click(button);

      expect(screen.queryByText('Upload from SharePoint')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined endpoint and provider gracefully', () => {
      mockUseAgentToolPermissions.mockReturnValue({
        fileSearchAllowedByAgent: false,
        codeAllowedByAgent: false,
        provider: undefined,
      });

      renderAttachFileMenu({
        endpoint: undefined,
      });

      const button = screen.getByRole('button', { name: /attach file options/i });
      expect(button).toBeInTheDocument();
      fireEvent.click(button);

      expect(screen.getByText('Upload File')).toBeInTheDocument();
    });

    it('should handle null endpoint and provider gracefully', () => {
      mockUseAgentToolPermissions.mockReturnValue({
        fileSearchAllowedByAgent: false,
        codeAllowedByAgent: false,
        provider: null,
      });

      renderAttachFileMenu({
        endpoint: null,
      });

      const button = screen.getByRole('button', { name: /attach file options/i });
      expect(button).toBeInTheDocument();
    });

    it('should handle missing agentId gracefully', () => {
      renderAttachFileMenu({
        agentId: undefined,
      });

      const button = screen.getByRole('button', { name: /attach file options/i });
      expect(button).toBeInTheDocument();
    });

    it('should handle empty string agentId', () => {
      renderAttachFileMenu({
        agentId: '',
      });

      const button = screen.getByRole('button', { name: /attach file options/i });
      expect(button).toBeInTheDocument();
    });
  });
});
