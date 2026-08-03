import { memo, useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useWatch } from 'react-hook-form';
import { TextareaAutosize } from '@librechat/client';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { Constants, isAssistantsEndpoint, isAgentsEndpoint } from 'librechat-data-provider';
import type { VocabularyHit } from 'librechat-data-provider';
import {
  useChatContext,
  useChatFormContext,
  useAddedChatContext,
  useAssistantsMapContext,
} from '~/Providers';
import {
  useTextarea,
  useAutoSave,
  useLocalize,
  useRequiresKey,
  useHandleKeyUp,
  useQueryParams,
  useSubmitMessage,
  useFocusChatEffect,
} from '~/hooks';
import { useGetAgentByIdQuery } from '~/data-provider';
import { mainTextareaId, BadgeItem } from '~/common';
import AttachFileChat from './Files/AttachFileChat';
import FileFormChat from './Files/FileFormChat';
import { cn, removeFocusRings } from '~/utils';
import VocabularyList from './VocabularyList';
import TextareaHeader from './TextareaHeader';
import PromptsCommand from './PromptsCommand';
import AudioRecorder from './AudioRecorder';
import CollapseChat from './CollapseChat';
import StreamAudio from './StreamAudio';
import StopButton from './StopButton';
import SendButton from './SendButton';
import EditBadges from './EditBadges';
import BadgeRow from './BadgeRow';
import Mention from './Mention';
import store from '~/store';

const KEYWORD_BREAK_CHARS = [' ', '，', '。', ',', '.', '、', '\n', '\t'];

/**
 * Maps any recognized trigger quote character to its [opening, closing] pair
 * used when wrapping a selected keyword. Curly quotes always use the proper
 * open/close pair so the inserted text looks natural (e.g. “keyword”).
 */
const QUOTE_PAIRS: Record<string, [string, string]> = {
  '"': ['"', '"'],
  "'": ["'", "'"],
  '\u201C': ['\u201C', '\u201D'], // “ ”
  '\u201D': ['\u201C', '\u201D'],
  '\u2018': ['\u2018', '\u2019'], // ‘ ’
  '\u2019': ['\u2018', '\u2019'],
};

const QUOTE_CHARS = Object.keys(QUOTE_PAIRS);

interface KeywordQuery {
  query: string;
  openQuote: string;
  closeQuote: string;
  quoteIndex: number;
}

/**
 * Derives the current keyword search query from the textarea state.
 * Triggers when the text immediately before the cursor is preceded by a
 * recognized quote character (ASCII " ', Chinese “ ” ‘ ’) and contains no
 * whitespace/punctuation between that quote and the cursor. The quote may
 * appear at any position in the textarea.
 */
const getKeywordQuery = (value: string, cursorPos: number): KeywordQuery | null => {
  const textBeforeCursor = value.substring(0, cursorPos);

  let lastQuoteIndex = -1;
  for (const q of QUOTE_CHARS) {
    const idx = textBeforeCursor.lastIndexOf(q);
    if (idx > lastQuoteIndex) {
      lastQuoteIndex = idx;
    }
  }
  if (lastQuoteIndex === -1) {
    return null;
  }

  const triggerChar = textBeforeCursor[lastQuoteIndex];
  const [openQuote, closeQuote] = QUOTE_PAIRS[triggerChar];
  const query = textBeforeCursor.substring(lastQuoteIndex + 1);

  if (KEYWORD_BREAK_CHARS.some((c) => query.includes(c))) {
    return null;
  }

  return { query, openQuote, closeQuote, quoteIndex: lastQuoteIndex };
};

const ChatForm = memo(({ index = 0 }: { index?: number }) => {
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const mentionAgentRef = useRef<string | null>(null);
  const piContextHandoffRef = useRef(false);
  const prevAgentIdRef = useRef<string | null>(null);
  const skipDeleteDetectRef = useRef(false);
  const setConversation = useSetRecoilState(store.conversationByIndex(index));
  useFocusChatEffect(textAreaRef);
  const localize = useLocalize();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [, setIsScrollable] = useState(false);
  const [visualRowCount, setVisualRowCount] = useState(1);
  const [isTextAreaFocused, setIsTextAreaFocused] = useState(false);
  const [backupBadges, setBackupBadges] = useState<Pick<BadgeItem, 'id'>[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<
    Array<{ name: string; definition: string }>
  >([]);

  const SpeechToText = useRecoilValue(store.speechToText);
  const TextToSpeech = useRecoilValue(store.textToSpeech);
  const chatDirection = useRecoilValue(store.chatDirection);
  const automaticPlayback = useRecoilValue(store.automaticPlayback);
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);
  const isTemporary = useRecoilValue(store.isTemporary);
  const keywordCommandEnabled = useRecoilValue(store.keywordCommand);

  const [badges, setBadges] = useRecoilState(store.chatBadges);
  const [isEditingBadges, setIsEditingBadges] = useRecoilState(store.isEditingBadges);
  const [showStopButton, setShowStopButton] = useRecoilState(store.showStopButtonByIndex(index));
  const [showPlusPopover, setShowPlusPopover] = useRecoilState(store.showPlusPopoverFamily(index));
  const [showMentionPopover, setShowMentionPopover] = useRecoilState(
    store.showMentionPopoverFamily(index),
  );

  const { requiresKey } = useRequiresKey();
  const methods = useChatFormContext();
  const {
    files,
    setFiles,
    conversation,
    isSubmitting,
    filesLoading,
    newConversation,
    handleStopGenerating,
  } = useChatContext();

  // Close @mention popovers when SSE stream starts to prevent conversation state mutation
  useEffect(() => {
    if (isSubmitting) {
      setShowMentionPopover(false);
      setShowPlusPopover(false);
    }
  }, [isSubmitting, setShowMentionPopover, setShowPlusPopover]);
  const {
    generateConversation,
    conversation: addedConvo,
    setConversation: setAddedConvo,
  } = useAddedChatContext();
  const assistantMap = useAssistantsMapContext();

  const endpoint = useMemo(
    () => conversation?.endpointType ?? conversation?.endpoint,
    [conversation?.endpointType, conversation?.endpoint],
  );
  const isPI = conversation?.endpoint === 'pi';
  const conversationId = useMemo(
    () => conversation?.conversationId ?? Constants.NEW_CONVO,
    [conversation?.conversationId],
  );

  const agentId = useMemo(() => conversation?.agent_id, [conversation?.agent_id]);
  const assistantId = useMemo(() => conversation?.assistant_id, [conversation?.assistant_id]);

  const { data: agentData } = useGetAgentByIdQuery(agentId ?? '', {
    enabled: !!agentId && isAgentsEndpoint(endpoint),
  });

  const datasetIds = useMemo(() => {
    return agentData?.datasetIds;
  }, [agentData]);

  const textValue = useWatch({ control: methods.control, name: 'text' });

  const keywordQuery = useMemo<KeywordQuery | null>(() => {
    if (!keywordCommandEnabled || !datasetIds || datasetIds.length === 0) {
      return null;
    }
    const cursorPos = textAreaRef.current?.selectionStart ?? textValue.length;
    return getKeywordQuery(textValue, cursorPos);
  }, [textValue, keywordCommandEnabled, datasetIds]);

  const handleKeywordSelect = useCallback(
    (hit: VocabularyHit) => {
      if (!keywordQuery) {
        return;
      }
      const { openQuote, closeQuote, quoteIndex } = keywordQuery;
      const keywordName = hit.name;
      const definition = hit.desc || hit.definition;
      const keywordDef = `${keywordName}(属于数据集${hit.datasetId})${definition}`;

      const textArea = textAreaRef.current;
      if (!textArea) {
        return;
      }
      const value = textArea.value || '';
      const cursorPos = textArea.selectionStart ?? value.length;
      const before = value.substring(0, quoteIndex);
      const after = value.substring(cursorPos);
      // IME may auto-insert a closing quote after the cursor; skip our own closeQuote if so.
      const nextChar = after[0];
      const hasTrailingCloseQuote = nextChar != null && QUOTE_PAIRS[nextChar] != null;
      const insertion = hasTrailingCloseQuote
        ? `${openQuote}${keywordName}`
        : `${openQuote}${keywordName}${closeQuote}`;
      const newValue = before + insertion + after;

      textArea.value = newValue;
      methods.setValue('text', newValue, { shouldValidate: true });
      textArea.focus();

      const newCursorPos = before.length + insertion.length;
      setTimeout(() => {
        textArea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);

      setSelectedKeywords((prev) => {
        const exists = prev.some((k) => k.name === keywordName);
        if (exists) {
          return prev;
        }
        return [...prev, { name: keywordName, definition: keywordDef }];
      });
    },
    [keywordQuery, methods],
  );

  const isRTL = useMemo(
    () => (chatDirection != null ? chatDirection?.toLowerCase() === 'rtl' : false),
    [chatDirection],
  );
  const invalidAssistant = useMemo(
    () =>
      isAssistantsEndpoint(endpoint) &&
      (!(conversation?.assistant_id ?? '') ||
        !assistantMap?.[endpoint ?? '']?.[conversation?.assistant_id ?? '']),
    [conversation?.assistant_id, endpoint, assistantMap],
  );
  const disableInputs = useMemo(
    () => requiresKey || invalidAssistant,
    [requiresKey, invalidAssistant],
  );

  const handleContainerClick = useCallback(() => {
    /** Check if the device is a touchscreen */
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      return;
    }
    textAreaRef.current?.focus();
  }, []);

  const handleFocusOrClick = useCallback(() => {
    if (isCollapsed) {
      setIsCollapsed(false);
    }
  }, [isCollapsed]);

  useAutoSave({
    files,
    setFiles,
    textAreaRef,
    conversationId,
    isSubmitting,
  });

  const { submitMessage: originalSubmitMessage, submitPrompt } = useSubmitMessage();

  const handleSubmit = useCallback(
    (data: { text: string }) => {
      const keywordDefinitions = selectedKeywords.map((k) => k.definition);
      originalSubmitMessage({
        text: data.text,
        keywordDefinitions,
        piContextHandoff: piContextHandoffRef.current,
      });
      piContextHandoffRef.current = false;
      setSelectedKeywords([]);
    },
    [originalSubmitMessage, selectedKeywords],
  );

  const handleKeyUp = useHandleKeyUp({
    index,
    textAreaRef,
    setShowPlusPopover,
    setShowMentionPopover,
  });
  const {
    isNotAppendable,
    handlePaste,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  } = useTextarea({
    textAreaRef,
    submitButtonRef,
    setIsScrollable,
    disabled: disableInputs,
  });

  useQueryParams({ textAreaRef });

  const { ref, ...registerProps } = methods.register('text', {
    required: true,
    onChange: useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) =>
        methods.setValue('text', e.target.value, { shouldValidate: true }),
      [methods],
    ),
  });

  useEffect(() => {
    if (textAreaRef.current) {
      const style = window.getComputedStyle(textAreaRef.current);
      const lineHeight = parseFloat(style.lineHeight);
      setVisualRowCount(Math.floor(textAreaRef.current.scrollHeight / lineHeight));
    }
  }, [textValue]);

  // Detect when @AgentName is deleted from textarea and restore previous agent
  useEffect(() => {
    if (!mentionAgentRef.current) {
      return;
    }
    // Skip the first effect after selection (textValue hasn't updated yet)
    if (skipDeleteDetectRef.current) {
      skipDeleteDetectRef.current = false;
      return;
    }
    const agentTag = `@${mentionAgentRef.current}`;
    if (!textValue?.includes(agentTag)) {
      const prevId = prevAgentIdRef.current;
      const wasPiMention = isPI && piContextHandoffRef.current;
      mentionAgentRef.current = null;
      prevAgentIdRef.current = null;
      if (wasPiMention) {
        piContextHandoffRef.current = false;
      }
      if (prevId && conversation) {
        setConversation({
          ...conversation,
          agent_id: prevId,
        });
      }
    }
  }, [textValue, conversation, isPI, setConversation]);

  useEffect(() => {
    if (isEditingBadges && backupBadges.length === 0) {
      setBackupBadges([...badges]);
    }
  }, [isEditingBadges, badges, backupBadges.length]);

  const handleSaveBadges = useCallback(() => {
    setIsEditingBadges(false);
    setBackupBadges([]);
  }, [setIsEditingBadges, setBackupBadges]);

  const handleCancelBadges = useCallback(() => {
    if (backupBadges.length > 0) {
      setBadges([...backupBadges]);
    }
    setIsEditingBadges(false);
    setBackupBadges([]);
  }, [backupBadges, setBadges, setIsEditingBadges]);

  const isMoreThanThreeRows = visualRowCount > 3;

  const baseClasses = useMemo(
    () =>
      cn(
        'md:py-3.5 m-0 w-full resize-none py-[13px] placeholder-black/50 bg-transparent dark:placeholder-white/50 [&:has(textarea:focus)]:shadow-[0_2px_6px_rgba(0,0,0,.05)]',
        isCollapsed ? 'max-h-[52px]' : 'max-h-[45vh] md:max-h-[55vh]',
        isMoreThanThreeRows ? 'pl-5' : 'px-5',
      ),
    [isCollapsed, isMoreThanThreeRows],
  );

  return (
    <form
      onSubmit={methods.handleSubmit(handleSubmit)}
      className={cn(
        'mx-auto flex w-full flex-row gap-3 transition-[max-width] duration-300 sm:px-2',
        maximizeChatSpace ? 'max-w-full' : 'md:max-w-3xl xl:max-w-4xl',
        centerFormOnLanding &&
          (conversationId == null || conversationId === Constants.NEW_CONVO) &&
          !isSubmitting &&
          conversation?.messages?.length === 0
          ? 'transition-all duration-200 sm:mb-28'
          : 'sm:mb-10',
      )}
    >
      <div className="relative flex h-full flex-1 items-stretch md:flex-col">
        <div className={cn('flex w-full items-center', isRTL && 'flex-row-reverse')}>
          {showPlusPopover && !isSubmitting && !isAssistantsEndpoint(endpoint) && !isPI && (
            <Mention
              conversation={conversation}
              setShowMentionPopover={setShowPlusPopover}
              newConversation={generateConversation}
              textAreaRef={textAreaRef}
              commandChar="+"
              placeholder="com_ui_add_model_preset"
              includeAssistants={false}
            />
          )}
          {/* Don't show @mention popover during SSE stream to prevent conversation state mutation (branch bug) */}
          {showMentionPopover && !isSubmitting && (
            <Mention
              conversation={conversation}
              setShowMentionPopover={setShowMentionPopover}
              newConversation={newConversation}
              textAreaRef={textAreaRef}
              onMentionSelect={(agentName: string, agentId?: string) => {
                // Only record refs for delete-detect; onSelectMention already handles agent switch
                mentionAgentRef.current = agentName;
                prevAgentIdRef.current = conversation?.agent_id ?? null;
                skipDeleteDetectRef.current = true;
              }}
              onPiMentionSelect={() => {
                piContextHandoffRef.current = true;
              }}
            />
          )}
          <PromptsCommand index={index} textAreaRef={textAreaRef} submitPrompt={submitPrompt} />
          <div
            onClick={handleContainerClick}
            className={cn(
              'relative flex w-full flex-grow flex-col overflow-hidden rounded-t-3xl border pb-4 text-text-primary transition-all duration-200 sm:rounded-3xl sm:pb-0',
              isTextAreaFocused ? 'shadow-lg' : 'shadow-md',
              isTemporary
                ? 'border-violet-800/60 bg-violet-950/10'
                : 'border-border-light bg-surface-chat',
            )}
          >
            <TextareaHeader addedConvo={addedConvo} setAddedConvo={setAddedConvo} />
            {/* WIP */}
            <EditBadges
              isEditingChatBadges={isEditingBadges}
              handleCancelBadges={handleCancelBadges}
              handleSaveBadges={handleSaveBadges}
              setBadges={setBadges}
            />
            <FileFormChat conversation={conversation} />
            {endpoint && (
              <div className={cn('flex', isRTL ? 'flex-row-reverse' : 'flex-row')}>
                <div
                  className="relative flex-1"
                  style={
                    isCollapsed
                      ? {
                          WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 90%)',
                          maskImage: 'linear-gradient(to bottom, black 60%, transparent 90%)',
                        }
                      : undefined
                  }
                >
                  <VocabularyList
                    searchQuery={keywordQuery?.query ?? ''}
                    datasetIds={datasetIds}
                    onKeywordSelect={handleKeywordSelect}
                    onClose={() => {}}
                  />
                  <TextareaAutosize
                    {...registerProps}
                    ref={(e) => {
                      ref(e);
                      (textAreaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current =
                        e;
                    }}
                    disabled={disableInputs || isNotAppendable}
                    onPaste={handlePaste}
                    onKeyDown={handleKeyDown}
                    onKeyUp={handleKeyUp}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    id={mainTextareaId}
                    tabIndex={0}
                    data-testid="text-input"
                    rows={1}
                    onFocus={() => {
                      handleFocusOrClick();
                      setIsTextAreaFocused(true);
                    }}
                    onBlur={setIsTextAreaFocused.bind(null, false)}
                    aria-label={localize('com_ui_message_input')}
                    onClick={handleFocusOrClick}
                    style={{ height: 44, overflowY: 'auto' }}
                    className={cn(
                      baseClasses,
                      removeFocusRings,
                      'scrollbar-hover transition-[max-height] duration-200 disabled:cursor-not-allowed',
                    )}
                  />
                </div>
                <div className="flex flex-col items-start justify-start pr-2.5 pt-1.5">
                  <CollapseChat
                    isCollapsed={isCollapsed}
                    isScrollable={isMoreThanThreeRows}
                    setIsCollapsed={setIsCollapsed}
                  />
                </div>
              </div>
            )}
            <div
              className={cn(
                '@container items-between flex gap-2 pb-2',
                isRTL ? 'flex-row-reverse' : 'flex-row',
              )}
            >
              <div className={`${isRTL ? 'mr-2' : 'ml-2'}`}>
                <AttachFileChat conversation={conversation} disableInputs={disableInputs} />
              </div>
              <BadgeRow
                showEphemeralBadges={
                  !!endpoint &&
                  !isAgentsEndpoint(endpoint) &&
                  !isAssistantsEndpoint(endpoint) &&
                  !isPI
                }
                isSubmitting={isSubmitting}
                conversationId={conversationId}
                specName={conversation?.spec}
                onChange={setBadges}
                isInChat={
                  Array.isArray(conversation?.messages) && conversation.messages.length >= 1
                }
              />
              <div className="mx-auto flex" />
              {SpeechToText && (
                <AudioRecorder
                  methods={methods}
                  ask={originalSubmitMessage}
                  textAreaRef={textAreaRef}
                  disabled={disableInputs || isNotAppendable}
                  isSubmitting={isSubmitting}
                />
              )}
              <div className={`${isRTL ? 'ml-2' : 'mr-2'}`}>
                {isSubmitting && showStopButton ? (
                  <StopButton stop={handleStopGenerating} setShowStopButton={setShowStopButton} />
                ) : (
                  endpoint && (
                    <SendButton
                      ref={submitButtonRef}
                      control={methods.control}
                      disabled={filesLoading || isSubmitting || disableInputs || isNotAppendable}
                    />
                  )
                )}
              </div>
            </div>
            {TextToSpeech && automaticPlayback && <StreamAudio index={index} />}
          </div>
        </div>
      </div>
    </form>
  );
});

export default ChatForm;
