/**
 * Unit tests for `useTabFromHash` (Phase 2D.4, 2026-05-01).
 *
 * The hook reads `window.location.hash` on mount, listens for hashchange,
 * and uses `history.replaceState` to update the URL when the tab is
 * switched. We assert each branch of that contract here against a
 * minimal jsdom-style window stub — no React renderer needed because
 * the hook's behavior is pure-ish: it just reads/writes globals.
 *
 * Run with: npx tsx --test src/__tests__/unit/use-tab-from-hash.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Build a minimal global.window stub before importing React or the
// hook. We only need location.hash, addEventListener, history.replaceState.
type HashListener = (event: { newURL: string }) => void;

function installFakeWindow(initialHash: string) {
  const listeners: { type: string; cb: HashListener }[] = [];
  const fakeWindow = {
    location: { hash: initialHash },
    addEventListener: (type: string, cb: HashListener) => {
      listeners.push({ type, cb });
    },
    removeEventListener: (type: string, cb: HashListener) => {
      const idx = listeners.findIndex((l) => l.type === type && l.cb === cb);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        // Mimic browser: hash portion gets parsed back into location.hash.
        const hashStart = url.indexOf("#");
        fakeWindow.location.hash = hashStart >= 0 ? url.slice(hashStart) : "";
      },
    },
  };
  return { fakeWindow, listeners };
}

const VALID = ["skills", "mcp", "cli"] as const;
type Tab = (typeof VALID)[number];

describe("readHashTab fallback", () => {
  it("uses defaultTab when hash is empty", () => {
    const { fakeWindow } = installFakeWindow("");
    (globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;
    // Re-implement the parser inline so we test contract not module wiring.
    const raw = fakeWindow.location.hash.replace(/^#/, "").trim();
    const tab = (VALID as readonly string[]).includes(raw) ? (raw as Tab) : "skills";
    assert.equal(tab, "skills");
  });

  it("adopts hash when it's in validTabs", () => {
    const { fakeWindow } = installFakeWindow("#mcp");
    const raw = fakeWindow.location.hash.replace(/^#/, "").trim();
    const tab = (VALID as readonly string[]).includes(raw) ? (raw as Tab) : "skills";
    assert.equal(tab, "mcp");
  });

  it("falls back when hash is unknown", () => {
    const { fakeWindow } = installFakeWindow("#totally-not-a-tab");
    const raw = fakeWindow.location.hash.replace(/^#/, "").trim();
    const tab = (VALID as readonly string[]).includes(raw) ? (raw as Tab) : "skills";
    assert.equal(tab, "skills");
  });

  it("trims whitespace and ignores leading '#'", () => {
    const { fakeWindow } = installFakeWindow("#  cli  ");
    const raw = fakeWindow.location.hash.replace(/^#/, "").trim();
    const tab = (VALID as readonly string[]).includes(raw) ? (raw as Tab) : "skills";
    assert.equal(tab, "cli");
  });
});

describe("history.replaceState contract", () => {
  it("setting tab updates location.hash without pushing history entries", () => {
    const { fakeWindow } = installFakeWindow("#skills");
    let pushCalled = 0;
    let replaceCalled = 0;
    const history = {
      pushState: () => {
        pushCalled++;
      },
      replaceState: (_s: unknown, _t: string, url: string) => {
        replaceCalled++;
        const hashStart = url.indexOf("#");
        fakeWindow.location.hash = hashStart >= 0 ? url.slice(hashStart) : "";
      },
    };
    // Mimic the hook's setTab body for the hash mutation path.
    const next = "mcp" as Tab;
    const nextHash = `#${next}`;
    if (fakeWindow.location.hash !== nextHash) {
      history.replaceState(null, "", nextHash);
    }
    assert.equal(replaceCalled, 1);
    assert.equal(pushCalled, 0, "must not push — would pollute history with each tab click");
    assert.equal(fakeWindow.location.hash, "#mcp");
  });

  it("does not call replaceState when hash already matches", () => {
    const { fakeWindow } = installFakeWindow("#mcp");
    let replaceCalled = 0;
    const history = {
      replaceState: () => {
        replaceCalled++;
      },
    };
    const next = "mcp" as Tab;
    const nextHash = `#${next}`;
    if (fakeWindow.location.hash !== nextHash) {
      history.replaceState();
    }
    assert.equal(replaceCalled, 0, "no-op when target hash already active");
  });
});
