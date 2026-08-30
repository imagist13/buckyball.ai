/**
 * Phase 0.5 Slice A guardrail — Permission event union must be
 * exactly the 4 canonical types (request / granted / denied /
 * unavailable). Adapters translate their native approval / sandbox /
 * confirm events into this union; UI only consumes the union.
 *
 * Slice D migrates the actual translators; Slice A locks the type
 * definitions + exhaustive list.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNTIME_PERMISSION_EVENT_TYPES,
  type RuntimePermissionEvent,
  type RuntimePermissionEventType,
} from '@/lib/runtime/contract';

describe('RuntimePermissionEvent contract', () => {
  it('exposes exactly 4 canonical permission event types', () => {
    assert.deepEqual(
      [...RUNTIME_PERMISSION_EVENT_TYPES].sort(),
      [
        'permission_denied',
        'permission_granted',
        'permission_request',
        'permission_unavailable',
      ],
    );
  });

  it('union is exhaustive — assertNever guards future drift', () => {
    // Compile-time exhaustiveness: switch on every member of
    // RuntimePermissionEventType. Adding a new event without updating
    // this switch will fail typecheck (the default branch's
    // `_: never` assignment).
    function visit(t: RuntimePermissionEventType): string {
      switch (t) {
        case 'permission_request':
          return 'request';
        case 'permission_granted':
          return 'granted';
        case 'permission_denied':
          return 'denied';
        case 'permission_unavailable':
          return 'unavailable';
        default: {
          const _: never = t;
          throw new Error(`unhandled permission event type: ${String(_)}`);
        }
      }
    }
    for (const t of RUNTIME_PERMISSION_EVENT_TYPES) {
      assert.ok(visit(t).length > 0);
    }
  });

  it('every event carries runtimeId + sessionId + requestId base fields', () => {
    // Sample one event of each shape and assert the base fields are
    // present at the type level. Runtime construction validates the
    // type — TS will catch missing fields here.
    const request: RuntimePermissionEvent = {
      type: 'permission_request',
      runtimeId: 'claude_code',
      sessionId: 's',
      requestId: 'r',
      toolName: 'Bash',
      subject: 'tool: bash',
    };
    const granted: RuntimePermissionEvent = {
      type: 'permission_granted',
      runtimeId: 'claude_code',
      sessionId: 's',
      requestId: 'r',
    };
    const denied: RuntimePermissionEvent = {
      type: 'permission_denied',
      runtimeId: 'codepilot_runtime',
      sessionId: 's',
      requestId: 'r',
    };
    const unavailable: RuntimePermissionEvent = {
      type: 'permission_unavailable',
      runtimeId: 'codepilot_runtime',
      sessionId: 's',
      requestId: 'r',
      reason: 'adapter cannot map this approval kind',
    };
    for (const e of [request, granted, denied, unavailable]) {
      assert.equal(typeof e.runtimeId, 'string');
      assert.equal(typeof e.sessionId, 'string');
      assert.equal(typeof e.requestId, 'string');
    }
  });
});
