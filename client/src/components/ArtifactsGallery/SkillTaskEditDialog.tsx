/* eslint-disable i18next/no-literal-string */
import * as Dialog from '@radix-ui/react-dialog';
import type { GallerySkillTask } from 'librechat-data-provider';
import { cn } from '~/utils';
import { useLocalize } from '~/hooks';

const frequencyOptions: Array<{ value: GallerySkillTask['frequency']; labelKey: string }> = [
  { value: 'minute', labelKey: 'com_skill_minutes' },
  { value: 'hourly', labelKey: 'com_skill_hours' },
  { value: 'daily', labelKey: 'com_skill_daily' },
  { value: 'weekly', labelKey: 'com_skill_weekly' },
  { value: 'monthly', labelKey: 'com_skill_monthly' },
];

export default function SkillTaskEditDialog({
  task,
  open,
  isSaving,
  onOpenChange,
  onChange,
  onSave,
}: {
  task: GallerySkillTask | null;
  open: boolean;
  isSaving?: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (task: GallerySkillTask) => void;
  onSave: () => void;
}) {
  const localize = useLocalize();
  const canSave = Boolean(task?.taskName.trim()) && !isSaving;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 dark:bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#1f1f1f] dark:text-white">
          <Dialog.Title className="text-lg font-semibold">{localize('com_skill_edit_task')}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-text-secondary dark:text-gray-300">
            {localize('com_skill_edit_task_desc')}
          </Dialog.Description>

          {task ? (
            <div className="mt-5 space-y-5">
              <label className="block">
                <span className="text-sm font-medium text-text-primary dark:text-white">{localize('com_skill_task_name')}</span>
                <input
                  value={task.taskName}
                  onChange={(event) => onChange({ ...task, taskName: event.target.value })}
                  className="mt-2 h-10 w-full rounded-lg bg-[#f5f5f7] px-3 text-sm text-text-primary outline-none dark:bg-[#2a2a2a] dark:text-white"
                />
              </label>

              <div>
                <div className="text-sm font-medium text-text-primary dark:text-white">{localize('com_skill_frequency')}</div>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {frequencyOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onChange({ ...task, frequency: option.value })}
                      className={cn(
                        'h-10 rounded-lg text-sm font-medium transition',
                        task.frequency === option.value
                          ? 'bg-[#7948ea] text-white'
                          : 'bg-[#f5f5f7] text-text-secondary hover:bg-surface-active-alt dark:bg-[#2a2a2a] dark:text-gray-200 dark:hover:bg-[#333333]',
                      )}
                    >
                      {localize(option.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {task.frequency === 'minute' || task.frequency === 'hourly' ? (
                <label className="block">
                  <span className="text-sm font-medium text-text-primary dark:text-white">{localize('com_skill_interval')}</span>
                  <input
                    type="number"
                    min="1"
                    value={task.interval || (task.frequency === 'minute' ? 30 : 1)}
                    onChange={(event) => onChange({ ...task, interval: Number(event.target.value) })}
                    className="mt-2 h-10 w-full rounded-lg bg-[#f5f5f7] px-3 text-sm text-text-primary outline-none dark:bg-[#2a2a2a] dark:text-white"
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="text-sm font-medium text-text-primary dark:text-white">{localize('com_skill_schedule_time')}</span>
                  <input
                    type="time"
                    value={task.scheduleTime || '09:00'}
                    onChange={(event) => onChange({ ...task, scheduleTime: event.target.value })}
                    className="mt-2 h-10 w-full rounded-lg bg-[#f5f5f7] px-3 text-sm text-text-primary outline-none dark:bg-[#2a2a2a] dark:text-white"
                  />
                </label>
              )}
            </div>
          ) : null}

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="h-9 rounded-lg px-4 text-sm font-medium text-text-secondary hover:bg-surface-secondary dark:text-gray-200 dark:hover:bg-[#303030]">
                {localize('com_skill_cancel')}
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={!canSave}
              onClick={onSave}
              className="h-9 rounded-lg bg-[#7948ea] px-4 text-sm font-medium text-white hover:bg-[#6d3fda] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? localize('com_skill_saving') : localize('com_skill_save')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
