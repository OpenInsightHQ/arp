import debounce from 'lodash/debounce';
import { useEffect, useRef, useCallback, useMemo } from 'react';
import { v4 } from 'uuid';
import { useRecoilValue, useRecoilState, useSetRecoilState } from 'recoil';
import type { TEndpointOption } from 'librechat-data-provider';
import type { KeyboardEvent } from 'react';
import {
  Constants,
  QueryKeys,
  isEphemeralAgentId,
  encodeEphemeralAgentId,
  uploadFileSimple,
  type TEndpointsConfig,
} from 'librechat-data-provider';
import {
  forceResize,
  insertTextAtCursor,
  getEntityName,
  getEntity,
  checkIfScrollable,
} from '~/utils';
import { useAssistantsMapContext } from '~/Providers/AssistantsMapContext';
import { useAgentsMapContext } from '~/Providers/AgentsMapContext';
import useGetSender from '~/hooks/Conversations/useGetSender';
import useFileHandling from '~/hooks/Files/useFileHandling';
import { useInteractionHealthCheck } from '~/data-provider';
import { useChatContext } from '~/Providers/ChatContext';
import { useQueryClient } from '@tanstack/react-query';
import { globalAudioId } from '~/common';
import { useLocalize } from '~/hooks';
import store from '~/store';

type KeyEvent = KeyboardEvent<HTMLTextAreaElement>;

export default function useTextarea({
  textAreaRef,
  submitButtonRef,
  setIsScrollable,
  disabled = false,
}: {
  textAreaRef: React.RefObject<HTMLTextAreaElement>;
  submitButtonRef: React.RefObject<HTMLButtonElement>;
  setIsScrollable: React.Dispatch<React.SetStateAction<boolean>>;
  disabled?: boolean;
}) {
  const localize = useLocalize();
  const getSender = useGetSender();
  const isComposing = useRef(false);
  const agentsMap = useAgentsMapContext();
  const { handleFiles } = useFileHandling();
  const assistantMap = useAssistantsMapContext();
  const checkHealth = useInteractionHealthCheck();
  const enterToSend = useRecoilValue(store.enterToSend);
  const queryClient = useQueryClient();
  const setConversationState = useSetRecoilState(store.conversationByIndex(0));

  const { index, conversation, isSubmitting, filesLoading, latestMessage, setFilesLoading, setFiles, files: existingFiles } =
    useChatContext();
  const [activePrompt, setActivePrompt] = useRecoilState(store.activePromptByIndex(index));

  const { endpoint = '' } = conversation || {};

  const piFilesAgentId = useMemo(() => {
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
  const { entity, isAgent, isAssistant } = getEntity({
    endpoint,
    agentsMap,
    assistantMap,
    agent_id: conversation?.agent_id,
    assistant_id: conversation?.assistant_id,
  });
  const entityName = entity?.name ?? '';

  const isNotAppendable = latestMessage?.error === true && !isAssistant;
  // && (conversationId?.length ?? 0) > 6; // also ensures that we don't show the wrong placeholder

  useEffect(() => {
    const prompt = activePrompt ?? '';
    if (prompt && textAreaRef.current) {
      insertTextAtCursor(textAreaRef.current, prompt);
      forceResize(textAreaRef.current);
      setActivePrompt(undefined);
    }
  }, [activePrompt, setActivePrompt, textAreaRef]);

  useEffect(() => {
    const currentValue = textAreaRef.current?.value ?? '';
    if (currentValue) {
      return;
    }

    const getPlaceholderText = () => {
      if (disabled) {
        return localize('com_endpoint_config_placeholder');
      }
      const currentEndpoint = conversation?.endpoint ?? '';
      const currentAgentId = conversation?.agent_id ?? '';
      const currentAssistantId = conversation?.assistant_id ?? '';
      if (isAgent && (!currentAgentId || !agentsMap?.[currentAgentId])) {
        return localize('com_endpoint_agent_placeholder');
      } else if (
        isAssistant &&
        (!currentAssistantId || !assistantMap?.[currentEndpoint]?.[currentAssistantId])
      ) {
        return localize('com_endpoint_assistant_placeholder');
      }

      if (isNotAppendable) {
        return localize('com_endpoint_message_not_appendable');
      }

      const sender =
        isAssistant || isAgent
          ? getEntityName({ name: entityName, isAgent, localize })
          : getSender(conversation as TEndpointOption);

      return `${localize('com_endpoint_message_new', {
        0: sender ? sender : localize('com_endpoint_ai'),
      })}`;
    };

    const placeholder = getPlaceholderText();

    if (textAreaRef.current?.getAttribute('placeholder') === placeholder) {
      return;
    }

    const setPlaceholder = () => {
      const placeholder = getPlaceholderText();

      if (textAreaRef.current?.getAttribute('placeholder') !== placeholder) {
        textAreaRef.current?.setAttribute('placeholder', placeholder);
        forceResize(textAreaRef.current);
      }
    };

    const debouncedSetPlaceholder = debounce(setPlaceholder, 80);
    debouncedSetPlaceholder();

    return () => debouncedSetPlaceholder.cancel();
  }, [
    isAgent,
    localize,
    disabled,
    getSender,
    agentsMap,
    entityName,
    textAreaRef,
    isAssistant,
    assistantMap,
    conversation,
    latestMessage,
    isNotAppendable,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyEvent) => {
      if (textAreaRef.current && checkIfScrollable(textAreaRef.current)) {
        const scrollable = checkIfScrollable(textAreaRef.current);
        scrollable && setIsScrollable(scrollable);
      }
      if (e.key === 'Enter' && isSubmitting) {
        return;
      }

      checkHealth();

      const isNonShiftEnter = e.key === 'Enter' && !e.shiftKey;
      const isCtrlEnter = e.key === 'Enter' && (e.ctrlKey || e.metaKey);

      // NOTE: isComposing and e.key behave differently in Safari compared to other browsers, forcing us to use e.keyCode instead
      const isComposingInput = isComposing.current || e.key === 'Process' || e.keyCode === 229;

      if (isNonShiftEnter && filesLoading) {
        e.preventDefault();
      }

      if (isNonShiftEnter) {
        e.preventDefault();
      }

      if (
        e.key === 'Enter' &&
        !enterToSend &&
        !isCtrlEnter &&
        textAreaRef.current &&
        !isComposingInput
      ) {
        e.preventDefault();
        insertTextAtCursor(textAreaRef.current, '\n');
        forceResize(textAreaRef.current);
        return;
      }

      if ((isNonShiftEnter || isCtrlEnter) && !isComposingInput) {
        const globalAudio = document.getElementById(globalAudioId) as HTMLAudioElement | undefined;
        if (globalAudio) {
          console.log('Unmuting global audio');
          globalAudio.muted = false;
        }
        submitButtonRef.current?.click();
      }
    },
    [
      isSubmitting,
      checkHealth,
      filesLoading,
      enterToSend,
      setIsScrollable,
      textAreaRef,
      submitButtonRef,
    ],
  );

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd = () => {
    isComposing.current = false;
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const textArea = textAreaRef.current;
      if (!textArea) {
        return;
      }

      const clipboardData = e.clipboardData as DataTransfer | undefined;
      if (!clipboardData) {
        return;
      }

      if (clipboardData.files.length > 0) {
        setFilesLoading(true);
        const timestampedFiles: File[] = [];
        for (const file of clipboardData.files) {
          const newFile = new File([file], `clipboard_${+new Date()}_${file.name}`, {
            type: file.type,
          });
          timestampedFiles.push(newFile);
        }

        if ((endpoint as string) === 'pi') {
          let sid = conversation?.conversationId;
          if (!sid || sid === Constants.NEW_CONVO || sid === Constants.PENDING_CONVO) {
            const newId = v4();
            if (conversation) {
              setConversationState({ ...conversation, conversationId: newId });
            }
            sid = newId;
          }
          const piFiles = Array.from(clipboardData.files);
          const nameToFileId = new Map<string, string>();
          for (const ef of existingFiles?.values() ?? []) {
            if (ef.endpoint !== 'pi' || !ef.filename) {
              continue;
            }
            nameToFileId.set(ef.filename, ef.file_id);
          }
          for (const originalFile of piFiles) {
            const file_id = nameToFileId.get(originalFile.name) ?? v4();
            nameToFileId.set(originalFile.name, file_id);
            const preview = URL.createObjectURL(originalFile);
            const baseFile = {
              file_id,
              file: originalFile,
              type: originalFile.type,
              preview,
              progress: 0.5,
              size: originalFile.size,
              filename: originalFile.name,
              endpoint: 'pi' as const,
              pi_session_id: sid,
              pi_agent_id: piFilesAgentId,
            };
            setFiles((prev: Map<string, any>) => {
              const next = new Map(prev);
              next.set(file_id, baseFile);
              return next;
            });
            try {
              const res = await uploadFileSimple(piFilesAgentId, sid, originalFile);
              const basePath = (res.path ?? '').replace(/\/+$/, '');
              const fullPath = basePath
                ? `${basePath}/${originalFile.name}`
                : originalFile.name;
              setFiles((prev: Map<string, any>) => {
                const next = new Map(prev);
                next.set(file_id, {
                  ...baseFile,
                  progress: 1,
                  filepath: fullPath,
                });
                return next;
              });
            } catch (err) {
              console.error('PI paste upload failed:', err);
              setFiles((prev: Map<string, any>) => {
                const next = new Map(prev);
                next.delete(file_id);
                return next;
              });
            }
          }
          setFilesLoading(false);
        } else {
          // Non-PI: original behavior
          handleFiles(timestampedFiles);
        }
      }
    },
    [handleFiles, setFilesLoading, setFiles, textAreaRef, endpoint, conversation, piFilesAgentId, setConversationState, existingFiles],
  );

  return {
    textAreaRef,
    handlePaste,
    handleKeyDown,
    isNotAppendable,
    handleCompositionEnd,
    handleCompositionStart,
  };
}
