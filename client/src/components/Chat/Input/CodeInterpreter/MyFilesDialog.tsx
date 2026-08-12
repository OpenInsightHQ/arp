import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Spinner,
  Input,
  Button,
  useToastContext,
} from '@librechat/client';
import { useLocalize } from '~/hooks';
import {
  useListFilesQuery,
  useCreateFolderMutation,
  useRenameFileMutation,
  useMoveFilesMutation,
  useDeleteFileMutation,
  useBatchDeleteFilesMutation,
  useUnzipFileMutation,
} from 'librechat-data-provider/react-query';
import {
  downloadFile,
  batchDownloadFiles,
  unzipFile,
  uploadFileSimple,
  getUploadLimits,
  type FileManagementFile,
  type FileManagementMkdirBody,
  type FileManagementRenameBody,
  type FileManagementMoveBody,
  type FileManagementDeleteBody,
  type FileManagementBatchDeleteBody,
  type FileManagementUnzipBody,
} from 'librechat-data-provider';
import {
  FileIcon,
  FolderIcon,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Upload,
  FolderPlus,
  Copy,
  Scissors,
  FilePlus,
  Search,
  X,
  RefreshCw,
  FileArchive,
  Eye,
  Loader2,
} from 'lucide-react';
import { useSetRecoilState } from 'recoil';
import store from '~/store';
import { cn } from '~/utils';

const PAGE_SIZE = 10;

const FILE_TYPE_I18N: Record<string, string> = {
  folder: 'com_arp_type_folder',
  html: 'com_arp_type_html',
  markdown: 'com_arp_type_markdown',
  pdf: 'com_arp_type_pdf',
  image: 'com_arp_type_image',
  excel: 'com_arp_type_excel',
  ppt: 'com_arp_type_ppt',
  word: 'com_arp_type_word',
  text: 'com_arp_type_text',
  archive: 'com_arp_type_archive',
  code: 'com_arp_type_code',
  file: 'com_arp_type_file',
};

function getFileTypeLabel(type: string, localize: ReturnType<typeof useLocalize>): string {
  const key = FILE_TYPE_I18N[type];
  return key ? localize(key) : type;
}

type SortField = 'name' | 'size' | 'lastModified';
type SortDir = 'asc' | 'desc';

interface MyFilesDialogProps {
  agentId: string;
  sessionId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function getFileType(name: string, isDirectory: boolean): string {
  if (isDirectory) return 'folder';
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (['.md', '.markdown'].includes(ext)) return 'markdown';
  if (['.pdf'].includes(ext)) return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) return 'image';
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'excel';
  if (['.pptx', '.ppt'].includes(ext)) return 'ppt';
  if (['.docx', '.doc'].includes(ext)) return 'word';
  if (['.txt', '.log'].includes(ext)) return 'text';
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return 'archive';
  if (['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h'].includes(ext)) return 'code';
  return 'file';
}

function SortableHeader({
  label,
  field,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const isActive = currentSort === field;
  return (
    <th
      className={cn(
        'cursor-pointer select-none whitespace-nowrap py-2 pr-3',
        field === 'name' ? 'text-left' : 'text-right',
        isActive ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400',
      )}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (currentDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );
}

interface FileItem extends FileManagementFile {
  selected?: boolean;
}

export default function MyFilesDialog({ agentId, sessionId, isOpen, onOpenChange }: MyFilesDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentPath, setCurrentPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('lastModified');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [unzippingPaths, setUnzippingPaths] = useState<Set<string>>(new Set());

  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ paths: string[]; operation: 'move' | 'copy' } | null>(null);
  const [operationPath, setOperationPath] = useState('');
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [maxFileSizeMB, setMaxFileSizeMB] = useState<number>(1024);

  const { data: filesData, isLoading, isError, error, refetch } = useListFilesQuery(
    agentId,
    sessionId,
    currentPath,
  );

  const createFolderMutation = useCreateFolderMutation();
  const renameFileMutation = useRenameFileMutation();
  const moveFilesMutation = useMoveFilesMutation();
  const deleteFileMutation = useDeleteFileMutation();
  const batchDeleteFilesMutation = useBatchDeleteFilesMutation();
  const unzipFileMutation = useUnzipFileMutation();

  useEffect(() => {
    if (isOpen) {
      getUploadLimits().then((data) => {
        if (data?.maxFileSizeMB) {
          setMaxFileSizeMB(data.maxFileSizeMB);
        }
      }).catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      refetch();
      setCurrentPage(1);
      setSearchQuery('');
      setSelectedFiles(new Set());
    }
  }, [isOpen]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortField, sortDir]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField]);

  const processedFiles: FileItem[] = useMemo(() => {
    if (!filesData?.files) return [];
    let files = [...filesData.files];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      files = files.filter((f) => f.name.toLowerCase().includes(q));
    }
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'size') cmp = a.size - b.size;
      else cmp = new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return files.map((f) => ({
      ...f,
      selected: selectedFiles.has(f.path || f.name),
    }));
  }, [filesData, searchQuery, sortField, sortDir, selectedFiles]);

  const totalPages = Math.max(1, Math.ceil(processedFiles.length / PAGE_SIZE));
  const paginatedFiles = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return processedFiles.slice(start, start + PAGE_SIZE);
  }, [processedFiles, currentPage]);

  const toggleSelect = useCallback((file: FileItem) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      const key = file.path || file.name;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedFiles((prev) => {
      if (prev.size === paginatedFiles.length) return new Set();
      return new Set(paginatedFiles.map((f) => f.path || f.name));
    });
  }, [paginatedFiles]);

  const handleRefresh = useCallback(() => {
    refetch();
    setCurrentPage(1);
  }, [refetch]);

  const handleNavigate = useCallback((path: string, isRelative = false) => {
    const newPath = isRelative ? (currentPath ? `${currentPath}/${path}` : path) : path;
    setCurrentPath(newPath);
    setSelectedFiles(new Set());
    setCurrentPage(1);
  }, [currentPath]);

  const handleNavigateUp = useCallback(() => {
    if (!currentPath) return;
    const parts = currentPath.split(/[/\\]/).filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
    setSelectedFiles(new Set());
    setCurrentPage(1);
  }, [currentPath]);

  const getFullPath = useCallback((path: string) => {
    return currentPath ? `${currentPath}/${path}` : path;
  }, [currentPath]);

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    const folderPath = currentPath ? `${currentPath}/${newFolderName}` : newFolderName;
    const body: FileManagementMkdirBody = { agentId, sessionId, path: folderPath };
    try {
      await createFolderMutation.mutateAsync(body);
      setShowNewFolderDialog(false);
      setNewFolderName('');
      refetch();
    } catch (err) {
      console.error('Create folder failed:', err);
    }
  }, [agentId, sessionId, currentPath, newFolderName, createFolderMutation, refetch]);

  const handleRename = useCallback(async () => {
    if (!renameTarget) return;
    const oldPath = currentPath ? `${currentPath}/${renameTarget.path}` : renameTarget.path;
    const newName = renameTarget.name;
    const dir = currentPath || '';
    const newPath = dir ? `${dir}/${newName}` : newName;
    const body: FileManagementRenameBody = { agentId, sessionId, oldPath, newPath };
    try {
      await renameFileMutation.mutateAsync(body);
      setShowRenameDialog(false);
      setRenameTarget(null);
      refetch();
    } catch (err) {
      console.error('Rename failed:', err);
    }
  }, [agentId, sessionId, currentPath, renameTarget, renameFileMutation, refetch]);

  const handleMove = useCallback(async () => {
    if (!moveTarget) return;
    const fullPaths = moveTarget.paths.map((p) => getFullPath(p));
    const body: FileManagementMoveBody = {
      agentId,
      sessionId,
      sourcePaths: fullPaths,
      targetDir: operationPath,
      operation: moveTarget.operation,
    };
    try {
      await moveFilesMutation.mutateAsync(body);
      setShowMoveDialog(false);
      setMoveTarget(null);
      setOperationPath('');
      setSelectedFiles(new Set());
      refetch();
    } catch (err) {
      console.error('Move failed:', err);
    }
  }, [agentId, sessionId, moveTarget, operationPath, getFullPath, moveFilesMutation, refetch]);

  const handleDelete = useCallback(async (path: string) => {
    const fullPath = getFullPath(path);
    const body: FileManagementDeleteBody = { agentId, sessionId, path: fullPath };
    try {
      await deleteFileMutation.mutateAsync(body);
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      refetch();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [agentId, sessionId, getFullPath, deleteFileMutation, refetch]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedFiles.size === 0) return;
    const fullPaths = Array.from(selectedFiles).map((p) => getFullPath(p));
    const body: FileManagementBatchDeleteBody = {
      agentId,
      sessionId,
      paths: fullPaths,
    };
    try {
      await batchDeleteFilesMutation.mutateAsync(body);
      setSelectedFiles(new Set());
      refetch();
    } catch (err) {
      console.error('Batch delete failed:', err);
    }
  }, [agentId, sessionId, selectedFiles, getFullPath, batchDeleteFilesMutation, refetch]);

  const handleDownload = useCallback(async (path: string, name: string, isDirectory = false) => {
    try {
      const blob = await downloadFile(agentId, sessionId, path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = isDirectory && !name.endsWith('.zip') ? `${name}.zip` : name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, [agentId, sessionId]);

  const handleBatchDownload = useCallback(async () => {
    if (selectedFiles.size === 0) return;
    try {
      const body: FileManagementBatchDeleteBody = {
        agentId,
        sessionId,
        paths: Array.from(selectedFiles),
      };
      const blob = await batchDownloadFiles(body);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'files.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Batch download failed:', err);
    }
  }, [agentId, sessionId, selectedFiles]);

  const handleUnzip = useCallback(async (path: string) => {
    const body: FileManagementUnzipBody = { agentId, sessionId, path };
    setUnzippingPaths((prev) => new Set(prev).add(path));
    try {
      await unzipFileMutation.mutateAsync(body);
      showToast({ message: localize('com_arp_unzip_success'), status: 'success' });
      refetch();
    } catch (err) {
      console.error('Unzip failed:', err);
      showToast({ message: localize('com_arp_unzip_failed'), status: 'error' });
    } finally {
      setUnzippingPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [agentId, sessionId, unzipFileMutation, refetch, showToast, localize]);

  const handleUpload = useCallback(async () => {
    if (!uploadingFile || isUploading) return;
    setIsUploading(true);
    try {
      await uploadFileSimple(agentId, sessionId, uploadingFile, currentPath || undefined);
      setShowUploadDialog(false);
      setUploadingFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      refetch();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  }, [agentId, sessionId, currentPath, uploadingFile, isUploading, refetch]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const maxSize = maxFileSizeMB * 1024 * 1024;
      if (file.size > maxSize) {
        const sizeStr = maxFileSizeMB >= 1024 ? `${(maxFileSizeMB / 1024).toFixed(0)}G` : `${maxFileSizeMB}MB`;
        alert(localize('com_arp_file_size_exceeded', { limit: sizeStr }));
        return;
      }
      setUploadingFile(file);
      setShowUploadDialog(true);
    }
  };

  const setArtifacts = useSetRecoilState(store.artifactsState);
  const setCurrentArtifactId = useSetRecoilState(store.currentArtifactId);
  const setArtifactsVisible = useSetRecoilState(store.artifactsVisibility);

  const handlePreviewHtml = useCallback(async (path: string, name: string) => {
    try {
      const blob = await downloadFile(agentId, sessionId, path);
      const htmlContent = await blob.text();
      const artifactId = `file_${path}_${Date.now()}`;
      const artifact = {
        id: artifactId,
        lastUpdateTime: Date.now(),
        identifier: 'html',
        language: 'html',
        content: htmlContent,
        title: name,
        type: 'text/html',
      };
      setArtifacts((prev) => ({ ...prev, [artifactId]: artifact }));
      setCurrentArtifactId(artifactId);
      setArtifactsVisible(true);
      onOpenChange(false);
    } catch (err) {
      console.error('Preview HTML failed:', err);
    }
  }, [agentId, sessionId, setArtifacts, setCurrentArtifactId, setArtifactsVisible, onOpenChange]);

  const isEmpty = !isLoading && !filesData?.files?.length;
  const isSearchMode = searchQuery.trim().length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px]" style={{ minWidth: '700px' }}>
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-white">{localize('com_ui_my_files')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col" style={{ height: '500px' }}>
          <div className="mb-3 flex items-center gap-2 px-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder={localize('com_ui_search') + '...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 dark:border-gray-600 dark:bg-gray-800"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowNewFolderDialog(true); setNewFolderName(''); }}
              className="flex items-center gap-1"
            >
              <FolderPlus className="h-4 w-4" />
              <span className="text-xs">{localize('com_arp_new')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1"
              disabled={isUploading}
            >
              <Upload className="h-4 w-4" />
              <span className="text-xs">{isUploading ? localize('com_arp_uploading') : localize('com_arp_upload_btn')}</span>
              <span className="text-[10px] text-gray-400">{maxFileSizeMB >= 1024 ? `${(maxFileSizeMB / 1024).toFixed(0)}G` : `${maxFileSizeMB}MB`}</span>
            </Button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
            <Button variant="outline" size="sm" onClick={handleRefresh} className="flex items-center gap-1">
              <RefreshCw className="h-4 w-4" />
              <span className="text-xs">{localize('com_arp_refresh')}</span>
            </Button>
          </div>

          {unzippingPaths.size > 0 && (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-blue-50 px-4 py-2 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{localize('com_arp_unzipping_count', { count: unzippingPaths.size })}</span>
            </div>
          )}

          <div className="mb-2 flex items-center gap-2 px-4 text-sm">
            <button
              onClick={handleNavigateUp}
              disabled={!currentPath}
              className="flex items-center gap-1 text-gray-600 dark:text-gray-300 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
              <span>..</span>
            </button>
            <button onClick={() => handleNavigate('')} className="text-blue-600 hover:underline dark:text-blue-400">
              /
            </button>
            {currentPath.split(/[/\\]/).filter(Boolean).map((part, i, arr) => (
              <span key={i} className="flex items-center">
                <span className="text-gray-400">/</span>
                <button
                  onClick={() => handleNavigate(arr.slice(0, i + 1).join('/'))}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {part}
                </button>
              </span>
            ))}
          </div>

          {isError && (
            <div className="flex flex-1 items-center justify-center text-red-500">{String(error)}</div>
          )}

          {isLoading && (
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          )}

          {!isLoading && isEmpty && (
            <div className="flex flex-1 items-center justify-center text-gray-500 dark:text-gray-400">
              {localize('com_ui_no_files') || 'No files found'}
            </div>
          )}

          {!isLoading && !isEmpty && (
            <>
              <div className="flex-1 overflow-y-auto px-4">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col style={{ width: '40px' }} />
                    <col />
                    <col style={{ width: '80px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '160px' }} />
                    <col style={{ width: '200px' }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-600">
                      <th className="py-2 text-left">
                        <input
                          type="checkbox"
                          checked={selectedFiles.size === paginatedFiles.length && paginatedFiles.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                      </th>
                      <SortableHeader label={localize('com_arp_filename')} field="name" currentSort={sortField} currentDir={sortDir} onSort={handleSort} />
                      <th className="py-2 text-left font-medium text-gray-500 dark:text-gray-400">{localize('com_arp_type')}</th>
                      <SortableHeader label={localize('com_ui_size')} field="size" currentSort={sortField} currentDir={sortDir} onSort={handleSort} />
                      <SortableHeader label={localize('com_arp_date')} field="lastModified" currentSort={sortField} currentDir={sortDir} onSort={handleSort} />
                      <th className="py-2 text-center font-medium text-gray-500 dark:text-gray-400">{localize('com_ui_actions')}</th>
                    </tr>
                  </thead>
                </table>
                <div className="max-h-[320px] overflow-y-auto">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col style={{ width: '40px' }} />
                      <col />
                      <col style={{ width: '80px' }} />
                      <col style={{ width: '100px' }} />
                      <col style={{ width: '160px' }} />
                      <col style={{ width: '200px' }} />
                    </colgroup>
                    <tbody>
                      {paginatedFiles.map((file, index) => (
                        <tr
                          key={index}
                          className={cn(
                            'hover:bg-gray-50 dark:hover:bg-gray-700/50',
                            selectedFiles.has(file.path || file.name) && 'bg-blue-50 dark:bg-blue-900/20',
                          )}
                        >
                          <td className="py-2">
                            <input
                              type="checkbox"
                              checked={selectedFiles.has(file.path || file.name)}
                              onChange={() => toggleSelect(file)}
                              className="rounded"
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2 overflow-hidden">
                              {file.isDirectory ? (
                                <FolderIcon className="h-4 w-4 shrink-0 text-yellow-500" />
                              ) : (
                                <FileIcon className="h-4 w-4 shrink-0 text-gray-500" />
                              )}
                              {file.isDirectory ? (
                                <button
                                  onClick={() => handleNavigate(file.name, true)}
                                  className="truncate text-blue-600 hover:underline dark:text-blue-400"
                                  title={file.name}
                                >
                                  {file.name}
                                </button>
                              ) : (
                                <span className="truncate text-gray-800 dark:text-white" title={file.name}>
                                  {file.name}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 text-left text-gray-600 dark:text-gray-300">
                            {getFileTypeLabel(getFileType(file.name, file.isDirectory), localize)}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-300">
                            {file.isDirectory ? '-' : formatSize(file.size)}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">
                            {formatDate(file.lastModified)}
                          </td>
                          <td className="py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleDownload(getFullPath(file.name), file.name, file.isDirectory)}
                                className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600"
                                title={localize('com_arp_download')}
                              >
                                <Download className="h-4 w-4" />
                              </button>
                              {!file.isDirectory && getFileType(file.name, false) === 'html' && (
                                <button
                                  onClick={() => handlePreviewHtml(getFullPath(file.name), file.name)}
                                  className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600"
                                  title={localize('com_arp_preview')}
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              )}
                              {!file.isDirectory && getFileType(file.name, false) === 'archive' && (
                                (() => {
                                  const fullPath = getFullPath(file.name);
                                  const isUnzipping = unzippingPaths.has(fullPath);
                                  return (
                                    <button
                                      onClick={() => handleUnzip(fullPath)}
                                      disabled={isUnzipping}
                                      className={cn(
                                        'rounded p-1',
                                        isUnzipping
                                          ? 'text-blue-500 dark:text-blue-400'
                                          : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600',
                                      )}
                                      title={localize(isUnzipping ? 'com_arp_unzipping' : 'com_arp_unzip')}
                                    >
                                      {isUnzipping ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <FileArchive className="h-4 w-4" />
                                      )}
                                    </button>
                                  );
                                })()
                              )}
                              <button
                                onClick={() => { setRenameTarget({ path: file.path || file.name, name: file.name }); setShowRenameDialog(true); }}
                                className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600"
                                title={localize('com_arp_rename')}
                              >
                                <FilePlus className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => { setMoveTarget({ paths: [file.path || file.name], operation: 'move' }); setOperationPath(currentPath); setShowMoveDialog(true); }}
                                className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600"
                                title={localize('com_arp_move')}
                              >
                                <Scissors className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(file.path || file.name)}
                                className="rounded p-1 text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                title={localize('com_arp_delete_btn')}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex-shrink-0 flex items-center justify-between border-t border-gray-200 dark:border-gray-600 pt-3 mt-2 px-4">
                <div className="flex items-center gap-2">
                  {selectedFiles.size > 0 && (
                    <>
                      <span className="text-sm text-gray-500 dark:text-gray-400">{selectedFiles.size} {localize('com_arp_selected')}</span>
                      <button onClick={handleBatchDownload} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600" title={localize('com_arp_download')}>
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setMoveTarget({ paths: Array.from(selectedFiles), operation: 'move' }); setOperationPath(currentPath); setShowMoveDialog(true); }}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600"
                        title={localize('com_arp_move')}
                      >
                        <Scissors className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setMoveTarget({ paths: Array.from(selectedFiles), operation: 'copy' }); setOperationPath(currentPath); setShowMoveDialog(true); }}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600"
                        title={localize('com_arp_copy')}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button onClick={handleBatchDelete} className="rounded p-1 text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30" title={localize('com_arp_delete_btn')}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {localize('com_arp_total_items', { count: processedFiles.length })}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-600"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="text-sm text-gray-600 dark:text-gray-300">
                        {currentPage}/{totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-600"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {showNewFolderDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-80 rounded-lg bg-white p-4 dark:bg-gray-800">
              <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">{localize('com_arp_new_folder')}</h3>
              <Input
                placeholder={localize('com_arp_folder_name')}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="mb-4 dark:border-gray-600 dark:bg-gray-700"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowNewFolderDialog(false)}>{localize('com_skill_cancel')}</Button>
                <Button size="sm" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>{localize('com_arp_create')}</Button>
              </div>
            </div>
          </div>
        )}

        {showRenameDialog && renameTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-80 rounded-lg bg-white p-4 dark:bg-gray-800">
              <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">{localize('com_arp_rename')}</h3>
              <Input
                placeholder={localize('com_arp_new_name')}
                value={renameTarget.name}
                onChange={(e) => setRenameTarget({ ...renameTarget, name: e.target.value })}
                className="mb-4 dark:border-gray-600 dark:bg-gray-700"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowRenameDialog(false)}>{localize('com_skill_cancel')}</Button>
                <Button size="sm" onClick={handleRename} disabled={!renameTarget.name.trim()}>{localize('com_arp_rename')}</Button>
              </div>
            </div>
          </div>
        )}

        {showMoveDialog && moveTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-80 rounded-lg bg-white p-4 dark:bg-gray-800">
              <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
                {moveTarget.operation === 'move' ? localize('com_arp_move') : localize('com_arp_copy')}
              </h3>
              <p className="mb-2 text-sm text-gray-500">{localize('com_arp_items_selected', { count: moveTarget.paths.length })}</p>
              <Input
                placeholder={localize('com_arp_target_path')}
                value={operationPath}
                onChange={(e) => setOperationPath(e.target.value)}
                className="mb-4 dark:border-gray-600 dark:bg-gray-700"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowMoveDialog(false)}>{localize('com_skill_cancel')}</Button>
                <Button size="sm" onClick={handleMove}>{moveTarget.operation === 'move' ? localize('com_arp_move') : localize('com_arp_copy')}</Button>
              </div>
            </div>
          </div>
        )}

        {showUploadDialog && uploadingFile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-80 rounded-lg bg-white p-4 dark:bg-gray-800">
              <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">{localize('com_arp_upload_file')}</h3>
              <p className="mb-2 text-sm text-gray-500 truncate">
                {uploadingFile.name} ({formatSize(uploadingFile.size)})
              </p>
              <p className="mb-4 text-sm text-gray-500">{localize('com_arp_target')}: {currentPath || '/'}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowUploadDialog(false); setUploadingFile(null); if (fileInputRef.current) { fileInputRef.current.value = ''; } }} disabled={isUploading}>{localize('com_skill_cancel')}</Button>
                <Button size="sm" onClick={handleUpload} disabled={isUploading}>{isUploading ? localize('com_arp_uploading') : localize('com_arp_upload_btn')}</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}