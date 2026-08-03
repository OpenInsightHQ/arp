import { useState, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { freezeModeState } from '~/store/freezeMode';

const SNIPPET_LENGTH = 80;

function extractSnippet(message: { text?: string; content?: unknown }): string {
  if (message.text) {
    return message.text;
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
    }
  }
  return '';
}

function buildSkillInstruction(
  skillName: string,
  skillDescription: string,
  skillParameters: string,
  startSnippet: string,
  endSnippet: string,
): string {
  const paramsLine = skillParameters.trim() ? `参数：${skillParameters.trim()}` : '参数：无';

  return [
    '请将当前会话中指定范围的对话固化为技能。',
    '',
    `技能名称：${skillName}`,
    `技能描述：${skillDescription}`,
    paramsLine,
    '',
    '对话范围（请根据以下内容锚点在你的上下文中定位，无需我重新发送完整内容）：',
    `起始消息开头：「${startSnippet}…」`,
    `结束消息开头：「${endSnippet}…」`,
    '',
    '请基于起始消息到结束消息之间的全部对话内容（含工具调用与中间过程）创建上述技能。若该范围内的内容不在你的上下文中，请说明。',
  ].join('\n');
}

export default function FreezeConfirmPanel() {
  const localize = useLocalize();
  const { ask, getMessages } = useChatContext();
  const [freezeState, setFreezeState] = useRecoilState(freezeModeState);
  const { startMsgId, endMsgId } = freezeState;
  const [skillName, setSkillName] = useState('');
  const [skillDescription, setSkillDescription] = useState('');
  const [skillParameters, setSkillParameters] = useState('');

  const resetForm = useCallback(() => {
    setFreezeState({
      isFreezeMode: false,
      startMsgId: null,
      endMsgId: null,
    });
    setSkillName('');
    setSkillDescription('');
    setSkillParameters('');
  }, [setFreezeState]);

  const handleConfirm = useCallback(() => {
    if (!startMsgId || !endMsgId || !skillName.trim() || !skillDescription.trim()) {
      return;
    }

    const messages = getMessages();
    if (!messages) {
      return;
    }

    const startIndex = messages.findIndex((m) => m.messageId === startMsgId);
    const endIndex = messages.findIndex((m) => m.messageId === endMsgId);

    if (startIndex === -1 || endIndex === -1) {
      return;
    }

    const minIdx = Math.min(startIndex, endIndex);
    const maxIdx = Math.max(startIndex, endIndex);

    const startSnippet = extractSnippet(messages[minIdx]).slice(0, SNIPPET_LENGTH).trim();
    const endSnippet = extractSnippet(messages[maxIdx]).slice(0, SNIPPET_LENGTH).trim();

    if (!startSnippet || !endSnippet) {
      return;
    }

    const instruction = buildSkillInstruction(
      skillName.trim(),
      skillDescription.trim(),
      skillParameters.trim(),
      startSnippet,
      endSnippet,
    );

    ask({ text: instruction });
    resetForm();
  }, [
    startMsgId,
    endMsgId,
    skillName,
    skillDescription,
    skillParameters,
    getMessages,
    ask,
    resetForm,
  ]);

  const handleCancel = useCallback(() => {
    resetForm();
  }, [resetForm]);

  if (!startMsgId || !endMsgId) {
    return null;
  }

  const canSubmit = skillName.trim().length > 0 && skillDescription.trim().length > 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border-light bg-surface-primary p-4 shadow-lg">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <span>✨</span>
          <span>{localize('com_freeze_confirm_title')}</span>
        </div>
        <input
          type="text"
          value={skillName}
          onChange={(e) => setSkillName(e.target.value)}
          placeholder={localize('com_freeze_skill_name_placeholder')}
          className="w-full rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-[#7948ea] focus:outline-none focus:ring-1 focus:ring-[#7948ea]"
        />
        <textarea
          value={skillDescription}
          onChange={(e) => setSkillDescription(e.target.value)}
          placeholder={localize('com_freeze_skill_desc_placeholder')}
          rows={2}
          className="w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-[#7948ea] focus:outline-none focus:ring-1 focus:ring-[#7948ea]"
        />
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-secondary">
            {localize('com_freeze_skill_params_label')}
          </label>
          <textarea
            value={skillParameters}
            onChange={(e) => setSkillParameters(e.target.value)}
            placeholder={localize('com_freeze_skill_params_placeholder')}
            rows={2}
            className="w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-[#7948ea] focus:outline-none focus:ring-1 focus:ring-[#7948ea]"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleCancel}
            className="rounded-lg border border-border-light px-4 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-hover"
          >
            {localize('com_freeze_cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="rounded-lg px-4 py-1.5 text-sm text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: '#7948ea' }}
          >
            {localize('com_freeze_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
