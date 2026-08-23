import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateWorkingDirectory } from '@/lib/bridge/security/validators';

const root = path.join(os.tmpdir(), `codepilot-bridge-cwd-${Date.now()}`);
const unicodeDirectory = path.join(root, '中文 游戏 (测试)&$资料');

describe('bridge working-directory validation', () => {
  before(() => fs.mkdirSync(unicodeDirectory, { recursive: true }));
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('accepts an existing Unicode directory with legal Windows characters', () => {
    assert.equal(validateWorkingDirectory(unicodeDirectory), path.normalize(unicodeDirectory));
  });

  it('rejects missing paths and files instead of silently binding them as CWD', () => {
    const filePath = path.join(root, 'file.txt');
    fs.writeFileSync(filePath, 'not a directory');
    assert.equal(validateWorkingDirectory(path.join(root, 'missing')), null);
    assert.equal(validateWorkingDirectory(filePath), null);
  });

  it('rejects relative traversal and control characters', () => {
    assert.equal(validateWorkingDirectory('../project'), null);
    assert.equal(validateWorkingDirectory(`${unicodeDirectory}\0suffix`), null);
  });
});
