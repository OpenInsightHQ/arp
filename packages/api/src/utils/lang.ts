import type { ServerRequest } from '~/types';

const LANG_TEXT_ZH = '请用中文进行答复';
const LANG_TEXT_EN = 'Please respond in English';

/**
 * Resolves the `{{lang}}` replacement text for the given language code.
 *
 * Chinese locales (`zh*`) return a Chinese instruction; all other locales
 * (including missing/unrecognized values) default to English.
 *
 * @param lang - Language code from the client (e.g. `zh-Hans`, `en`, `en-US`).
 */
export function getLangText(lang?: string | null): string {
  if (!lang) {
    return LANG_TEXT_EN;
  }
  const normalized = lang.toLowerCase();
  if (normalized.startsWith('zh')) {
    return LANG_TEXT_ZH;
  }
  return LANG_TEXT_EN;
}

/**
 * Extracts the user's language code from an Express request.
 *
 * Checks the `lang` cookie first, then falls back to the `accept-language` header.
 *
 * @returns The language code string, or an empty string when none is available.
 */
export function getLangFromReq(req: ServerRequest): string {
  const cookies = req.cookies as Record<string, string> | undefined;
  if (cookies?.lang) {
    return cookies.lang;
  }
  const acceptLang = req.headers['accept-language'];
  if (typeof acceptLang === 'string' && acceptLang.length > 0) {
    return acceptLang.split(',')[0].trim();
  }
  return '';
}

/**
 * Replaces all `{{lang}}` occurrences in the given text using the request's language.
 *
 * @returns The text with `{{lang}}` replaced, or the original text if not present.
 */
export function replaceLangVar(text: string, req: ServerRequest): string {
  if (!text || !/{{lang}}/i.test(text)) {
    return text;
  }
  return text.replace(/{{lang}}/gi, getLangText(getLangFromReq(req)));
}
