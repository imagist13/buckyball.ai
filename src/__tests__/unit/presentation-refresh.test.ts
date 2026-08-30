/**
 * Phase 4 P2.2 — presentation refresh URL builder.
 *
 * Codex review finding: refreshing a presentation built from an
 * external user-selected Markdown went through the CURRENT
 * workingDirectory baseDir and 403'd. The fix is to honour the
 * trust tier captured at generation time:
 *  - workspace      → use captured sourceBaseDir
 *  - user-selected  → no baseDir (homeDir scope, like original load)
 *  - missing tier   → back-compat fallback to current workingDirectory
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPresentationRefreshUrl } from '../../lib/markdown/presentation-refresh';

describe('buildPresentationRefreshUrl', () => {
  it('workspace source → URL carries the stored baseDir, not the chat\'s', () => {
    const url = buildPresentationRefreshUrl(
      {
        sourcePath: '/proj-a/docs/spec.md',
        sourceTrust: 'workspace',
        sourceBaseDir: '/proj-a',
      },
      '/some-other-chat-cwd',
    );
    const parsed = new URL(url, 'http://localhost');
    assert.equal(parsed.searchParams.get('path'), '/proj-a/docs/spec.md');
    assert.equal(parsed.searchParams.get('baseDir'), '/proj-a');
  });

  it('user-selected source → URL omits baseDir (home scope)', () => {
    // This is the bug: previously the URL got baseDir=<chat cwd> and
    // 403'd for external files. Now it carries no baseDir so the
    // route falls back to homeDir, same as the original external load.
    const url = buildPresentationRefreshUrl(
      {
        sourcePath: '/Users/me/Desktop/notes.md',
        sourceTrust: 'user-selected',
      },
      '/Users/me/proj-a',
    );
    const parsed = new URL(url, 'http://localhost');
    assert.equal(parsed.searchParams.get('path'), '/Users/me/Desktop/notes.md');
    assert.equal(parsed.searchParams.has('baseDir'), false);
  });

  it('legacy backlink without sourceTrust falls back to workingDirectory', () => {
    // Back-compat: presentations generated before this fix landed had
    // only { sourcePath, templateId }. Treat them as workspace-ish
    // and use the current chat cwd as baseDir — same behaviour as
    // before the fix, just with the new helper.
    const url = buildPresentationRefreshUrl(
      { sourcePath: '/proj-a/x.md' },
      '/proj-a',
    );
    const parsed = new URL(url, 'http://localhost');
    assert.equal(parsed.searchParams.get('baseDir'), '/proj-a');
  });

  it('legacy backlink with no trust + no cwd → URL has no baseDir', () => {
    const url = buildPresentationRefreshUrl(
      { sourcePath: '/somewhere/x.md' },
      null,
    );
    const parsed = new URL(url, 'http://localhost');
    assert.equal(parsed.searchParams.has('baseDir'), false);
  });

  it('workspace source with no captured baseDir falls back to workingDirectory', () => {
    // Defensive: a workspace tier backlink that somehow lost
    // sourceBaseDir still gets a baseDir from the current chat,
    // matching the legacy behaviour.
    const url = buildPresentationRefreshUrl(
      { sourcePath: '/proj-a/x.md', sourceTrust: 'workspace' },
      '/proj-a',
    );
    const parsed = new URL(url, 'http://localhost');
    assert.equal(parsed.searchParams.get('baseDir'), '/proj-a');
  });
});
