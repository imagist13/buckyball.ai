import en, { type TranslationKey } from './en';
import zh from './zh';

export type { TranslationKey };

export type Locale = 'en' | 'zh';

export const SUPPORTED_LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  zh,
};

/**
 * Translate a key with optional parameter interpolation.
 * Fallback chain: target locale → English → raw key.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[locale] ?? en;
  let text = dict[key] ?? en[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}

// ── Active locale for non-React modules ────────────────────────────
//
// The locale lives in I18nContext, which plain modules can't read. SSE status
// notifications are localized in `maybeShowStatusToast` (a module function
// shared by useSSEStream and the inline parser in app/chat/page.tsx), so they
// need the current locale without threading `t` through every callback object.
// I18nProvider publishes it here on every change — same module-registry pattern
// the browser toast registry already uses. 'en' until the provider mounts,
// which matches I18nContext's own default.
let activeLocale: Locale = 'en';

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

/** `translate` against whatever locale I18nProvider last published. */
export function translateActive(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  return translate(activeLocale, key, params);
}
