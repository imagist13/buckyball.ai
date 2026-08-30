import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  migrateLegacyWorkspaceSidebarEntries,
  movePrimarySurface,
  parseLegacyWorkspaceSidebarKey,
  parseThreadSurfaceState,
  parseWorkspaceSurfacePreferences,
  workspaceSurfacePreferencesKey,
} from '@/lib/workspace-surfaces';

describe('workspace surface preference persistence', () => {
  it('uses only the opaque workspace id in the new key', () => {
    assert.equal(workspaceSurfacePreferencesKey('abc123'), 'codepilot:workspace-surfaces:v1:abc123');
  });

  it('fails malformed data closed and clamps widths', () => {
    assert.deepEqual(parseWorkspaceSurfacePreferences('{bad', 'id').pinnedKinds, []);
    const parsed = parseWorkspaceSurfacePreferences(JSON.stringify({
      version: 1,
      workspaceId: 'id',
      pinnedKinds: ['files', 'files', 'invalid'],
      order: ['widget'],
      open: true,
      width: 9999,
    }), 'id');
    assert.deepEqual(parsed.pinnedKinds, ['files']);
    assert.equal(parsed.width, 800);
    assert.deepEqual(parsed.order.slice(0, 2), ['widget', 'files']);
  });

  it('reorders a primary surface without dropping registry entries', () => {
    const moved = movePrimarySurface(['files', 'git', 'widget', 'browser', 'agents'], 'git', -1);
    assert.deepEqual(moved, ['git', 'files', 'widget', 'browser', 'agents']);
    assert.deepEqual(movePrimarySurface(moved, 'git', -1), moved);
  });
});

describe('thread surface persistence', () => {
  it('restores only inspector tabs owned by the requested thread', () => {
    const raw = JSON.stringify({
      version: 1,
      sessionId: 'thread-a',
      activePrimary: 'files',
      inspectorTabs: [
        { id: 'markdown:a.md', kind: 'markdown', key: 'a.md', title: 'a.md', filePath: 'a.md' },
        { id: 'agent-run:x', kind: 'agent-run', key: 'x' },
      ],
      activeInspectorId: 'markdown:a.md',
    });
    assert.equal(parseThreadSurfaceState(raw, 'thread-b'), null);
    const parsed = parseThreadSurfaceState(raw, 'thread-a');
    assert.equal(parsed?.activePrimary, 'files');
    assert.equal(parsed?.activeInspectorId, 'markdown:a.md');
    assert.deepEqual(parsed?.inspectorTabs.map((tab) => tab.id), ['markdown:a.md']);
  });

  it('fails malformed active ids closed without discarding valid tabs', () => {
    const parsed = parseThreadSurfaceState(JSON.stringify({
      version: 1,
      sessionId: 'thread-a',
      inspectorTabs: [
        { id: 'file:a.txt', kind: 'file', key: 'a.txt', title: 'a.txt', filePath: 'a.txt' },
      ],
      activeInspectorId: 'file:missing.txt',
    }), 'thread-a');
    assert.equal(parsed?.activeInspectorId, undefined);
    assert.equal(parsed?.inspectorTabs.length, 1);
  });
});

describe('legacy workspace sidebar migration', () => {
  it('parses session from the final delimiter so paths may contain ::', () => {
    assert.deepEqual(
      parseLegacyWorkspaceSidebarKey('codepilot:workspace-sidebar::/tmp/a::b::session-1'),
      { workingDirectory: '/tmp/a::b', sessionId: 'session-1' },
    );
  });

  it('ORs files-pinned across sessions and keeps preview tabs thread-scoped', () => {
    const migrated = migrateLegacyWorkspaceSidebarEntries('workspace-id', [
      {
        sessionId: 'a',
        raw: JSON.stringify({
          open: false,
          width: 420,
          activeTabId: 'markdown:a.md',
          dynamicTabs: [{ id: 'markdown:a.md', kind: 'markdown', key: 'a.md', title: 'a.md', filePath: 'a.md' }],
        }),
      },
      {
        sessionId: 'b',
        raw: JSON.stringify({
          open: true,
          width: 560,
          activeTabId: 'files-pinned',
          dynamicTabs: [{ id: 'files-pinned', kind: 'files-pinned', key: 'files', title: 'Files' }],
        }),
      },
    ]);
    assert.deepEqual(migrated.preferences.pinnedKinds, ['files', 'git', 'widget']);
    assert.equal(migrated.preferences.open, true);
    assert.equal(migrated.threadStates.find((state) => state.sessionId === 'a')?.inspectorTabs.length, 1);
    assert.equal(migrated.threadStates.find((state) => state.sessionId === 'b')?.inspectorTabs.length, 0);
  });

  it('is monotonic when a later bucket does not contain files-pinned', () => {
    const migrated = migrateLegacyWorkspaceSidebarEntries('id', [
      { sessionId: 'a', raw: JSON.stringify({ dynamicTabs: [{ id: 'files-pinned', kind: 'files-pinned', key: 'files' }] }) },
      { sessionId: 'b', raw: JSON.stringify({ dynamicTabs: [] }) },
    ]);
    assert.ok(migrated.preferences.pinnedKinds.includes('files'));
  });

  it('skips malformed buckets without inventing agent-run persistence', () => {
    const migrated = migrateLegacyWorkspaceSidebarEntries('id', [
      { sessionId: 'bad', raw: '{bad' },
      { sessionId: 'agent', raw: JSON.stringify({ dynamicTabs: [{ id: 'agent-run:x', kind: 'agent-run', key: 'x' }] }) },
    ]);
    assert.equal(migrated.threadStates.length, 1);
    assert.deepEqual(migrated.threadStates[0].inspectorTabs, []);
  });
});
