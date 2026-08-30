/**
 * Phase 7c primitive source pins. Failure means the primitive's
 * structural contract drifted, which historically caused the
 * "dirty corners + off-center handle + asymmetric topbar" trio.
 *
 * Why source-grep instead of DOM render:
 *   - The constraints live in CSS (gap geometry, clip vs overflow,
 *     attribute names) not in component runtime behavior.
 *   - jsdom does no layout, so it cannot prove the gutter's 2px line
 *     actually lands on the gap mid-line. That centering claim is now
 *     proven against a real Chromium render in
 *     `src/__tests__/e2e/card-gutter-geometry.spec.ts` (@smoke) —
 *     these source pins guard the contract, that e2e measures the
 *     resulting geometry.
 *   - Electron-side darwin visual proof lives in
 *     `docs/exec-plans/active/_smoke-evidence/phase-7c/` (manual
 *     screenshots referenced in the plan's acceptance section).
 *   - Existing unit tests in this folder all follow the same
 *     source-pin pattern (see `platform-marker.test.ts`).
 */

import { test } from "node:test";
import { ok, match } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../../components/layout/card-primitives.tsx"),
  "utf-8",
);

test("RESIZE_GUTTER_WIDTH_PX is 8 (matches the visible gap promise)", () => {
  match(SOURCE, /export const RESIZE_GUTTER_WIDTH_PX = 8;/);
});

test("ResizeGutter renders a justify-center container so the 2px line lands on its centerX", () => {
  // The container must justify-center; this is what guarantees the
  // visible 2px line sits at the gutter's geometric mid-line, which in
  // turn lands on the gap's geometric mid-line in flex layout.
  match(
    SOURCE,
    /"relative z-10 flex h-full shrink-0 cursor-col-resize items-stretch justify-center touch-none[^\"]*"/,
  );
});

test("ResizeGutter visible line is 2px wide (w-0.5)", () => {
  match(SOURCE, /className="pointer-events-none w-0\.5 transition-opacity duration-150"/);
});

test("ResizeGutter width is driven by the RESIZE_GUTTER_WIDTH_PX constant", () => {
  // The 8px container width must come from the exported constant, not a
  // hand-typed literal, so the "8px gap" promise stays single-source.
  // The real-DOM centering that results is asserted in
  // card-gutter-geometry.spec.ts.
  match(SOURCE, /style=\{\{ width: RESIZE_GUTTER_WIDTH_PX \}\}/);
});

test("ResizeGutter is marked with data-resize-gutter for DOM identification", () => {
  match(SOURCE, /data-resize-gutter/);
});

test("ResizeGutter is keyboard accessible and exposes a separator name", () => {
  match(SOURCE, /role="separator"/);
  match(SOURCE, /aria-label=\{ariaLabel\}/);
  match(SOURCE, /tabIndex=\{0\}/);
  match(SOURCE, /e\.key === "ArrowLeft" \? -16 : 16/);
});

test("CardFrame emits data-platform-card-frame with kind value", () => {
  // Frame attribute name + value mapping is load-bearing for globals.css
  // selectors. Removing either would silently un-shadow every card.
  match(SOURCE, /\[CARD_FRAME_ATTR\]: FRAME_VALUE_BY_KIND\[kind\]/);
  match(SOURCE, /const CARD_FRAME_ATTR = "data-platform-card-frame";/);
});

test("CardFrame does NOT set overflow:hidden / clip-path on itself", () => {
  // The frame's job is to PAINT the shadow; clipping belongs on the
  // surface. If a future refactor adds `overflow-hidden` or
  // `clip-path` to the frame the shadow gets cropped — same bug Codex
  // flagged in Round 30/34.
  const frameSection = SOURCE.match(/export function CardFrame\([^]*?\n}/)?.[0] ?? "";
  ok(frameSection.length > 0, "CardFrame function block not found");
  ok(
    !/overflow-hidden/.test(frameSection),
    "CardFrame must not set overflow-hidden (clipping is the surface's job)",
  );
  ok(
    !/clip-path/.test(frameSection),
    "CardFrame must not set clip-path (clipping is the surface's job)",
  );
});

test("CardSurface emits the correct data-platform-* attribute per kind", () => {
  // These exact attribute names are what globals.css selects on. Any
  // typo silently drops the entire macOS profile for that surface.
  match(SOURCE, /sidebar: "data-platform-sidebar",/);
  match(SOURCE, /main: "data-platform-main-content",/);
  match(SOURCE, /workspace: "data-workspace-sidebar",/);
  match(SOURCE, /assistant: "data-platform-assistant",/);
});

test("CardKind includes the assistant rail and maps its frame value (Phase 7c closeout)", () => {
  // The assistant rail joined the primitive so the right rail runs one
  // chrome system. globals.css adds [data-platform-assistant] to the
  // opaque-surface group (NOT the translucent backdrop-filter group).
  match(SOURCE, /export type CardKind =[^;]*"assistant"/);
  match(SOURCE, /assistant: "assistant",/);
});

test("CardSurface keeps overflow-hidden (it's the actual clipping layer)", () => {
  const surfaceSection = SOURCE.match(/export function CardSurface\([^]*?\n}/)?.[0] ?? "";
  ok(surfaceSection.length > 0, "CardSurface function block not found");
  match(surfaceSection, /overflow-hidden/);
});

test("CardSurface does NOT set box-shadow inline (shadow is the frame's job)", () => {
  // If the surface paints its own outer shadow, the shadow lives
  // INSIDE the surface's own clip-path mask and gets cropped — the
  // exact Round 30 failure mode.
  const surfaceSection = SOURCE.match(/export function CardSurface\([^]*?\n}/)?.[0] ?? "";
  ok(surfaceSection.length > 0, "CardSurface function block not found");
  ok(
    !/shadow-(sm|md|lg|xl|2xl)/.test(surfaceSection),
    "CardSurface must not apply tailwind shadow utility",
  );
  ok(
    !/box-shadow\s*:/.test(surfaceSection),
    "CardSurface must not apply inline box-shadow (frame paints the shadow)",
  );
});

test("Only `kind=\"main\"` gets flex-1 + min-w-0 so it absorbs remaining row space", () => {
  // Sidebar / workspace are shrink-0 with a fixed width
  // owned by the consumer panel. Only main fills the leftover space.
  // If any other kind ever gets flex-1 the row layout breaks.
  match(SOURCE, /const isMain = kind === "main";/);
  match(SOURCE, /isMain && "flex-1 min-w-0"/);
});
