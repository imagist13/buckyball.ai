/**
 * Tests for agent-loop message handling and message-builder logic.
 *
 * message-builder tests import the REAL module to lock actual implementation.
 * agent-loop dedup logic is inlined because agent-loop.ts depends on
 * DB/streaming infrastructure that can't run in pure unit test context.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Suite 1: message dedup (inlined — agent-loop needs DB to test directly) ──

function shouldAppendPrompt(
  historyMessages: Array<{ role: string; content: unknown }>,
  autoTrigger: boolean,
): boolean {
  if (autoTrigger) return true;
  if (historyMessages.length === 0) return true;
  if (historyMessages[historyMessages.length - 1]?.role !== 'user') return true;
  return false;
}

describe('agent-loop message dedup (inlined)', () => {
  it('does not append when last message is user (normal flow)', () => {
    assert.equal(shouldAppendPrompt([{ role: 'user', content: 'hi' }], false), false);
  });

  it('always appends for autoTrigger even if last is user', () => {
    assert.equal(shouldAppendPrompt([{ role: 'user', content: 'hi' }], true), true);
  });

  it('appends when history is empty', () => {
    assert.equal(shouldAppendPrompt([], false), true);
  });

  it('appends when last message is assistant', () => {
    assert.equal(shouldAppendPrompt([{ role: 'assistant', content: 'ok' }], false), true);
  });

  it('does not append when last is user with multipart content', () => {
    const multipart = [{ type: 'text', text: 'hi' }, { type: 'file', data: 'abc' }];
    assert.equal(shouldAppendPrompt([{ role: 'user', content: multipart }], false), false);
  });
});

// ── Suite 2: buildCoreMessages (REAL import from @/lib/message-builder) ──

describe('message-builder buildCoreMessages (real import)', () => {
  it('converts plain user messages', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: 'hello', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'user');
    assert.equal(result[0].content, 'hello');
  });

  it('rebuilds user message with image attachment', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-test-'));
    const imgPath = path.join(tmpDir, 'test.png');
    fs.writeFileSync(imgPath, Buffer.from('fakepng'));
    try {
      const fileMeta = JSON.stringify([{ id: '1', name: 'test.png', type: 'image/png', size: 7, filePath: imgPath }]);
      const content = `<!--files:${fileMeta}-->describe the image`;
      const result = buildCoreMessages([
        { id: '1', session_id: 's', role: 'user', content, created_at: '', is_heartbeat_ack: 0, token_usage: '' },
      ]);
      assert.equal(result.length, 1);
      assert.ok(Array.isArray(result[0].content), 'content should be multipart array');
      const parts = result[0].content as Array<{ type: string }>;
      assert.ok(parts.some(p => p.type === 'text'));
      assert.ok(parts.some(p => p.type === 'file'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('falls back when attached file is missing', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const fileMeta = JSON.stringify([{ id: '1', name: 'gone.png', type: 'image/png', size: 0, filePath: '/nonexistent/gone.png' }]);
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: `<!--files:${fileMeta}-->text`, created_at: '', is_heartbeat_ack: 0, token_usage: '' },
    ]);
    assert.equal(result[0].role, 'user');
  });

  it('skips heartbeat-ack messages', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: 'hello', created_at: '', is_heartbeat_ack: 1, token_usage: '' },
    ]);
    assert.equal(result.length, 0);
  });

  it('merges consecutive user messages to string', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: 'first', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
      { id: '2', session_id: 's', role: 'user', content: 'second', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
    ]);
    assert.equal(result.length, 1);
    assert.ok(typeof result[0].content === 'string');
    assert.ok((result[0].content as string).includes('first'));
    assert.ok((result[0].content as string).includes('second'));
  });

  it('merges consecutive user messages preserving multipart', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-merge-'));
    const imgPath = path.join(tmpDir, 'img.png');
    fs.writeFileSync(imgPath, Buffer.from('png'));
    try {
      const fileMeta = JSON.stringify([{ id: '1', name: 'img.png', type: 'image/png', size: 3, filePath: imgPath }]);
      const result = buildCoreMessages([
        { id: '1', session_id: 's', role: 'user', content: 'plain text', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
        { id: '2', session_id: 's', role: 'user', content: `<!--files:${fileMeta}-->with image`, created_at: '', is_heartbeat_ack: 0, token_usage: '' },
      ]);
      assert.equal(result.length, 1);
      // Merged content should be array (has file part)
      assert.ok(Array.isArray(result[0].content), 'merged with file should be array');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('repairs a persisted tool_use that ended before its result arrived', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: 'read it', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
      {
        id: '2',
        session_id: 's',
        role: 'assistant',
        content: JSON.stringify([{ type: 'tool_use', id: 'call-stopped', name: 'Read', input: { file_path: 'README.md' } }]),
        created_at: '',
        is_heartbeat_ack: 0,
        token_usage: '',
      },
      { id: '3', session_id: 's', role: 'user', content: 'continue', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
    ]);
    assert.deepEqual(result.map((message) => message.role), ['user', 'assistant', 'tool', 'user']);
    const repair = result[2].content as Array<{ toolCallId: string; output: { value: string } }>;
    assert.equal(repair[0].toolCallId, 'call-stopped');
    assert.match(repair[0].output.value, /no tool result was received/);
  });

  it('omits an orphan persisted tool_result from model history', async () => {
    const { buildCoreMessages } = await import('@/lib/message-builder');
    const result = buildCoreMessages([
      { id: '1', session_id: 's', role: 'user', content: 'hello', created_at: '', is_heartbeat_ack: 0, token_usage: '' },
      {
        id: '2',
        session_id: 's',
        role: 'assistant',
        content: JSON.stringify([{ type: 'tool_result', tool_use_id: 'missing-call', content: 'orphan' }]),
        created_at: '',
        is_heartbeat_ack: 0,
        token_usage: '',
      },
    ]);
    assert.deepEqual(result.map((message) => message.role), ['user']);
  });
});
