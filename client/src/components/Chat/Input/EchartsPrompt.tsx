import React, { memo, useCallback } from 'react';
import { LineChart } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { useLocalize } from '~/hooks';
import useEchartsPrompt from '~/hooks/useEchartsPrompt';

function EchartsPrompt() {
  const localize = useLocalize();
  const { enabled, setEnabled, isPinned } = useEchartsPrompt();

  const handleToggle = useCallback(
    ({ value }: { value: boolean | string }) => {
      setEnabled(value === true);
    },
    [setEnabled],
  );

  if (!enabled && !isPinned) {
    return null;
  }

  return (
    <CheckboxButton
      className="max-w-fit"
      checked={enabled}
      setValue={handleToggle}
      label={localize('com_ui_echarts')}
      isCheckedClassName="border-cyan-600/40 bg-cyan-500/10 hover:bg-cyan-700/10"
      icon={<LineChart className="icon-md" aria-hidden="true" />}
    />
  );
}

export default memo(EchartsPrompt);
