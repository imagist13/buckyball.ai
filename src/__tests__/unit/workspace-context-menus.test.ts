import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), 'utf8');

describe('workspace context-menu contracts', () => {
  it('gives Electron editable fields a native editing context menu', () => {
    const source = readSource('electron/main.ts');
    const start = source.indexOf('function attachRendererEditingContextMenu');
    const end = source.indexOf('function createWindow', start);
    const block = source.slice(start, end);

    assert.ok(start >= 0, 'native renderer editing menu helper must exist');
    assert.match(block, /webContents\.on\(['"]context-menu['"]/);
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll']) {
      assert.match(block, new RegExp(`role:\\s*['"]${role}['"]`), `missing ${role} role`);
    }
    assert.match(block, /inputFieldType\s*===\s*['"]password['"]/);
    assert.match(source, /attachRendererEditingContextMenu\(mainWindow\)/);
  });

  it('exposes project and conversation actions from row context menus', () => {
    const project = readSource('src/components/layout/ProjectGroupHeader.tsx');
    const session = readSource('src/components/layout/SessionListItem.tsx');

    assert.match(project, /<ContextMenuTrigger asChild>/);
    assert.match(project, /chatList\.newConversation/);
    assert.match(project, /chatList\.openFolder/);
    assert.match(project, /chatList\.copyFolderPath/);
    assert.match(project, /chatList\.removeProject/);

    assert.match(session, /<ContextMenuTrigger asChild>/);
    assert.match(session, /chatList\.splitScreen/);
    assert.match(session, /chatList\.renameConversation/);
    assert.match(session, /chatList\.copySessionId/);
    assert.match(session, /chatList\.deleteConversation/);
    assert.doesNotMatch(
      session,
      /onDelete\(event as unknown as React\.MouseEvent/,
      'Radix select events must not be cast to React mouse events',
    );
    assert.match(session, /onCloseAutoFocus/);
  });

  it('uses a modal new-item flow and keeps add-to-chat in file-tree context menus only', () => {
    const panel = readSource('src/components/layout/panels/FileTreePanel.tsx');
    const tree = readSource('src/components/ai-elements/file-tree.tsx');

    assert.match(panel, /<PromptDialog/);
    assert.doesNotMatch(panel, /newItemInputRef/);
    assert.doesNotMatch(tree, /name=["']plus["']/);
    assert.match(tree, /onAdd\(path,\s*["']directory["']\)/);
    assert.match(tree, /onAdd\(path,\s*["']file["']\)/);
    assert.match(tree, /onContextMenu=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.match(tree, /onCloseAutoFocus/);
    assert.match(panel, /selectStem=\{dialogItemMode === ["']file["']\}/);
  });
});
