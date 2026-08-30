/**
 * Phase 5e Phase 5 (2026-05-18) — mutationLevel completeness tests.
 *
 * Pins:
 *   1. Every CodePilot tool in `HARNESS_CAPABILITIES.toolNames` MUST
 *      have a classification in `CODEPILOT_TOOL_MUTATION_LEVELS`.
 *      Missing → fail. This forces tool authors to decide at the
 *      point of declaration, not after a smoke surprise.
 *   2. Mutating tools (cli_tools_install / dashboard_pin / notify /
 *      schedule_task / generate_image / etc.) MUST NOT be classified
 *      as `safe_read`.
 *   3. `PERMISSION_SAFE_TOOLS` (the runtime-derived allowlist) must
 *      be byte-identical to:
 *         CORE_SAFE_READ_TOOLS ∪
 *         { name | mutationLevel(name) === 'safe_read' }
 *      i.e. derivation has no bugs and no side-table.
 *   4. `shouldSkipPermission` is fail-safe — returns false for
 *      unknown tools, true only for declared safe_read.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_CAPABILITIES } from '@/lib/harness/capability-contract';
import {
  CODEPILOT_TOOL_MUTATION_LEVELS,
  CORE_SAFE_READ_TOOLS,
  getMutationLevel,
  shouldSkipPermission,
  type MutationLevel,
} from '@/lib/harness/mutation-level';
import { PERMISSION_SAFE_TOOLS } from '@/lib/agent-tools';

describe('mutation-level — completeness vs capability catalog', () => {
  it('every catalog toolName has a mutationLevel classification', () => {
    const classified = new Set(Object.keys(CODEPILOT_TOOL_MUTATION_LEVELS));
    for (const cap of HARNESS_CAPABILITIES) {
      for (const toolName of cap.toolNames) {
        assert.ok(
          classified.has(toolName),
          `Catalog tool "${toolName}" has no mutationLevel classification. Add it to CODEPILOT_TOOL_MUTATION_LEVELS in src/lib/harness/mutation-level.ts with rationale.`,
        );
      }
    }
  });
});

describe('mutation-level — mutating tools must NOT be safe_read', () => {
  const mustNotBeSafeRead: ReadonlyArray<{ name: string; expectedLevel: MutationLevel; danger: string }> = [
    { name: 'codepilot_cli_tools_install', expectedLevel: 'mutating_external', danger: 'shell-execs npm / brew / pip install' },
    { name: 'codepilot_cli_tools_remove', expectedLevel: 'mutating_external', danger: 'shell-execs uninstall' },
    { name: 'codepilot_cli_tools_update', expectedLevel: 'mutating_external', danger: 'shell-execs upgrade' },
    { name: 'codepilot_cli_tools_add', expectedLevel: 'mutating_external', danger: 'adds tool to user catalog' },
    { name: 'codepilot_notify', expectedLevel: 'side_effect', danger: 'system toast / Telegram bridge' },
    { name: 'codepilot_schedule_task', expectedLevel: 'mutating_local', danger: 'durable DB write' },
    { name: 'codepilot_cancel_task', expectedLevel: 'mutating_local', danger: 'cancels user task' },
    { name: 'codepilot_hatch_buddy', expectedLevel: 'mutating_local', danger: 'creates buddy assets' },
    { name: 'codepilot_generate_image', expectedLevel: 'mutating_external', danger: 'third-party API + file write' },
    { name: 'codepilot_generate_video', expectedLevel: 'mutating_external', danger: 'billed Grok Imagine API + file write' },
    { name: 'codepilot_import_media', expectedLevel: 'mutating_local', danger: 'writes user file to media lib' },
    { name: 'codepilot_dashboard_pin', expectedLevel: 'mutating_local', danger: 'mutates user dashboard' },
    { name: 'codepilot_dashboard_update', expectedLevel: 'mutating_local', danger: 'rewrites pinned widget' },
    { name: 'codepilot_dashboard_remove', expectedLevel: 'mutating_local', danger: 'unpins widget' },
  ];

  for (const { name, expectedLevel, danger } of mustNotBeSafeRead) {
    it(`${name} → ${expectedLevel} (danger: ${danger})`, () => {
      const level = CODEPILOT_TOOL_MUTATION_LEVELS[name];
      assert.equal(
        level,
        expectedLevel,
        `${name} classified as "${level}" but must be "${expectedLevel}"`,
      );
      assert.notEqual(level, 'safe_read', `${name} must not be safe_read`);
    });
  }
});

describe('mutation-level — safe_read tools enumeration', () => {
  const mustBeSafeRead: readonly string[] = [
    'codepilot_memory_recent',
    'codepilot_memory_search',
    'codepilot_memory_get',
    'codepilot_load_widget_guidelines',
    'codepilot_list_tasks',
    'codepilot_dashboard_list',
    'codepilot_dashboard_refresh',
    'codepilot_cli_tools_list',
    'codepilot_cli_tools_check_updates',
    'codepilot_session_search',
    'codepilot_list_subagent_runs',
    'codepilot_spawn_subagent',
  ];

  for (const name of mustBeSafeRead) {
    it(`${name} === safe_read`, () => {
      assert.equal(CODEPILOT_TOOL_MUTATION_LEVELS[name], 'safe_read');
    });
  }
});

describe('mutation-level — PERMISSION_SAFE_TOOLS derivation', () => {
  it('PERMISSION_SAFE_TOOLS = CORE_SAFE_READ_TOOLS ∪ safe_read codepilot tools', () => {
    const derived = new Set<string>(CORE_SAFE_READ_TOOLS);
    for (const [name, level] of Object.entries(CODEPILOT_TOOL_MUTATION_LEVELS)) {
      if (level === 'safe_read') derived.add(name);
    }
    // Same set membership
    assert.equal(PERMISSION_SAFE_TOOLS.size, derived.size);
    for (const name of derived) {
      assert.ok(
        PERMISSION_SAFE_TOOLS.has(name),
        `${name} should be in PERMISSION_SAFE_TOOLS (derived from safe_read)`,
      );
    }
    for (const name of PERMISSION_SAFE_TOOLS) {
      assert.ok(
        derived.has(name),
        `${name} in PERMISSION_SAFE_TOOLS but not derivable from mutation-level table — derivation broken`,
      );
    }
  });
});

describe('mutation-level — shouldSkipPermission fail-safe semantics', () => {
  it('returns true for core read-only tools', () => {
    for (const name of ['Read', 'Glob', 'Grep', 'Skill']) {
      assert.equal(shouldSkipPermission(name), true);
    }
  });

  it('returns true for safe_read codepilot tools', () => {
    assert.equal(shouldSkipPermission('codepilot_memory_search'), true);
    assert.equal(shouldSkipPermission('codepilot_dashboard_list'), true);
  });

  it('returns false for mutating codepilot tools', () => {
    assert.equal(shouldSkipPermission('codepilot_cli_tools_install'), false);
    assert.equal(shouldSkipPermission('codepilot_dashboard_pin'), false);
    assert.equal(shouldSkipPermission('codepilot_notify'), false);
  });

  it('returns false for unknown tools (fail-safe)', () => {
    assert.equal(shouldSkipPermission('codepilot_future_tool_not_yet_classified'), false);
    assert.equal(shouldSkipPermission('SomeRandomName'), false);
  });

  it('getMutationLevel returns undefined for unknown tools', () => {
    assert.equal(getMutationLevel('codepilot_unknown_xyz'), undefined);
  });
});
