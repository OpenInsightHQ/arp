import type { ExtendedFile, FileSetter } from '~/common';
import useSetFilesToDelete from './useSetFilesToDelete';

export default function useUpdateFiles(setFiles: FileSetter) {
  const setFilesToDelete = useSetFilesToDelete();

  const addFile = (newFile: ExtendedFile) => {
    setFiles((currentFiles) => {
      const updatedFiles = new Map(currentFiles);
      updatedFiles.set(newFile.file_id, newFile);
      return updatedFiles;
    });
  };

  const replaceFile = (newFile: ExtendedFile) => {
    setFiles((currentFiles) => {
      const updatedFiles = new Map(currentFiles);
      updatedFiles.set(newFile.file_id, newFile);
      return updatedFiles;
    });
  };

  const updateFileById = (fileId: string, updates: Partial<ExtendedFile>, isEntityFile = false) => {
    setFiles((currentFiles) => {
      const updatedFiles = new Map(currentFiles);
      if (!updatedFiles.has(fileId)) {
        console.warn(`File with id ${fileId} not found. Creating new entry.`);
        updatedFiles.set(fileId, {
          file_id: fileId,
          progress: 0,
          size: updates.size ?? 0,
          ...updates,
        } as ExtendedFile);
        return updatedFiles;
      }

      const currentFile = updatedFiles.get(fileId);
      if (!currentFile) {
        console.warn(`File with id ${fileId} not found. Creating new entry.`);
        updatedFiles.set(fileId, {
          file_id: fileId,
          progress: 0,
          size: updates.size ?? 0,
          ...updates,
        } as ExtendedFile);
        return updatedFiles;
      }
      updatedFiles.set(fileId, { ...currentFile, ...updates });
      const filepath = updates['filepath'] ?? '';
      if (filepath && updates['progress'] !== 1 && !isEntityFile) {
        const files = Object.fromEntries(updatedFiles);
        setFilesToDelete(files);
      }

      return updatedFiles;
    });
  };

  const deleteFileById = (fileId: string) => {
    setFiles((currentFiles) => {
      const updatedFiles = new Map(currentFiles);
      if (updatedFiles.has(fileId)) {
        updatedFiles.delete(fileId);
      } else {
        console.warn(`File with id ${fileId} not found.`);
      }

      const files = Object.fromEntries(updatedFiles);
      setFilesToDelete(files);
      return updatedFiles;
    });
  };

  return {
    addFile,
    replaceFile,
    updateFileById,
    deleteFileById,
  };
}
