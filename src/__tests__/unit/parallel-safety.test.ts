import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  isDestructiveCommand,
  pathsOverlap,
  extractScopePath,
  shouldParallelizeToolBatch,
  PARALLEL_SAFE_TOOLS,
  PATH_SCOPED_TOOLS,
  NEVER_PARALLEL_TOOLS,
  MAX_PARALLEL_TOOL_WORKERS,
  type ToolCallDescriptor,
} from '../../lib/parallel-safety';

// ───────────────────────────────────────────────────────────────
// Constants sanity
// ───────────────────────────────────────────────────────────────

describe('parallel-safety — constants', () => {
  it('MAX_PARALLEL_TOOL_WORKERS matches Hermes (8)', () => {
    assert.equal(MAX_PARALLEL_TOOL_WORKERS, 8);
  });

  it('Read is in both PARALLEL_SAFE_TOOLS and PATH_SCOPED_TOOLS (mirrors Hermes)', () => {
    assert.ok(PARALLEL_SAFE_TOOLS.has('Read'));
    assert.ok(PATH_SCOPED_TOOLS.has('Read'));
  });

  it('Write and Edit are path-scoped but not parallel-safe', () => {
    assert.ok(PATH_SCOPED_TOOLS.has('Write'));
    assert.ok(PATH_SCOPED_TOOLS.has('Edit'));
    assert.ok(!PARALLEL_SAFE_TOOLS.has('Write'));
    assert.ok(!PARALLEL_SAFE_TOOLS.has('Edit'));
  });

  it('NEVER_PARALLEL_TOOLS defaults to empty (extended per-call)', () => {
    assert.equal(NEVER_PARALLEL_TOOLS.size, 0);
  });
});

// ───────────────────────────────────────────────────────────────
// isDestructiveCommand
// ───────────────────────────────────────────────────────────────

describe('parallel-safety — isDestructiveCommand', () => {
  it('empty string is not destructive', () => {
    assert.equal(isDestructiveCommand(''), false);
  });

  it('plain ls is not destructive', () => {
    assert.equal(isDestructiveCommand('ls -la'), false);
  });

  it('plain cat is not destructive', () => {
    assert.equal(isDestructiveCommand('cat /tmp/foo.txt'), false);
  });

  it('rm -rf is destructive', () => {
    assert.equal(isDestructiveCommand('rm -rf /tmp/stuff'), true);
  });

  it('mv is destructive', () => {
    assert.equal(isDestructiveCommand('mv a b'), true);
  });

  it('sed -i is destructive (in-place edit)', () => {
    assert.equal(isDestructiveCommand("sed -i 's/foo/bar/' file.txt"), true);
  });

  it('sed without -i is not destructive', () => {
    assert.equal(isDestructiveCommand("sed 's/foo/bar/' file.txt"), false);
  });

  it('git reset is destructive', () => {
    assert.equal(isDestructiveCommand('git reset --hard HEAD'), true);
  });

  it('git clean is destructive', () => {
    assert.equal(isDestructiveCommand('git clean -fd'), true);
  });

  it('git checkout is destructive (file overwrite semantics)', () => {
    assert.equal(isDestructiveCommand('git checkout -- file.txt'), true);
  });

  it('git status is NOT destructive', () => {
    assert.equal(isDestructiveCommand('git status'), false);
  });

  it('> redirect overwrites a file (destructive)', () => {
    assert.equal(isDestructiveCommand('echo hi > /tmp/out.txt'), true);
  });

  it('>> redirect appends and is NOT treated as destructive', () => {
    assert.equal(isDestructiveCommand('echo hi >> /tmp/out.txt'), false);
  });

  it('rm inside a pipeline is destructive (separator detection)', () => {
    assert.equal(isDestructiveCommand('find . -name "*.tmp" && rm -f /tmp/x'), true);
  });
});

// ───────────────────────────────────────────────────────────────
// pathsOverlap
// ───────────────────────────────────────────────────────────────

describe('parallel-safety — pathsOverlap', () => {
  it('identical paths overlap', () => {
    assert.equal(pathsOverlap('/a/b/c', '/a/b/c'), true);
  });

  it('parent and child overlap', () => {
    assert.equal(pathsOverlap('/a/b', '/a/b/c'), true);
    assert.equal(pathsOverlap('/a/b/c', '/a/b'), true);
  });

  it('siblings do not overlap', () => {
    assert.equal(pathsOverlap('/a/b', '/a/c'), false);
  });

  it('disjoint roots do not overlap', () => {
    assert.equal(pathsOverlap('/a', '/b'), false);
  });

  it('deeply nested disjoint paths do not overlap', () => {
    assert.equal(pathsOverlap('/home/user/proj1/src', '/home/user/proj2/src'), false);
  });

  it('same-depth with shared prefix overlap', () => {
    assert.equal(pathsOverlap('/home/user/proj/a', '/home/user/proj/a'), true);
  });
});

// ───────────────────────────────────────────────────────────────
// extractScopePath
// ───────────────────────────────────────────────────────────────

describe('parallel-safety — extractScopePath', () => {
  const cwd = path.resolve(path.sep, 'tmp', 'testcwd');

  it('returns null for non-path-scoped tools', () => {
    assert.equal(extractScopePath('Grep', { pattern: 'foo' }, cwd), null);
  });

  it('returns null when path arg is missing', () => {
    assert.equal(extractScopePath('Read', {}, cwd), null);
  });

  it('returns null when path arg is an empty string', () => {
    assert.equal(extractScopePath('Read', { path: '' }, cwd), null);
  });

  it('resolves relative Read path against cwd', () => {
    const result = extractScopePath('Read', { path: 'foo/bar.txt' }, cwd);
    assert.equal(result, path.join(cwd, 'foo', 'bar.txt'));
  });

  it('uses file_path for Write (CodePilot convention)', () => {
    const absolutePath = path.resolve(path.sep, 'abs', 'path.txt');
    const result = extractScopePath('Write', { file_path: absolutePath }, cwd);
    assert.equal(result, absolutePath);
  });

  it('uses file_path for Edit (CodePilot convention)', () => {
    const result = extractScopePath('Edit', { file_path: 'relative.txt' }, cwd);
    assert.equal(result, path.join(cwd, 'relative.txt'));
  });

  it('keeps absolute paths unchanged', () => {
    const absolutePath = path.resolve(path.sep, 'absolute', 'file.txt');
    const result = extractScopePath('Read', { path: absolutePath }, cwd);
    assert.equal(result, absolutePath);
  });
});

// ───────────────────────────────────────────────────────────────
// shouldParallelizeToolBatch — the main judgment function
// ───────────────────────────────────────────────────────────────

describe('parallel-safety — shouldParallelizeToolBatch', () => {
  const cwd = path.resolve(path.sep, 'tmp', 'testcwd');

  // Layer 1
  it('empty batch is not parallelized', () => {
    assert.equal(shouldParallelizeToolBatch([]), false);
  });

  it('singleton batch is not parallelized (nothing to fan out)', () => {
    const calls: ToolCallDescriptor[] = [{ name: 'Read', args: { path: 'a.txt' } }];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });

  // Layer 2 — NEVER_PARALLEL_TOOLS via extraNeverParallelTools
  it('extraNeverParallelTools forces batch to serialize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'a.txt' } },
      { name: 'AskUser', args: {} },
    ];
    const result = shouldParallelizeToolBatch(calls, {
      cwd,
      extraNeverParallelTools: new Set(['AskUser']),
    });
    assert.equal(result, false);
  });

  // Layer 3 — path-scoped tools
  it('two Reads of different files parallelize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'a.txt' } },
      { name: 'Read', args: { path: 'b.txt' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), true);
  });

  it('two Reads of the same file DO NOT parallelize (Hermes-conservative)', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'a.txt' } },
      { name: 'Read', args: { path: 'a.txt' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });

  it('two Writes of different files parallelize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Write', args: { file_path: 'a.txt' } },
      { name: 'Write', args: { file_path: 'b.txt' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), true);
  });

  it('two Writes of the same file DO NOT parallelize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Write', args: { file_path: 'a.txt' } },
      { name: 'Write', args: { file_path: 'a.txt' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });

  it('Read + Write on disjoint paths parallelizes', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'src/a.ts' } },
      { name: 'Write', args: { file_path: 'dist/b.js' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), true);
  });

  it('Read + Write overlapping parent/child DO NOT parallelize', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'src/a.ts' } },
      { name: 'Write', args: { file_path: 'src/a.ts' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });

  it('Write without a resolvable path falls through to serial', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'src/a.ts' } },
      { name: 'Write', args: {} }, // missing file_path
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });

  // Layer 4 — whitelist
  it('two Grep calls parallelize (both in safe whitelist)', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Grep', args: { pattern: 'foo' } },
      { name: 'Grep', args: { pattern: 'bar' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), true);
  });

  it('Read + Grep parallelizes (Read is path-scoped + safe, Grep is safe)', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'a.txt' } },
      { name: 'Grep', args: { pattern: 'foo' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), true);
  });

  it('Read + Bash does NOT parallelize (Bash not in whitelist)', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'Read', args: { path: 'a.txt' } },
      { name: 'Bash', args: { command: 'ls' } },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });

  it('two unknown tools do NOT parallelize (whitelist-first default)', () => {
    const calls: ToolCallDescriptor[] = [
      { name: 'SomeUnknownTool', args: {} },
      { name: 'AnotherUnknownTool', args: {} },
    ];
    assert.equal(shouldParallelizeToolBatch(calls, { cwd }), false);
  });
});
