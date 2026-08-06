// Persisted UI language preference.
//
// The web UI speaks two languages: English (the source of truth) and simplified
// Chinese. The user's choice is persisted in localStorage under a single key so
// the next boot can apply it before first paint — see
// `applyLanguage` below, mirroring themePalette.ts / uiFontPreferences.ts
// (read/apply pair invoked at boot, write/apply pair on Settings change).
//
// Why not let i18next-browser-languagedetector own this entirely? Detecting
// from `navigator.language` on first boot is a fine default, but the user
// picking Chinese in Settings must override that detection on every reload —
// detector falls back to the detector order (querystring → localStorage →
// cookies → htmlTag → navigator). Persisting ourselves and feeding the value
// to i18next at boot makes the override stick regardless of the browser locale.
//
// English is stored as the absence of a key rather than the literal "en" so
// brand-new / cleared users get the existing default without a write.

const STORAGE_KEY = "omnigent:ui-language";

/** Supported UI languages. The first entry is the default (English). */
export const uiLanguages = ["en", "zh-CN"] as const;

export type UiLanguage = (typeof uiLanguages)[number];

/** Default language: matches the original (unlocalized) product copy. */
export const DEFAULT_LANGUAGE: UiLanguage = "en";

export interface LanguageMeta {
  id: UiLanguage;
  /** Native label shown in the language selector (e.g. "中文" / "English"). */
  label: string;
  /** English label used as a secondary hint (e.g. "Chinese"). */
  englishLabel: string;
}

export const LANGUAGES: readonly LanguageMeta[] = [
  { id: "en", label: "English", englishLabel: "English" },
  { id: "zh-CN", label: "中文", englishLabel: "Chinese (Simplified)" },
] as const;

/** Type guard: returns whether `value` is one of the supported language ids. */
export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && (uiLanguages as readonly string[]).includes(value);
}

/**
 * Read the persisted language.
 *
 * Returns the default when nothing is stored, on a server render (no `window`),
 * or when the stored value is missing/malformed — never throws, so a corrupt
 * entry can't break app boot.
 */
export function readLanguage(): UiLanguage {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LANGUAGE;
    const parsed: unknown = JSON.parse(raw);
    return isUiLanguage(parsed) ? parsed : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Persist the language. Storing the default removes the key so cleared
 * localStorage / new users get the default without a write. Swallows
 * quota/access errors so a failed write can't break the app.
 */
export function writeLanguage(language: UiLanguage): void {
  if (typeof window === "undefined") return;
  try {
    if (language === DEFAULT_LANGUAGE) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(language));
  } catch {
    // localStorage quota or access errors shouldn't break the app.
  }
}

/**
 * Apply the language to the DOM by setting `lang` on the document root. This
 * lets browser features (e.g. font selection, hyphenation, screen reader
 * pronunciation) respond to the language without waiting for React to render.
 * Intentionally paired with the i18next changeLanguage call — this function
 * only owns the HTML attribute side-effect.
 */
export function applyLanguage(language: UiLanguage): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
}
