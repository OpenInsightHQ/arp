import { atom } from 'recoil';

export const freezeModeState = atom({
  key: 'freezeModeState',
  default: {
    isFreezeMode: false,
    startMsgId: null as string | null,
    endMsgId: null as string | null,
  },
});
