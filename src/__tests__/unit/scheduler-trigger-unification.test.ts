import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../lib/task-scheduler.ts'),
  'utf-8',
);

describe('durable scheduler trigger unification', () => {
  it('poll and missed-task recovery use the same lock-aware run entry as manual run', () => {
    const poll = source.match(/const dueTasks = getDueTasks\(\);[\s\S]*?\/\/ Check session-only tasks/);
    assert.ok(poll);
    assert.match(poll![0], /runScheduledTaskNow\(task\.id\)/);
    assert.doesNotMatch(poll![0], /executeDueTask\(task\)/);

    const missed = source.match(/async function handleMissedTasks[\s\S]*?async function checkExpiredTasks/);
    assert.ok(missed);
    assert.match(missed![0], /runScheduledTaskNow\(task\.id\)/);
    assert.doesNotMatch(missed![0], /executeDueTask\(task\)/);
  });
});
