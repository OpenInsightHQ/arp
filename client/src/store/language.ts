import Cookies from 'js-cookie';
import { atomWithLocalStorage } from './utils';

const LANG_STORAGE_KEY = 'librechat_lang';

const isValidLangString = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(value);

const extractLangValue = (raw: string): string | null => {
  try {
    const parsed = JSON.parse(raw);
    if (isValidLangString(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object' && 'v' in parsed) {
      const inner = typeof parsed.v === 'string' ? JSON.parse(parsed.v) : parsed.v;
      if (isValidLangString(inner)) {
        return inner;
      }
    }
  } catch {
    if (isValidLangString(raw)) {
      return raw;
    }
  }
  return null;
};

const defaultLang = () => {
  const cookieLang = Cookies.get('lang');
  if (cookieLang) {
    const extracted = extractLangValue(cookieLang);
    if (extracted) {
      return extracted;
    }
  }

  const localLang = localStorage.getItem(LANG_STORAGE_KEY);
  if (localLang) {
    const extracted = extractLangValue(localLang);
    if (extracted) {
      return extracted;
    }
  }

  const documentLang = document.documentElement.lang;
  if (documentLang && documentLang !== 'en' && documentLang !== 'en-US') {
    return documentLang;
  }

  return navigator.language || navigator.languages[0];
};

const lang = atomWithLocalStorage(LANG_STORAGE_KEY, defaultLang());

export default { lang };
