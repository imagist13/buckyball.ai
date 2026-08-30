/**
 * chat-runtime.test.ts — regression coverage for the runtime registry
 * import side effect.
 *
 * Background: chat-runtime.ts MUST import resolveRuntime via the
 * `runtime/index.ts` barrel, not directly from `runtime/registry.ts`.
 * The barrel calls `registerRuntime(nativeRuntime)` and
 * `registerRuntime(sdkRuntime)` at import time; pulling resolveRuntime
 * from the registry module skips that registration. When
 * `/api/providers/models?runtime=auto` was the first runtime consumer
 * in a request's dep graph, the registry was empty and resolveRuntime
 * threw "No agent runtime registered" — surfacing as a 500 to the
 * picker / chat page init.
 *
 * These tests reproduce that path: importing chat-runtime alone (no
 * other code that already triggered the barrel) and calling
 * getActiveChatRuntime() must succeed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getActiveChatRuntime, isChatRuntimeParam, resolveChatRuntimeParam, chatRuntimeParamForSession } from '../../lib/chat-runtime';
import { getSetting, setSetting } from '../../lib/db';
import { RUNTIME_IDS } from '@/lib/runtime/runtime-id';

const runtimeIdSet: ReadonlySet<string> = new Set<string>(RUNTIME_IDS);

describe('chat-runtime registry side effects', () => {
  it('getActiveChatRuntime() does not throw when chat-runtime is the entry import', () => {
    // The actual regression: importing chat-runtime above and immediately
    // calling getActiveChatRuntime() must NOT throw "No agent runtime
    // registered". If this test starts failing with that message,
    // chat-runtime.ts has been changed back to import from
    // ./runtime/registry instead of the ./runtime barrel.
    assert.doesNotThrow(() => getActiveChatRuntime());
  });

  it('returns a label from the canonical RUNTIME_IDS set', () => {
    const result = getActiveChatRuntime();
    assert.ok(
      runtimeIdSet.has(result),
      `expected a member of RUNTIME_IDS (${[...RUNTIME_IDS].join(' | ')}), got ${result}`,
    );
  });

  it('agent_runtime=native + cli disabled → codepilot_runtime (deterministic)', () => {
    // Pin BOTH inputs resolveRuntime reads so this is genuinely deterministic.
    // Under db-isolation.setup.ts each worker gets a FRESH empty DB: cli_enabled
    // is unset and no provider is configured, so native.isAvailable() is false
    // → resolveRuntime would fall through to the SDK (claude_code). Setting
    // cli_enabled='false' fires the cli_disabled short-circuit (registry.ts
    // step 2), which returns Native regardless of provider config — the real
    // state when a user runs Native/CodePilot. (Pre-isolation this test silently
    // relied on the developer's real ~/.codepilot DB happening to have
    // cli_enabled='false'; the old "no env dependency" claim was wrong.)
    const savedRt = getSetting('agent_runtime');
    const savedCli = getSetting('cli_enabled');
    setSetting('agent_runtime', 'native');
    setSetting('cli_enabled', 'false');
    try {
      assert.equal(getActiveChatRuntime(), 'codepilot_runtime');
    } finally {
      setSetting('agent_runtime', savedRt || '');
      setSetting('cli_enabled', savedCli || '');
    }
  });

  it('cli_enabled=false + agent_runtime=claude-code-sdk (no session override) → codepilot_runtime', () => {
    const savedCli = getSetting('cli_enabled');
    const savedRt = getSetting('agent_runtime');
    setSetting('cli_enabled', 'false');
    setSetting('agent_runtime', 'claude-code-sdk');
    try {
      // Phase 5e round 8 — comment updated. cli_disabled is no longer
      // the "highest-priority" constraint in resolveRuntime: an
      // explicit session pin to claude_code now wins over it. But
      // here we call `getActiveChatRuntime()` with NO session pin, so
      // resolveRuntime gets overrideId=undefined and the cli_disabled
      // short-circuit (step 2) still fires → native. The session-pin
      // win is tested separately in runtime-selection.test.ts /
      // session-runtime-immunity-claude-pin.test.ts.
      assert.equal(getActiveChatRuntime(), 'codepilot_runtime');
    } finally {
      setSetting('cli_enabled', savedCli || '');
      setSetting('agent_runtime', savedRt || '');
    }
  });
});

describe('chat-runtime param helpers', () => {
  it('isChatRuntimeParam accepts every RUNTIME_IDS member + "auto", rejects everything else', () => {
    // Iterate the canonical set so adding a new runtime to RUNTIME_IDS
    // automatically extends this assertion.
    for (const id of RUNTIME_IDS) {
      assert.equal(isChatRuntimeParam(id), true, `RUNTIME_IDS member ${id} must be accepted`);
    }
    assert.equal(isChatRuntimeParam('auto'), true);
    assert.equal(isChatRuntimeParam(''), false);
    assert.equal(isChatRuntimeParam(null), false);
    assert.equal(isChatRuntimeParam(undefined), false);
    assert.equal(isChatRuntimeParam('claude-code'), false);
    assert.equal(isChatRuntimeParam('UNKNOWN_RUNTIME'), false);
  });

  it('resolveChatRuntimeParam passes explicit RUNTIME_IDS through, resolves auto via canonical set', () => {
    for (const id of RUNTIME_IDS) {
      assert.equal(resolveChatRuntimeParam(id), id);
    }
    const auto = resolveChatRuntimeParam('auto');
    assert.ok(
      runtimeIdSet.has(auto),
      `auto resolution must return a RUNTIME_IDS member, got ${auto}`,
    );
  });
});

describe('chatRuntimeParamForSession (Phase 2 Step 3b)', () => {
  it('valid RUNTIME_IDS pin → that pin (immune to global)', () => {
    for (const id of RUNTIME_IDS) {
      assert.equal(chatRuntimeParamForSession(id), id);
    }
  });

  it('empty / undefined / null → "auto" (follow global)', () => {
    assert.equal(chatRuntimeParamForSession(''), 'auto');
    assert.equal(chatRuntimeParamForSession(undefined), 'auto');
    assert.equal(chatRuntimeParamForSession(null), 'auto');
  });

  it('legacy / corrupt unknown value → "auto" (defensive)', () => {
    // If a future legacy row holds a stale label form ('sdk', 'claude-code'),
    // we'd rather fall through to global than route the picker into an
    // unrecognized state. The downstream useProviderModels server filter
    // is the second line of defense.
    assert.equal(chatRuntimeParamForSession('sdk'), 'auto');
    assert.equal(chatRuntimeParamForSession('claude-code'), 'auto');
    assert.equal(chatRuntimeParamForSession('CLAUDE_CODE'), 'auto');
  });
});
