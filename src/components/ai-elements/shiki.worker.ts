/**
 * Phase 5B — Shiki tokenization Web Worker (dedicated, module type).
 *
 * Runs the shared `createHighlightEngine` off the main thread so highlighting
 * a chat full of code fences during streaming no longer blocks paint/input on
 * the renderer's main thread. The main thread keeps an identical engine for
 * fallback (see `code-block.tsx` / `shiki-worker-client.ts`), so if this worker
 * fails to load or a tokenize throws, highlighting silently continues on the
 * main thread — code blocks are never left blank.
 *
 * Instantiated from `shiki-worker-client.ts` via
 *   new Worker(new URL('./shiki.worker.ts', import.meta.url), { type: 'module' })
 * which Turbopack recognizes and emits as a same-origin static chunk.
 */

import { createHighlighter } from "shiki";
import { createHighlightEngine } from "./shiki-highlight-core";
import type {
  ShikiTokenizeRequest,
  ShikiWorkerResponse,
} from "./shiki-worker-protocol";

// Minimal typed view of the dedicated worker global. The project tsconfig
// ships the `dom` lib (so `self` is typed as Window, not the worker scope);
// rather than pull in the `webworker` lib (which collides with `dom`), narrow
// `self` to just the two members we use.
interface WorkerScope {
  postMessage(message: ShikiWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ShikiTokenizeRequest>) => void,
  ): void;
}

const ctx = self as unknown as WorkerScope;

const engine = createHighlightEngine({
  createHighlighter,
  // Lazy dynamic import mirrors the main thread: the bundledLanguages map is
  // only needed to normalize unknown languages, not to eagerly load grammars.
  loadBundledLanguages: async () =>
    (await import("shiki")).bundledLanguages as Record<string, unknown>,
  // Match the app's defaults (SHIKI_DEFAULT_LIGHT / SHIKI_DEFAULT_DARK). These
  // are the fallback theme names used when a requested theme is unsupported.
  defaultLight: "github-light",
  defaultDark: "github-dark",
});

ctx.addEventListener("message", (event) => {
  const req = event.data;
  if (!req || typeof req.id !== "number") return;

  engine
    .tokenize(req.code, req.language, req.lightTheme, req.darkTheme)
    .then((tokenized) => {
      ctx.postMessage({ id: req.id, ok: true, tokenized });
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : String(error);
      ctx.postMessage({ id: req.id, ok: false, error: message });
    });
});
