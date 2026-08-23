/**
 * Phase 5B â€?postMessage RPC contract between the main thread
 * (`shiki-worker-client.ts`) and the Shiki tokenization worker
 * (`shiki.worker.ts`).
 *
 * Types only â€?no runtime code, so importing this from either side creates
 * no module cycle and no bundle weight. Every field is structured-clone safe.
 */

import type { BundledLanguage, BundledTheme } from "shiki";
import type { TokenizedCode } from "./shiki-highlight-core";

/** Main â†?worker: tokenize one code string with a light/dark theme pair.
 *  `id` correlates the response back to the awaiting caller. */
export interface ShikiTokenizeRequest {
  id: number;
  code: string;
  language: BundledLanguage;
  lightTheme: BundledTheme;
  darkTheme: BundledTheme;
}

/** Worker â†?main: success carries the themed tokens; failure carries a
 *  string reason (worker Errors don't structured-clone cleanly). */
export type ShikiWorkerResponse =
  | { id: number; ok: true; tokenized: TokenizedCode }
  | { id: number; ok: false; error: string };
