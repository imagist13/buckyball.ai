/**
 * bbdev skill-generator — unit tests
 *
 * 覆盖：
 * - renderBbdevSkillMarkdown 生成有效的 frontmatter + body
 * - generateBbdevSkillDefinition 返回 SkillDefinition（context=fork, allowedTools 非空）
 * - buildAllowedTools 包含所有 bbdev 工具（除 bbdev_dc_verilog）+ Read/Glob/Grep/Bash
 * - 模板变量 ${CLAUDE_SKILL_DIR} 被正确替换
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  renderBbdevSkillMarkdown,
  generateBbdevSkillDefinition,
  buildAllowedTools,
  BBDEV_SKILL_NAME,
  BBDEV_SKILL_FILENAME,
} from '../../lib/bbdev/skill-generator';

const TEST_CONFIG = {
  mode: 'local' as const,
  repoRoot: '/tmp/buckyball-test',
  chipName: 'riscv',
  balldomain: 'matmul',
  autoStartLocal: true,
};

describe('bbdev/skill-generator', () => {
  it('constants are exported', () => {
    assert.equal(BBDEV_SKILL_NAME, 'bbdev');
    assert.equal(BBDEV_SKILL_FILENAME, 'SKILL.md');
  });

  it('renderBbdevSkillMarkdown contains frontmatter with fork context', () => {
    const md = renderBbdevSkillMarkdown(TEST_CONFIG);
    assert.match(md, /^---\n/);
    assert.match(md, /name: bbdev/);
    assert.match(md, /context: fork/);
    assert.match(md, /user-invocable: true/);
    assert.match(md, /allowed-tools:/);
  });

  it('renderBbdevSkillMarkdown contains chip and balldomain', () => {
    const md = renderBbdevSkillMarkdown(TEST_CONFIG);
    assert.match(md, /riscv/);
    assert.match(md, /matmul/);
  });

  it('renderBbdevSkillMarkdown handles missing balldomain', () => {
    const md = renderBbdevSkillMarkdown({ ...TEST_CONFIG, balldomain: undefined });
    assert.match(md, /name: bbdev/);
    // 不应包含 `balldomain `matmul``
    assert.doesNotMatch(md, /balldomain `matmul`/);
  });

  it('generateBbdevSkillDefinition returns SkillDefinition with fork context', () => {
    const def = generateBbdevSkillDefinition(TEST_CONFIG);
    assert.equal(def.name, 'bbdev');
    assert.equal(def.context, 'fork');
    assert.equal(def.userInvocable, true);
    assert.ok(def.allowedTools.length > 0);
    assert.ok(
      def.filePath.endsWith(path.join(BBDEV_SKILL_NAME, BBDEV_SKILL_FILENAME)),
      `filePath should end with <bbdev/SKILL.md>, got: ${def.filePath}`,
    );
    assert.equal(def.arguments.length, 2);
    assert.ok(def.arguments.some(a => a.name === 'operation'));
    assert.ok(def.arguments.some(a => a.name === 'target'));
  });

  it('generateBbdevSkillDefinition contains $CLAUDE_SKILL_DIR placeholder', () => {
    const def = generateBbdevSkillDefinition(TEST_CONFIG);
    assert.match(def.body, /\$CLAUDE_SKILL_DIR/);
  });

  it('buildAllowedTools includes bbdev tools (excluding bbdev_dc_verilog) and Read/Glob/Grep/Bash', () => {
    const tools = buildAllowedTools();
    assert.ok(tools.includes('Read'));
    assert.ok(tools.includes('Glob'));
    assert.ok(tools.includes('Grep'));
    assert.ok(tools.includes('Bash'));
    assert.ok(tools.includes('bbdev_compiler_build'));
    assert.ok(tools.includes('bbdev_bemu_sim'));
    assert.ok(tools.includes('validate'));
    // DC 单独门控
    assert.ok(!tools.includes('bbdev_dc_verilog'));
  });
});
