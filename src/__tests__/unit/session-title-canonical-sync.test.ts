/**
 * Rename lands the SAME title in every view.
 *
 * The bug this pins: the top bar and the sidebar each PATCHed inline and then
 * announced the text they had SENT. PATCH canonicalizes (50-grapheme clamp,
 * single-lining), so for any rename the server rewrote, the top bar and split
 * view sat on the raw input while the sidebar's later re-fetch showed the
 * canonical form — one session, two titles, depending on where you looked.
 *
 * Both call sites now go through `renameSession`, so this drives the real
 * shared path and models the three consumers exactly as the components do:
 * the top bar and split view via `subscribeSessionTitle`, the sidebar via the
 * returned title it writes into its own list state.
 *
 * Window shim pattern borrowed from file-changed-event.test.ts.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  renameSession,
  subscribeSessionTitle,
  broadcastSessionTitle,
  canonicalTitleFromResponse,
} from '../../lib/session-title-events';
import { deriveConversationTitle, titleLength, MAX_TITLE_GRAPHEMES } from '../../lib/conversation-title';

type GlobalAny = Record<string, unknown>;

class FakeWindow {
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
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
    return true;
  }
}

/** Records every PATCH the code under test makes. */
interface PatchCall {
  url: string;
  title: unknown;
}

let patches: PatchCall[];
let originalWindow: unknown;
let originalFetch: unknown;

/**
 * Stand-in for the route: applies the SAME canonicalization the real PATCH
 * applies (`sanitizeManualTitle` → `deriveConversationTitle`) and answers with
 * the stored session, so a divergence between sent and stored is reproduced
 * rather than assumed.
 */
function installServer(behaviour: 'ok' | 'reject' | 'network-error' = 'ok') {
  (globalThis as GlobalAny).fetch = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    patches.push({ url, title: body.title });
    if (behaviour === 'network-error') throw new Error('offline');
    const canonical = deriveConversationTitle(body.title);
    if (behaviour === 'reject' || !canonical) {
      return { ok: false, status: 400, json: async () => ({ error: 'title must not be empty' }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ session: { id: 'sess-1', title: canonical, title_origin: 'manual' } }),
    };
  };
}

beforeEach(() => {
  patches = [];
  originalWindow = (globalThis as GlobalAny).window;
  originalFetch = (globalThis as GlobalAny).fetch;
  (globalThis as GlobalAny).window = new FakeWindow();
  installServer('ok');
});

afterEach(() => {
  (globalThis as GlobalAny).window = originalWindow;
  (globalThis as GlobalAny).fetch = originalFetch;
});

/** Subscribes the way `/chat/[id]` (top bar) and SplitColumn both do. */
function mountViews(sessionId: string) {
  const views = { topBar: 'New Chat', split: 'New Chat' };
  const unsubs = [
    subscribeSessionTitle(sessionId, (t) => { views.topBar = t; }),
    subscribeSessionTitle(sessionId, (t) => { views.split = t; }),
  ];
  return { views, unmount: () => unsubs.forEach((u) => u()) };
}

describe('renameSession — every view settles on the server title', () => {
  it('a rename the server rewrites does not leave views disagreeing', async () => {
    const { views, unmount } = mountViews('sess-1');
    // 80 graphemes: the server clamps to 50 + ellipsis. Echoing the request
    // text is exactly what used to split the views apart.
    const typed = 'A'.repeat(80);

    const sidebar = await renameSession('sess-1', typed);

    assert.equal(titleLength(sidebar), MAX_TITLE_GRAPHEMES, 'sidebar shows the clamped title');
    assert.notEqual(sidebar, typed, 'the server really did rewrite it');
    assert.equal(views.topBar, sidebar, 'top bar matches the sidebar');
    assert.equal(views.split, sidebar, 'split view matches the sidebar');
    unmount();
  });

  it('a multi-line rename reaches all views single-lined', async () => {
    const { views, unmount } = mountViews('sess-1');
    const sidebar = await renameSession('sess-1', 'first line\nsecond line');
    assert.equal(sidebar, 'first line second line');
    assert.equal(views.topBar, 'first line second line');
    assert.equal(views.split, 'first line second line');
    unmount();
  });

  it('a rename the server accepts verbatim is broadcast unchanged', async () => {
    const { views, unmount } = mountViews('sess-1');
    const sidebar = await renameSession('sess-1', 'Auth refactor');
    assert.equal(sidebar, 'Auth refactor');
    assert.equal(views.topBar, 'Auth refactor');
    assert.equal(views.split, 'Auth refactor');
    unmount();
  });

  it('sends exactly one PATCH, carrying the raw text for the server to judge', async () => {
    await renameSession('sess-1', '  spaced out  ');
    assert.equal(patches.length, 1);
    assert.equal(patches[0].url, '/api/chat/sessions/sess-1');
    assert.equal(patches[0].title, '  spaced out  ', 'canonicalization is the server\'s job, not the client\'s');
  });
});

describe('renameSession — nothing changes on a rejected or failed rename', () => {
  it('a 400 leaves every view on its old title and returns empty', async () => {
    installServer('reject');
    const { views, unmount } = mountViews('sess-1');
    const result = await renameSession('sess-1', 'anything');
    assert.equal(result, '', 'caller must not write its own input on failure');
    assert.equal(views.topBar, 'New Chat');
    assert.equal(views.split, 'New Chat');
    unmount();
  });

  it('a network error is fail-soft — no throw, no broadcast', async () => {
    installServer('network-error');
    const { views, unmount } = mountViews('sess-1');
    const result = await renameSession('sess-1', 'anything');
    assert.equal(result, '');
    assert.equal(views.topBar, 'New Chat');
    unmount();
  });

  it('a whitespace-only rename never reaches a view', async () => {
    const { views, unmount } = mountViews('sess-1');
    const result = await renameSession('sess-1', '   ');
    assert.equal(result, '');
    assert.equal(views.topBar, 'New Chat');
    unmount();
  });
});

describe('title broadcast addressing', () => {
  it('a title for another session does not touch this one', () => {
    const { views, unmount } = mountViews('sess-1');
    broadcastSessionTitle('sess-2', 'Someone else');
    assert.equal(views.topBar, 'New Chat');
    unmount();
  });

  it('an unsubscribed view stops receiving titles', () => {
    const { views, unmount } = mountViews('sess-1');
    unmount();
    broadcastSessionTitle('sess-1', 'Too late');
    assert.equal(views.topBar, 'New Chat');
  });
});

describe('canonicalTitleFromResponse', () => {
  it('reads the title out of the session envelope', () => {
    assert.equal(canonicalTitleFromResponse({ session: { title: 'Hi' } }), 'Hi');
  });

  it('yields empty for shapes it does not recognize, so callers do not guess', () => {
    for (const bad of [null, undefined, {}, { session: null }, { session: {} }, { session: { title: 42 } }, 'nope']) {
      assert.equal(canonicalTitleFromResponse(bad), '', `must not invent a title from ${JSON.stringify(bad)}`);
    }
  });
});
