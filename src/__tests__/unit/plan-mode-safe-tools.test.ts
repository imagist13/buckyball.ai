/**
 * #26 — Native Plan / read-only 模式必须保留 safe_read Harness 能力（尤其
 * codepilot_load_widget_guidelines + widget wire-format prompt），而不是只剩
 * Read/Glob/Grep；mutating 工具（Write/Edit/Bash + 生图/dashboard/schedule/
 * notify/media import）继续禁用。修复前 assembleTools({mode:'plan'}) 硬编码
 * 只返回 Read/Glob/Grep + 空 systemPrompts，导致 Native Plan 模式无法生成 Widget。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assembleTools } from '../../lib/agent-tools';

describe('#26 Plan mode — safe-read Harness capabilities survive, mutating stay out', () => {
  const plan = assembleTools({ mode: 'plan' });
  const toolNames = Object.keys(plan.tools);
  const prompts = plan.systemPrompts.join('\n');

  it('keeps read-only coding tools, drops mutating ones', () => {
    assert.ok(toolNames.includes('Read'), 'Read present');
    assert.ok(toolNames.includes('Glob'), 'Glob present');
    assert.ok(toolNames.includes('Grep'), 'Grep present');
    assert.ok(!toolNames.includes('Write'), 'Write must be absent in plan');
    assert.ok(!toolNames.includes('Edit'), 'Edit must be absent in plan');
    assert.ok(!toolNames.includes('Bash'), 'Bash must be absent in plan');
  });

  it('keeps codepilot_load_widget_guidelines + its wire-format prompt (FINAL OUTPUT FORMAT)', () => {
    assert.ok(
      toolNames.includes('codepilot_load_widget_guidelines'),
      'widget guideline loader must survive in plan mode',
    );
    assert.match(
      prompts,
      /FINAL OUTPUT FORMAT/,
      'widget wire-format spec must be present in plan-mode systemPrompts',
    );
  });

  it('drops mutating Harness tools (image gen / dashboard / schedule / notify / media import)', () => {
    for (const mut of [
      'codepilot_generate_image',
      'codepilot_dashboard_pin',
      'codepilot_schedule_task',
      'codepilot_notify',
      'codepilot_import_media',
    ]) {
      assert.ok(!toolNames.includes(mut), `${mut} must NOT be in plan-mode tools`);
    }
  });

  it('normal (non-plan) mode still mounts the mutating Harness tools (no regression)', () => {
    const normal = assembleTools({ mode: 'default' });
    const names = Object.keys(normal.tools);
    assert.ok(
      names.includes('codepilot_load_widget_guidelines'),
      'widget loader present in normal mode',
    );
    assert.ok(
      names.includes('codepilot_notify') || names.includes('codepilot_dashboard_pin'),
      'normal mode should still expose mutating Harness tools',
    );
  });
});
