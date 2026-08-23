import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { syncCodexThreadName } from '../../lib/codex/thread-name';

describe('Codex thread title mirror', () => {
  it('sends the committed local title through thread/name/set', async () => {
    const calls: Array<{ threadId: string; name: string }> = [];
    const outcome = await syncCodexThreadName('chat-1', '  PostgreSQL 只读副本  ', {
      getThreadId: () => 'thread-1',
      setThreadName: async (threadId, name) => {
        calls.push({ threadId, name });
      },
    });

    assert.equal(outcome, 'synced');
    assert.deepEqual(calls, [{ threadId: 'thread-1', name: 'PostgreSQL 只读副本' }]);
  });

  it('does not spawn app-server when the chat has no Codex thread', async () => {
    let called = false;
    const outcome = await syncCodexThreadName('chat-2', 'Fallback title', {
      getThreadId: () => null,
      setThreadName: async () => { called = true; },
    });

    assert.equal(outcome, 'no-thread');
    assert.equal(called, false);
  });

  it('degrades without throwing when Codex rejects the rename', async () => {
    const outcome = await syncCodexThreadName('chat-3', 'Fallback title', {
      getThreadId: () => 'thread-3',
      setThreadName: async () => { throw new Error('method unavailable'); },
    });

    assert.equal(outcome, 'failed');
  });
});
