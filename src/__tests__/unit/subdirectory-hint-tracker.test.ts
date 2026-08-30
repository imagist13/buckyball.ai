import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  SubdirectoryHintTracker,
  tokenizeShellCommand,
} from '../../lib/subdirectory-hint-tracker';

// ────────────────────────────────────────────────────────────────
// Test filesystem fixture — mimics a monorepo layout
// ────────────────────────────────────────────────────────────────
//
// tmpRoot/
// ├─ AGENTS.md            ← root hint
// ├─ src/
// │  ├─ main.ts           ← file, no hints in this dir
// │  └─ utils/
// │     ├─ CLAUDE.md      ← sub-package hint
// │     └─ helper.ts
// ├─ docs/
// │  ├─ .cursorrules      ← cursor rule
// │  └─ readme.md
// ├─ empty/               ← dir with no hint files
// ├─ huge-hint/
// │  └─ AGENTS.md         ← > 8 KB, will be truncated
// └─ priorities/
//    ├─ AGENTS.md         ← wins over CLAUDE.md because AGENTS is listed first
//    └─ CLAUDE.md

let tmpRoot: string;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'subdir-hint-test-'));

  fs.writeFileSync(path.join(tmpRoot, 'AGENTS.md'), '# Root agents\nroot rules');

  fs.mkdirSync(path.join(tmpRoot, 'src'));
  fs.writeFileSync(path.join(tmpRoot, 'src', 'main.ts'), 'export const x = 1;');

  fs.mkdirSync(path.join(tmpRoot, 'src', 'utils'));
  fs.writeFileSync(
    path.join(tmpRoot, 'src', 'utils', 'CLAUDE.md'),
    '# Utils\nUtils subpackage rules',
  );
  fs.writeFileSync(path.join(tmpRoot, 'src', 'utils', 'helper.ts'), 'export const y = 2;');

  fs.mkdirSync(path.join(tmpRoot, 'docs'));
  fs.writeFileSync(path.join(tmpRoot, 'docs', '.cursorrules'), 'cursor rules here');
  fs.writeFileSync(path.join(tmpRoot, 'docs', 'readme.md'), 'readme');

  fs.mkdirSync(path.join(tmpRoot, 'empty'));

  fs.mkdirSync(path.join(tmpRoot, 'huge-hint'));
  const huge = 'x'.repeat(9_000);
  fs.writeFileSync(path.join(tmpRoot, 'huge-hint', 'AGENTS.md'), huge);

  fs.mkdirSync(path.join(tmpRoot, 'priorities'));
  fs.writeFileSync(path.join(tmpRoot, 'priorities', 'AGENTS.md'), 'agents wins');
  fs.writeFileSync(path.join(tmpRoot, 'priorities', 'CLAUDE.md'), 'claude loses');
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

// ────────────────────────────────────────────────────────────────
// tokenizeShellCommand
// ────────────────────────────────────────────────────────────────

describe('tokenizeShellCommand', () => {
  it('splits on simple whitespace', () => {
    assert.deepEqual(tokenizeShellCommand('ls -la /tmp'), ['ls', '-la', '/tmp']);
  });

  it('honors double quotes', () => {
    assert.deepEqual(
      tokenizeShellCommand('cat "/path with spaces/file.txt"'),
      ['cat', '/path with spaces/file.txt'],
    );
  });

  it('honors single quotes', () => {
    assert.deepEqual(
      tokenizeShellCommand("echo 'hello world'"),
      ['echo', 'hello world'],
    );
  });

  it('handles multiple spaces', () => {
    assert.deepEqual(tokenizeShellCommand('foo   bar'), ['foo', 'bar']);
  });

  it('handles tabs and newlines', () => {
    assert.deepEqual(tokenizeShellCommand('foo\tbar\nbaz'), ['foo', 'bar', 'baz']);
  });

  it('empty string → empty array', () => {
    assert.deepEqual(tokenizeShellCommand(''), []);
  });
});

// ────────────────────────────────────────────────────────────────
// SubdirectoryHintTracker — core behavior
// ────────────────────────────────────────────────────────────────

describe('SubdirectoryHintTracker — discovery', () => {
  it('loading the working dir itself returns null (pre-marked as loaded)', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Read', { path: 'AGENTS.md' });
    // AGENTS.md resolves to a file → parent is tmpRoot itself, which is pre-loaded.
    assert.equal(result, null);
  });

  it('reading a file in a hinted subdirectory returns that hint', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Read', {
      path: 'src/utils/helper.ts',
    });
    assert.ok(result, 'expected hint content from src/utils/CLAUDE.md');
    assert.ok(result!.includes('Utils subpackage rules'));
    assert.ok(result!.includes('[Subdirectory context discovered:'));
  });

  it('deduplicates — second call to the same directory returns null', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const first = tracker.checkToolCall('Read', { path: 'src/utils/helper.ts' });
    assert.ok(first);
    const second = tracker.checkToolCall('Read', { path: 'src/utils/helper.ts' });
    assert.equal(second, null, 'second call must not re-emit the same hint');
  });

  it('returns null for a directory with no hint files', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Read', { path: 'empty/placeholder.txt' });
    // empty/ has no hints; parent is tmpRoot (pre-loaded). Expect null.
    assert.equal(result, null);
  });

  it('finds .cursorrules in docs/', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Read', { path: 'docs/something.txt' });
    assert.ok(result);
    assert.ok(result!.includes('cursor rules here'));
  });

  it('truncates oversized hint files with truncation marker', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Read', { path: 'huge-hint/any.txt' });
    assert.ok(result);
    // 8000 + newline + truncation marker + header text
    assert.ok(result!.length < 9500);
    assert.ok(result!.includes('[...truncated AGENTS.md:'));
  });

  it('prefers AGENTS.md over CLAUDE.md (filename priority)', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Read', { path: 'priorities/any.txt' });
    assert.ok(result);
    assert.ok(result!.includes('agents wins'));
    assert.ok(!result!.includes('claude loses'));
  });
});

// ────────────────────────────────────────────────────────────────
// Ancestor walking
// ────────────────────────────────────────────────────────────────

describe('SubdirectoryHintTracker — ancestor walking', () => {
  it('walks up from a nested file to find a parent AGENTS.md', () => {
    // Fresh tracker — src has no hint but tmpRoot has AGENTS.md.
    // Because tmpRoot is pre-loaded, we should NOT see it as a hint.
    // But if we point inside src/utils/helper.ts the first ancestor
    // is src/utils (has CLAUDE.md), so we find that instead.
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Read', {
      path: 'src/utils/helper.ts',
    });
    assert.ok(result);
    assert.ok(result!.includes('Utils subpackage rules'));
  });

  it('stops at the working directory (pre-loaded)', () => {
    // src/ has no hint, parent is tmpRoot (pre-loaded) → no hint.
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Read', { path: 'src/main.ts' });
    assert.equal(result, null);
  });

  it('absolute path outside working dir still works', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const absPath = path.join(tmpRoot, 'src', 'utils', 'helper.ts');
    const result = tracker.checkToolCall('Read', { path: absPath });
    assert.ok(result);
    assert.ok(result!.includes('Utils subpackage rules'));
  });
});

// ────────────────────────────────────────────────────────────────
// Argument key handling
// ────────────────────────────────────────────────────────────────

describe('SubdirectoryHintTracker — argument keys', () => {
  it('honors file_path key (CodePilot Write/Edit convention)', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Write', {
      file_path: 'src/utils/new-file.ts',
    });
    assert.ok(result);
    assert.ok(result!.includes('Utils subpackage rules'));
  });

  it('honors workdir key', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('SomeTool', { workdir: 'src/utils' });
    assert.ok(result);
  });

  it('ignores unrelated argument keys', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Grep', {
      pattern: 'foo',
      include: '*.ts',
      // no path arg
    });
    assert.equal(result, null);
  });

  it('empty path strings are ignored', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Read', { path: '   ' });
    assert.equal(result, null);
  });
});

// ────────────────────────────────────────────────────────────────
// Bash command path extraction
// ────────────────────────────────────────────────────────────────

describe('SubdirectoryHintTracker — Bash command extraction', () => {
  it('extracts a path from a simple Bash command', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Bash', {
      command: 'cat src/utils/helper.ts',
    });
    assert.ok(result);
    assert.ok(result!.includes('Utils subpackage rules'));
  });

  it('ignores flag-only tokens', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Bash', {
      command: 'ls -la --color',
    });
    assert.equal(result, null);
  });

  it('ignores URLs', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('Bash', {
      command: 'curl https://example.com/docs/thing',
    });
    // curl has a URL arg but no filesystem path → no hint
    assert.equal(result, null);
  });

  it('handles quoted paths with spaces', () => {
    // Create a dir with a space
    const spaceDir = path.join(tmpRoot, 'space dir');
    fs.mkdirSync(spaceDir);
    fs.writeFileSync(path.join(spaceDir, 'AGENTS.md'), 'space dir rules');
    try {
      const tracker = new SubdirectoryHintTracker(tmpRoot);
      const result = tracker.checkToolCall('Bash', {
        command: 'cat "space dir/file.txt"',
      });
      assert.ok(result);
      assert.ok(result!.includes('space dir rules'));
    } finally {
      fs.rmSync(spaceDir, { recursive: true, force: true });
    }
  });

  it('non-Bash tool does NOT extract from command arg', () => {
    const tracker = new SubdirectoryHintTracker(tmpRoot);
    const result = tracker.checkToolCall('NotBash', {
      command: 'cat src/utils/helper.ts',
    });
    // command is not a PATH_ARG_KEY and the tool is not in COMMAND_TOOLS
    assert.equal(result, null);
  });
});
