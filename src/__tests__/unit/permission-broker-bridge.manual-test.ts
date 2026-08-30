/**
 * Unit tests for bridge permission broker's interactive-tool deny guard.
 *
 * Tests the pure guard function `isBridgeUnsupportedInteractiveTool`
 * which is the first check in `forwardPermissionRequest`. When it
 * returns true, the broker immediately denies the permission with a
 * clear reason, so the model falls back to plain text questions.
 *
 * These tests are intentionally pure (no async, no DB, no permission
 * registry) to avoid process-exit hangs caused by the permission
 * registry's internal timers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isBridgeUnsupportedInteractiveTool } from '../../lib/bridge/permission-broker';

describe('permission-broker — bridge interactive-tool guard', () => {
  it('blocks AskUserQuestion', () => {
    assert.equal(isBridgeUnsupportedInteractiveTool('AskUserQuestion'), true);
  });

  it('does not block standard coding tools', () => {
    const standardTools = ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebFetch'];
    for (const tool of standardTools) {
      assert.equal(
        isBridgeUnsupportedInteractiveTool(tool),
        false,
        `${tool} must not be blocked by the interactive-tool guard`,
      );
    }
  });

  it('does not block ExitPlanMode (has its own UI that works in bridge)', () => {
    assert.equal(isBridgeUnsupportedInteractiveTool('ExitPlanMode'), false);
  });

  it('does not block codepilot_* builtin tools', () => {
    const builtins = [
      'codepilot_memory_search',
      'codepilot_session_search',
      'codepilot_send_notification',
    ];
    for (const tool of builtins) {
      assert.equal(
        isBridgeUnsupportedInteractiveTool(tool),
        false,
        `${tool} must not be blocked`,
      );
    }
  });

  it('does not block unknown/future tools by default (whitelist-only guard)', () => {
    assert.equal(isBridgeUnsupportedInteractiveTool('SomeNewTool'), false);
  });
});
