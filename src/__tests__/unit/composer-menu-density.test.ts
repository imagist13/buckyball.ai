/**
 * Composer footer menus have very little horizontal room. Keep explanatory
 * copy concise and keep dynamic capability / permission notices from growing
 * the popovers beyond their explicit width.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const capabilitySrc = fs.readFileSync(
  path.join(repoRoot, 'components/chat/ModelCapabilityDropdown.tsx'),
  'utf8',
);
const permissionSrc = fs.readFileSync(
  path.join(repoRoot, 'components/chat/ChatPermissionSelector.tsx'),
  'utf8',
);
const zh = fs.readFileSync(path.join(repoRoot, 'i18n/zh.ts'), 'utf8');
const en = fs.readFileSync(path.join(repoRoot, 'i18n/en.ts'), 'utf8');

function translation(source: string, key: string): string {
  const match = source.match(new RegExp(`['"]${key.replaceAll('.', '\\.') }['"]\\s*:\\s*['"]([^'"]+)['"]`));
  assert.ok(match, `${key} must exist`);
  return match[1];
}

describe('Composer menu density', () => {
  it('keeps the capability popover at 240px with viewport clamping', () => {
    assert.match(capabilitySrc, /className="w-60 max-w-\[calc\(100vw-2rem\)\]/);
    assert.doesNotMatch(capabilitySrc, /className="w-80 max-w-\[calc\(100vw-2rem\)\]/);
  });

  it('keeps the permission menu bounded and wraps dynamic reasons', () => {
    assert.match(permissionSrc, /className="w-64 max-w-\[calc\(100vw-2rem\)\]"/);
    assert.match(permissionSrc, /break-words/);
    assert.match(permissionSrc, /\{autoReviewNotice\}/);
    assert.match(permissionSrc, /permission\.autoReviewDegraded/);
  });

  it('uses concise capability explanations in both languages', () => {
    assert.equal(translation(zh, 'composer.context1mFixed'), '1M（固定）');
    assert.equal(translation(en, 'composer.context1mFixed'), '1M (fixed)');
    assert.equal(translation(zh, 'messageInput.effort.note.glmCodePlan'), '默认使用最大档');
    assert.equal(translation(en, 'messageInput.effort.note.glmCodePlan'), 'Default uses Max');
    assert.equal(translation(zh, 'messageInput.effort.note.kimiAuto'), '默认由 Kimi 决定');
    assert.equal(translation(en, 'messageInput.effort.note.kimiAuto'), 'Default lets Kimi decide');
  });

  it('uses one-line permission summaries without removing safety notices', () => {
    for (const key of [
      'permission.readOnlyDesc',
      'permission.defaultDesc',
      'permission.autoReviewDesc',
      'permission.fullAccessDesc',
    ]) {
      assert.ok(translation(zh, key).length <= 14, `${key} zh copy is too long`);
      assert.ok(translation(en, key).length <= 42, `${key} en copy is too long`);
    }
    assert.match(permissionSrc, /permission\.autoReviewWarning/);
  });
});
