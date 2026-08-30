/**
 * P2 fix (v6): `builtin-tools/notification.ts` declared a `durable`
 * parameter on `codepilot_schedule_task` but the executor body
 * unconditionally POSTed `/api/tasks/schedule` — `durable=false`
 * created a persistent task anyway. The MCP variant in
 * `notification-mcp.ts` already had a session-task branch; this
 * contract pins both files to the same shape so the AI SDK and MCP
 * surfaces match the schema's promise.
 *
 * Asserts:
 *   1. `builtin-tools/notification.ts` declares the same `durable`
 *      param (boolean) the MCP variant has.
 *   2. The executor branches on `durable === false` and reaches
 *      `addSessionTask` (i.e., uses the in-memory non-durable path).
 *   3. The session-task object literal in that branch carries the
 *      `kind` field — same v4 fix #1 enforcement as the MCP path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');
const BUILTIN = readFileSync(path.resolve(SRC, 'lib/builtin-tools/notification.ts'), 'utf-8');
const MCP = readFileSync(path.resolve(SRC, 'lib/notification-mcp.ts'), 'utf-8');

describe('codepilot_schedule_task durable parity (v6 P2 fix)', () => {
  it('builtin-tools/notification.ts schema still declares durable', () => {
    // The schema must keep `durable` as a documented option; if you
    // remove it, also remove the description from the MCP variant so
    // both surfaces tell the AI the same thing.
    assert.match(
      BUILTIN,
      /durable:\s*z\.boolean\(\)/,
      'codepilot_schedule_task must declare a durable boolean field (matches notification-mcp)',
    );
    assert.match(MCP, /durable:\s*z\.boolean\(\)/);
  });

  it('builtin-tools/notification.ts honors durable=false via addSessionTask', () => {
    assert.match(
      BUILTIN,
      /durable\s*===\s*false/,
      'execute body must branch on durable===false (do not silently ignore the param)',
    );
    assert.match(
      BUILTIN,
      /\baddSessionTask\(/,
      'durable=false branch must reach addSessionTask — the same session-only API the MCP variant uses',
    );
  });

  it('builtin-tools session-task literal carries kind (v4 fix #1 parity)', () => {
    // Find the `const task = { … };` literal and assert `kind` field
    // is present. Same shape as `notification-mcp.ts:103`.
    const lit = BUILTIN.match(
      /const\s+task\s*=\s*\{[\s\S]*?\};\s*\n\s*addSessionTask\(\s*task\s*\)/,
    );
    assert.ok(
      lit,
      'expected `const task = { … }; addSessionTask(task)` in builtin-tools/notification.ts durable=false branch',
    );
    assert.match(
      lit![0],
      /\bkind\s*[,:]/,
      'session-task literal must include kind — durable=false bypasses /api/tasks/schedule\'s server-side kind validation, the in-memory dispatch needs it stamped here',
    );
  });
});
