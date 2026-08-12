import { useState, useRef, useEffect, useMemo } from 'react';
import { useCombobox } from '@librechat/client';
import { AutoSizer, List } from 'react-virtualized';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import type { MentionOption, ConvoGenerator } from '~/common';
import type { SetterOrUpdater } from 'recoil';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { useLocalize, TranslationKeys } from '~/hooks';
import { useAssistantsMapContext } from '~/Providers';
import useMentions from '~/hooks/Input/useMentions';
import { removeCharIfLast } from '~/utils';
import MentionItem from './MentionItem';

const ROW_HEIGHT = 44;

export default function Mention({
  conversation,
  setShowMentionPopover,
  newConversation,
  textAreaRef,
  commandChar = '@',
  placeholder = 'com_ui_mention',
  includeAssistants = true,
  onMentionSelect,
}: {
  conversation: TConversation | null;
  setShowMentionPopover: SetterOrUpdater<boolean>;
  newConversation: ConvoGenerator;
  textAreaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  commandChar?: string;
  placeholder?: TranslationKeys;
  includeAssistants?: boolean;
  onMentionSelect?: (agentName: string, agentId?: string) => void;
}) {
  const localize = useLocalize();
  const assistantsMap = useAssistantsMapContext();
  const {
    options,
    presets,
    modelSpecs,
    agentsList,
    modelsConfig,
    endpointsConfig,
    assistantListMap,
    piMentionOption,
  } = useMentions({ assistantMap: assistantsMap || {}, includeAssistants });
  const { onSelectMention } = useSelectMention({
    presets,
    modelSpecs,
    conversation,
    assistantsMap,
    endpointsConfig,
    newConversation,
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // For @: only show agents. For +: show all options (original behavior)
  const isAtMention = commandChar === '@';
  const baseOptions = useMemo(
    () =>
      isAtMention
        ? [...(agentsList ?? []), ...(piMentionOption ? [piMentionOption] : [])]
        : options,
    [isAtMention, agentsList, options, piMentionOption],
  );
  const [inputOptions, setInputOptions] = useState<MentionOption[]>(baseOptions);

  const { open, setOpen, searchValue, setSearchValue, matches } = useCombobox({
    value: '',
    options: inputOptions,
  });

  const handleSelect = (mention?: MentionOption) => {
    if (!mention) {
      return;
    }

    const defaultSelect = () => {
      const agentName = mention.label || mention.value || '';
      setSearchValue('');
      setOpen(false);
      setShowMentionPopover(false);

      // For @ mention with agent or pi: call onSelectMention for full switch, then onMentionSelect to record refs for delete-detect
      if (isAtMention && (mention.type === EModelEndpoint.agents || mention.type === 'pi')) {
        onSelectMention?.(mention);
        onMentionSelect?.(agentName, mention.value);
      } else {
        onSelectMention?.(mention);
      }

      if (textAreaRef.current) {
        const textarea = textAreaRef.current;
        const text = textarea.value;
        const lastAtIndex = text.lastIndexOf(commandChar);
        if (lastAtIndex !== -1) {
          // Replace @ with @AgentName
          const newText =
            text.slice(0, lastAtIndex) +
            `${commandChar}${agentName} ` +
            text.slice(lastAtIndex + 1);
          textarea.value = newText;
          const cursorPos = lastAtIndex + commandChar.length + agentName.length + 1;
          textarea.setSelectionRange(cursorPos, cursorPos);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        textarea.focus();
      }
    };

    if (mention.type === 'endpoint' && mention.value === EModelEndpoint.agents) {
      setSearchValue('');
      setInputOptions(agentsList ?? []);
      setActiveIndex(0);
      inputRef.current?.focus();
    } else if (mention.type === 'endpoint' && mention.value === EModelEndpoint.assistants) {
      setSearchValue('');
      setInputOptions(assistantListMap[EModelEndpoint.assistants] ?? []);
      setActiveIndex(0);
      inputRef.current?.focus();
    } else if (mention.type === 'endpoint' && mention.value === EModelEndpoint.azureAssistants) {
      setSearchValue('');
      setInputOptions(assistantListMap[EModelEndpoint.azureAssistants] ?? []);
      setActiveIndex(0);
      inputRef.current?.focus();
    } else if (mention.type === 'endpoint') {
      const models = (modelsConfig?.[mention.value || ''] ?? []).map((model) => ({
        value: mention.value,
        label: model,
        type: 'model',
      }));

      setActiveIndex(0);
      setSearchValue('');
      setInputOptions(models);
      inputRef.current?.focus();
    } else {
      defaultSelect();
    }
  };

  // Sync inputOptions when baseOptions changes (handles async agentsList load)
  useEffect(() => {
    setInputOptions(baseOptions);
    setActiveIndex(0);
  }, [baseOptions]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const type = commandChar !== '@' ? 'add-convo' : 'mention';
  useEffect(() => {
    const currentActiveItem = document.getElementById(`${type}-item-${activeIndex}`);
    currentActiveItem?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }, [type, activeIndex]);

  const rowRenderer = ({
    index,
    key,
    style,
  }: {
    index: number;
    key: string;
    style: React.CSSProperties;
  }) => {
    const mention = matches[index] as MentionOption;
    return (
      <MentionItem
        type={type}
        index={index}
        key={key}
        style={style}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Use mousedown instead of click to prevent onBlur from closing the popover first
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          handleSelect(mention);
        }}
        name={mention.label ?? ''}
        icon={mention.icon}
        description={mention.description}
        isActive={index === activeIndex}
      />
    );
  };

  return (
    <div className="absolute bottom-28 z-10 w-full space-y-2">
      <div className="popover border-token-border-light rounded-2xl border bg-white p-2 shadow-lg dark:bg-gray-700">
        <input
          // The user expects focus to transition to the input field when the popover is opened
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          ref={inputRef}
          placeholder={localize(placeholder)}
          className="mb-1 w-full border-0 bg-white p-2 text-sm focus:outline-none dark:bg-gray-700 dark:text-gray-200"
          autoComplete="off"
          value={searchValue}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setShowMentionPopover(false);
              textAreaRef.current?.focus();
            }
            if (e.key === 'ArrowDown') {
              setActiveIndex((prevIndex) => (prevIndex + 1) % matches.length);
            } else if (e.key === 'ArrowUp') {
              setActiveIndex((prevIndex) => (prevIndex - 1 + matches.length) % matches.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              const mentionOption = matches[activeIndex] as MentionOption | undefined;
              if (mentionOption?.type === 'endpoint') {
                e.preventDefault();
              } else if (e.key === 'Enter') {
                e.preventDefault();
              }
              handleSelect(matches[activeIndex] as MentionOption);
            } else if (e.key === 'Backspace' && searchValue === '') {
              setOpen(false);
              setShowMentionPopover(false);
              textAreaRef.current?.focus();
            }
          }}
          onChange={(e) => setSearchValue(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            timeoutRef.current = setTimeout(() => {
              setOpen(false);
              setShowMentionPopover(false);
            }, 150);
          }}
        />
        {open && (
          <div className="max-h-40">
            <AutoSizer disableHeight>
              {({ width }) => (
                <List
                  width={width}
                  overscanRowCount={5}
                  rowHeight={ROW_HEIGHT}
                  rowCount={matches.length}
                  rowRenderer={rowRenderer}
                  scrollToIndex={activeIndex}
                  height={Math.min(matches.length * ROW_HEIGHT, 160)}
                />
              )}
            </AutoSizer>
          </div>
        )}
      </div>
    </div>
  );
}
