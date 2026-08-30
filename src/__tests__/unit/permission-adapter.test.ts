/**
 * Phase 0.5 Slice D — Permission adapter translators.
 *
 * Pins the adapter-side translation contract: each runtime's native
 * approval / sandbox / confirm shape collapses into the canonical
 * 4-event `RuntimePermissionEvent` union. UI consumes only the
 * union; adapters never let their native shape leak past this layer.
 *
 * Slice D adds the ClaudeCode SDK translator + 3 terminal-event
 * helpers (granted / denied / unavailable). Codex slice adds
 * `translateCodexApproval` alongside without changing the UI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  translateClaudeCodePermissionRequest,
  emitPermissionGranted,
  emitPermissionDenied,
  emitPermissionUnavailable,
} from '@/lib/runtime/permission-adapter';
import type { PermissionRequestEvent } from '@/types';

describe('translateClaudeCodePermissionRequest', () => {
  it('maps SDK fields into the canonical permission_request shape', () => {
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'req-001',
      toolName: 'Bash',
      toolInput: { cmd: 'rm -rf /' },
      toolUseId: 'tu-1',
      description: 'Run shell command',
      decisionReason: 'destructive_path',
      blockedPath: '/',
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 'session-xyz');
    assert.equal(canonical.type, 'permission_request');
    assert.equal(canonical.runtimeId, 'claude_code');
    assert.equal(canonical.sessionId, 'session-xyz');
    assert.equal(canonical.requestId, 'req-001');
    assert.equal(canonical.subject, 'Bash · /');
    assert.equal(canonical.details, 'Run shell command\ndestructive_path');
  });

  it('preserves toolName / toolInput / toolUseId for downstream UI', () => {
    // P1.2 fix — PermissionPrompt distinguishes ExitPlanMode /
    // AskUserQuestion / generic tools by `toolName`, renders
    // arguments from `toolInput`, and echoes `toolUseId` on resume.
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'req-100',
      toolName: 'ExitPlanMode',
      toolInput: { plan: 'step 1\nstep 2' },
      toolUseId: 'tu-100',
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 's');
    assert.equal(canonical.toolName, 'ExitPlanMode');
    assert.deepEqual(canonical.toolInput, { plan: 'step 1\nstep 2' });
    assert.equal(canonical.toolUseId, 'tu-100');
  });

  it('translates SDK suggestions into canonical permissionHints', () => {
    // PermissionPrompt's "Allow for session" / "Allow for project"
    // buttons render off this list. Fields are kept structurally
    // identical to PermissionSuggestion so the migration is loss-free.
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'req-200',
      toolName: 'Bash',
      toolInput: { cmd: 'ls' },
      toolUseId: 'tu-200',
      suggestions: [
        { type: 'addRule', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Bash' }] },
        { type: 'addToAllowlist', behavior: 'allow', destination: 'project' },
      ],
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 's');
    assert.equal(canonical.permissionHints?.length, 2);
    assert.equal(canonical.permissionHints?.[0].type, 'addRule');
    assert.equal(canonical.permissionHints?.[0].behavior, 'allow');
    assert.equal(canonical.permissionHints?.[0].destination, 'session');
    assert.equal(canonical.permissionHints?.[0].rules?.[0].toolName, 'Bash');
    assert.equal(canonical.permissionHints?.[1].destination, 'project');
  });

  it('omits permissionHints when SDK suggestions array is empty / absent', () => {
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'req-201',
      toolName: 'Read',
      toolInput: {},
      toolUseId: 'tu-201',
      suggestions: [],
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 's');
    assert.equal(canonical.permissionHints, undefined);
  });

  it('carries nativeRequestRef so SDK-side resume can round-trip', () => {
    // UI MUST NOT inspect nativeRequestRef.raw — adapter owns the
    // shape. The contract is: round-trip ref exists, runtimeId
    // matches, raw is the SDK event verbatim.
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'req-300',
      toolName: 'Edit',
      toolInput: { path: '/tmp/a' },
      toolUseId: 'tu-300',
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 's');
    assert.ok(canonical.nativeRequestRef);
    assert.equal(canonical.nativeRequestRef?.runtimeId, 'claude_code');
    assert.equal(canonical.nativeRequestRef?.raw, sdk);
  });

  it('omits details when neither description nor decisionReason is set', () => {
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'req-002',
      toolName: 'Read',
      toolInput: { path: '/etc/passwd' },
      toolUseId: 'tu-2',
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 's');
    assert.equal(canonical.subject, 'Read');
    assert.equal(canonical.details, undefined);
  });

  it('preserves the SDK requestId verbatim so resume can echo it back', () => {
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'pr_abc_123-xyz',
      toolName: 'Edit',
      toolInput: {},
      toolUseId: 'tu-3',
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 's');
    assert.equal(canonical.requestId, 'pr_abc_123-xyz');
  });
});

describe('Terminal-event helpers', () => {
  it('emitPermissionGranted produces a minimal granted event', () => {
    const e = emitPermissionGranted('claude_code', 's', 'r');
    assert.deepEqual(e, {
      type: 'permission_granted',
      runtimeId: 'claude_code',
      sessionId: 's',
      requestId: 'r',
    });
  });

  it('emitPermissionDenied omits reason when not provided', () => {
    const e = emitPermissionDenied('claude_code', 's', 'r');
    assert.deepEqual(e, {
      type: 'permission_denied',
      runtimeId: 'claude_code',
      sessionId: 's',
      requestId: 'r',
    });
  });

  it('emitPermissionDenied carries the reason when provided', () => {
    const e = emitPermissionDenied('claude_code', 's', 'r', 'user clicked deny');
    assert.equal(e.type, 'permission_denied');
    assert.equal((e as { reason?: string }).reason, 'user clicked deny');
  });

  it('emitPermissionUnavailable always carries a reason — conservative default', () => {
    const e = emitPermissionUnavailable(
      'codepilot_runtime',
      's',
      'r',
      'adapter does not map this approval kind yet',
    );
    assert.equal(e.type, 'permission_unavailable');
    assert.equal(e.reason, 'adapter does not map this approval kind yet');
    // Conservative default contract: this event must NEVER imply granted.
    // The fact that the type exists distinguishes it from granted at the
    // type level — UI is forced to render it differently.
    assert.notEqual(e.type as string, 'permission_granted');
  });
});

describe('Conservative default contract', () => {
  it('permission_unavailable is the documented escape hatch for unknown semantics', () => {
    // Implementer guidance check: when an adapter encounters an
    // approval event it can't classify, it MUST emit
    // permission_unavailable (not fall-through to granted). This
    // test is a documentation pin — failing it means someone removed
    // emitPermissionUnavailable from the public API.
    assert.equal(typeof emitPermissionUnavailable, 'function');
  });
});
