import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const section = fs.readFileSync(path.join(ROOT, 'src/components/settings/AssistantWorkspaceSection.tsx'), 'utf8');
const dialogs = fs.readFileSync(path.join(ROOT, 'src/components/settings/WorkspaceConfirmDialogs.tsx'), 'utf8');

describe('assistant workspace path is an explicit identity switch', () => {
  it('shows the persisted current path without a recent-path Select', () => {
    assert.match(section, /const currentPath = workspace\?\.path \|\| ""/);
    assert.match(section, /currentPath \|\| t\('assistant\.pathNotSet'\)/);
    assert.doesNotMatch(section, /recentPaths|handleSelectChange|<Select value=\{currentPath\}/);
  });

  it('warns before opening the native folder picker', () => {
    assert.match(section, /onClick=\{handleRequestFolderChange\}/);
    assert.match(section, /setConfirmDialog\(\{ kind: 'switch_path' \}\)/);
    assert.match(dialogs, /kind: 'switch_path'/);
    assert.match(dialogs, /onClick=\{onConfirmSwitchPath\}/);
    assert.match(dialogs, /assistant\.confirmSwitchPathDesc/);
    assert.match(section, /window\.setTimeout\(\(\) => \{ void handleSelectFolder\(\); \}, 0\)/);
  });
});
