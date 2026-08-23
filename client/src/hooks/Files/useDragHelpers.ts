import { useCallback, useRef } from 'react';
import { useDrop } from 'react-dnd';
import { useToastContext } from '@librechat/client';
import { NativeTypes } from 'react-dnd-html5-backend';
import { useQueryClient } from '@tanstack/react-query';
import { useRecoilValue } from 'recoil';
import { QueryKeys, mergeFileConfig, getEndpointFileConfig } from 'librechat-data-provider';
import type { DropTargetMonitor } from 'react-dnd';
import type * as t from 'librechat-data-provider';
import store from '~/store';
import usePiFileUpload from './usePiFileUpload';
import useLocalize from '../useLocalize';

export default function useDragHelpers() {
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const conversation = useRecoilValue(store.conversationByIndex(0)) || undefined;
  const { uploadFilesToPi } = usePiFileUpload();

  /** Use refs to avoid re-creating the drop handler */
  const conversationRef = useRef(conversation);

  conversationRef.current = conversation;

  const handleDrop = useCallback(
    (item: { files: File[] }) => {
      /** Early block: leverage endpoint file config to prevent drag/drop on disabled endpoints */
      const currentEndpoint = conversationRef.current?.endpoint ?? 'default';
      const currentEndpointType = conversationRef.current?.endpointType ?? undefined;
      const cfg = queryClient.getQueryData<t.FileConfig>([QueryKeys.fileConfig]);
      if (cfg) {
        const mergedCfg = mergeFileConfig(cfg);
        const endpointCfg = getEndpointFileConfig({
          fileConfig: mergedCfg,
          endpoint: currentEndpoint,
          endpointType: currentEndpointType,
        });
        if (endpointCfg?.disabled === true) {
          showToast({
            message: localize('com_ui_attach_error_disabled'),
            status: 'error',
          });
          return;
        }
      }

      if (!item.files || item.files.length === 0) {
        return;
      }
      uploadFilesToPi(item.files).catch(() => {
        showToast({
          message: localize('com_error_files_upload'),
          status: 'error',
        });
      });
    },
    [queryClient, showToast, localize, uploadFilesToPi],
  );

  const [{ canDrop, isOver }, drop] = useDrop(
    () => ({
      accept: [NativeTypes.FILE],
      drop: handleDrop,
      canDrop: () => true,
      collect: (monitor: DropTargetMonitor) => {
        /** Optimize collect to reduce re-renders */
        const isOver = monitor.isOver();
        const canDrop = monitor.canDrop();
        return { canDrop, isOver };
      },
    }),
    [handleDrop],
  );

  return {
    canDrop,
    isOver,
    drop,
  };
}
