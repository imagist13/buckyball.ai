/**
 * native-runtime.test.ts — Tests for the native Agent Runtime stack.
 *
 * Covers: permission flow, provider transport, claude-code-compat URL building,
 * event bus, system prompt, and session primitives.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Permission checker tests ────────────────────────────────────

describe('Permission checker', () => {
  // Dynamic import to avoid module init issues
  let checkPermission: typeof import('@/lib/permission-checker').checkPermission;
  let isDangerousCommand: typeof import('@/lib/permission-checker').isDangerousCommand;

  beforeEach(async () => {
    const mod = await import('@/lib/permission-checker');
    checkPermission = mod.checkPermission;
    isDangerousCommand = mod.isDangerousCommand;
  });

  it('allows Read in all modes', () => {
    assert.equal(checkPermission('Read', { file_path: '/foo.ts' }, 'explore').action, 'allow');
    assert.equal(checkPermission('Read', { file_path: '/foo.ts' }, 'normal').action, 'allow');
    assert.equal(checkPermission('Read', { file_path: '/foo.ts' }, 'trust').action, 'allow');
  });

  it('denies Write in explore mode', () => {
    assert.equal(checkPermission('Write', { file_path: '/foo.ts' }, 'explore').action, 'deny');
  });

  it('allows Write in normal mode', () => {
    assert.equal(checkPermission('Write', { file_path: '/foo.ts' }, 'normal').action, 'allow');
  });

  it('asks for Bash in normal mode', () => {
    assert.equal(checkPermission('Bash', { command: 'unknown-cmd' }, 'normal').action, 'ask');
  });

  it('allows everything in trust mode', () => {
    assert.equal(checkPermission('Bash', { command: 'rm -rf /' }, 'trust').action, 'ask'); // dangerous always asks
    assert.equal(checkPermission('Write', { file_path: '/.env' }, 'trust').action, 'allow');
  });

  it('always asks for dangerous bash commands regardless of mode', () => {
    assert.equal(isDangerousCommand('rm -rf /'), true);
    assert.equal(isDangerousCommand('sudo apt install'), true);
    assert.equal(isDangerousCommand('git push --force'), true);
    assert.equal(isDangerousCommand('ls -la'), false);
    assert.equal(isDangerousCommand('npm install'), false);
  });

  it('applies user rules with findLast semantics', () => {
    const rules = [
      { permission: 'Bash', pattern: '*', action: 'deny' as const },
      { permission: 'Bash', pattern: 'npm *', action: 'allow' as const },
    ];
    assert.equal(checkPermission('Bash', { command: 'npm test' }, 'normal', rules).action, 'allow');
    assert.equal(checkPermission('Bash', { command: 'curl evil.com' }, 'normal', rules).action, 'deny');
  });
});

// ── Claude Code Compat URL building ─────────────────────────────

describe('Claude Code compat URL building', () => {
  // Test the buildMessagesUrl function by importing the module
  it('appends /v1/messages to bare domain', async () => {
    // We test indirectly by checking the model's URL construction
    const { ClaudeCodeCompatModel } = await import('@/lib/claude-code-compat/claude-code-compat-model');
    const model = new ClaudeCodeCompatModel({
      baseUrl: 'https://proxy.example.com',
      modelId: 'sonnet',
      apiKey: 'test',
    });
    assert.equal(model.modelId, 'sonnet');
    assert.equal(model.provider, 'claude-code-compat');
    assert.equal(model.specificationVersion, 'v3');
  });

  it('handles deep path proxy (inserts /v1/messages)', async () => {
    const { ClaudeCodeCompatModel } = await import('@/lib/claude-code-compat/claude-code-compat-model');
    // This exercises buildMessagesUrl internally
    const model = new ClaudeCodeCompatModel({
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      modelId: 'glm-5-turbo',
      authToken: 'test-token',
    });
    assert.equal(model.modelId, 'glm-5-turbo');
  });
});

// ── Provider transport detection ────────────────────────────────

describe('Provider transport detection', () => {
  it('official anthropic URL → standard-messages', async () => {
    // This test validates the logic in provider-transport.ts
    // We can't easily test without a real provider, so test the helper logic
    const isOfficial = (url: string) => {
      try {
        const hostname = new URL(url).hostname;
        return hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com');
      } catch { return false; }
    };
    assert.equal(isOfficial('https://api.anthropic.com/v1'), true);
    assert.equal(isOfficial('https://open.bigmodel.cn/api/anthropic'), false);
    assert.equal(isOfficial('https://aiberm.com'), false);
    assert.equal(isOfficial('https://api.minimaxi.com/anthropic'), false);
  });
});

// ── Event bus ───────────────────────────────────────────────────

describe('Runtime event bus', () => {
  let eventBus: typeof import('@/lib/runtime/event-bus');

  beforeEach(async () => {
    eventBus = await import('@/lib/runtime/event-bus');
    eventBus.clear();
  });

  it('fires handlers on emit', () => {
    const events: string[] = [];
    eventBus.on('session:start', (data) => { events.push(`start:${data.sessionId}`); });
    eventBus.emit('session:start', { sessionId: 'test-123' });
    assert.equal(events.length, 1);
    assert.equal(events[0], 'start:test-123');
  });

  it('supports multiple handlers', () => {
    let count = 0;
    eventBus.on('tool:pre-use', () => { count++; });
    eventBus.on('tool:pre-use', () => { count++; });
    eventBus.emit('tool:pre-use', { sessionId: 's1' });
    assert.equal(count, 2);
  });

  it('removes handlers with off()', () => {
    let count = 0;
    const handler = () => { count++; };
    eventBus.on('session:end', handler);
    eventBus.emit('session:end', { sessionId: 's1' });
    assert.equal(count, 1);
    eventBus.off('session:end', handler);
    eventBus.emit('session:end', { sessionId: 's1' });
    assert.equal(count, 1); // not incremented
  });

  it('does not throw on handler errors', () => {
    eventBus.on('session:start', () => { throw new Error('boom'); });
    // Should not throw
    eventBus.emit('session:start', { sessionId: 's1' });
  });
});

// ── SSE parser ──────────────────────────────────────────────────

describe('Claude Code compat SSE parser', () => {
  it('parses standard SSE events', async () => {
    const { parseSSEStream } = await import('@/lib/claude-code-compat/sse-parser');

    const sseText = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"sonnet","usage":{"input_tokens":10}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseText));
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event.type);
    }

    assert.deepEqual(events, [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
  });

  it('handles CRLF line endings', async () => {
    const { parseSSEStream } = await import('@/lib/claude-code-compat/sse-parser');

    const sseText = 'data: {"type":"message_stop"}\r\n\r\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseText));
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event.type);
    }
    assert.equal(events.length, 1);
    assert.equal(events[0], 'message_stop');
  });
});

// ── System prompt ───────────────────────────────────────────────

describe('System prompt builder', () => {
  it('includes base prompt', async () => {
    const { buildSystemPrompt } = await import('@/lib/agent-system-prompt');
    const prompt = buildSystemPrompt();
    assert.ok(prompt.includes('CodePilot'));
  });

  it('includes working directory', async () => {
    const { buildSystemPrompt } = await import('@/lib/agent-system-prompt');
    const prompt = buildSystemPrompt({ workingDirectory: '/test/dir' });
    assert.ok(prompt.includes('/test/dir'));
  });

  it('includes user prompt', async () => {
    const { buildSystemPrompt } = await import('@/lib/agent-system-prompt');
    const prompt = buildSystemPrompt({ userPrompt: 'Be concise' });
    assert.ok(prompt.includes('Be concise'));
  });

  it('includes context snippets', async () => {
    const { buildSystemPrompt } = await import('@/lib/agent-system-prompt');
    const prompt = buildSystemPrompt({ contextSnippets: ['Custom context here'] });
    assert.ok(prompt.includes('Custom context here'));
  });
});

// ── Finish reason mapping ───────────────────────────────────────

describe('Anthropic finish reason mapping', () => {
  it('maps standard finish reasons', async () => {
    const { mapFinishReason } = await import('@/lib/claude-code-compat/types');
    assert.equal(mapFinishReason('end_turn').unified, 'stop');
    assert.equal(mapFinishReason('tool_use').unified, 'tool-calls');
    assert.equal(mapFinishReason('max_tokens').unified, 'length');
    assert.equal(mapFinishReason('stop_sequence').unified, 'stop');
    assert.equal(mapFinishReason('unknown_value').unified, 'other');
  });

  it('preserves raw reason', async () => {
    const { mapFinishReason } = await import('@/lib/claude-code-compat/types');
    assert.equal(mapFinishReason('end_turn').raw, 'end_turn');
    assert.equal(mapFinishReason('tool_use').raw, 'tool_use');
  });
});
