/**
 * Phase 8 Phase 5 — Codex dynamic tool-call bridge (item/tool/call).
 *
 * Run: npx tsx --test src/__tests__/unit/codex-dynamic-tool-bridge.test.ts
 *
 * The model-autonomous path: Codex sends `item/tool/call` (a server
 * request) when the model decides to call an inherited MCP tool mid-turn.
 * The bridge forwards the call to Codex's MCP manager via
 * mcpServer/tool/call and shapes the DynamicToolCallResponse. It must not
 * maintain a second CodePilot-specific capability allowlist.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  dispatchCodexDynamicToolCall,
  handleCodexDynamicToolCall,
  isManagedLocalDynamicToolLifecycle,
  registerCodexDynamicToolRoute,
  type CodexDynamicToolCallParams,
  type McpToolCallResultLike,
} from '../../lib/codex/dynamic-tool-bridge';

function params(over: Partial<CodexDynamicToolCallParams> = {}): CodexDynamicToolCallParams {
  return {
    threadId: 't1',
    turnId: 'turn1',
    callId: 'call1',
    namespace: 'codepilot_memory',
    tool: 'codepilot_memory_recent',
    arguments: {},
    ...over,
  };
}

describe('handleCodexDynamicToolCall', () => {
  it('forwards an inherited MCP call to mcpServer/tool/call and returns success text', async () => {
    const calls: unknown[] = [];
    const forward = async (req: unknown): Promise<McpToolCallResultLike> => {
      calls.push(req);
      return { content: [{ type: 'text', text: 'MEMTEST recent memory' }] };
    };
    const res = await handleCodexDynamicToolCall(
      params({ tool: 'codepilot_memory_recent', arguments: { q: 1 } }),
      forward,
    );
    // forwarded with namespace→server mapping (NOT bypassing Codex MCP mgr)
    assert.deepEqual(calls[0], {
      threadId: 't1',
      server: 'codepilot_memory',
      tool: 'codepilot_memory_recent',
      arguments: { q: 1 },
    });
    assert.equal(res.success, true);
    assert.deepEqual(res.contentItems, [{ type: 'inputText', text: 'MEMTEST recent memory' }]);
  });

  it('maps MCP isError:true → success:false (still returns the error text)', async () => {
    const forward = async (): Promise<McpToolCallResultLike> => ({
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    });
    const res = await handleCodexDynamicToolCall(params({ tool: 'codepilot_memory_search' }), forward);
    assert.equal(res.success, false);
    assert.equal(res.contentItems[0].type, 'inputText');
    assert.match((res.contentItems[0] as { text: string }).text, /boom/);
  });

  it('forwards arbitrary inherited MCP namespaces instead of enforcing a CodePilot allowlist', async () => {
    const calls: unknown[] = [];
    const forward = async (req: unknown): Promise<McpToolCallResultLike> => {
      calls.push(req);
      return { content: [{ type: 'text', text: 'sunny' }] };
    };
    const res = await handleCodexDynamicToolCall(
      params({
        namespace: 'user_weather',
        tool: 'get_forecast',
        arguments: { city: 'Shanghai' },
      }),
      forward,
    );
    assert.deepEqual(calls, [{
      threadId: 't1',
      server: 'user_weather',
      tool: 'get_forecast',
      arguments: { city: 'Shanghai' },
    }]);
    assert.equal(res.success, true);
    assert.equal((res.contentItems[0] as { text: string }).text, 'sunny');
  });

  it('forwards arbitrary tools within an inherited namespace and leaves approval to Codex', async () => {
    const calls: unknown[] = [];
    const forward = async (req: unknown): Promise<McpToolCallResultLike> => {
      calls.push(req);
      return { structuredContent: { deleted: true } };
    };
    const res = await handleCodexDynamicToolCall(
      params({ tool: 'codepilot_memory_delete_everything' }),
      forward,
    );
    assert.equal(calls.length, 1);
    assert.equal(res.success, true);
    assert.equal(
      (res.contentItems[0] as { text: string }).text,
      JSON.stringify({ deleted: true }),
    );
  });

  it('null namespace → graceful success:false', async () => {
    const res = await handleCodexDynamicToolCall(
      params({ namespace: null, tool: 'whatever' }),
      async () => ({}),
    );
    assert.equal(res.success, false);
  });

  it('falls back to structuredContent / JSON when no text content', async () => {
    const forward = async (): Promise<McpToolCallResultLike> => ({
      content: [],
      structuredContent: { hits: 3 },
    });
    const res = await handleCodexDynamicToolCall(params({ tool: 'codepilot_memory_search' }), forward);
    assert.equal(res.success, true);
    assert.equal((res.contentItems[0] as { text: string }).text, JSON.stringify({ hits: 3 }));
  });

  it('a forward failure becomes a graceful success:false (never throws to method-not-found)', async () => {
    const forward = async (): Promise<McpToolCallResultLike> => {
      throw new Error('mcp manager exploded');
    };
    const res = await handleCodexDynamicToolCall(params(), forward);
    assert.equal(res.success, false);
    assert.match((res.contentItems[0] as { text: string }).text, /failed.*exploded/i);
  });
});

describe('dispatchCodexDynamicToolCall — thread ownership + local managed tools', () => {
  it('routes a non-namespaced managed tool by thread id and preserves call id + abort signal', async () => {
    const controller = new AbortController();
    const calls: unknown[] = [];
    const unregister = registerCodexDynamicToolRoute('managed-thread', {
      forwardMcp: async () => ({}),
      abortSignal: controller.signal,
      localTools: new Map([[
        'codepilot_spawn_subagent',
        async (input, options) => {
          calls.push({ input, options });
          return 'managed terminal result';
        },
      ]]),
    });
    try {
      const res = await dispatchCodexDynamicToolCall(params({
        threadId: 'managed-thread',
        namespace: null,
        tool: 'codepilot_spawn_subagent',
        callId: 'wire-call-7',
        arguments: { model: 'deepseek-v4' },
      }));
      assert.equal(res.success, true);
      assert.equal((res.contentItems[0] as { text: string }).text, 'managed terminal result');
      assert.deepEqual(calls, [{
        input: { model: 'deepseek-v4' },
        options: { toolCallId: 'wire-call-7', abortSignal: controller.signal },
      }]);
    } finally {
      unregister();
    }
  });

  it('keeps concurrent thread routes independent and cleanup is identity-gated', async () => {
    const old = registerCodexDynamicToolRoute('shared-thread', {
      forwardMcp: async () => ({ content: [{ type: 'text', text: 'old' }] }),
    });
    const current = registerCodexDynamicToolRoute('shared-thread', {
      forwardMcp: async () => ({ content: [{ type: 'text', text: 'current' }] }),
    });
    old();
    const res = await dispatchCodexDynamicToolCall(params({
      threadId: 'shared-thread',
      namespace: 'memory',
    }));
    assert.equal(res.success, true);
    assert.equal((res.contentItems[0] as { text: string }).text, 'current');
    current();
    const missing = await dispatchCodexDynamicToolCall(params({
      threadId: 'shared-thread',
    }));
    assert.equal(missing.success, false);
    assert.match((missing.contentItems[0] as { text: string }).text, /No active.*owner/i);
  });

  it('fails closed for an unregistered local tool', async () => {
    const unregister = registerCodexDynamicToolRoute('managed-thread-2', {
      forwardMcp: async () => ({}),
      localTools: new Map(),
    });
    try {
      const res = await dispatchCodexDynamicToolCall(params({
        threadId: 'managed-thread-2',
        namespace: null,
        tool: 'spawn_agent',
      }));
      assert.equal(res.success, false);
      assert.match((res.contentItems[0] as { text: string }).text, /Unknown non-namespaced/i);
    } finally {
      unregister();
    }
  });
});

describe('isManagedLocalDynamicToolLifecycle', () => {
  const managed = new Set(['codepilot_spawn_subagent', 'codepilot_list_subagent_runs']);

  it('suppresses only mirrored non-namespaced managed start/completed items', () => {
    const item = {
      item: {
        type: 'dynamicToolCall',
        id: 'call-1',
        namespace: null,
        tool: 'codepilot_spawn_subagent',
      },
    };
    assert.equal(isManagedLocalDynamicToolLifecycle('item/started', item, managed), true);
    assert.equal(isManagedLocalDynamicToolLifecycle('item/completed', item, managed), true);
    assert.equal(isManagedLocalDynamicToolLifecycle('item/updated', item, managed), false);
  });

  it('preserves inherited MCP and unknown local dynamic-tool lifecycle events', () => {
    assert.equal(isManagedLocalDynamicToolLifecycle('item/started', {
      item: {
        type: 'dynamicToolCall',
        namespace: 'codepilot_memory',
        tool: 'codepilot_memory_recent',
      },
    }, managed), false);
    assert.equal(isManagedLocalDynamicToolLifecycle('item/started', {
      item: {
        type: 'dynamicToolCall',
        namespace: null,
        tool: 'future_host_tool',
      },
    }, managed), false);
  });
});

describe('runtime.ts — dynamic tool call wiring (source pin)', () => {
  const runtimeSrc = fs.readFileSync(path.resolve(__dirname, '../../lib/codex/runtime.ts'), 'utf-8');

  it('registers item/tool/call and forwards via mcpServer/tool/call', () => {
    assert.ok(runtimeSrc.includes("onServerRequest('item/tool/call'"), 'must register item/tool/call handler');
    assert.ok(runtimeSrc.includes('dispatchCodexDynamicToolCall'), 'must use the thread-owned dispatcher');
    assert.ok(runtimeSrc.includes('registerCodexDynamicToolRoute'), 'must register each resolved thread owner');
    assert.match(
      runtimeSrc,
      /client\.request<[^>]*>\('mcpServer\/tool\/call'/,
      'dynamic calls must forward through mcpServer/tool/call (keep Codex MCP lifecycle)',
    );
    assert.doesNotMatch(
      runtimeSrc,
      /ALLOWED_DYNAMIC_TOOLS/,
      'runtime must not reintroduce a second CodePilot capability allowlist',
    );
  });
});
