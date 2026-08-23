import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyCodexSandboxFailure,
  getCodexSandboxReadiness,
  observeCodexSandboxNotification,
  resetCodexSandboxReadinessForTests,
} from '../../lib/codex/sandbox-readiness';

test('ordinary command failures are not reclassified as Windows sandbox errors', () => {
  assert.equal(classifyCodexSandboxFailure('spawn tool ENOENT'), null);
  assert.equal(classifyCodexSandboxFailure('working directory does not exist'), null);
  assert.equal(
    classifyCodexSandboxFailure('Windows sandbox child spawn failed: ENOENT'),
    'child_spawn',
  );
});

test('sandbox readiness starts unknown and never derives from app-server readiness', () => {
  resetCodexSandboxReadinessForTests();
  assert.deepEqual(getCodexSandboxReadiness(), {
    state: 'unknown',
    probe: 'not_run',
    source: 'not_observed',
  });
});

test('non-Windows hosts ignore Windows sandbox notifications', () => {
  resetCodexSandboxReadinessForTests();
  observeCodexSandboxNotification('windowsSandbox/setupCompleted', { success: true });
  if (process.platform !== 'win32') {
    assert.equal(getCodexSandboxReadiness().state, 'unknown');
  }
});

test('source pins keep setupCompleted observation wired without treating it as full ready', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../lib/codex/sandbox-readiness.ts', import.meta.url), 'utf8');
  assert.match(source, /windowsSandbox\/setupCompleted/);
  assert.match(source, /state:\s*'setup'/);
  assert.doesNotMatch(source, /windowsSandbox\/setupCompleted'[\s\S]{0,800}state:\s*'ready'/);
});

test('refresh clears prior sandbox observations even while app-server remains cached', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../lib/codex/app-server-manager.ts', import.meta.url), 'utf8');
  const refreshStart = source.indexOf('export async function refreshCodexAvailability');
  const refreshBody = source.slice(refreshStart, refreshStart + 900);
  assert.ok(refreshStart >= 0);
  assert.ok(
    refreshBody.indexOf('resetCodexSandboxReadiness()') < refreshBody.indexOf('if (cached)'),
    'refresh must reset the observation before the cached-server early return',
  );
});
