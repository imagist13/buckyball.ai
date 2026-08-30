/**
 * Phase 4 Phase 1 — codepilot:file-changed event channel.
 *
 * The channel has two producers (stream-session-manager on AI writes,
 * PreviewPanel on user save) and one consumer (PreviewPanel listener).
 * This file pins the wire shape so a future producer change can't
 * silently break the listener: detail.paths is normalized to forward
 * slashes, source is the discriminated union, originId optional.
 *
 * Run: npx tsx --test src/__tests__/unit/file-changed-event.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  FILE_CHANGED_EVENT,
  dispatchFileChanged,
  isFileChangedDetail,
} from '../../lib/file-changed-event';

// Minimal window shim. The dispatcher narrows on `typeof window` so we
// can install a fake one for the duration of the test. node:test runs
// each `describe` in the same process so we restore at the end.
//
// `globalThis.window` is typed as `Window & typeof globalThis`; we
// stash the fake as `unknown` and cast at the assignment point so we
// don't pull in a fake DOM lib just to bypass one type.
type GlobalAny = Record<string, unknown>;

class FakeEventTarget {
  private listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }
  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatchEvent(event: Event): boolean {
    const set = this.listeners.get(event.type);
    if (!set) return true;
    for (const fn of set) fn(event);
    return true;
  }
}

function installFakeWindow(): { window: FakeEventTarget; restore: () => void } {
  const g = globalThis as unknown as GlobalAny;
  const fake = new FakeEventTarget();
  const prevWindow = g.window;
  const prevCustomEvent = g.CustomEvent;
  g.window = fake;
  // Node 22 has CustomEvent natively; older Node lacks it. Install a
  // minimal polyfill that carries `detail` through, which is all the
  // dispatcher and the type guard exercise.
  if (typeof prevCustomEvent !== 'function') {
    class PolyCustomEvent<T> extends Event {
      detail: T;
      constructor(type: string, init?: { detail: T }) {
        super(type);
        this.detail = init?.detail as T;
      }
    }
    g.CustomEvent = PolyCustomEvent;
  }
  return {
    window: fake,
    restore: () => {
      g.window = prevWindow;
      if (typeof prevCustomEvent !== 'function') {
        delete g.CustomEvent;
      }
    },
  };
}

describe('dispatchFileChanged + isFileChangedDetail', () => {
  it('dispatches the named event with the expected detail on window', () => {
    const { window, restore } = installFakeWindow();
    try {
      let received: unknown = null;
      const handler = (event: Event) => {
        received = (event as CustomEvent).detail;
      };
      window.addEventListener(FILE_CHANGED_EVENT, handler);

      dispatchFileChanged({
        paths: ['/Users/me/proj/docs/x.md'],
        source: 'ai-tool',
      });

      assert.ok(received, 'listener should have fired');
      assert.ok(isFileChangedDetail(received));
      const r = received as { paths: string[]; source: string };
      assert.deepEqual(r.paths, ['/Users/me/proj/docs/x.md']);
      assert.equal(r.source, 'ai-tool');
    } finally {
      restore();
    }
  });

  it('normalizes Windows backslashes to forward slashes in detail.paths', () => {
    const { window, restore } = installFakeWindow();
    try {
      let received: { paths: string[] } | null = null;
      window.addEventListener(FILE_CHANGED_EVENT, (event: Event) => {
        received = (event as CustomEvent).detail;
      });
      dispatchFileChanged({
        paths: ['C:\\proj\\docs\\x.md', '/Users/me/proj/y.md'],
        source: 'preview-save',
      });
      assert.ok(received);
      // Listener relies on this normalization to match against the
      // active panel's filePath (also stored with forward slashes).
      const r = received as unknown as { paths: string[] };
      assert.deepEqual(r.paths, [
        'C:/proj/docs/x.md',
        '/Users/me/proj/y.md',
      ]);
    } finally {
      restore();
    }
  });

  it('passes through originId so the panel can skip self-saves', () => {
    const { window, restore } = installFakeWindow();
    try {
      let received: { originId?: string } | null = null;
      window.addEventListener(FILE_CHANGED_EVENT, (event: Event) => {
        received = (event as CustomEvent).detail;
      });
      dispatchFileChanged({
        paths: ['/Users/me/proj/x.md'],
        source: 'preview-save',
        originId: '/Users/me/proj/x.md',
      });
      assert.ok(received);
      const r = received as unknown as { originId?: string };
      assert.equal(r.originId, '/Users/me/proj/x.md');
    } finally {
      restore();
    }
  });

  it('isFileChangedDetail rejects shapes missing required fields', () => {
    assert.equal(isFileChangedDetail(null), false);
    assert.equal(isFileChangedDetail({}), false);
    assert.equal(isFileChangedDetail({ paths: [] }), false); // missing source
    assert.equal(
      isFileChangedDetail({ paths: [], source: 'ai-tool' }),
      true,
    );
    assert.equal(
      isFileChangedDetail({ paths: ['x', 42], source: 'ai-tool' }),
      false, // non-string in paths
    );
    assert.equal(
      isFileChangedDetail({ paths: ['x'], source: 'invalid' }),
      false, // unknown source tier
    );
  });

  it('is a no-op when window is undefined (SSR safety)', () => {
    const g = globalThis as unknown as GlobalAny;
    const prev = g.window;
    g.window = undefined;
    try {
      // Should not throw — exercised under SSR / unit tests without jsdom.
      assert.doesNotThrow(() => {
        dispatchFileChanged({ paths: ['/x'], source: 'ai-tool' });
      });
    } finally {
      g.window = prev;
    }
  });
});
