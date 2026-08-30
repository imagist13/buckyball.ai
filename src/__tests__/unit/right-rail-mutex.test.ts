/**
 * Historical filename retained for git breadcrumbs. The v13 two-rail
 * coexistence contract was superseded after Files Primary + Inspector passed
 * responsive smoke. These pins prevent the retired standalone FileTree shell
 * from quietly returning.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relative: string): string {
  return readFileSync(path.resolve(__dirname, relative), 'utf-8');
}

const APPSHELL = read('../../components/layout/AppShell.tsx');
const TOPBAR = read('../../components/layout/UnifiedTopBar.tsx');
const PANEL_ZONE = read('../../components/layout/PanelZone.tsx');
const TAB_PANEL = read('../../components/layout/WorkspaceSidebar/TabPanel.tsx');
const CHAT_PAGE = read('../../app/chat/[id]/page.tsx');

describe('unified Workspace Sidebar supersedes the v13 standalone FileTree rail', () => {
  it('topbar has one workspace-surface entry and no standalone file-tree setter', () => {
    assert.doesNotMatch(TOPBAR, /\bfileTreeOpen\b|\bsetFileTreeOpen\b/);
    assert.match(TOPBAR, /ws\.setOpen\(\s*!ws\.state\.open\s*\)/);
  });

  it('AppShell and PanelZone no longer render the retired FileTree shell', () => {
    assert.doesNotMatch(APPSHELL, /\bfileTreeOpen\b|\bsetFileTreeOpen\b/);
    assert.doesNotMatch(PANEL_ZONE, /import\(["']\.\/panels\/FileTreePanel["']\)|<FileTreePanel/);
    assert.match(APPSHELL, /<WorkspaceSidebar\s*\/>/);
  });

  it('Files remains available inside the unified Primary lane', () => {
    assert.match(TAB_PANEL, /kind === 'files'\) return <FileTreePanel\s*\/>/);
    assert.match(TAB_PANEL, /aria-label="Primary workspace surface"/);
    assert.match(TAB_PANEL, /aria-label="Inspector"/);
    assert.match(TAB_PANEL, /data-inspector-resize-divider/);
    assert.match(TAB_PANEL, /event\.key === 'Escape'/);
  });

  it('uses a bounded overlay on narrow app widths and measures the real sidebar width', () => {
    assert.match(APPSHELL, /max-lg:absolute/);
    assert.match(APPSHELL, /max-lg:max-w-\[calc\(100vw-24px\)\]/);
    assert.match(APPSHELL, /className="max-lg:hidden"/);
    assert.match(TAB_PANEL, /new ResizeObserver/);
    assert.match(
      TAB_PANEL,
      /data-inspector-layout=\{standaloneInspector \? 'standalone' : narrowPeek \? 'peek' : 'split'\}/,
    );
  });

  it('keeps a standalone Inspector independent from the fallback Git Primary', () => {
    assert.match(TAB_PANEL, /const standaloneInspector = state\.inspectorOpen && !hasActivePrimary/);
    assert.match(TAB_PANEL, /\{!standaloneInspector && \(\s*<section/);
  });

  it('uses the top-level tabs for narrow Inspector navigation without a duplicate return row', () => {
    assert.doesNotMatch(TAB_PANEL, /data-inspector-back|<ArrowLeft|workspaceSidebar\.tab\.\$\{primaryKind\}/);
  });

  it('legacy default-panel values translate to unified Primary surfaces', () => {
    assert.match(CHAT_PAGE, /panel === 'file_tree'[\s\S]{0,100}activatePrimary\?\.\('files'\)/);
    assert.match(CHAT_PAGE, /panel === 'git'[\s\S]{0,100}activatePrimary\?\.\('git'\)/);
    assert.match(CHAT_PAGE, /panel === 'dashboard'[\s\S]{0,100}activatePrimary\?\.\('widget'\)/);
  });
});
