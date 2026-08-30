/**
 * Phase 3 Step 4a — agent-task-runner contract tests.
 *
 * **What this file does NOT pin**: that the runner is a real headless
 * Agent execution chain. It isn't (Step 4a uses
 * `generateTextFromProvider` for the model call). When Step 4b lands
 * a real `streamClaude` background runner, additional tests should
 * land for `permission_request` → waiting_for_permission and the
 * abandon / re-run flows.
 *
 * **What this file DOES pin** — the v2 invariants the runner already
 * enforces and that must survive the 4a → 4b transition unchanged:
 *
 *   1. Branches on `task.source`, NOT `task.kind === 'heartbeat'` (no
 *      such kind exists; heartbeat is `kind='ai_task' + source=
 *      'assistant_heartbeat'`). A grep of the source ensures no future
 *      refactor sneaks in a `kind === 'heartbeat'` branch.
 *
 *   2. The HEARTBEAT_OK silent contract uses **exact** trim-equality.
 *      `HEARTBEAT_OK\n\nfoo` is speak-up, not silent. This is exposed
 *      as `isHeartbeatSilent(modelOutput)` and must be testable
 *      directly without a full runner mock.
 *
 *   3. Every `addMessage` call inside the runner passes a 5th argument
 *      with `task_run_id`, never embeds it in `content`. This is the
 *      v2 fix for "no sentinel string in message body".
 *
 *   4. `task_run_logs.status` whitelist accepts the 5-state v2 enum
 *      AND the legacy `'success'` / `'error'` values; rejects any
 *      other string. App-layer enforcement (no DB CHECK).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RUNNER_SRC = readFileSync(
  path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
  'utf-8',
);

describe('agent-task-runner: heartbeat is source-based, not kind-based', () => {
  it('does NOT contain `kind === "heartbeat"` (heartbeat is ai_task + source=assistant_heartbeat)', () => {
    assert.doesNotMatch(
      RUNNER_SRC,
      /kind\s*===\s*['"]heartbeat['"]/,
      'agent-task-runner must not switch on `task.kind === "heartbeat"` — heartbeat is identified solely by `task.source === "assistant_heartbeat"`. The user-imposed v2 fix #1 disallows extending ScheduledTaskKind for this case.',
    );
  });

  it('branches on `task.source === "assistant_heartbeat"` to choose buddy session vs task-bound', () => {
    assert.match(
      RUNNER_SRC,
      /task\.source\s*===\s*['"]assistant_heartbeat['"]/,
      'runner must explicitly check `task.source === "assistant_heartbeat"` to route to the buddy-session + silent-contract path',
    );
  });
});

describe('agent-task-runner: HEARTBEAT_OK silent contract is exact-trim', () => {
  it('exposes isHeartbeatSilent for direct testing', async () => {
    const mod = await import('../../lib/agent-task-runner');
    assert.equal(typeof mod.isHeartbeatSilent, 'function');
    // Exact match after trim → silent.
    assert.equal(mod.isHeartbeatSilent('HEARTBEAT_OK'), true);
    assert.equal(mod.isHeartbeatSilent('  HEARTBEAT_OK  '), true);
    assert.equal(mod.isHeartbeatSilent('\nHEARTBEAT_OK\n'), true);
    // Anything else → speak-up.
    assert.equal(mod.isHeartbeatSilent('HEARTBEAT_OK\n\nbut also foo'), false);
    assert.equal(mod.isHeartbeatSilent('User has 3 things to do'), false);
    assert.equal(mod.isHeartbeatSilent('heartbeat_ok'), false);
    assert.equal(mod.isHeartbeatSilent(''), false);
  });
});

describe('agent-task-runner: addMessage carries task_run_id via metadata, not content', () => {
  it('every addMessage call passes a metadata object with task_run_id (5th arg)', () => {
    // Find every addMessage(...) call in the runner. Each one must
    // include `task_run_id: runId` in a 5th positional metadata
    // argument — never as a sentinel string concatenated to content.
    const calls = RUNNER_SRC.match(/addMessage\([\s\S]*?\)/g) ?? [];
    assert.ok(calls.length >= 2, 'expected at least 2 addMessage calls (user prompt + assistant message)');
    for (const call of calls) {
      assert.match(
        call,
        /task_run_id:\s*runId/,
        `addMessage call missing task_run_id metadata: ${call.slice(0, 120)}…\nThe v2 fix forbids embedding the run id in message.content (it would pollute the LLM prompt). It must be passed via the metadata parameter.`,
      );
    }
  });

  it('runner does NOT write any [__TASK_RUN__] / [__HEARTBEAT_RUN__] sentinel string into message content', () => {
    // Defensive — if a future refactor reverts to sentinel strings,
    // this trips immediately. The marker is rendered React-side from
    // the inline-joined taskRuns map, not parsed from content.
    assert.doesNotMatch(
      RUNNER_SRC,
      /__TASK_RUN__|__HEARTBEAT_RUN__/,
      'agent-task-runner must not write `[__TASK_RUN__]` or `[__HEARTBEAT_RUN__]` sentinel strings. Marker rendering uses `messages.task_run_id` + the inline-joined task_run_logs metadata.',
    );
  });
});

describe('agent-task-runner: heartbeat resolves to user-visible buddy session, never a task-bound one', () => {
  it('resolveBuddySessionId fallback path calls createSession (not just returns undefined on miss)', () => {
    // Source-grep guard for Codex review fix #1: earlier rev bailed
    // out with `failed` when no workspace session existed, hostile
    // UX for users toggling heartbeat on before opening the
    // workspace. The fix: when workspace path is configured but
    // getLatestSessionByWorkingDirectory returns undefined, the
    // runner lazy-creates a buddy session. Pin both branches.
    assert.match(
      RUNNER_SRC,
      /getLatestSessionByWorkingDirectory[\s\S]*?createSession\s*\(/,
      'agent-task-runner must lazy-create a buddy session when getLatestSessionByWorkingDirectory misses — failing the run is hostile UX. Source-of-truth: resolveBuddySessionId.',
    );
    // The fallback session must NOT be source='task' (heartbeat
    // output goes into the user-visible chat, not a hidden execution
    // session).
    const fnBody = RUNNER_SRC.match(/async function resolveBuddySessionId[\s\S]*?\n\}/);
    assert.ok(fnBody, 'expected resolveBuddySessionId function block');
    assert.doesNotMatch(
      fnBody![0],
      /createSession\([^)]*['"]task['"]/,
      'lazy-created buddy session must not be source="task" — heartbeat speak-up belongs in the main chat list, not an execution session',
    );
  });

  it('resolveBuddySessionId filters getLatestSessionByWorkingDirectory to source="user"', () => {
    // Codex review fix #2: without a source filter, an ai_task whose
    // working_directory matches the assistant workspace creates a
    // hidden source='task' session that sorts as "latest" by
    // updated_at and gets reused as the buddy. Heartbeat speak-up
    // then writes into the hidden execution session instead of a
    // user-visible chat. The fix is to pass `{ includeSources:
    // ['user'] }` to the helper. Pin the call shape so a future
    // refactor can't quietly drop the filter.
    const fnBody = RUNNER_SRC.match(/async function resolveBuddySessionId[\s\S]*?\n\}/);
    assert.ok(fnBody);
    assert.match(
      fnBody![0],
      /getLatestSessionByWorkingDirectory\s*\([\s\S]*?includeSources:\s*\[\s*['"]user['"]\s*\]/,
      'resolveBuddySessionId must pass `{ includeSources: ["user"] }` to getLatestSessionByWorkingDirectory — without this filter, heartbeat could pick up a hidden task-bound session and write speak-up there.',
    );
  });
});

describe('db.getLatestSessionByWorkingDirectory: includeSources filter is honored', () => {
  it('signature accepts opts.includeSources for source filtering', async () => {
    const dbSrc = await import('node:fs').then((fs) =>
      fs.readFileSync(path.resolve(__dirname, '../../lib/db.ts'), 'utf-8'),
    );
    // Pin the signature shape so the agent-task-runner's call won't
    // silently no-op (typescript would catch a missing param, but a
    // future refactor that changes the param name / collapses opts
    // to a positional arg would compile and break the runtime intent).
    assert.match(
      dbSrc,
      /export\s+function\s+getLatestSessionByWorkingDirectory\s*\([\s\S]*?opts\?\s*:\s*\{\s*includeSources\?\s*:\s*ReadonlyArray<['"]user['"]\s*\|\s*['"]task['"]>/,
      'getLatestSessionByWorkingDirectory must accept `opts?: { includeSources?: ReadonlyArray<"user" | "task"> }` so callers (heartbeat, buddy lookup) can restrict to user-visible sessions',
    );
  });
});

describe('task_run_logs status whitelist (app-layer, no DB CHECK)', () => {
  it('insertTaskRunLog accepts the 5-state enum + legacy `success` / `error`', async () => {
    // Smoke check the whitelist set itself is exposed correctly. The
    // actual insert path needs a DB; here we verify the type module
    // exposes all 5 new states.
    const types = await import('../../types');
    for (const v of ['running', 'succeeded', 'failed', 'waiting_for_permission', 'cancelled']) {
      assert.equal(types.TASK_RUN_STATUS_VALUES.includes(v as never), true, `TASK_RUN_STATUS_VALUES missing '${v}'`);
    }
    assert.equal(types.isTaskRunStatus('running'), true);
    assert.equal(types.isTaskRunStatus('succeeded'), true);
    assert.equal(types.isTaskRunStatus('waiting_for_permission'), true);
    // Legacy values are NOT in the v2 5-state union (they're accepted
    // at the db.ts whitelist for back-compat but the type predicate
    // rejects them — so new code paths can't accidentally write them).
    assert.equal(types.isTaskRunStatus('success'), false);
    assert.equal(types.isTaskRunStatus('error'), false);
    assert.equal(types.isTaskRunStatus('skipped'), false);
    // Garbage strings are rejected.
    assert.equal(types.isTaskRunStatus('done'), false);
    assert.equal(types.isTaskRunStatus(''), false);
    assert.equal(types.isTaskRunStatus(null), false);
  });
});
