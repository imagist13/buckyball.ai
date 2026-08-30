/**
 * Phase 4 Phase 1 — shared write-tool classification.
 *
 * Both MessageItem (DiffSummary cards) and stream-session-manager
 * (codepilot:file-changed dispatch) consume this module. Drift between
 * the two surfaces is what we're guarding against: any tool variant in
 * WRITE_TOOLS must also be handled in CREATE_TOOLS (or fall through to
 * the "modified" label), and extractWritePath must accept every input
 * shape the SDK / MCP servers produce.
 *
 * Run: npx tsx --test src/__tests__/unit/file-write-tools.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WRITE_TOOLS,
  CREATE_TOOLS,
  isWriteTool,
  isCreateTool,
  extractWritePath,
  resolveToolPath,
} from '../../lib/file-write-tools';

describe('write-tool classification', () => {
  it('isWriteTool matches all canonical names case-insensitively', () => {
    for (const name of WRITE_TOOLS) {
      assert.equal(isWriteTool(name), true, `lower: ${name}`);
      assert.equal(isWriteTool(name.toUpperCase()), true, `upper: ${name}`);
    }
  });

  it('isWriteTool rejects unrelated tool names', () => {
    assert.equal(isWriteTool('read'), false);
    assert.equal(isWriteTool('bash'), false);
    assert.equal(isWriteTool('glob'), false);
    assert.equal(isWriteTool(''), false);
    assert.equal(isWriteTool(null), false);
    assert.equal(isWriteTool(undefined), false);
  });

  it('isWriteTool recognizes MultiEdit (the canonical Claude Code variant)', () => {
    // Pin MultiEdit explicitly: this is the most common write tool in
    // Claude Code turns that touch existing files, and a regression
    // here means DiffSummary + auto-refresh both silently miss every
    // MultiEdit edit. Both PascalCase and snake_case must match.
    assert.equal(isWriteTool('MultiEdit'), true);
    assert.equal(isWriteTool('multiedit'), true);
    assert.equal(isWriteTool('multi_edit'), true);
  });

  it('extractWritePath handles MultiEdit input shape (file_path + edits[])', () => {
    // MultiEdit's input is `{ file_path, edits: [{old_string, new_string}, ...] }`.
    // We only need the file path — the edits[] payload is irrelevant
    // to the "which file just changed" question.
    const input = {
      file_path: '/Users/me/proj/docs/x.md',
      edits: [
        { old_string: 'foo', new_string: 'bar' },
        { old_string: 'baz', new_string: 'qux' },
      ],
    };
    assert.equal(extractWritePath(input), '/Users/me/proj/docs/x.md');
  });

  it('every CREATE_TOOLS entry is also in WRITE_TOOLS', () => {
    // CREATE_TOOLS is a strict subset — used only to refine the label
    // ('Created' vs 'Modified') on the DiffSummary card. A create-only
    // tool that isn't in WRITE_TOOLS would never produce a card at all.
    for (const name of CREATE_TOOLS) {
      assert.ok(WRITE_TOOLS.has(name), `${name} must be in WRITE_TOOLS`);
    }
  });

  it('isCreateTool distinguishes create vs modify variants', () => {
    assert.equal(isCreateTool('write'), true);
    assert.equal(isCreateTool('writeFile'), true);
    assert.equal(isCreateTool('edit'), false);          // modifies existing
    assert.equal(isCreateTool('notebook_edit'), false); // modifies existing
  });
});

describe('extractWritePath', () => {
  it('reads file_path (canonical SDK shape)', () => {
    assert.equal(
      extractWritePath({ file_path: '/abs/path.md', content: 'x' }),
      '/abs/path.md',
    );
  });

  it('reads notebook_path (NotebookEdit shape)', () => {
    assert.equal(
      extractWritePath({ notebook_path: '/x/n.ipynb', cell: 0 }),
      '/x/n.ipynb',
    );
  });

  it('reads path / filePath (various MCP shapes)', () => {
    assert.equal(extractWritePath({ path: '/abs/p.md' }), '/abs/p.md');
    assert.equal(extractWritePath({ filePath: '/abs/q.md' }), '/abs/q.md');
  });

  it('prefers file_path over fallback keys when both are present', () => {
    // A tool that mixes shapes (file_path + path) — go with the
    // canonical one so the same input produces the same dispatched
    // path regardless of which legacy key got merged in.
    assert.equal(
      extractWritePath({ file_path: '/canonical.md', path: '/legacy.md' }),
      '/canonical.md',
    );
  });

  it('returns empty string when no recognized path field is present', () => {
    assert.equal(extractWritePath({}), '');
    assert.equal(extractWritePath({ unrelated: 'x' }), '');
    assert.equal(extractWritePath(null), '');
    assert.equal(extractWritePath('string-not-object'), '');
  });
});

describe('resolveToolPath', () => {
  it('returns absolute paths unchanged', () => {
    assert.equal(
      resolveToolPath('/Users/me/x.md', '/Users/me/proj'),
      '/Users/me/x.md',
    );
  });

  it('joins relative paths to the working directory with /', () => {
    assert.equal(
      resolveToolPath('docs/x.md', '/Users/me/proj'),
      '/Users/me/proj/docs/x.md',
    );
  });

  it('joins with backslash on Windows-style working directories', () => {
    assert.equal(
      resolveToolPath('docs\\x.md', 'C:\\Users\\me\\proj'),
      'C:\\Users\\me\\proj\\docs\\x.md',
    );
  });

  it('treats Windows drive-rooted paths as absolute', () => {
    assert.equal(
      resolveToolPath('C:\\abs\\x.md', '/some/other/cwd'),
      'C:\\abs\\x.md',
    );
  });

  it('passes relative paths through unchanged when cwd is missing', () => {
    assert.equal(resolveToolPath('docs/x.md', null), 'docs/x.md');
    assert.equal(resolveToolPath('docs/x.md', undefined), 'docs/x.md');
    assert.equal(resolveToolPath('docs/x.md', ''), 'docs/x.md');
  });

  it('empty raw path returns empty (no spurious joining)', () => {
    assert.equal(resolveToolPath('', '/cwd'), '');
  });
});
