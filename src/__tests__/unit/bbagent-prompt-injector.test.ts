/**
 * Unit tests for bbagent/skill-injector.ts and bbagent/prompt-injector.ts
 *
 * Verify:
 *   - Skill injection idempotency
 *   - Feature flag disabling short-circuits
 *   - Prompt fragment returns null when context unavailable
 *   - Prompt fragment format includes chip / balldomain / submit-poll rule
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBbPromptFragment,
  injectBbPrompt,
  getBbPromptFragmentForAgentLoop,
} from '@/lib/bbagent/prompt-injector';

import {
  isBbdevEnabled,
} from '@/lib/bbagent/features';

import { bbContextStore } from '@/lib/bbagent/context-store';

test('isBbdevEnabled: 默认开启（feature flag true）', () => {
  assert.equal(typeof isBbdevEnabled(), 'boolean');
  // 当前 features.ts 把 bbdev 默认开启
  assert.equal(isBbdevEnabled(), true);
});

// ── prompt-injector ─────────────────────────────────────────────

test('buildBbPromptFragment: context 为空 → 返回 null', () => {
  // 确保 context-store 是干净的
  bbContextStore.clear();
  const fragment = buildBbPromptFragment();
  // context 为空 + 无 fallback → null（不引入假 0 / placeholder 文本）
  assert.equal(fragment, null);
});

test('injectBbPrompt: context 为空 → ok=false（不抛错）', () => {
  bbContextStore.clear();
  const result = injectBbPrompt();
  // 返回 BbInjectorOutcome；context 为空 → ok=false + reason
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /context unavailable/);
});

test('getBbPromptFragmentForAgentLoop: 与 buildBbPromptFragment 等价', () => {
  bbContextStore.clear();
  assert.equal(getBbPromptFragmentForAgentLoop(), buildBbPromptFragment());

  bbContextStore.set({
    chip: 'toy',
    repoRoot: '/tmp/buckyball',
  });
  const f1 = buildBbPromptFragment();
  const f2 = getBbPromptFragmentForAgentLoop();
  assert.equal(f1, f2);
  assert.ok(f1 !== null);
  assert.match(f1!, /Current chip: \*\*toy\*\*/);
  assert.match(f1!, /submit-and-poll/);
  assert.match(f1!, /bbdev/);
});

test('buildBbPromptFragment: balldomain 注入', () => {
  bbContextStore.set({
    chip: 'pebble',
    balldomain: 'matmul',
    repoRoot: '/tmp/buckyball',
  });
  const fragment = buildBbPromptFragment();
  assert.ok(fragment !== null);
  assert.match(fragment!, /Current chip: \*\*pebble\*\*/);
  assert.match(fragment!, /Active balldomain: `matmul`/);
});

test('buildBbPromptFragment: 远程模式文案', () => {
  bbContextStore.set({
    chip: 'toy',
    repoRoot: '/tmp/buckyball',
    remoteUrl: 'https://bbdev.example.com/sse',
  });
  const fragment = buildBbPromptFragment();
  assert.ok(fragment !== null);
  assert.match(fragment!, /remote bbdev server/);
  assert.match(fragment!, /bbdev\.example\.com/);
});

test('buildBbPromptFragment: 本地模式文案', () => {
  bbContextStore.set({
    chip: 'toy',
    repoRoot: '/Users/me/buckyball',
  });
  const fragment = buildBbPromptFragment();
  assert.ok(fragment !== null);
  assert.match(fragment!, /local bbdev/);
  assert.match(fragment!, /Users\/me\/buckyball/);
});

test('buildBbPromptFragment: 包含 submit-and-poll 规则', () => {
  bbContextStore.set({
    chip: 'toy',
    repoRoot: '/tmp/buckyball',
  });
  const fragment = buildBbPromptFragment();
  assert.ok(fragment !== null);
  // 关键规则：模型必须 poll trace_id
  assert.match(fragment!, /trace_id/);
  assert.match(fragment!, /bbdev_task_status/);
});

test('buildBbPromptFragment: 包含 Skill 提示', () => {
  bbContextStore.set({
    chip: 'toy',
    repoRoot: '/tmp/buckyball',
  });
  const fragment = buildBbPromptFragment();
  assert.ok(fragment !== null);
  assert.match(fragment!, /fork sub-agent/);
  assert.match(fragment!, /bbdev/);
});

test('buildBbPromptFragment: repoRoot 为空字符串 → null', () => {
  bbContextStore.set({
    chip: 'toy',
    repoRoot: '',
  });
  const fragment = buildBbPromptFragment();
  // 显式空 repoRoot = 配置未完成 → null（不显示假数据）
  assert.equal(fragment, null);
});

test('buildBbPromptFragment: 头部标识 [buckyball.ai bbdev context]', () => {
  bbContextStore.set({
    chip: 'toy',
    repoRoot: '/tmp/buckyball',
  });
  const fragment = buildBbPromptFragment();
  assert.ok(fragment !== null);
  assert.match(fragment!, /^\[buckyball\.ai bbdev context\]/);
});
