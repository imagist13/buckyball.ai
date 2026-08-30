/**
 * Phase 3 Step 3 — task execution history table contract.
 *
 * v3 plan locks: `task_run_logs` is the ONLY execution-history table.
 * `scheduled_task_runs` was a name floated in early drafts; the v3
 * decision (and v4 retro) pinned `task_run_logs` instead and added
 * `notification_event_id` as the FK to the umbrella event.
 *
 * v4 fix #4 — this contract scans only `src/`. The plan and decision
 * log in `docs/exec-plans/active/refactor-closeout.md` reference
 * `scheduled_task_runs` repeatedly when explaining "we explicitly
 * decided NOT to add this table"; that prose must not trip the test.
 *
 * Asserts:
 *   1. No source under `src/` mentions `scheduled_task_runs` (test
 *      files included — they reference `task_run_logs` instead).
 *   2. `src/lib/db.ts` defines `updateTaskRunLog` (running → terminal
 *      single-row UPDATE; v3 fix #2).
 *   3. `src/lib/task-scheduler.ts` calls `updateTaskRunLog(...)` —
 *      proves the row-lifecycle path is wired, not just declared.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    if (entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('task execution history table contract (Phase 3 Step 3)', () => {
  it('no source file under src/ mentions `scheduled_task_runs`', () => {
    const offenders: { rel: string; line: number; text: string }[] = [];
    for (const file of walk(SRC)) {
      // Skip THIS test file itself — it has to mention the forbidden
      // name in its own description / assertion text.
      if (file === __filename) continue;
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\bscheduled_task_runs\b/.test(lines[i])) {
          offenders.push({
            rel: path.relative(SRC, file),
            line: i + 1,
            text: lines[i].trim().slice(0, 120),
          });
        }
      }
    }
    if (offenders.length > 0) {
      const detail = offenders.map((o) => `  ${o.rel}:${o.line} → ${o.text}`).join('\n');
      assert.fail(
        `Found ${offenders.length} reference(s) to \`scheduled_task_runs\` in src/.\n` +
          `Phase 3 Step 3 reuses the existing \`task_run_logs\` table; do not add a parallel\n` +
          `history table. Plan / decision-log mentions in docs/ are intentionally allowed.\n` +
          `Offenders:\n${detail}`,
      );
    }
  });

  it('src/lib/db.ts defines updateTaskRunLog for in-place row updates', () => {
    const src = readFileSync(path.resolve(SRC, 'lib/db.ts'), 'utf-8');
    assert.match(
      src,
      /export\s+function\s+updateTaskRunLog\s*\(/,
      'updateTaskRunLog must exist — that is how `running` rows flip to `success`/`error` without a duplicate insert (v3 fix #2)',
    );
  });

  it('src/lib/task-scheduler.ts calls updateTaskRunLog', () => {
    const src = readFileSync(path.resolve(SRC, 'lib/task-scheduler.ts'), 'utf-8');
    assert.match(
      src,
      /updateTaskRunLog\(/,
      'task-scheduler must use updateTaskRunLog to flip the running row in place — without it the `running` row stays running forever and a separate terminal row gets inserted',
    );
  });

  it('insertTaskRunLog now returns { runId } for the in-place update path', () => {
    const src = readFileSync(path.resolve(SRC, 'lib/db.ts'), 'utf-8');
    // Loose: matches `): { runId: string }` regardless of formatting.
    assert.match(
      src,
      /export\s+function\s+insertTaskRunLog[\s\S]{0,400}\)\s*:\s*\{\s*runId:\s*string\s*\}/,
      'insertTaskRunLog must return the new row id so runScheduledTaskNow + executeDueTask can pass it to updateTaskRunLog later',
    );
  });
});
