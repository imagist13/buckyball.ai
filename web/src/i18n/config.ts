// i18n bootstrap.
//
// Owns the i18next instance: detection, resource registration, fallback, and
// the side-effect of mirroring the active language onto <html lang="..."> so
// browser features (font selection, hyphenation, screen-reader pronunciation)
// respond without waiting for React to render.
//
// Design choices:
//
// 1. Resources are inlined (no `i18next-http-backend`). Translation files are
//    small and shipped in the main bundle, so we save a request and avoid
//    Suspense flicker at boot. Tradeoff: a future "many languages" build
//    should swap this for backend-loaded JSON.
//
// 2. `useSuspense: false` per `useTranslation` call site. We don't load
//    remotely, so there's nothing to suspend on; the flag prevents the
//    "blank screen while translations load" footgun.
//
// 3. `fallbackLng: 'en'`. Every missing key (in zh-CN) falls back to English
//    rather than the key itself, so untranslated Chinese surfaces English
//    copy instead of e.g. "settings.appearance.title".
//
// 4. `interpolation.escapeValue: false`. React already escapes interpolated
//    children, so i18next's escape pass would double-escape (`&amp;` etc.).
//
// 5. The user's persisted language wins over the browser locale. Detector
//    order is localStorage → navigator.language, so `readLanguage()` runs
//    before `i18next.use(LanguageDetector)` orders the lookup. (Detector
//    also reads localStorage directly under an internal key, but we feed
//    it our own value so the storage key stays in one place.)
//
// 6. The `languageChanged` listener calls `applyLanguage` so the DOM
//    `<html lang>` attribute tracks the active language inside the tab —
//    no React effect needed.

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import {
  applyLanguage,
  DEFAULT_LANGUAGE,
  isUiLanguage,
  readLanguage,
  type UiLanguage,
  uiLanguages,
} from "@/lib/languagePreferences";
import { common, sidebar, settings, chat, auth, tasks, inbox } from "./locales/en";
import {
  common as commonZh,
  sidebar as sidebarZh,
  settings as settingsZh,
  chat as chatZh,
  auth as authZh,
  tasks as tasksZh,
  inbox as inboxZh,
} from "./locales/zh-CN";

export const SUPPORTED_LANGUAGES = uiLanguages;
export const FALLBACK_LANGUAGE: UiLanguage = DEFAULT_LANGUAGE;

/**
 * Translation namespaces. Order matters for `nsMode: 'fallback'` — a missing
 * key in the primary namespace falls back to the next one's value before
 * hitting the English fallback. We always use the explicit `ns: 'common'`
 * form in components, so the order is just documentation here.
 */
export const NAMESPACES = ["common", "sidebar", "settings", "chat", "auth", "tasks", "inbox"] as const;
export type Namespace = (typeof NAMESPACES)[number];
export const DEFAULT_NAMESPACE: Namespace = "common";

function readStoredLanguage(): UiLanguage {
  const stored = readLanguage();
  return isUiLanguage(stored) ? stored : FALLBACK_LANGUAGE;
}

export const resources = {
  en: {
    common,
    sidebar,
    settings,
    chat,
    auth,
    tasks,
    inbox,
  },
  "zh-CN": {
    common: commonZh,
    sidebar: sidebarZh,
    settings: settingsZh,
    chat: chatZh,
    auth: authZh,
    tasks: tasksZh,
    inbox: inboxZh,
  },
} as const;

let initialized = false;

/**
 * Initialize the i18next instance synchronously. Safe to call multiple times —
 * subsequent calls are no-ops so test harnesses that re-import the module
 * don't double-init.
 */
export function initI18n(): typeof i18n {
  if (initialized) return i18n;
  initialized = true;

  // Apply the language to <html lang> before init so the very first paint
  // already has the right attribute. i18next also calls this on
  // `languageChanged`, but the pre-init paint wouldn't see that.
  applyLanguage(readStoredLanguage());

  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      lng: readStoredLanguage(),
      fallbackLng: FALLBACK_LANGUAGE,
      supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
      ns: [...NAMESPACES],
      defaultNS: DEFAULT_NAMESPACE,
      // Strings in components are written as `t('namespace.key')` (e.g.
      // `t('sidebar.chat')`) so the ns prefix is part of the key itself.
      // Empty this out so i18next doesn't try to infer a namespace from the
      // first colon-separated segment.
      keySeparator: ".",
      nsSeparator: false,
      interpolation: {
        escapeValue: false,
      },
      detection: {
        // Lookup order: localStorage (our key) → navigator → hard fallback.
        // We pre-populate `lng` from `readLanguage()` above, but the
        // detector still re-asserts here so a fresh user with no stored
        // value gets the browser locale.
        order: ["localStorage", "navigator"],
        caches: [],
        lookupLocalStorage: "omnigent:ui-language-detector",
      },
      returnEmptyString: false,
      returnNull: false,
    });

  // Keep <html lang> in sync. i18next's built-in `react` option already
  // updates the attribute on `languageChanged`, but we add an explicit
  // listener so `applyLanguage` (the same function called at boot) is the
  // single source of the DOM side-effect.
  i18n.on("languageChanged", (lng) => {
    if (isUiLanguage(lng)) applyLanguage(lng);
  });

  return i18n;
}

export default i18n;
