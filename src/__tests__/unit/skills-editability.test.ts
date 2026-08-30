/**
 * Unit tests for `deriveSkillEditability` (Phase 2D.1).
 *
 * Locks down the contract that the Skills manager UI relies on:
 *   - SDK skills are always read-only with reason='sdk'
 *   - Project skills outside the resolved cwd report 'out_of_cwd'
 *   - Project skills with no cwd context report 'out_of_cwd'
 *   - Files without W_OK report 'file_not_writable'
 *   - Otherwise editable=true
 *
 * Uses a real os.tmpdir() workspace so we exercise the actual fs.access
 * path (not a mock). On macOS / Linux chmod 0o400 reliably makes a file
 * non-writable for the current user.
 *
 * Run with: npx tsx --test src/__tests__/unit/skills-editability.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deriveSkillEditability } from '../../lib/skills-editability';

let tmpRoot = '';
let writableFile = '';
let readOnlyFile = '';
let outsideFile = '';

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-editability-'));
  // A writable project skill inside the cwd subtree.
  const cwdDir = path.join(tmpRoot, 'workspace', '.claude', 'commands');
  fs.mkdirSync(cwdDir, { recursive: true });
  writableFile = path.join(cwdDir, 'fix.md');
  fs.writeFileSync(writableFile, '# fix\n', 'utf8');

  // A read-only file inside the same workspace.
  readOnlyFile = path.join(cwdDir, 'locked.md');
  fs.writeFileSync(readOnlyFile, '# locked\n', 'utf8');
  fs.chmodSync(readOnlyFile, 0o400);

  // A skill file that is *outside* the workspace.
  const outsideDir = path.join(tmpRoot, 'elsewhere', '.claude', 'commands');
  fs.mkdirSync(outsideDir, { recursive: true });
  outsideFile = path.join(outsideDir, 'orphan.md');
  fs.writeFileSync(outsideFile, '# orphan\n', 'utf8');
});

after(() => {
  // Restore writable so rmSync can clean it up.
  try { fs.chmodSync(readOnlyFile, 0o600); } catch {}
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('deriveSkillEditability — SDK', () => {
  it('SDK source is always read-only with reason="sdk"', () => {
    const r = deriveSkillEditability({ source: 'sdk', filePath: '' });
    assert.deepEqual(r, { editable: false, readOnlyReason: 'sdk' });
  });
  it('SDK source is read-only even when filePath happens to be writable', () => {
    const r = deriveSkillEditability({ source: 'sdk', filePath: writableFile });
    assert.deepEqual(r, { editable: false, readOnlyReason: 'sdk' });
  });
});

describe('deriveSkillEditability — project', () => {
  const cwd = () => path.join(tmpRoot, 'workspace');

  it('project + writable + inside cwd → editable', () => {
    const r = deriveSkillEditability(
      { source: 'project', filePath: writableFile },
      cwd(),
    );
    assert.deepEqual(r, { editable: true });
  });

  it('project + outside cwd → out_of_cwd', () => {
    const r = deriveSkillEditability(
      { source: 'project', filePath: outsideFile },
      cwd(),
    );
    assert.deepEqual(r, { editable: false, readOnlyReason: 'out_of_cwd' });
  });

  it('project + no cwd context → out_of_cwd (we do not guess)', () => {
    const r = deriveSkillEditability(
      { source: 'project', filePath: writableFile },
      undefined,
    );
    assert.deepEqual(r, { editable: false, readOnlyReason: 'out_of_cwd' });
  });

  it('project + inside cwd but read-only file → file_not_writable', () => {
    const r = deriveSkillEditability(
      { source: 'project', filePath: readOnlyFile },
      cwd(),
    );
    assert.deepEqual(r, { editable: false, readOnlyReason: 'file_not_writable' });
  });
});

describe('deriveSkillEditability — file-backed sources (global / installed / plugin)', () => {
  for (const source of ['global', 'installed', 'plugin'] as const) {
    it(`${source} + writable file → editable`, () => {
      const r = deriveSkillEditability({ source, filePath: writableFile });
      assert.deepEqual(r, { editable: true });
    });

    it(`${source} + read-only file → file_not_writable`, () => {
      const r = deriveSkillEditability({ source, filePath: readOnlyFile });
      assert.deepEqual(r, { editable: false, readOnlyReason: 'file_not_writable' });
    });

    it(`${source} + missing file → file_not_writable (W_OK rejects)`, () => {
      const ghost = path.join(tmpRoot, 'workspace', '.claude', 'commands', 'ghost.md');
      const r = deriveSkillEditability({ source, filePath: ghost });
      assert.deepEqual(r, { editable: false, readOnlyReason: 'file_not_writable' });
    });

    it(`${source} + empty filePath → file_not_writable`, () => {
      const r = deriveSkillEditability({ source, filePath: '' });
      assert.deepEqual(r, { editable: false, readOnlyReason: 'file_not_writable' });
    });
  }

  it('cwd argument is ignored for non-project sources', () => {
    // Even though `outsideFile` is "outside" the cwd, a plugin skill
    // backed by a writable file is still editable — cwd is only enforced
    // for source === "project".
    const r = deriveSkillEditability(
      { source: 'plugin', filePath: outsideFile },
      path.join(tmpRoot, 'workspace'),
    );
    assert.deepEqual(r, { editable: true });
  });
});
