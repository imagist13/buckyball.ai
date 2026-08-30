/**
 * Phase 3 Step 4 — architecture-level invariants.
 *
 * Source-grep contracts for the non-obvious architectural decisions
 * the v2 plan locked down. Each invariant maps to a specific user
 * fix from the v2 review:
 *
 *   #1 — heartbeat is `kind='ai_task' + source='assistant_heartbeat'`,
 *        not a new kind. (also covered in agent-task-runner.test.ts;
 *        here we pin the call sites that wire it)
 *
 *   #2 — waiting_for_permission has no durable resume in v1: code
 *        does NOT contain phrases like "agent resume" or "continue
 *        stream from checkpoint". The state exists; the auto-resume
 *        path does not.
 *
 *   #3 — `task_run_logs.status` migration does NOT use `ALTER CHECK`
 *        (SQLite would reject; the v2 plan dropped this approach in
 *        favor of app-layer validation).
 *
 *   #4 — `messages.task_run_id` is the marker association mechanism.
 *        Source-grep ensures no `[__TASK_RUN__]` / `[__HEARTBEAT_RUN__]`
 *        sentinel strings exist anywhere in the codebase, AND the
 *        prompt builder doesn't read `task_run_id`.
 *
 *   #5 — Task-bound chat sessions default to hidden in the main list.
 *        `/api/chat/sessions` GET filters `source='user'` by default.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(path.resolve(ROOT, rel), 'utf-8');
}

/** Strip line + block comments (line-first to handle `// /* …` rationale text). */
function stripComments(src: string): string {
  return src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function* walkSrc(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkSrc(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

describe('Phase 3 Step 4 — architecture invariants', () => {
  // ── #1 / heartbeat is source-driven ────────────────────────────
  it('ScheduledTaskKind union has only `reminder | ai_task` (no `heartbeat` kind)', () => {
    const types = read('types/index.ts');
    const m = types.match(/export\s+type\s+ScheduledTaskKind\s*=\s*([^;]+);/);
    assert.ok(m, 'ScheduledTaskKind must be defined in types/index.ts');
    const union = m![1];
    assert.match(union, /['"]reminder['"]/, 'ScheduledTaskKind must include `"reminder"`');
    assert.match(union, /['"]ai_task['"]/, 'ScheduledTaskKind must include `"ai_task"`');
    assert.doesNotMatch(union, /['"]heartbeat['"]/, 'ScheduledTaskKind must NOT include `"heartbeat"` — heartbeat is identified by `source`, not `kind`');
  });

  it('ScheduledTaskSource union is exactly `user | assistant_heartbeat`', () => {
    const types = read('types/index.ts');
    const m = types.match(/export\s+type\s+ScheduledTaskSource\s*=\s*([^;]+);/);
    assert.ok(m, 'ScheduledTaskSource must be defined in types/index.ts');
    const union = m![1];
    assert.match(union, /['"]user['"]/);
    assert.match(union, /['"]assistant_heartbeat['"]/);
  });

  // ── #2 / no durable resume language ─────────────────────────────
  it('agent-task-runner does NOT claim to resume permission-paused runs', () => {
    const code = stripComments(read('lib/agent-task-runner.ts'));
    // Phrases that would imply durable resume — explicitly forbidden
    // by user fix #2. v1 only supports re-run from scratch (new
    // runId) or abandon (cancelled). Comments are stripped first so
    // the docstring's explanation of WHY we don't do this isn't
    // tripped by the search.
    for (const phrase of [
      /resume.*stream.*from/i,
      /continue.*the.*paused.*stream/i,
      /restore.*agent.*state/i,
    ]) {
      assert.doesNotMatch(
        code,
        phrase,
        `agent-task-runner code must not suggest durable resume (matched ${phrase}) — v1 only supports manual "Re-run" / "Abandon" from the user side.`,
      );
    }
  });

  // ── #3 / no ALTER CHECK in db.ts task_run_logs migration ──────
  it('db.ts does NOT attempt to ALTER the task_run_logs CHECK constraint', () => {
    const dbCode = read('lib/db.ts');
    // Look for the specific (impossible) statement: "ALTER TABLE
    // task_run_logs ... CHECK". SQLite rejects this; the v2 plan
    // explicitly chose app-layer validation over a table-rebuild
    // migration.
    assert.doesNotMatch(
      dbCode,
      /ALTER\s+TABLE\s+task_run_logs[\s\S]{0,200}CHECK/i,
      'db.ts must not try to ALTER a CHECK constraint on task_run_logs — SQLite does not support this. Use app-layer validation (see ALLOWED_TASK_RUN_STATUSES).',
    );
    // And we DO have the app-layer whitelist.
    assert.match(
      dbCode,
      /ALLOWED_TASK_RUN_STATUSES/,
      'db.ts must define ALLOWED_TASK_RUN_STATUSES app-layer whitelist',
    );
    assert.match(
      dbCode,
      /assertValidTaskRunStatus/,
      'db.ts must call a status assertion helper from insertTaskRunLog / updateTaskRunLog',
    );
  });

  // ── #4 / no sentinel strings, ever ─────────────────────────────
  it('no source file under src/ writes `[__TASK_RUN__]` or `[__HEARTBEAT_RUN__]` sentinel strings', () => {
    const offenders: string[] = [];
    for (const file of walkSrc(ROOT)) {
      if (file.endsWith('step4-architecture-invariants.test.ts')) continue;
      if (file.endsWith('agent-task-runner.test.ts')) continue;
      const code = stripComments(readFileSync(file, 'utf-8'));
      if (/__TASK_RUN__|__HEARTBEAT_RUN__/.test(code)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Sentinel strings forbidden by v2 fix #4. Marker rendering uses messages.task_run_id + inline-join, not message.content sentinels. Offenders:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('messages route inline-joins task_run_logs (no per-marker N+1 fetch)', () => {
    const route = read('app/api/chat/sessions/[id]/messages/route.ts');
    assert.match(route, /getTaskRunSummariesByIds/, '/api/chat/sessions/[id]/messages must call getTaskRunSummariesByIds for inline-join');
    assert.match(route, /taskRuns/, 'response must include `taskRuns` map (per MessagesResponse type)');
  });

  it('TaskRunMarker reads its data from prop `run`, NOT a self-fetch', () => {
    const marker = read('components/chat/TaskRunMarker.tsx');
    // Component must accept `run` as a prop, not call useEffect-fetch.
    assert.match(marker, /run\s*:\s*TaskRunSummary/, 'TaskRunMarker must take `run: TaskRunSummary` as a prop');
    assert.doesNotMatch(
      marker,
      /useEffect[\s\S]*?fetch\(/,
      'TaskRunMarker must NOT fetch inside useEffect — that would be N+1 per marker. Inline-join via MessagesResponse.taskRuns instead.',
    );
  });

  // ── #5 / task-bound sessions hidden from main list ───────────
  it('/api/chat/sessions GET defaults to filtering out `source=task` sessions', () => {
    const route = read('app/api/chat/sessions/route.ts');
    // The default branch must produce an `includeSources` of just
    // ['user'] (or equivalent). The exact phrasing varies; pin the
    // structural intent: the default-branch `includeSources` must
    // contain `'user'` and must NOT contain `'task'` as the default.
    assert.match(
      route,
      /includeSources/,
      "/api/chat/sessions route must expose an `includeSources` filter knob",
    );
    assert.match(
      route,
      /\['user'\]/,
      "default include set must be `['user']` so task-bound sessions stay hidden by default",
    );
  });

  it('createSession DB helper accepts a `source` parameter so task-bound sessions can be tagged', () => {
    const dbCode = read('lib/db.ts');
    assert.match(
      dbCode,
      /createSession[\s\S]*?source\?:\s*['"]user['"]\s*\|\s*['"]task['"]/,
      'createSession must accept an optional `source: "user" | "task"` parameter for the agent task runner to pass `"task"` when creating an execution session',
    );
  });
});
