/**
 * v7 fix — `notify_on_complete` must be 0/1 by the time it hits SQLite.
 *
 * Pre-fix bug: AI tools / external callers POSTed `true`/`false`; the
 * route handed it straight to `createScheduledTask` which bound it
 * via better-sqlite3 → "SQLite3 can only bind numbers, strings,
 * bigints, buffers, and null". The whole task creation crashed.
 *
 * Three layers of defense are exercised here:
 *   1. `/api/tasks/schedule` route normalizes before calling DB
 *      (true → 1, false → 0, undefined → 1).
 *   2. `createScheduledTask` in db.ts has its own defensive coercion
 *      so a future direct caller can't crash the DB.
 *   3. AI SDK builtin (`builtin-tools/notification.ts`) POSTs 0/1, not
 *      raw boolean — wire-format parity with `notification-mcp.ts`.
 *
 * The route lives behind Next.js's request/response model so we
 * exercise it by importing the POST handler directly and feeding it a
 * `Request`-shaped object.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readFileSync } from 'node:fs';

let tempDir: string;
let originalDataDir: string | undefined;

before(() => {
  originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
});

after(() => {
  if (originalDataDir === undefined) {
    delete process.env.CLAUDE_GUI_DATA_DIR;
  } else {
    process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
  }
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-notify-flag-'));
  process.env.CLAUDE_GUI_DATA_DIR = tempDir;
});

afterEach(async () => {
  try {
    const { closeDb } = await import('../../lib/db');
    closeDb();
  } catch { /* ignore */ }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

async function postSchedule(body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
  const { POST } = await import('../../app/api/tasks/schedule/route');
  // Minimal Request-shaped object satisfying the route's `await body.json()`.
  const req = {
    json: async () => body,
  } as unknown as import('next/server').NextRequest;
  const res = await POST(req);
  const data = await res.json();
  return { status: res.status, data };
}

describe('notify_on_complete normalization (v7 fix)', () => {
  it('POST with notify_on_complete=true returns 200 and persists 1', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = await postSchedule({
      name: 'Reminder true',
      prompt: 'do thing',
      kind: 'reminder',
      schedule_type: 'once',
      schedule_value: future,
      notify_on_complete: true,
    });
    assert.equal(result.status, 200, 'route must accept boolean true (no SQLite binding crash)');
    const task = (result.data as { task: { id: string; notify_on_complete: number } }).task;
    assert.equal(task.notify_on_complete, 1, 'true → 1');

    // Verify DB row directly so we know the integer landed.
    const { getScheduledTask } = await import('../../lib/db');
    const stored = getScheduledTask(task.id);
    assert.ok(stored);
    assert.equal(stored!.notify_on_complete, 1);
  });

  it('POST with notify_on_complete=false returns 200 and persists 0', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = await postSchedule({
      name: 'AI task false',
      prompt: 'silent',
      kind: 'ai_task',
      schedule_type: 'once',
      schedule_value: future,
      notify_on_complete: false,
    });
    assert.equal(result.status, 200, 'route must accept boolean false');
    const task = (result.data as { task: { id: string; notify_on_complete: number } }).task;
    assert.equal(task.notify_on_complete, 0, 'false → 0');
  });

  it('POST with notify_on_complete missing defaults to 1', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = await postSchedule({
      name: 'Default flag',
      prompt: 'do thing',
      kind: 'reminder',
      schedule_type: 'once',
      schedule_value: future,
      // notify_on_complete deliberately omitted
    });
    assert.equal(result.status, 200);
    const task = (result.data as { task: { notify_on_complete: number } }).task;
    assert.equal(task.notify_on_complete, 1, 'undefined → 1 (historical default)');
  });

  it('createScheduledTask defensively coerces booleans (db-level safety net)', async () => {
    const { createScheduledTask } = await import('../../lib/db');
    // Bypass the route entirely and pass a literal `true` — the db
    // helper should coerce, not crash.
    const future = new Date(Date.now() + 60_000).toISOString();
    const created = createScheduledTask({
      name: 'Direct call',
      prompt: 'p',
      kind: 'reminder',
      schedule_type: 'once',
      schedule_value: future,
      next_run: future,
      consecutive_errors: 0,
      status: 'active',
      priority: 'normal',
      // Cast through unknown so TypeScript doesn't reject the literal —
      // this is exactly what the v7 defensive layer is supposed to catch.
      notify_on_complete: true as unknown as number,
      permanent: 0,
    });
    assert.equal(created.notify_on_complete, 1, 'db-layer coercion: true → 1');

    const created2 = createScheduledTask({
      name: 'Direct call false',
      prompt: 'p',
      kind: 'ai_task',
      schedule_type: 'once',
      schedule_value: future,
      next_run: future,
      consecutive_errors: 0,
      status: 'active',
      priority: 'normal',
      notify_on_complete: false as unknown as number,
      permanent: 0,
    });
    assert.equal(created2.notify_on_complete, 0, 'db-layer coercion: false → 0');
  });

  it('builtin-tools/notification.ts POST body sends 0/1, not boolean', () => {
    // Source-grep contract: the durable=true branch must compute a
    // `notifyFlag` (or equivalent name) before fetch and reference it
    // in the JSON.stringify body — NOT pass the raw `notify_on_complete`
    // boolean from the schema. This pins the wire format to integer.
    const src = readFileSync(
      path.resolve(__dirname, '../../lib/builtin-tools/notification.ts'),
      'utf-8',
    );
    // The fetch body for /api/tasks/schedule must NOT pass the raw
    // boolean param via shorthand. Look for the JSON.stringify block
    // that targets /api/tasks/schedule and assert the bound flag is
    // explicitly `notifyFlag` or an integer-typed expression — never
    // the bare `notify_on_complete` shorthand.
    // Anchor to the actual `fetch(... /api/tasks/schedule ...)` call,
    // not the first textual mention of the path (which would sweep in
    // schema declarations + the function-param destructuring upstream).
    const fetchBlock = src.match(
      /fetch\([^)]*\/api\/tasks\/schedule[\s\S]*?body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/,
    );
    assert.ok(fetchBlock, 'expected a fetch call targeting /api/tasks/schedule with a JSON.stringify body');
    const bodyContent = fetchBlock![1];
    // Reject ES6 shorthand: `notify_on_complete` followed by `,` or `}`
    // without the `:` separator that pairs it with a normalized 0/1 value.
    assert.doesNotMatch(
      bodyContent,
      /\bnotify_on_complete\s*[,}]/,
      'POST body must not include `notify_on_complete` as ES6 shorthand — that smuggles the raw boolean back into SQLite',
    );
    // Positive: the body must reference `notify_on_complete: <0/1 expr>`.
    assert.match(
      bodyContent,
      /notify_on_complete:\s*(notifyFlag|[01]\b|.*\?\s*[01]\s*:\s*[01])/,
      'POST body must explicitly bind notify_on_complete to a 0/1 value (notifyFlag local var or ternary)',
    );
  });
});
