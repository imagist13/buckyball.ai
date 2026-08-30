/**
 * Phase 4 Phase 1 — PreviewSource trust classification.
 *
 * Pins the contract that `classifyPath` is the single source of truth
 * for deciding whether a file path the AI just named should be opened
 * directly (workspace) or staged behind a confirm card
 * (agent-referenced). The path-under-workingDirectory check is the
 * hinge for every UI affordance downstream (Edit toggle, readonly chip,
 * the AgentReferencedConfirm card), so a regression here propagates
 * to every external-file scenario in the panel.
 *
 * Run: npx tsx --test src/__tests__/unit/preview-source-trust.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyPath } from '../../lib/preview-source';

describe('classifyPath — workspace vs agent-referenced', () => {
  it('treats paths under the working directory as workspace + R/W + baseDir set', () => {
    const c = classifyPath('/Users/me/proj/docs/x.md', '/Users/me/proj');
    assert.equal(c.trust, 'workspace');
    assert.equal(c.baseDir, '/Users/me/proj');
    assert.equal(c.readonly, false);
  });

  it('treats the working directory itself as workspace (edge: same path)', () => {
    const c = classifyPath('/Users/me/proj', '/Users/me/proj');
    assert.equal(c.trust, 'workspace');
  });

  it('treats sibling paths (same prefix but different segment) as agent-referenced', () => {
    // Lexical-prefix test would falsely classify /Users/me/proj-other as
    // under /Users/me/proj. The helper must use segment-aware comparison.
    const c = classifyPath('/Users/me/proj-other/x.md', '/Users/me/proj');
    assert.equal(c.trust, 'agent-referenced');
    assert.equal(c.baseDir, undefined);
    assert.equal(c.readonly, true);
  });

  it('treats paths outside the working directory as agent-referenced + readonly', () => {
    const c = classifyPath('/etc/hosts', '/Users/me/proj');
    assert.equal(c.trust, 'agent-referenced');
    assert.equal(c.baseDir, undefined);
    assert.equal(c.readonly, true);
  });

  it('treats home-dir Desktop files (outside workspace) as agent-referenced', () => {
    const c = classifyPath('/Users/me/Desktop/note.md', '/Users/me/proj');
    assert.equal(c.trust, 'agent-referenced');
  });

  it('falls back to agent-referenced when working directory is missing', () => {
    // Empty / null cwd means we cannot scope the path. Better to ask
    // the user than to default to workspace and silently widen access.
    assert.equal(classifyPath('/Users/me/x.md', null).trust, 'agent-referenced');
    assert.equal(classifyPath('/Users/me/x.md', '').trust, 'agent-referenced');
    assert.equal(classifyPath('/Users/me/x.md', undefined).trust, 'agent-referenced');
  });

  it('normalizes Windows backslashes for comparison', () => {
    // Tool outputs on Windows mix separators. The classifier should
    // not treat C:\proj\docs\x.md and C:/proj as unrelated.
    const c = classifyPath('C:\\proj\\docs\\x.md', 'C:\\proj');
    assert.equal(c.trust, 'workspace');
  });

  it('user-selected confirm transition shape (documented contract)', () => {
    // This test documents the call shape PreviewPanel uses to promote
    // an agent-referenced source to user-selected on confirm. There's
    // no helper for the transition itself — the panel constructs the
    // new source directly — but a future refactor that adds one should
    // produce a source matching this shape: kind=file, trust=user-selected,
    // readonly=true, baseDir intentionally absent.
    const promoted = {
      kind: 'file' as const,
      filePath: '/Users/me/Desktop/note.md',
      trust: 'user-selected' as const,
      readonly: true,
    };
    assert.equal(promoted.trust, 'user-selected');
    assert.equal(promoted.readonly, true);
    assert.equal('baseDir' in promoted, false);
  });
});
