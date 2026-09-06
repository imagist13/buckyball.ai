/**
 * Phase 5B — isomorphic Shiki tokenization core.
 *
 * This is the single implementation of "turn source into themed tokens"
 * shared by BOTH sides of the Phase 5B seam:
 *   - the Web Worker (`shiki.worker.ts`) runs it off the main thread on the
 *     happy path, and
 *   - the main thread (`code-block.tsx`) runs it as the fallback when the
 *     worker is unavailable or a tokenize RPC fails.
 *
 * Keeping ONE engine means worker output and fallback output can't drift.
 * The engine faithfully reproduces the pre-5B main-thread behavior:
 *   - per-`lang:light:dark` highlighter cache (bounded LRU),
 *   - lazy bundledLanguages check to normalize unknown langs to "text",
 *   - createHighlighter failure → fall back to text + (if the *theme* may be
 *     the problem) default themes, never infinite-retrying the same theme,
 *   - getLoadedLanguages() guard before codeToTokens so an unloaded grammar
 *     degrades to plain "text" instead of throwing.
 *
 * Deliberately isomorphic: imports only `shiki` (works in node/worker/DOM)
 * and a pure LRU map. It must NOT import React, theme style bundles
 * (react-syntax-highlighter), or anything DOM-only, so the worker chunk
 * stays lean and node unit tests can drive it directly.
 */

import type {
  BundledLanguage,
  BundledTheme,
  HighlighterGeneric,
  ThemedToken,
} from "shiki";
// Relative (not `@/`) import so the worker module graph resolves without
// relying on tsconfig path aliases inside the Worker build environment.
import { LRUMap } from "../../lib/lru-map";

/** Internal tokenized shape rendered by TokenSpan/LineSpan and shimmed to
 *  Streamdown's TokensResult by `toTokensResult`. Structured-clone safe, so
 *  it crosses the worker boundary via postMessage unchanged. */
export interface TokenizedCode {
  tokens: ThemedToken[][];
  fg: string;
  bg: string;
}

type ShikiHighlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;

/** Only the two shiki entry points the engine needs, injected so the engine
 *  stays testable (real shiki in node) and the worker/main can each supply
 *  their own lazily-loaded shiki. */
export interface HighlightEngineDeps {
  createHighlighter: (options: {
    langs: BundledLanguage[];
    themes: BundledTheme[];
  }) => Promise<ShikiHighlighter>;
  /** Resolves shiki's `bundledLanguages` map (lang → dynamic import thunk).
   *  Used only to normalize unknown langs to "text" before hitting shiki. */
  loadBundledLanguages: () => Promise<Record<string, unknown>>;
  defaultLight: BundledTheme;
  defaultDark: BundledTheme;
  /** Highlighter LRU capacity. Defaults to 10 (matches pre-5B main thread). */
  highlighterCacheSize?: number;
}

export interface HighlightEngine {
  tokenize(
    code: string,
    language: BundledLanguage,
    lightTheme: BundledTheme,
    darkTheme: BundledTheme,
  ): Promise<TokenizedCode>;
}

export function createHighlightEngine(deps: HighlightEngineDeps): HighlightEngine {
  const { createHighlighter, loadBundledLanguages, defaultLight, defaultDark } = deps;
  const highlighterCache = new LRUMap<string, Promise<ShikiHighlighter>>(
    deps.highlighterCacheSize ?? 10,
  );

  // Lazily-loaded bundledLanguages map, kept null until first resolved. While
  // null, isBundledLanguage() stays permissive and lets createHighlighter's
  // catch handle any truly-unknown language.
  let bundledLanguages: Record<string, unknown> | null = null;

  function ensureBundledLanguages(): void {
    if (bundledLanguages) return;
    // Fire-and-forget: resolves for future calls. Failures leave the map null,
    // which only makes isBundledLanguage() more permissive (safe).
    loadBundledLanguages()
      .then((mod) => {
        bundledLanguages = mod;
      })
      .catch(() => {});
  }

  function isBundledLanguage(lang: string): lang is BundledLanguage {
    if (!bundledLanguages) return true;
    return lang in bundledLanguages || lang === "text" || lang === "plaintext";
  }

  function getHighlighter(
    language: BundledLanguage,
    lightTheme: BundledTheme,
    darkTheme: BundledTheme,
  ): Promise<ShikiHighlighter> {
    ensureBundledLanguages();

    // Normalize unknown languages to "text" before hitting Shiki.
    const safeLang = isBundledLanguage(language)
      ? language
      : ("text" as BundledLanguage);
    const cacheKey = `${safeLang}:${lightTheme}:${darkTheme}`;

    const cached = highlighterCache.get(cacheKey);
    if (cached) return cached;

    const highlighterPromise = createHighlighter({
      langs: [safeLang],
      themes: [lightTheme, darkTheme],
    }).catch(() => {
      // Language or theme not supported — fall back to plain text + default
      // themes. Using default themes avoids infinite retry if the *theme* was
      // the problem.
      highlighterCache.delete(cacheKey);
      const useFallbackThemes =
        lightTheme !== defaultLight || darkTheme !== defaultDark;
      if (useFallbackThemes) {
        return getHighlighter("text" as BundledLanguage, defaultLight, defaultDark);
      }
      return getHighlighter("text" as BundledLanguage, lightTheme, darkTheme);
    });

    highlighterCache.set(cacheKey, highlighterPromise);
    return highlighterPromise;
  }

  async function tokenize(
    code: string,
    language: BundledLanguage,
    lightTheme: BundledTheme,
    darkTheme: BundledTheme,
  ): Promise<TokenizedCode> {
    const highlighter = await getHighlighter(language, lightTheme, darkTheme);
    const availableLangs = highlighter.getLoadedLanguages();
    const langToUse = (availableLangs.includes(language)
      ? language
      : "text") as BundledLanguage;

    const result = highlighter.codeToTokens(code, {
      lang: langToUse,
      themes: {
        dark: darkTheme,
        light: lightTheme,
      },
    });

    return {
      bg: result.bg ?? "transparent",
      fg: result.fg ?? "inherit",
      tokens: result.tokens,
    };
  }

  return { tokenize };
}
