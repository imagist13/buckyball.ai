/**
 * Phase 5 Phase 1 — Codex app-server JSON-RPC client contract.
 *
 * Tests run against a mocked `CodexTransport` — no real `codex`
 * binary required. Covers:
 *
 *   - initialize() round-trip + initialized notification
 *   - request<T>() resolves with typed result
 *   - request<T>() rejects with CodexRpcError on error response
 *   - notification handlers receive matching method payloads
 *   - overload (-32001) retries up to maxOverloadRetries
 *   - dispose() rejects pending requests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CodexAppServerClient,
  CodexRpcError,
  type CodexTransport,
} from '@/lib/codex/app-server-client';
import { CODEX_CLIENT_NAME, JSON_RPC_OVERLOADED_CODE } from '@/lib/codex/types';

function makeMockTransport() {
  let messageHandler: ((line: string) => void) | null = null;
  const closeHandlers = new Set<(reason?: Error) => void>();
  let closed = false;
  let closeReason: Error | undefined;
  const sent: string[] = [];
  const transport: CodexTransport = {
    send(message) {
      sent.push(message);
    },
    onMessage(handler) {
      messageHandler = handler;
      return () => {
        if (messageHandler === handler) messageHandler = null;
      };
    },
    onClose(handler) {
      // Mirror the production stdio transport: notify immediately if the
      // process is already gone (exit-before-attach race).
      if (closed) {
        handler(closeReason);
        return () => { /* nothing to unsubscribe */ };
      }
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    async close() {
      messageHandler = null;
    },
  };
  return {
    transport,
    sent,
    emit(line: string) {
      if (!messageHandler) throw new Error('no message handler attached');
      messageHandler(line);
    },
    /** Simulate the child process / transport dying. */
    emitClose(reason?: Error) {
      if (closed) return;
      closed = true;
      closeReason = reason;
      for (const h of [...closeHandlers]) h(reason);
    },
    /** Wait one microtask so client-side promise wiring settles. */
    flush: () => new Promise<void>((r) => setImmediate(r)),
  };
}

describe('CodexAppServerClient — initialize handshake', () => {
  it('sends initialize with client name + version, then initialized notification', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '1.2.3' });

    const promise = client.initialize();
    await mock.flush();
    const initReq = JSON.parse(mock.sent[0]);
    assert.equal(initReq.jsonrpc, '2.0');
    assert.equal(initReq.method, 'initialize');
    assert.equal(initReq.params.clientInfo.name, CODEX_CLIENT_NAME);
    assert.equal(initReq.params.clientInfo.version, '1.2.3');
    assert.equal(typeof initReq.id, 'number');

    // Server responds
    mock.emit(JSON.stringify({
      jsonrpc: '2.0',
      id: initReq.id,
      result: {
        userAgent: 'codex/0.50.0',
        codexHome: '/home/test/.codex',
        platformFamily: 'unix',
        platformOs: 'macos',
      },
    }));

    const result = await promise;
    assert.equal(result.userAgent, 'codex/0.50.0');
    assert.equal(result.codexHome, '/home/test/.codex');

    // Initialized notification fired
    await mock.flush();
    const notif = JSON.parse(mock.sent[1]);
    assert.equal(notif.method, 'initialized');
    assert.equal(notif.id, undefined);
    assert.equal(client.initialized, true);

    await client.dispose();
  });
});

describe('CodexAppServerClient — request / response', () => {
  it('resolves a typed request with the server result', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    const promise = client.request<{ ok: true }>('model/list', { includeHidden: false });
    await mock.flush();
    const sent = JSON.parse(mock.sent[0]);
    assert.equal(sent.method, 'model/list');
    assert.equal(sent.params.includeHidden, false);
    mock.emit(JSON.stringify({ id: sent.id, result: { ok: true } }));
    const result = await promise;
    assert.deepEqual(result, { ok: true });
    await client.dispose();
  });

  it('rejects with CodexRpcError on error response, preserving code + data', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    const promise = client.request('unknown/method');
    await mock.flush();
    const sent = JSON.parse(mock.sent[0]);
    mock.emit(JSON.stringify({
      id: sent.id,
      error: { code: -32601, message: 'Method not found', data: { hint: 'check spelling' } },
    }));
    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof CodexRpcError);
      assert.equal((err as CodexRpcError).code, -32601);
      assert.equal((err as CodexRpcError).message, 'Method not found');
      assert.deepEqual((err as CodexRpcError).data, { hint: 'check spelling' });
      return true;
    });
    await client.dispose();
  });

  it('retries -32001 overloaded up to maxOverloadRetries, then surfaces the error', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, {
      version: '0.0.0',
      maxOverloadRetries: 2,
      requestTimeoutMs: 0,
    });
    const promise = client.request('thread/start', { cwd: '/tmp' });

    for (let attempt = 0; attempt < 3; attempt++) {
      // Each attempt: drain the queue, emit overload response.
      // Use polling because between attempts the client schedules a
      // backoff via setTimeout.
       
      while (mock.sent.length <= attempt) {
         
        await new Promise((r) => setTimeout(r, 10));
      }
      const sent = JSON.parse(mock.sent[attempt]);
      mock.emit(JSON.stringify({
        id: sent.id,
        error: { code: JSON_RPC_OVERLOADED_CODE, message: 'Server overloaded; retry later.' },
      }));
    }

    await assert.rejects(promise, (err: unknown) => err instanceof CodexRpcError && (err as CodexRpcError).code === JSON_RPC_OVERLOADED_CODE);
    // 1 initial + 2 retries = 3 sends
    assert.equal(mock.sent.length, 3);
    await client.dispose();
  });

  it('aborts one pending RPC at the caller deadline and drops a late response', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, {
      version: '0.0.0',
      requestTimeoutMs: 30_000,
    });
    const controller = new AbortController();
    const promise = client.request('model/list', {}, { signal: controller.signal });
    await mock.flush();
    const request = JSON.parse(mock.sent[0]);
    controller.abort();
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, 'AbortError');
      assert.match(error.message, /model\/list/);
      return true;
    });

    // A response that arrives after cancellation is ignored and must not affect
    // a subsequent request that uses a new id.
    mock.emit(JSON.stringify({ id: request.id, result: { stale: true } }));
    const next = client.request<{ ok: true }>('model/list');
    await mock.flush();
    const nextRequest = JSON.parse(mock.sent[1]);
    assert.notEqual(nextRequest.id, request.id);
    mock.emit(JSON.stringify({ id: nextRequest.id, result: { ok: true } }));
    assert.deepEqual(await next, { ok: true });
    await client.dispose();
  });

  it('honors a per-call timeout shorter than the client default', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, {
      version: '0.0.0',
      requestTimeoutMs: 30_000,
    });
    const start = Date.now();
    await assert.rejects(
      client.request('model/list', {}, { timeoutMs: 40 }),
      /Codex RPC timeout: model\/list/,
    );
    assert.ok(Date.now() - start < 1_000);
    await client.dispose();
  });
});

describe('CodexAppServerClient — notifications', () => {
  it('routes notifications by method to registered handlers', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    // Force attach without initialize
    const deltas: unknown[] = [];
    const unsub = client.onNotification('item/agentMessage/delta', (params) => deltas.push(params));
    // Manually attach via a no-op request prepares the listener. We
    // can use notify() to attach since it lazily attaches the
    // transport listener.
    await client.notify('initialized', {});

    mock.emit(JSON.stringify({
      method: 'item/agentMessage/delta',
      params: { threadId: 't1', turnId: 'u1', itemId: 'm1', delta: 'hello' },
    }));

    assert.equal(deltas.length, 1);
    assert.deepEqual(deltas[0], { threadId: 't1', turnId: 'u1', itemId: 'm1', delta: 'hello' });

    unsub();
    mock.emit(JSON.stringify({
      method: 'item/agentMessage/delta',
      params: { threadId: 't1', turnId: 'u1', itemId: 'm2', delta: 'world' },
    }));
    // No new delivery after unsubscribe.
    assert.equal(deltas.length, 1);
    await client.dispose();
  });
});

describe('CodexAppServerClient — wildcard notifications (P2.2 fix)', () => {
  it('onAnyNotification fires for every notification with (method, params)', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    const seen: Array<[string, unknown]> = [];
    client.onAnyNotification((method, params) => seen.push([method, params]));
    await client.notify('initialized', {}); // force-attach
    mock.emit(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'hi' } }));
    mock.emit(JSON.stringify({ method: 'codex.someUnknownNotif', params: { foo: 1 } }));
    mock.emit(JSON.stringify({ method: 'thread/tokenUsage/updated', params: {} }));
    assert.equal(seen.length, 3);
    assert.equal(seen[0][0], 'item/agentMessage/delta');
    assert.equal(seen[1][0], 'codex.someUnknownNotif');
    assert.deepEqual(seen[1][1], { foo: 1 });
    await client.dispose();
  });

  it('per-method + wildcard both fire (additive, not exclusive)', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    const specific: unknown[] = [];
    const wildcard: Array<[string, unknown]> = [];
    client.onNotification('item/agentMessage/delta', (p) => specific.push(p));
    client.onAnyNotification((method, params) => wildcard.push([method, params]));
    await client.notify('initialized', {});
    mock.emit(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'x' } }));
    assert.equal(specific.length, 1);
    assert.equal(wildcard.length, 1);
    assert.equal(wildcard[0][0], 'item/agentMessage/delta');
    await client.dispose();
  });

  it('handler throw does not block other wildcard handlers', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    const survivors: string[] = [];
    client.onAnyNotification(() => {
      throw new Error('boom');
    });
    client.onAnyNotification((method) => survivors.push(method));
    await client.notify('initialized', {});
    mock.emit(JSON.stringify({ method: 'fs/changed', params: {} }));
    assert.deepEqual(survivors, ['fs/changed']);
    await client.dispose();
  });

  it('unsubscribe drops the wildcard handler', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    const seen: string[] = [];
    const unsub = client.onAnyNotification((method) => seen.push(method));
    await client.notify('initialized', {});
    mock.emit(JSON.stringify({ method: 'a', params: {} }));
    unsub();
    mock.emit(JSON.stringify({ method: 'b', params: {} }));
    assert.deepEqual(seen, ['a']);
    await client.dispose();
  });
});

describe('CodexAppServerClient — server-originated requests (P1.1 fix)', () => {
  it('routes incoming request to onServerRequest handler + emits response', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    client.onServerRequest('item/commandExecution/requestApproval', () => ({ decision: 'decline' as const }));
    await client.notify('initialized', {}); // force-attach listener
    mock.emit(JSON.stringify({
      jsonrpc: '2.0',
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 't', turnId: 'u', itemId: 'i', startedAtMs: 0, command: 'ls' },
    }));
    // Allow the async handler + send to flush.
    await new Promise((r) => setTimeout(r, 5));
    const response = JSON.parse(mock.sent[1]); // sent[0] is the initialized notification
    assert.equal(response.id, 42);
    assert.deepEqual(response.result, { decision: 'decline' });
    await client.dispose();
  });

  it('no handler → auto-emits -32601 method not found so Codex does not hang', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    await client.notify('initialized', {});
    mock.emit(JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'codex.somethingNew',
      params: {},
    }));
    await new Promise((r) => setTimeout(r, 5));
    const response = JSON.parse(mock.sent[1]);
    assert.equal(response.id, 99);
    assert.equal(response.error.code, -32601);
    await client.dispose();
  });

  it('handler throw → -32603 internal error with the message', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    client.onServerRequest('item/commandExecution/requestApproval', () => {
      throw new Error('boom from handler');
    });
    await client.notify('initialized', {});
    mock.emit(JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'item/commandExecution/requestApproval',
      params: {},
    }));
    await new Promise((r) => setTimeout(r, 5));
    const response = JSON.parse(mock.sent[1]);
    assert.equal(response.error.code, -32603);
    assert.match(response.error.message, /boom from handler/);
    await client.dispose();
  });

  it('handler returning a Promise resolves into the response', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    client.onServerRequest('item/permissions/requestApproval', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { decision: 'accept' as const };
    });
    await client.notify('initialized', {});
    mock.emit(JSON.stringify({
      jsonrpc: '2.0',
      id: 13,
      method: 'item/permissions/requestApproval',
      params: { reason: 'sandbox' },
    }));
    await new Promise((r) => setTimeout(r, 20));
    const response = JSON.parse(mock.sent[1]);
    assert.deepEqual(response.result, { decision: 'accept' });
    await client.dispose();
  });
});

describe('CodexAppServerClient — dispose', () => {
  it('rejects pending requests on dispose so callers do not hang', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0', requestTimeoutMs: 0 });
    const promise = client.request('thread/start');
    await mock.flush();
    await client.dispose();
    await assert.rejects(promise, /aborted.*disposed/);
  });
});

describe('CodexAppServerClient — transport close (P0: fast-fail, not 30s timeout)', () => {
  it('rejects a pending request immediately when the process exits — NOT after the 30s timeout', async () => {
    const mock = makeMockTransport();
    // Real 30s default: a regression that waits the timeout would make this
    // test slow AND fail the elapsed assertion below.
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0', requestTimeoutMs: 30_000 });
    const promise = client.initialize();
    await mock.flush();
    // Server never responds; the app-server dies (e.g. old binary rejecting
    // ~/.codex/config.toml → exit 1).
    const start = Date.now();
    mock.emitClose(new Error('Codex app-server exited (code=1 signal=null)'));
    await assert.rejects(promise, /exited \(code=1/);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `expected fast-fail on close, took ${elapsed}ms (regression: waiting the 30s RPC timeout?)`);
    await client.dispose();
  });

  it('rejects ALL in-flight requests on close, each with the close reason', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0', requestTimeoutMs: 30_000 });
    const a = client.request('model/list');
    const b = client.request('thread/start');
    await mock.flush();
    mock.emitClose(new Error('transport gone'));
    await assert.rejects(a, /transport gone/);
    await assert.rejects(b, /transport gone/);
    await client.dispose();
  });

  it('fast-fails NEW requests issued after the transport has closed (no write to a dead pipe)', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0', requestTimeoutMs: 30_000 });
    await client.notify('initialized', {}); // forces attach so onClose is wired
    mock.emitClose(new Error('boom'));
    const sentBefore = mock.sent.length;
    await assert.rejects(client.request('model/list', { includeHidden: false }), /boom/);
    assert.equal(mock.sent.length, sentBefore, 'must not send to a closed transport');
    await client.dispose();
  });

  it('handles the exit-before-attach race — close before initialize still rejects fast', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0', requestTimeoutMs: 30_000 });
    // Process dies BEFORE the client ever attaches / sends initialize.
    mock.emitClose(new Error('died early'));
    const start = Date.now();
    await assert.rejects(client.initialize(), /died early/);
    assert.ok(Date.now() - start < 1000, 'already-closed transport must reject the next request synchronously');
    await client.dispose();
  });
});
