/**
 * Backward-compatibility contract for the retired in-place Markdown themes.
 *
 * Old localStorage records may still contain `presentationTemplate`. Parsing
 * must accept those records without throwing and remove the obsolete field
 * before the tab becomes current runtime state.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parse, previewSourceFromTab } from '../../lib/workspace-sidebar';

describe('retired Markdown presentation theme compatibility', () => {
  it('accepts and strips presentationTemplate from a legacy persisted tab', () => {
    const restored = parse(JSON.stringify({
      open: true,
      width: 480,
      activeTabId: 'markdown:/proj/note.md',
      dynamicTabs: [{
        id: 'markdown:/proj/note.md',
        kind: 'markdown',
        key: '/proj/note.md',
        title: 'note.md',
        filePath: '/proj/note.md',
        trust: 'workspace',
        baseDir: '/proj',
        presentationTemplate: 'brief',
      }],
    }));

    const tab = restored.tabs.find((candidate) => candidate.kind === 'markdown');
    assert.ok(tab && tab.kind === 'markdown');
    assert.equal('presentationTemplate' in tab, false);
    assert.deepEqual(previewSourceFromTab(tab), {
      kind: 'file',
      filePath: '/proj/note.md',
      trust: 'workspace',
      baseDir: '/proj',
    });
  });

  it('restores pre-theme Markdown tabs with the same source shape', () => {
    const source = previewSourceFromTab({
      id: 'markdown:/proj/x.md',
      kind: 'markdown',
      key: '/proj/x.md',
      title: 'x.md',
      filePath: '/proj/x.md',
    });
    assert.deepEqual(source, { kind: 'file', filePath: '/proj/x.md' });
  });
});
