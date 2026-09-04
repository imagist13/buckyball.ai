/**
 * bbdev skill-registry — unit tests
 *
 * 覆盖：
 * - registerBbdevSkill 在临时目录下写盘（同时 .claude/skills 和 .agents/skills）
 * - isBbdevSkillRegistered 检测任一位置
 * - unregisterBbdevSkill 清理两处
 * - refreshBbdevSkill 检测内容变化
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  registerBbdevSkill,
  unregisterBbdevSkill,
  isBbdevSkillRegistered,
  readBbdevSkillMarkdown,
  refreshBbdevSkill,
} from '../../lib/bbdev/skill-registry';

interface TestConfigShape {
  mode: 'local';
  repoRoot: string;
  chipName: string;
  autoStartLocal: boolean;
}

describe('bbdev/skill-registry', () => {
  let tmpDir: string;
  let testConfig: TestConfigShape;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbdev-skill-registry-'));
    testConfig = {
      mode: 'local',
      repoRoot: tmpDir,
      chipName: 'toy',
      autoStartLocal: true,
    };
  });

  after(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // 每个测试开始前清掉之前 register 留下的 SKILL.md（如果有）
    unregisterBbdevSkill(tmpDir);
  });

  it('registerBbdevSkill writes SKILL.md to both .claude/skills and .agents/skills', () => {
    const result = registerBbdevSkill(testConfig);
    assert.equal(result.skillFiles.length, 2);
    assert.ok(
      result.skillFiles.some(p =>
        p.includes(path.join('.claude', 'skills', 'bbdev', 'SKILL.md')),
      ),
      `expected .claude/skills/bbdev/SKILL.md in ${JSON.stringify(result.skillFiles)}`,
    );
    assert.ok(
      result.skillFiles.some(p =>
        p.includes(path.join('.agents', 'skills', 'bbdev', 'SKILL.md')),
      ),
      `expected .agents/skills/bbdev/SKILL.md in ${JSON.stringify(result.skillFiles)}`,
    );
    for (const f of result.skillFiles) {
      assert.ok(fs.existsSync(f));
    }
  });

  it('isBbdevSkillRegistered returns true after registration', () => {
    registerBbdevSkill(testConfig);
    assert.equal(isBbdevSkillRegistered(tmpDir), true);
  });

  it('readBbdevSkillMarkdown returns non-empty content', () => {
    registerBbdevSkill(testConfig);
    const md = readBbdevSkillMarkdown(tmpDir);
    assert.ok(md);
    assert.match(md!, /name: bbdev/);
    assert.match(md!, /context: fork/);
  });

  it('refreshBbdevSkill returns false when content unchanged', () => {
    registerBbdevSkill(testConfig);
    assert.equal(refreshBbdevSkill(testConfig), false);
  });

  it('refreshBbdevSkill writes when chip changes', () => {
    registerBbdevSkill(testConfig);
    const updated = refreshBbdevSkill({ ...testConfig, chipName: 'riscv' });
    assert.equal(updated, true);
    const md = readBbdevSkillMarkdown(tmpDir);
    assert.match(md!, /riscv/);
  });

  it('unregisterBbdevSkill removes both files', () => {
    registerBbdevSkill(testConfig);
    unregisterBbdevSkill(tmpDir);
    assert.equal(isBbdevSkillRegistered(tmpDir), false);
    assert.equal(readBbdevSkillMarkdown(tmpDir), null);
  });

  it('registerBbdevSkill rejects empty repoRoot', () => {
    assert.throws(
      () => registerBbdevSkill({ ...testConfig, repoRoot: '' }),
      /repoRoot is required/,
    );
  });

  it('registerBbdevSkill rejects non-existent repoRoot', () => {
    assert.throws(
      () => registerBbdevSkill({ ...testConfig, repoRoot: '/nonexistent/path/xyz' }),
      /repoRoot does not exist/,
    );
  });

  it('isBbdevSkillRegistered returns false for empty repoRoot', () => {
    assert.equal(isBbdevSkillRegistered(''), false);
  });

  it('unregisterBbdevSkill is a no-op for empty repoRoot', () => {
    // 不应抛错
    unregisterBbdevSkill('');
  });
});
