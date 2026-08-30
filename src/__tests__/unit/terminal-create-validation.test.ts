/**
 * 稳定性审计 ⑦ — terminal:create 的 cwd 存在性 + id 类型/唯一校验。
 *
 * 修复前 handler 把 opts.cwd/opts.id 直接喂给 spawn：坏 cwd 会在错误目录起进程或
 * 抛含糊 ENOENT，非字符串/重复 id 会污染 id→terminal map 或静默 kill 掉活着的
 * 终端。修复 = spawn 前用纯校验器（DI）校验 id 类型 → id 唯一 → cwd 存在。
 *
 * 行为钉：纯校验器逐条覆盖。源码钉：main.ts handler 用真实 fs.statSync +
 * terminalManager.has 接线并在校验失败时早返回。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateTerminalCreateOpts } from '../../../electron/terminal-create-validation';

const okDeps = { idExists: () => false, cwdIsDirectory: () => true };

describe('validateTerminalCreateOpts（⑦行为钉）', () => {
  it('合法：字符串 id + 未占用 + cwd 是目录 → ok', () => {
    const r = validateTerminalCreateOpts({ id: 'term-1', cwd: '/tmp' }, okDeps);
    assert.equal(r.ok, true);
  });

  it('id 非字符串 → invalid_id', () => {
    assert.equal(validateTerminalCreateOpts({ id: 123, cwd: '/tmp' }, okDeps).ok, false);
    assert.equal(
      (validateTerminalCreateOpts({ id: 123, cwd: '/tmp' }, okDeps) as { error: string }).error,
      'invalid_id',
    );
  });

  it('id 空串 → invalid_id', () => {
    assert.equal(
      (validateTerminalCreateOpts({ id: '', cwd: '/tmp' }, okDeps) as { error: string }).error,
      'invalid_id',
    );
  });

  it('id 已占用 → duplicate_id（不静默 clobber 活终端）', () => {
    const r = validateTerminalCreateOpts(
      { id: 'term-1', cwd: '/tmp' },
      { idExists: (id) => id === 'term-1', cwdIsDirectory: () => true },
    );
    assert.equal((r as { error: string }).error, 'duplicate_id');
  });

  it('cwd 不是已存在目录 → invalid_cwd', () => {
    const r = validateTerminalCreateOpts(
      { id: 'term-1', cwd: '/no/such/dir' },
      { idExists: () => false, cwdIsDirectory: () => false },
    );
    assert.equal((r as { error: string }).error, 'invalid_cwd');
  });

  it('cwd 非字符串 → invalid_cwd', () => {
    const r = validateTerminalCreateOpts({ id: 'term-1', cwd: 42 }, { idExists: () => false, cwdIsDirectory: () => true });
    assert.equal((r as { error: string }).error, 'invalid_cwd');
  });

  it('校验顺序：id 类型 先于 唯一性 先于 cwd', () => {
    // 全非法时先报 invalid_id
    const r = validateTerminalCreateOpts(
      { id: 123, cwd: 456 },
      { idExists: () => true, cwdIsDirectory: () => false },
    );
    assert.equal((r as { error: string }).error, 'invalid_id');
  });
});

// ── 源码钉：main.ts handler 接线 ──
describe('main.ts terminal:create 接线（⑦源码钉）', () => {
  const MAIN = fs.readFileSync(path.resolve(__dirname, '../../../electron/main.ts'), 'utf-8');

  it('spawn 前调用 validateTerminalCreateOpts，失败早返回', () => {
    const idx = MAIN.indexOf("ipcMain.handle('terminal:create'");
    assert.ok(idx > -1, 'terminal:create handler 必须存在');
    const block = MAIN.slice(idx, idx + 900);
    assert.ok(block.includes('validateTerminalCreateOpts'), 'handler 必须调用校验器');
    assert.ok(/terminalManager\.has/.test(block), 'idExists 必须接 terminalManager.has（唯一校验）');
    assert.ok(/fs\.statSync\([^)]*\)\.isDirectory\(\)/.test(block), 'cwdIsDirectory 必须用 fs.statSync().isDirectory()');
    const validateIdx = block.indexOf('validateTerminalCreateOpts');
    const createIdx = block.indexOf('terminalManager.create(');
    assert.ok(validateIdx < createIdx, '校验必须早于 terminalManager.create');
    assert.ok(/if \(!validation\.ok\)[\s\S]{0,200}return \{ ok: false/.test(block), '校验失败必须早返回，不 spawn');
  });
});
