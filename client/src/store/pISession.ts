import { atomFamily } from 'recoil';

export const piSessionByConvoId = atomFamily<string | null, string>({
  key: 'piSessionByConvoId',
  default: null,
});
