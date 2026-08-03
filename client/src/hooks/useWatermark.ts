import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { useGetStartupConfig } from '~/data-provider';
import { formatWatermark } from '~/utils/watermark';
import type { WatermarkStyleOptions } from '~/utils/watermark';
import store from '~/store';

export type WatermarkState = {
  chat: boolean;
  artifacts: boolean;
  text: string;
  style: WatermarkStyleOptions;
};

/**
 * Reads watermark configuration (from startup config) together with the current
 * user, returning the resolved watermark text plus per-surface enable flags.
 * `chat`/`artifacts` are only `true` when the surface is enabled AND a non-empty
 * watermark text can be produced, so callers can simply branch on the flag.
 */
export function useWatermark(): WatermarkState {
  const { data: startupConfig } = useGetStartupConfig();
  const user = useRecoilValue(store.user);
  const config = startupConfig?.watermark;

  const text = useMemo(() => formatWatermark(config?.template, user), [config?.template, user]);
  const enabled = !!text;

  const style = useMemo<WatermarkStyleOptions>(
    () => ({
      opacity: config?.opacity,
      fontSize: config?.fontSize,
      density: config?.density,
      rotation: config?.rotation,
    }),
    [config?.opacity, config?.fontSize, config?.density, config?.rotation],
  );

  return useMemo(
    () => ({
      chat: enabled && !!config?.chat,
      artifacts: enabled && !!config?.artifacts,
      text,
      style,
    }),
    [enabled, config?.chat, config?.artifacts, text, style],
  );
}
