import { useCallback, useMemo } from 'react';
import { v4 } from 'uuid';
import { useQueryClient } from '@tanstack/react-query';
import { useSetRecoilState } from 'recoil';
import {
  Constants,
  QueryKeys,
  inferMimeType,
  isEphemeralAgentId,
  uploadFileSimple,
  encodeEphemeralAgentId,
} from 'librechat-data-provider';
import type { TEndpointsConfig } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useChatContext } from '~/Providers/ChatContext';
import { insertTextAtCursor } from '~/utils';
import { mainTextareaId } from '~/common';
import { useLocalize } from '~/hooks';
import store from '~/store';

/**
 * Shared PI file upload logic used by every endpoint (pi, agents, models).
 *
 * Files are uploaded to the PI backend workspace keyed by (piAgentId, sessionId)
 * where sessionId is the conversation id (created on demand for new chats so
 * uploads before the first message still land in the right session).
 * On success, `[<localized 附件/Attachment>:filename]` is inserted into the
 * chat input, matching the PI-native attachment behavior regardless of
 * upload-before-chat or chat-before-upload ordering.
 */
export default function usePiFileUpload() {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { files, setFiles, conversation, setFilesLoading } = useChatContext();
  const setConversationState = useSetRecoilState(store.conversationByIndex(0));

  const piAgentId = useMemo(() => {
    if (!conversation) {
      return 'default';
    }
    const agentId = conversation.agent_id;
    if (agentId && !isEphemeralAgentId(agentId)) {
      return agentId;
    }
    if (conversation?.model) {
      const endpointsConfig = queryClient.getQueryData<TEndpointsConfig>([QueryKeys.endpoints]);
      const modelLabel = conversation.modelLabel ?? '';
      const modelDisplayLabel =
        endpointsConfig?.[conversation.endpoint ?? '']?.modelDisplayLabel ?? '';
      const sender = modelLabel || modelDisplayLabel || undefined;
      return encodeEphemeralAgentId({
        endpoint: conversation.endpoint ?? '',
        model: conversation.model,
        sender,
      });
    }
    return 'default';
  }, [conversation, queryClient]);

  /** Insert `[附件:filename]` (localized tag) at the cursor of the main chat input. */
  const insertAttachmentText = useCallback(
    (filename: string) => {
      const textArea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
      if (!textArea) {
        return;
      }
      const current = textArea.value ?? '';
      const prefix = current.length > 0 && !/\s$/.test(current) ? ' ' : '';
      const tag = localize('com_ui_attachment_tag');
      insertTextAtCursor(textArea, `${prefix}[${tag}:${filename}]`);
    },
    [localize],
  );

  /** Resolve the PI sessionId, minting + persisting a conversation id for new chats. */
  const ensurePiSessionId = useCallback((): string | null => {
    const sid = conversation?.conversationId;
    if (sid && sid !== Constants.NEW_CONVO && sid !== Constants.PENDING_CONVO) {
      return sid;
    }
    if (!conversation) {
      return null;
    }
    const newId = v4();
    setConversationState({ ...conversation, conversationId: newId });
    return newId;
  }, [conversation, setConversationState]);

  /** Resolve the PI path of an already-tracked file by filename (for paste dedupe). */
  const nameToFileId = useCallback(() => {
    const map = new Map<string, string>();
    for (const ef of files?.values() ?? []) {
      if (ef.endpoint === 'pi' && ef.filename) {
        map.set(ef.filename, ef.file_id);
      }
    }
    return map;
  }, [files]);

  /** Upload a single file to the PI workspace, tracking progress in the files map. */
  const uploadPiFile = useCallback(
    async (file: File, sid: string, existingFileId?: string) => {
      const file_id = existingFileId ?? v4();
      const preview = URL.createObjectURL(file);
      const baseFile: ExtendedFile = {
        file_id,
        file,
        type: inferMimeType(file.name, file.type),
        preview,
        progress: 0.5,
        size: file.size,
        filename: file.name,
        endpoint: 'pi',
        pi_session_id: sid,
        pi_agent_id: piAgentId,
      };
      setFiles((prev) => {
        const next = new Map(prev);
        next.set(file_id, baseFile);
        return next;
      });
      try {
        const res = await uploadFileSimple(piAgentId, sid, file);
        const basePath = (res.path ?? '').replace(/\/+$/, '');
        const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
        setFiles((prev) => {
          const next = new Map(prev);
          next.set(file_id, {
            ...baseFile,
            progress: 1,
            filepath: fullPath,
          });
          return next;
        });
        insertAttachmentText(file.name);
        queryClient.invalidateQueries([QueryKeys.files, piAgentId, sid]);
      } catch (err) {
        console.error('PI file upload failed:', err);
        setFiles((prev) => {
          const next = new Map(prev);
          next.delete(file_id);
          return next;
        });
        throw err;
      }
    },
    [piAgentId, setFiles, insertAttachmentText, queryClient],
  );

  /** Upload multiple files to the PI workspace; failures are logged and skipped. */
  const uploadFilesToPi = useCallback(
    async (fileList: File[] | FileList) => {
      const sid = ensurePiSessionId();
      if (!sid) {
        return;
      }
      setFilesLoading(true);
      const trackedIds = nameToFileId();
      const uploads = Array.from(fileList).map((file) =>
        uploadPiFile(file, sid, trackedIds.get(file.name)).catch(() => undefined),
      );
      await Promise.all(uploads);
      setFilesLoading(false);
    },
    [ensurePiSessionId, nameToFileId, uploadPiFile, setFilesLoading],
  );

  return { piAgentId, ensurePiSessionId, uploadFilesToPi, insertAttachmentText };
}
