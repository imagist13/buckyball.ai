/**
 * Phase 3 Step 3 — `kind` contract for the AI tool that creates tasks.
 *
 * v3/v4 plan: AI tool input must declare `kind: 'reminder' | 'ai_task'`
 * so models can route "5 分钟后提醒我喝水" to the reminder path during
 * prompt generation, not silently default to ai_task.
 *
 * Asserts:
 *   1. Both `builtin-tools/notification.ts` and `notification-mcp.ts`
 *      have `kind: z.enum(['reminder', 'ai_task'])` in their
 *      `codepilot_schedule_task` schema.
 *   2. Both schemas mention "reminder" and "ai_task" in their description
 *      so the model gets enough hint to route correctly.
 *   3. The session-task object literal in notification-mcp.ts (durable=false
 *      branch — bypasses /api/tasks/schedule's server-side kind check)
 *      stamps `kind` onto the in-memory task. v4 fix #1.
 *   4. /api/tasks/schedule rejects requests with missing or invalid `kind`.
 *   5. Type-side: `ScheduledTask` interface declares the `kind` field.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(path.resolve(SRC, rel), 'utf-8');
}

describe('codepilot_schedule_task kind contract (Phase 3 Step 3)', () => {
  it('builtin-tools/notification.ts schema declares kind enum', () => {
    const src = read('lib/builtin-tools/notification.ts');
    assert.match(
      src,
      /codepilot_schedule_task[\s\S]{0,2000}kind:\s*z\.enum\(\['reminder',\s*'ai_task'\]\)/,
      'codepilot_schedule_task in builtin-tools/notification.ts must declare kind: z.enum([\'reminder\', \'ai_task\']) so the AI tool can\'t silently default to ai_task',
    );
    // Description must hint at reminder vs ai_task routing.
    const toolBlock = src.match(/codepilot_schedule_task:\s*tool\(\{[\s\S]*?\}\),/);
    assert.ok(toolBlock, 'codepilot_schedule_task tool block not found in builtin-tools/notification.ts');
    assert.match(toolBlock![0], /reminder/, 'tool description must reference "reminder"');
    assert.match(toolBlock![0], /ai_task/, 'tool description must reference "ai_task"');
  });

  it('notification-mcp.ts schema declares kind enum', () => {
    const src = read('lib/notification-mcp.ts');
    assert.match(
      src,
      /codepilot_schedule_task[\s\S]{0,3000}kind:\s*z\.enum\(\['reminder',\s*'ai_task'\]\)/,
      'codepilot_schedule_task in notification-mcp.ts must declare kind: z.enum([\'reminder\', \'ai_task\']) (parity with the builtin-tool variant)',
    );
  });

  it('notification-mcp.ts session-task literal (durable=false) stamps kind', () => {
    // v4 fix #1 — the in-memory session task object literal must carry
    // `kind`, otherwise the durable=false path bypasses the API's
    // kind validation and creates a task with no kind.
    const src = read('lib/notification-mcp.ts');
    assert.match(
      src,
      /addSessionTask\(\s*[a-zA-Z_$][\w$]*\s*\)/,
      'expected an addSessionTask(<varname>) call inside the durable=false branch',
    );
    // Find the task object literal preceding addSessionTask and assert kind appears.
    const taskLiteral = src.match(
      /const\s+task\s*=\s*\{[\s\S]*?\};\s*\n\s*addSessionTask\(\s*task\s*\)/,
    );
    assert.ok(
      taskLiteral,
      'durable=false branch must build a `const task = { … }` literal then call addSessionTask(task)',
    );
    assert.match(
      taskLiteral![0],
      /\bkind\s*[,:]/,
      'session task literal must include a `kind` field — without it the in-memory path defaults to ai_task and reminders accidentally call providers',
    );
  });

  it('/api/tasks/schedule POST validates kind server-side', () => {
    const src = read('app/api/tasks/schedule/route.ts');
    assert.match(
      src,
      /kind/,
      '/api/tasks/schedule route must read `kind` from the request body',
    );
    // Validation must reject missing / non-enum kind.
    assert.match(
      src,
      /kind\s*!==\s*['"]reminder['"]\s*&&\s*kind\s*!==\s*['"]ai_task['"]/,
      'route must reject any kind that is not exactly \'reminder\' or \'ai_task\'',
    );
    assert.match(
      src,
      /status:\s*400/,
      'invalid kind must produce a 400 response',
    );
  });

  it('ScheduledTask interface declares the kind field', () => {
    const src = read('types/index.ts');
    assert.match(
      src,
      /interface\s+ScheduledTask\b[\s\S]{0,1200}kind:\s*ScheduledTaskKind/,
      'ScheduledTask interface must require the kind field — typecheck propagates the contract to every read/write site',
    );
    assert.match(
      src,
      /export\s+type\s+ScheduledTaskKind\s*=\s*['"]reminder['"]\s*\|\s*['"]ai_task['"]/,
      'ScheduledTaskKind alias must be exported with both literals so callers can narrow against it',
    );
  });
});
