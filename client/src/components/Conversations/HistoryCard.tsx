import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Trash2, Pin, Pen } from 'lucide-react';
import { Checkbox, useToastContext } from '@librechat/client';
import type { TConversation } from 'librechat-data-provider';
import { useUpdateConversationMutation } from '~/data-provider';
import { useLocalize, useNavigateToConvo } from '~/hooks';
import { NotificationSeverity } from '~/common';
import RenameForm from './RenameForm';
import { cn, logger } from '~/utils';

interface HistoryCardProps {
  conversation: TConversation;
  groupName: string;
  formatDate: (date: string, groupName: string) => string;
  onTogglePin: (e: React.MouseEvent, conversationId: string) => void;
  onDelete: (e: React.MouseEvent, conversationId: string) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (conversationId: string) => void;
}

export default function HistoryCard({
  conversation,
  groupName,
  formatDate,
  onTogglePin,
  onDelete,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
}: HistoryCardProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { navigateToConvo } = useNavigateToConvo();
  const { conversationId, title = '' } = conversation;
  const updateConvoMutation = useUpdateConversationMutation(conversationId ?? '');

  const [renaming, setRenaming] = useState(false);
  const [titleInput, setTitleInput] = useState(title || '');
  const previousTitle = useRef(title);

  useEffect(() => {
    if (title !== previousTitle.current) {
      setTitleInput(title as string);
      previousTitle.current = title;
    }
  }, [title]);

  useEffect(() => {
    if (isSelectionMode && renaming) {
      setRenaming(false);
      setTitleInput(title as string);
    }
  }, [isSelectionMode, renaming, title]);

  const handleRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTitleInput(title as string);
    setRenaming(true);
  };

  const handleRenameSubmit = async (newTitle: string) => {
    if (!conversationId || newTitle === title) {
      setRenaming(false);
      return;
    }

    try {
      await updateConvoMutation.mutateAsync({
        conversationId,
        title: newTitle.trim() || localize('com_ui_untitled'),
      });
      setRenaming(false);
    } catch (error) {
      logger.error('Error renaming conversation', error);
      setTitleInput(title as string);
      showToast({
        message: localize('com_ui_rename_failed'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
      setRenaming(false);
    }
  };

  const handleCancelRename = () => {
    setTitleInput(title as string);
    setRenaming(false);
  };

  const handleCardActivate = () => {
    if (renaming) {
      return;
    }
    if (isSelectionMode && conversationId && onToggleSelect) {
      onToggleSelect(conversationId);
      return;
    }
    navigateToConvo(conversation);
  };

  return (
    <div
      className={cn(
        'group relative cursor-pointer rounded-2xl border border-border-light bg-surface-secondary p-5 transition-all duration-200 hover:border-[#7948ea]/30 hover:shadow-md',
        renaming && 'cursor-default',
        isSelected && 'border-[#7948ea] bg-[#7948ea]/5 hover:border-[#7948ea]',
      )}
      role="button"
      tabIndex={renaming ? -1 : 0}
      aria-pressed={isSelectionMode ? isSelected : undefined}
      onClick={handleCardActivate}
      onKeyDown={(e) => {
        if (renaming) {
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardActivate();
        }
      }}
    >
      {renaming && !isSelectionMode && (
        <RenameForm
          titleInput={titleInput}
          setTitleInput={setTitleInput}
          onSubmit={handleRenameSubmit}
          onCancel={handleCancelRename}
          localize={localize}
          className="rounded-2xl"
        />
      )}
      <div className={cn(renaming && !isSelectionMode && 'invisible')}>
        <div className="mb-3 flex items-start gap-3">
          {isSelectionMode && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => {
                if (conversationId && onToggleSelect) {
                  onToggleSelect(conversationId);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              aria-label={localize('com_ui_select_row')}
              className="mt-1"
            />
          )}
          <h3 className="line-clamp-2 flex-1 pr-2 text-base font-medium text-text-primary">
            {title || localize('com_ui_untitled')}
          </h3>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">
            {formatDate(conversation.updatedAt || '', groupName)}
          </span>
          {conversation.messages && conversation.messages.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-secondary">
              <MessageSquare className="size-3" />
              {conversation.messages.length}
            </span>
          )}
        </div>
        {!isSelectionMode && (
          <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={handleRename}
              className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-[#7948ea]"
              aria-label={localize('com_ui_rename')}
              title={localize('com_ui_rename')}
            >
              <Pen className="size-4" />
            </button>
            <button
              type="button"
              onClick={(e) => onTogglePin(e, conversationId ?? '')}
              className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-[#7948ea]"
              aria-label={localize('com_ui_pin')}
              title={localize('com_ui_pin')}
            >
              <Pin className="size-4" />
            </button>
            <button
              type="button"
              onClick={(e) => onDelete(e, conversationId ?? '')}
              className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
              aria-label={localize('com_ui_delete')}
              title={localize('com_ui_delete')}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
