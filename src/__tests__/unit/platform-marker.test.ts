/**
 * Source pin — Phase 7b Phase 1 platform marker + token layer (2026-05-22).
 *
 * Goals:
 *   1. `src/app/layout.tsx` ships the anti-FOUC platform script that
 *      stamps `data-platform` and `data-platform-style` on <html>
 *      before hydration. If this script disappears the platform CSS
 *      cascade silently breaks (no diff to the visual baseline on the
 *      regular dev page, but the macOS profile override never fires).
 *   2. `src/app/globals.css` declares the `--platform-*` token layer
 *      under `:root` and a macOS override under
 *      `html[data-platform="darwin"][data-platform-style="auto"]`.
 *
 * This test is deliberately a source-grep (not a DOM render) — the
 * anti-FOUC inline script and CSS custom properties exist as plain
 * strings in source, and the failure mode we guard against is
 * accidental removal during a future refactor. A DOM-render test would
 * need to spin up an Electron-like environment to be meaningful here.
 */

import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LAYOUT_SOURCE = readFileSync(
  resolve(__dirname, "../../app/layout.tsx"),
  "utf-8",
);

const GLOBALS_SOURCE = readFileSync(
  resolve(__dirname, "../../app/globals.css"),
  "utf-8",
);

const ELECTRON_MAIN_SOURCE = readFileSync(
  resolve(__dirname, "../../../electron/main.ts"),
  "utf-8",
);

test("layout.tsx stamps data-platform on <html> before hydration", () => {
  // The inline script must call setAttribute with 'data-platform' so
  // [data-platform="darwin"] CSS cascades apply on first paint, not
  // only after the React tree mounts.
  ok(
    LAYOUT_SOURCE.includes(`document.documentElement.setAttribute('data-platform'`),
    "expected layout.tsx to call documentElement.setAttribute('data-platform', ...) in an inline script",
  );
});

test("layout.tsx stamps data-platform-style with auto default", () => {
  ok(
    LAYOUT_SOURCE.includes(`document.documentElement.setAttribute('data-platform-style'`),
    "expected layout.tsx to set data-platform-style on <html>",
  );
  ok(
    LAYOUT_SOURCE.includes(`'auto'`),
    "expected the default platform-style to be 'auto' (which lets data-platform drive the cascade)",
  );
});

test("layout.tsx reads platform from electronAPI.versions.platform with darwin/win32/linux mapping", () => {
  // Anti-FOUC script must prefer the explicit Electron platform value
  // over a user-agent sniff. Without this, the renderer in a packaged
  // Electron build silently falls back to UA detection.
  ok(
    LAYOUT_SOURCE.includes("window.electronAPI"),
    "expected layout.tsx anti-FOUC script to read window.electronAPI",
  );
  for (const value of ["'darwin'", "'win32'", "'linux'"]) {
    ok(
      LAYOUT_SOURCE.includes(value),
      `expected layout.tsx anti-FOUC script to map to ${value}`,
    );
  }
});

test("globals.css declares the --platform-* token layer", () => {
  const required = [
    "--platform-font-ui",
    "--platform-radius-window",
    "--platform-radius-control",
    "--platform-hover-alpha",
    "--platform-surface-window",
    "--platform-surface-sidebar",
    "--platform-surface-bar",
    "--platform-surface-popover",
    "--platform-surface-hud",
    "--platform-surface-tooltip",
    "--platform-border-subtle",
  ];
  for (const token of required) {
    ok(
      GLOBALS_SOURCE.includes(token),
      `expected globals.css to declare ${token} (Phase 7b Phase 1 token layer)`,
    );
  }
});

test("layout.tsx also stamps data-shell so web vs electron can be distinguished", () => {
  // Round 17 (2026-05-23) — Codex P1 fix. The macOS-material CSS
  // gates on `data-shell="electron"` so a plain Safari / Playwright /
  // CDP session running on darwin doesn't trigger Electron-only
  // treatments (body transparency, traffic-light safe area).
  ok(
    LAYOUT_SOURCE.includes(`document.documentElement.setAttribute('data-shell'`),
    "expected layout.tsx to set data-shell on <html>",
  );
  ok(
    LAYOUT_SOURCE.includes("'electron'") && LAYOUT_SOURCE.includes("'web'"),
    "expected data-shell to take 'electron' or 'web' value depending on window.electronAPI presence",
  );
});

test("globals.css scopes the macOS profile under both data-platform=darwin AND data-shell=electron", () => {
  ok(
    GLOBALS_SOURCE.includes('html[data-platform="darwin"][data-shell="electron"][data-platform-style="auto"]'),
    "expected globals.css macOS profile to require both data-platform=\"darwin\" and data-shell=\"electron\" (otherwise web browsers on macOS pick up Electron-only chrome offsets)",
  );
});

test("globals.css does NOT shadow content-layer tokens inside the macOS profile", () => {
  // Hard guard against the most likely accident: scoping --background /
  // --card / --popover overrides under the macOS selector. Per HIG,
  // Liquid Glass belongs on controls and navigation, not on content.
  // If this fails, someone tried to make the reading canvas glassy.
  const macosBlockMatch = GLOBALS_SOURCE.match(
    /html\[data-platform="darwin"\]\[data-shell="electron"\]\[data-platform-style="auto"\]\s*\{([^}]*)\}/,
  );
  ok(
    macosBlockMatch,
    "expected to find the macOS profile block in globals.css",
  );
  const macosBlock = macosBlockMatch![1];
  for (const forbidden of [
    "--background:",
    "--foreground:",
    "--card:",
    "--popover:",
    "--card-foreground:",
    "--popover-foreground:",
  ]) {
    strictEqual(
      macosBlock.includes(forbidden),
      false,
      `macOS profile must NOT override content-layer token ${forbidden} (HIG: content stays opaque)`,
    );
  }
});

test("macOS light and dark profiles preserve native material translucency", () => {
  const macBlockMatch = GLOBALS_SOURCE.match(
    /html\[data-platform="darwin"\]\[data-shell="electron"\]\[data-platform-style="auto"\]\s*\{([^}]*)\}/,
  );
  ok(macBlockMatch, "expected to find the macOS Electron profile block");
  const macBlock = macBlockMatch![1];
  ok(
    macBlock.includes("--platform-surface-window: transparent"),
    "light macOS shell must not cover the native material",
  );
  ok(
    macBlock.includes(
      "--platform-surface-sidebar: color-mix(in oklch, white 40%, transparent)",
    ),
    "light macOS sidebar must keep a low-alpha card tint",
  );

  const darkMacBlockMatch = GLOBALS_SOURCE.match(
    /html\.dark\[data-platform="darwin"\]\[data-shell="electron"\]\[data-platform-style="auto"\]\s*\{([^}]*)\}/,
  );
  ok(
    darkMacBlockMatch,
    "expected to find the dark macOS Electron profile block in globals.css",
  );
  const darkMacBlock = darkMacBlockMatch![1];
  ok(
    darkMacBlock.includes("--platform-surface-window: transparent"),
    "dark macOS shell must not cover the native material",
  );
  ok(
    darkMacBlock.includes(
      "--platform-surface-sidebar: color-mix(in oklch, var(--sidebar) 40%, transparent)",
    ),
    "dark macOS sidebar must keep a low-alpha card tint",
  );
  ok(
    GLOBALS_SOURCE.includes(
      "background-color: var(--platform-surface-window)",
    ),
    "the macOS Electron body must consume the platform window tint token",
  );
});

test("macOS defaults to the lighter under-window material while retaining override support", () => {
  ok(
    ELECTRON_MAIN_SOURCE.includes("const envVibrancy = process.env.ELECTRON_VIBRANCY"),
    "expected the macOS material override to remain available for diagnostics",
  );
  ok(
    /const vibrancyChoice[\s\S]*\?\s*envVibrancy\s*:\s*['"]under-window['"]/.test(
      ELECTRON_MAIN_SOURCE,
    ),
    "expected under-window to remain the default macOS material",
  );
});
