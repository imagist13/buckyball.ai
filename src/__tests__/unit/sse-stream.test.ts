import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { consumeSSEStream, type SSECallbacks } from '../../hooks/useSSEStream';
import { buildContextCompressedStatus } from '../../lib/context-compressor';

/**
 * Helper: create a mock ReadableStreamDefaultReader from SSE lines.
 * Each line is a complete "data: {json}\n" entry.
 */
function mockReader(lines: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = lines.map(l => encoder.encode(l + '\n'));
  let idx = 0;
  return {
    read: async () => {
      if (idx >= chunks.length) return { done: true, value: undefined } as { done: true; value: undefined };
      return { done: false, value: chunks[idx++] } as { done: false; value: Uint8Array };
    },
    cancel: async () => {},
    releaseLock: () => {},
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

function sseData(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}`;
}

function noopCallbacks(overrides: Partial<SSECallbacks> = {}): SSECallbacks {
  return {
    onText: () => {},
    onToolUse: () => {},
    onToolResult: () => {},
    onToolOutput: () => {},
    onToolProgress: () => {},
    onStatus: () => {},
    onResult: () => {},
    onPermissionRequest: () => {},
    onToolTimeout: () => {},
    onModeChanged: () => {},
    onTaskUpdate: () => {},
    onRewindPoint: () => {},
    onKeepAlive: () => {},
    onError: () => {},
    ...overrides,
  };
}

describe('SSE Stream — thinking events', () => {
  it('dispatches onThinking for thinking-type events', async () => {
    const deltas: string[] = [];
    const reader = mockReader([
      sseData({ type: 'thinking', data: 'Analyzing ' }),
      sseData({ type: 'thinking', data: 'the code' }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onThinking: (d) => deltas.push(d),
    }));

    assert.equal(deltas.length, 2);
    assert.equal(deltas[0], 'Analyzing ');
    assert.equal(deltas[1], 'the code');
  });

  it('does not mix thinking into accumulated text', async () => {
    let lastText = '';
    const reader = mockReader([
      sseData({ type: 'thinking', data: 'secret reasoning' }),
      sseData({ type: 'text', data: 'Hello!' }),
      sseData({ type: 'done', data: '' }),
    ]);

    const result = await consumeSSEStream(reader, noopCallbacks({
      onText: (t) => { lastText = t; },
    }));

    assert.equal(lastText, 'Hello!');
    assert.equal(result.accumulated, 'Hello!');
    assert.ok(!result.accumulated.includes('secret reasoning'));
  });
});

describe('SSE Stream — is_error propagation', () => {
  it('extracts is_error from tool_result events', async () => {
    const results: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];
    const reader = mockReader([
      sseData({ type: 'tool_result', data: JSON.stringify({
        tool_use_id: 'tu_1',
        content: 'success output',
      }) }),
      sseData({ type: 'tool_result', data: JSON.stringify({
        tool_use_id: 'tu_2',
        content: 'Error: command failed',
        is_error: true,
      }) }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onToolResult: (r) => results.push(r),
    }));

    assert.equal(results.length, 2);
    assert.equal(results[0].is_error, undefined);
    assert.equal(results[1].is_error, true);
    assert.equal(results[1].content, 'Error: command failed');
  });
});

describe('SSE Stream — media in tool_result', () => {
  it('passes through media array from tool_result', async () => {
    const results: Array<{ tool_use_id: string; media?: Array<{ type: string }> }> = [];
    const reader = mockReader([
      sseData({ type: 'tool_result', data: JSON.stringify({
        tool_use_id: 'tu_media',
        content: 'Image generated',
        media: [
          { type: 'image', mimeType: 'image/png', localPath: '/tmp/img.png' },
        ],
      }) }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onToolResult: (r) => results.push(r),
    }));

    assert.equal(results.length, 1);
    assert.ok(results[0].media);
    assert.equal(results[0].media!.length, 1);
    assert.equal(results[0].media![0].type, 'image');
  });

  it('omits media field when no media blocks', async () => {
    const results: Array<{ tool_use_id: string; media?: unknown }> = [];
    const reader = mockReader([
      sseData({ type: 'tool_result', data: JSON.stringify({
        tool_use_id: 'tu_nomedia',
        content: 'plain result',
      }) }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onToolResult: (r) => results.push(r),
    }));

    assert.equal(results[0].media, undefined);
  });
});

// ────────────────────────────────────────────────────────────────
// context_compressed SSE events
// ────────────────────────────────────────────────────────────────

describe('SSE Stream — context_compressed events', () => {
  it('dispatches onContextCompressed for subtype=context_compressed status events', async () => {
    const events: Array<{ message: string; messagesCompressed: number; tokensSaved: number }> = [];
    const statusCalls: string[] = [];

    const reader = mockReader([
      sseData({
        type: 'status',
        data: JSON.stringify({
          notification: true,
          subtype: 'context_compressed',
          message: 'Context compressed: 5 older messages summarized, ~1,200 tokens saved',
          stats: { messagesCompressed: 5, tokensSaved: 1200 },
        }),
      }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onContextCompressed: (d) => events.push(d),
      onStatus: (t) => { if (t) statusCalls.push(t); },
    }));

    // onContextCompressed should have been called
    assert.equal(events.length, 1);
    assert.equal(events[0].messagesCompressed, 5);
    assert.equal(events[0].tokensSaved, 1200);
    assert.ok(events[0].message.includes('Context compressed'));

    // onStatus should NOT have been called (context_compressed is intercepted before notification branch)
    assert.equal(statusCalls.length, 0, 'context_compressed must not leak into onStatus');
  });

  it('does NOT fire onContextCompressed for unrelated status events', async () => {
    const events: unknown[] = [];
    const reader = mockReader([
      sseData({
        type: 'status',
        data: JSON.stringify({ notification: true, message: 'Some other notification' }),
      }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onContextCompressed: (d) => events.push(d),
    }));

    assert.equal(events.length, 0);
  });

  it('reactive-compact retry payload (via buildContextCompressedStatus) reaches onContextCompressed', async () => {
    // Regression guard for the stale-shape bug: the reactive-compact retry
    // path in claude-client.ts used to emit { message: 'context_compressed' }
    // without a subtype. After useSSEStream switched to subtype-based dispatch
    // (useSSEStream.ts:204) that payload was silently dropped. Both the
    // pre-compression wrapper and the retry path now route through the shared
    // builder — this test pins the builder's output to the consumer contract.
    const events: Array<{ message: string; messagesCompressed: number; tokensSaved: number }> = [];
    const statusCalls: string[] = [];

    const payload = buildContextCompressedStatus({
      messagesCompressed: 12,
      tokensSaved: 8500,
    });

    // Builder shape assertions (locked-in contract for useSSEStream consumer)
    assert.equal(payload.notification, true);
    assert.equal(payload.subtype, 'context_compressed');
    assert.equal(payload.stats.messagesCompressed, 12);
    assert.equal(payload.stats.tokensSaved, 8500);
    assert.ok(payload.message.includes('12 older messages'));
    assert.ok(payload.message.includes('8,500'));

    const reader = mockReader([
      sseData({ type: 'status', data: JSON.stringify(payload) }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onContextCompressed: (d) => events.push(d),
      onStatus: (t) => { if (t) statusCalls.push(t); },
    }));

    assert.equal(events.length, 1, 'retry-path payload must dispatch onContextCompressed');
    assert.equal(events[0].messagesCompressed, 12);
    assert.equal(events[0].tokensSaved, 8500);
    assert.equal(statusCalls.length, 0, 'must not leak into generic onStatus');
  });

  it('buildContextCompressedStatus omits tokens-saved phrasing when tokensSaved=0', () => {
    const payload = buildContextCompressedStatus({ messagesCompressed: 3, tokensSaved: 0 });
    assert.equal(payload.subtype, 'context_compressed');
    assert.ok(payload.message.includes('3 older messages'));
    assert.ok(!payload.message.includes('tokens saved'));
    assert.equal(payload.stats.tokensSaved, 0);
  });
});

// ────────────────────────────────────────────────────────────────
// skill_nudge SSE events
// ────────────────────────────────────────────────────────────────

describe('SSE Stream — skill_nudge events', () => {
  it('dispatches onSkillNudge for subtype=skill_nudge status events', async () => {
    const events: Array<{ message: string; step: number; distinctToolCount: number; toolNames: string[] }> = [];
    const statusCalls: string[] = [];

    const reader = mockReader([
      sseData({
        type: 'status',
        data: JSON.stringify({
          notification: true,
          subtype: 'skill_nudge',
          message: 'This workflow involved 10 steps...',
          payload: {
            type: 'skill_nudge',
            message: 'This workflow involved 10 steps...',
            reason: { step: 10, distinctToolCount: 4, toolNames: ['Bash', 'Edit', 'Grep', 'Read'] },
          },
        }),
      }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onSkillNudge: (d) => events.push(d),
      onStatus: (t) => { if (t) statusCalls.push(t); },
    }));

    assert.equal(events.length, 1);
    assert.equal(events[0].step, 10);
    assert.equal(events[0].distinctToolCount, 4);
    assert.deepEqual(events[0].toolNames, ['Bash', 'Edit', 'Grep', 'Read']);

    // Must not leak into onStatus
    assert.equal(statusCalls.length, 0, 'skill_nudge must not leak into onStatus');
  });
});
