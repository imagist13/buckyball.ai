/**
 * Unit tests for the Workspace Sidebar pure state model. Drives the
 * Tab lifecycle (add / focus / close) + persistence round-trip.
 *
 * Run with: npx tsx --test src/__tests__/unit/workspace-sidebar.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  activatePrimaryInteractively,
  initialState,
  hydrateWorkspaceSidebarState,
  openDynamicTab,
  closeTab,
  closeInspector,
  createBrowserSurfaceTab,
  setActiveTab,
  setOpen,
  setWidth,
  serialize,
  parse,
  storageKey,
  dynamicTabId,
  previewSourceFromTab,
  renameBrowserSurfaceTab,
  restoreThreadSurfaceState,
  serializeThreadSurfaceState,
  tabFromPreviewSource,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  type DynamicTab,
} from '../../lib/workspace-sidebar';

const markdownTab = (filePath: string): DynamicTab => ({
  id: dynamicTabId('markdown', filePath),
  kind: 'markdown',
  key: filePath,
  title: filePath.split('/').pop() ?? filePath,
  filePath,
});

const fileTab = (filePath: string): DynamicTab => ({
  id: dynamicTabId('file', filePath),
  kind: 'file',
  key: filePath,
  title: filePath.split('/').pop() ?? filePath,
  filePath,
});

describe('initialState', () => {
  it('defaults to closed with two fixed Tabs and git active', () => {
    const s = initialState();
    assert.equal(s.open, false);
    assert.equal(s.width, SIDEBAR_DEFAULT_WIDTH);
    assert.equal(s.activeTabId, 'git');
    assert.equal(s.tabs.length, 2);
    assert.deepEqual(s.tabs.map((t) => t.id), ['git', 'widget']);
  });
});

describe('openDynamicTab', () => {
  it('appends a new Tab + opens the shell + makes it active', () => {
    const s = openDynamicTab(initialState(), markdownTab('docs/x.md'));
    assert.equal(s.open, true);
    assert.equal(s.tabs.length, 3);
    assert.equal(s.activeTabId, 'markdown:docs/x.md');
  });

  it('reuses an existing Tab with the same id (no duplicate)', () => {
    let s = openDynamicTab(initialState(), markdownTab('docs/x.md'));
    s = setActiveTab(s, 'git');                                  // park on git
    s = openDynamicTab(s, markdownTab('docs/x.md'));             // reopen same key
    assert.equal(s.tabs.length, 3);                              // not 4
    assert.equal(s.activeTabId, 'markdown:docs/x.md');           // refocused
  });

  it('keys differ across kinds — same path can have markdown + file Tabs', () => {
    let s = openDynamicTab(initialState(), markdownTab('a.md'));
    s = openDynamicTab(s, fileTab('a.md'));
    // Different kinds → different ids → both Tabs coexist.
    assert.equal(s.tabs.length, 4);
  });
});

describe('repeatable Browser Primary Tabs', () => {
  it('uses one sidebar Tab per browser page with no nested tab identity', () => {
    let s = openDynamicTab(initialState(), createBrowserSurfaceTab('one'));
    s = openDynamicTab(s, createBrowserSurfaceTab('two', 'https://example.com/'));
    const browserTabs = s.tabs.filter((tab) => tab.kind === 'browser');
    assert.equal(browserTabs.length, 2);
    assert.equal(s.activePrimaryId, 'browser');
    assert.equal(s.activeBrowserTabId, 'browser:two');
    assert.equal(s.activeTabId, 'browser:two');
  });

  it('keeps the selected Browser behind Inspector and returns to it on close', () => {
    let s = openDynamicTab(initialState(), createBrowserSurfaceTab('one'));
    s = openDynamicTab(s, createBrowserSurfaceTab('two'));
    s = setActiveTab(s, 'browser:one');
    s = openDynamicTab(s, markdownTab('docs/x.md'));
    assert.equal(s.activePrimaryId, 'browser');
    assert.equal(s.activeBrowserTabId, 'browser:one');
    assert.equal(s.inspectorOpen, true);
    s = closeInspector(s);
    assert.equal(s.activeTabId, 'browser:one');
    assert.equal(s.inspectorOpen, false);
  });

  it('renames from the actual page title and selects a sibling when closed', () => {
    let s = openDynamicTab(initialState(), createBrowserSurfaceTab('one'));
    s = openDynamicTab(s, createBrowserSurfaceTab('two'));
    s = openDynamicTab(s, createBrowserSurfaceTab('three'));
    s = closeTab(s, 'browser:three');
    assert.equal(s.activeBrowserTabId, 'browser:two');
    s = renameBrowserSurfaceTab(s, 'browser:two', ' Example Domain ');
    const renamed = s.tabs.find((tab) => tab.id === 'browser:two');
    assert.equal(renamed?.kind === 'browser' ? renamed.title : undefined, 'Example Domain');
    s = closeTab(s, 'browser:two');
    assert.equal(s.activeBrowserTabId, 'browser:one');
    assert.equal(s.activeTabId, 'browser:one');
    s = closeTab(s, 'browser:one');
    assert.equal(s.activeBrowserTabId, undefined);
    assert.equal(s.activePrimaryId, 'git');
    assert.equal(s.activeTabId, 'git');
  });

  it('keeps Browser page state memory-only while restoring a blank Browser Primary', () => {
    const open = openDynamicTab(
      initialState(),
      createBrowserSurfaceTab('one', 'https://example.com/private'),
    );
    const wire = serializeThreadSurfaceState(open, 'thread-a');
    assert.equal(wire.activePrimary, 'browser');
    assert.equal(wire.inspectorTabs.some((tab) => tab.kind === 'browser'), false);
    const restored = restoreThreadSurfaceState(initialState(), wire);
    assert.equal(restored.activePrimaryId, 'browser');
    assert.equal(restored.tabs.filter((tab) => tab.kind === 'browser').length, 1);
    const restoredBrowser = restored.tabs.find((tab) =>
      tab.kind === 'browser' && tab.id === restored.activeBrowserTabId);
    assert.equal(
      restoredBrowser?.kind === 'browser' ? restoredBrowser.initialUrl : 'unexpected',
      undefined,
    );
  });
});

describe('closeTab', () => {
  it('removes the dynamic Tab and activates the neighbour to its left', () => {
    let s = openDynamicTab(initialState(), markdownTab('a.md'));
    s = openDynamicTab(s, markdownTab('b.md'));
    s = openDynamicTab(s, markdownTab('c.md'));
    // Active is c.md (just opened). Close c → b.md becomes active.
    s = closeTab(s, 'markdown:c.md');
    assert.equal(s.tabs.length, 4); // git widget a b
    assert.equal(s.activeTabId, 'markdown:b.md');
  });

  it('refuses to close fixed Tabs', () => {
    let s = openDynamicTab(initialState(), markdownTab('a.md'));
    s = closeTab(s, 'git');
    s = closeTab(s, 'widget');
    assert.equal(s.tabs.length, 3);
    assert.ok(s.tabs.some((t) => t.id === 'git'));
    assert.ok(s.tabs.some((t) => t.id === 'widget'));
  });

  it('closing a non-active Tab keeps the current active', () => {
    let s = openDynamicTab(initialState(), markdownTab('a.md'));
    s = openDynamicTab(s, markdownTab('b.md'));
    s = setActiveTab(s, 'git');
    s = closeTab(s, 'markdown:a.md');
    assert.equal(s.activeTabId, 'git');
  });

  it('closing the only dynamic Tab while active focuses the neighbour to its left (widget)', () => {
    let s = openDynamicTab(initialState(), markdownTab('a.md'));
    s = closeTab(s, 'markdown:a.md');
    // markdown:a.md was at idx 2; its left neighbour is widget at idx 1.
    // We don't slingshot back to git — VSCode/Chrome behaviour is to
    // focus the immediately-adjacent Tab.
    assert.equal(s.activeTabId, 'widget');
    assert.deepEqual(s.tabs.map((t) => t.id), ['git', 'widget']);
  });
});

describe('setActiveTab / setOpen / setWidth', () => {
  it('setActiveTab opens the shell and switches the active id', () => {
    let s = initialState();
    s = setActiveTab(s, 'widget');
    assert.equal(s.activeTabId, 'widget');
    assert.equal(s.open, true);
  });

  it('setActiveTab ignores unknown ids', () => {
    const s = setActiveTab(initialState(), 'does-not-exist');
    assert.equal(s.activeTabId, 'git');
  });

  it('setOpen toggles open state', () => {
    let s = initialState();
    s = setOpen(s, true);
    assert.equal(s.open, true);
    s = setOpen(s, false);
    assert.equal(s.open, false);
  });

  it('setWidth clamps to [min, max]', () => {
    let s = setWidth(initialState(), 100);
    assert.equal(s.width, SIDEBAR_MIN_WIDTH);
    s = setWidth(initialState(), 99999);
    assert.equal(s.width, SIDEBAR_MAX_WIDTH);
  });
});

describe('interactive Primary activation', () => {
  it('reveals Widget over a standalone preview without closing the preview tab', () => {
    let s = openDynamicTab(initialState(), {
      id: 'artifact:demo',
      kind: 'artifact',
      key: 'demo',
      title: 'demo.html',
      source: { kind: 'inline-html', html: '<p>demo</p>', virtualName: 'demo.html' },
    });

    s = activatePrimaryInteractively(s, 'widget');

    assert.equal(s.activePrimaryId, 'widget');
    assert.equal(s.activeTabId, 'widget');
    assert.equal(s.activeInspectorId, undefined);
    assert.equal(s.inspectorOpen, false);
    assert.ok(s.tabs.some((tab) => tab.id === 'artifact:demo'));

    s = setActiveTab(s, 'artifact:demo');
    assert.equal(s.activeInspectorId, 'artifact:demo');
    assert.equal(s.inspectorOpen, true);
  });

  it('keeps hydration semantics separate so a restored Inspector remains open', () => {
    const preview = openDynamicTab(initialState(), markdownTab('docs/restored.md'));
    const hydrated = hydrateWorkspaceSidebarState(preview, {
      open: true,
      width: 480,
      pinnedPrimaryIds: ['widget'],
      defaultPrimaryId: 'widget',
    });

    assert.equal(hydrated.activePrimaryId, 'widget');
    assert.equal(hydrated.activeInspectorId, 'markdown:docs/restored.md');
    assert.equal(hydrated.inspectorOpen, true);
  });
});

describe('workspace preference hydration', () => {
  it('restores a thread-owned pinned Primary without reopening a collapsed shell', () => {
    const threadState = restoreThreadSurfaceState(initialState(), {
      version: 1,
      sessionId: 'thread-a',
      activePrimary: 'files',
      inspectorTabs: [],
    });
    const hydrated = hydrateWorkspaceSidebarState(threadState, {
      open: false,
      width: 620,
      pinnedPrimaryIds: ['files-pinned', 'git'],
      defaultPrimaryId: 'git',
    });

    assert.equal(hydrated.open, false);
    assert.equal(hydrated.width, 620);
    assert.equal(hydrated.activePrimaryId, 'files-pinned');
    assert.ok(hydrated.tabs.some((tab) => tab.id === 'files-pinned'));
  });

  it('falls back to the workspace default when the thread Primary is no longer pinned', () => {
    const threadState = restoreThreadSurfaceState(initialState(), {
      version: 1,
      sessionId: 'thread-a',
      activePrimary: 'files',
      inspectorTabs: [],
    });
    const hydrated = hydrateWorkspaceSidebarState(threadState, {
      open: true,
      width: 480,
      pinnedPrimaryIds: ['widget'],
      defaultPrimaryId: 'widget',
    });

    assert.equal(hydrated.open, true);
    assert.equal(hydrated.activePrimaryId, 'widget');
  });
});

describe('storageKey', () => {
  it('combines workspace + session into a stable key', () => {
    const k = storageKey('/home/proj', 'sess-1');
    assert.equal(k, 'codepilot:workspace-sidebar::/home/proj::sess-1');
  });

  it('falls back to "global" buckets when missing', () => {
    assert.equal(storageKey(undefined, undefined), 'codepilot:workspace-sidebar::global::global');
    assert.equal(storageKey('', ''), 'codepilot:workspace-sidebar::global::global');
  });
});

describe('Phase 2 boundary — Files Tab is opt-in only', () => {
  // The revised Phase 2 product boundary says: clicking the topbar
  // file-tree button must NEVER create / activate the Files Tab.
  // Files Tab only exists when the user explicitly clicks PushPin in
  // the lightweight FileTreePanel header. This test models that
  // contract on the pure state level: openDynamicTab is the ONLY
  // path that creates a `files-pinned` Tab; nothing about the file
  // tree's own state can produce it implicitly.
  it('initialState has no files-pinned Tab', () => {
    const s = initialState();
    assert.equal(s.tabs.find((t) => t.kind === 'files-pinned'), undefined);
  });

  it('files-pinned Tab only appears via explicit openDynamicTab', () => {
    const filesTab = {
      id: 'files-pinned' as const,
      kind: 'files-pinned' as const,
      key: 'files' as const,
      title: 'Files',
    };
    let s = initialState();
    assert.ok(!s.tabs.some((t) => t.id === 'files-pinned'));
    s = openDynamicTab(s, filesTab);
    assert.ok(s.tabs.some((t) => t.id === 'files-pinned'));
    // Closing the Files Tab gets back to "no Files Tab" — re-opening
    // requires another explicit openDynamicTab, never an automatic
    // recovery.
    s = closeTab(s, 'files-pinned');
    assert.ok(!s.tabs.some((t) => t.id === 'files-pinned'));
  });

  it('openDynamicTab(files-pinned) twice still leaves exactly one', () => {
    const filesTab = {
      id: 'files-pinned' as const,
      kind: 'files-pinned' as const,
      key: 'files' as const,
      title: 'Files',
    };
    let s = openDynamicTab(initialState(), filesTab);
    s = openDynamicTab(s, filesTab);
    const filesTabs = s.tabs.filter((t) => t.id === 'files-pinned');
    assert.equal(filesTabs.length, 1);
  });
});

describe('previewSourceFromTab — Tab → PreviewSource sync (Codex P1)', () => {
  it('markdown Tab → file source with the same filePath', () => {
    const tab: DynamicTab = markdownTab('docs/buddy.md');
    const src = previewSourceFromTab(tab);
    assert.deepEqual(src, { kind: 'file', filePath: 'docs/buddy.md' });
  });

  it('file Tab → file source with the same filePath', () => {
    const src = previewSourceFromTab(fileTab('src/index.ts'));
    assert.deepEqual(src, { kind: 'file', filePath: 'src/index.ts' });
  });

  it('artifact Tab → echoes the stored inline source unchanged', () => {
    const inline = { kind: 'inline-html' as const, html: '<p>x</p>', virtualName: 'note.html' };
    const tab: DynamicTab = {
      id: 'artifact:note.html',
      kind: 'artifact',
      key: 'note.html',
      title: 'note.html',
      source: inline,
    };
    assert.deepEqual(previewSourceFromTab(tab), inline);
  });

  it('files-pinned + fixed Tabs → null (do not drive the preview surface)', () => {
    assert.equal(previewSourceFromTab({ id: 'git', kind: 'fixed' }), null);
    assert.equal(previewSourceFromTab({ id: 'widget', kind: 'fixed' }), null);
    assert.equal(
      previewSourceFromTab({ id: 'files-pinned', kind: 'files-pinned', key: 'files', title: 'Files' }),
      null,
    );
  });

  it('open A → open B → switch back to A: the source we sync is A again', () => {
    // Models the regression Codex flagged: TabPanel's sync effect runs
    // `previewSourceFromTab(activeTab)` whenever the active id changes.
    // Going A → B → A must end with the source matching A, not B.
    let s = openDynamicTab(initialState(), markdownTab('a.md'));
    s = openDynamicTab(s, markdownTab('b.md'));
    // Active is now b.md; switch back to a.md.
    s = setActiveTab(s, 'markdown:a.md');
    const active = s.tabs.find((t) => t.id === s.activeTabId)!;
    assert.deepEqual(previewSourceFromTab(active), { kind: 'file', filePath: 'a.md' });
  });
});

describe('serialize / parse round-trip', () => {
  it('preserves open + width + active + dynamic Tabs', () => {
    let s = initialState({ open: true, width: 600 });
    s = openDynamicTab(s, markdownTab('docs/x.md'));
    const wire = JSON.stringify(serialize(s));
    const restored = parse(wire);
    assert.equal(restored.open, true);
    assert.equal(restored.width, 600);
    assert.equal(restored.activeTabId, 'markdown:docs/x.md');
    assert.equal(restored.tabs.length, 3);
    assert.ok(restored.tabs.some((t) => t.id === 'markdown:docs/x.md'));
  });

  it('parse(null) returns a fresh initialState', () => {
    const s = parse(null);
    assert.deepEqual(s.tabs.map((t) => t.id), ['git', 'widget']);
    assert.equal(s.open, false);
  });

  it('parse rejects malformed JSON without throwing', () => {
    const s = parse('not-valid-json');
    assert.equal(s.activeTabId, 'git');
  });

  it('parse drops dynamic Tabs with unknown kinds (forward-compat)', () => {
    const wire = JSON.stringify({
      open: true,
      width: 500,
      activeTabId: 'git',
      dynamicTabs: [
        { id: 'markdown:a.md', kind: 'markdown', key: 'a.md', title: 'a.md', filePath: 'a.md' },
        { id: 'future:foo', kind: 'future-thing', key: 'foo', title: 'x' },
      ],
    });
    const s = parse(wire);
    assert.equal(s.tabs.length, 3); // git + widget + 1 valid markdown
    assert.ok(s.tabs.some((t) => t.id === 'markdown:a.md'));
  });

  it('falls back to git when persisted activeTabId no longer exists', () => {
    const wire = JSON.stringify({
      open: true,
      width: 500,
      activeTabId: 'markdown:gone.md',
      dynamicTabs: [],
    });
    const s = parse(wire);
    assert.equal(s.activeTabId, 'git');
  });

  it('round-trips active Inspector state through the thread-owned envelope', () => {
    let s = initialState({ open: true, width: 640 });
    s = openDynamicTab(s, {
      id: 'files-pinned',
      kind: 'files-pinned',
      key: 'files',
      title: 'Files',
    });
    s = openDynamicTab(s, markdownTab('docs/persisted.md'));
    const thread = serializeThreadSurfaceState(s, 'thread-a');
    const restored = restoreThreadSurfaceState(initialState({ width: 640 }), thread);

    assert.equal(thread.activePrimary, 'files');
    assert.deepEqual(thread.inspectorTabs.map((tab) => tab.id), ['markdown:docs/persisted.md']);
    assert.equal(restored.activePrimaryId, 'files-pinned');
    assert.equal(restored.activeInspectorId, 'markdown:docs/persisted.md');
    assert.equal(restored.inspectorOpen, true);
    assert.equal(restored.activeTabId, 'markdown:docs/persisted.md');
    assert.ok(restored.tabs.some((tab) => tab.id === 'files-pinned'));
  });
});

// ─── Phase 4 Phase 1: trust round-trip ────────────────────────────────
//
// PreviewSource gained a trust tier (workspace / user-selected /
// agent-referenced). Tabs persist to localStorage and must survive a
// page reload without forgetting that an external file was external —
// otherwise reopening a persisted Tab would silently re-promote it to
// workspace and skip the confirm card.

describe('tabFromPreviewSource carries trust tier through to the Tab', () => {
  it('preserves workspace trust + baseDir on a markdown source', () => {
    const tab = tabFromPreviewSource({
      kind: 'file',
      filePath: '/proj/docs/x.md',
      trust: 'workspace',
      baseDir: '/proj',
    });
    assert.equal(tab.kind, 'markdown');
    if (tab.kind !== 'markdown') return; // narrow for TS
    assert.equal(tab.trust, 'workspace');
    assert.equal(tab.baseDir, '/proj');
  });

  it('preserves user-selected + readonly tier (e.g. accepted external file)', () => {
    const tab = tabFromPreviewSource({
      kind: 'file',
      filePath: '/Users/me/Desktop/note.md',
      trust: 'user-selected',
      readonly: true,
    });
    if (tab.kind !== 'markdown') {
      assert.fail('expected markdown tab for .md');
    }
    assert.equal(tab.trust, 'user-selected');
    assert.equal(tab.readonly, true);
    assert.equal(tab.baseDir, undefined);
  });

  it('preserves agent-referenced on a non-markdown file source', () => {
    const tab = tabFromPreviewSource({
      kind: 'file',
      filePath: '/etc/hosts',
      trust: 'agent-referenced',
      readonly: true,
    });
    if (tab.kind !== 'file') {
      assert.fail('expected file tab for /etc/hosts');
    }
    assert.equal(tab.trust, 'agent-referenced');
    assert.equal(tab.readonly, true);
  });
});

describe('openDynamicTab refreshes metadata when reopening the same id', () => {
  it('replaces trust info on the existing tab (agent-referenced → user-selected)', () => {
    // Phase 4: PreviewPanel's "confirm external" path calls
    // setPreviewSource with the same filePath + a new trust tier.
    // openDynamicTab must refresh tab metadata in place, otherwise
    // localStorage persists the old agent-referenced marker and the
    // user re-sees the confirm card after every reload.
    let s = openDynamicTab(
      initialState(),
      tabFromPreviewSource({
        kind: 'file',
        filePath: '/Users/me/Desktop/note.md',
        trust: 'agent-referenced',
        readonly: true,
      }),
    );
    s = openDynamicTab(
      s,
      tabFromPreviewSource({
        kind: 'file',
        filePath: '/Users/me/Desktop/note.md',
        trust: 'user-selected',
        readonly: true,
      }),
    );
    // Still exactly one tab (no duplicate)
    const matches = s.tabs.filter((t) => t.id === 'markdown:/Users/me/Desktop/note.md');
    assert.equal(matches.length, 1);
    // ...but trust upgraded to user-selected
    const tab = matches[0];
    assert.ok(tab.kind === 'markdown');
    if (tab.kind !== 'markdown') return;
    assert.equal(tab.trust, 'user-selected');
    assert.equal(s.activeTabId, 'markdown:/Users/me/Desktop/note.md');
  });

  it('serialize → parse round-trip carries the upgraded trust forward', () => {
    // The end-to-end shape: after confirm, persist, reload — the tab
    // should come back as user-selected (NOT re-prompting). Without
    // the in-place replace, this test would fail (old trust persisted).
    let s = openDynamicTab(
      initialState({ open: true }),
      tabFromPreviewSource({
        kind: 'file',
        filePath: '/Users/me/Desktop/note.md',
        trust: 'agent-referenced',
        readonly: true,
      }),
    );
    s = openDynamicTab(
      s,
      tabFromPreviewSource({
        kind: 'file',
        filePath: '/Users/me/Desktop/note.md',
        trust: 'user-selected',
        readonly: true,
      }),
    );
    const restored = parse(JSON.stringify(serialize(s)));
    const tab = restored.tabs.find((t) => t.kind === 'markdown');
    assert.ok(tab && tab.kind === 'markdown');
    if (!tab || tab.kind !== 'markdown') return;
    assert.equal(tab.trust, 'user-selected');
  });
});

describe('previewSourceFromTab restores trust tier (and stays back-compat)', () => {
  it('echoes back trust/baseDir/readonly when set on the Tab', () => {
    const src = previewSourceFromTab({
      id: 'markdown:/proj/x.md',
      kind: 'markdown',
      key: '/proj/x.md',
      title: 'x.md',
      filePath: '/proj/x.md',
      trust: 'user-selected',
      readonly: true,
    });
    assert.deepEqual(src, {
      kind: 'file',
      filePath: '/proj/x.md',
      trust: 'user-selected',
      readonly: true,
    });
  });

  it('back-compat: Tab without trust fields restores to a bare file source', () => {
    // Pre-Phase-4 persisted Tabs have no trust field. PreviewPanel
    // reads trust ?? 'workspace' downstream, so omitting the field
    // produces the same UI as the v0.54.x literal shape. This is the
    // assertion the original test (line 209) relied on; keeping it
    // here ensures the Phase 4 spread doesn't add `trust: undefined`
    // (which would diverge from the v0.54.x persisted state via
    // JSON.stringify dropping vs keeping the key).
    const src = previewSourceFromTab({
      id: 'markdown:docs/x.md',
      kind: 'markdown',
      key: 'docs/x.md',
      title: 'x.md',
      filePath: 'docs/x.md',
    });
    assert.deepEqual(src, { kind: 'file', filePath: 'docs/x.md' });
  });

  it('serialize → parse round-trip preserves trust on a user-selected tab', () => {
    // A persisted user-selected Tab must come back with the same trust
    // tier, otherwise reopening after a page refresh would lose the
    // external/readonly marker and let the user edit a file they only
    // authorized for read-only preview.
    let s = initialState({ open: true });
    s = openDynamicTab(
      s,
      tabFromPreviewSource({
        kind: 'file',
        filePath: '/Users/me/Desktop/note.md',
        trust: 'user-selected',
        readonly: true,
      }),
    );
    const wire = JSON.stringify(serialize(s));
    const restored = parse(wire);
    const tab = restored.tabs.find((t) => t.kind === 'markdown');
    assert.ok(tab && tab.kind === 'markdown');
    if (tab.kind !== 'markdown') return;
    assert.equal(tab.trust, 'user-selected');
    assert.equal(tab.readonly, true);
  });
});
