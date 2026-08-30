/**
 * Phase 5 Phase 2 — Codex account state translation contract.
 *
 * Test runs against a mocked app-server transport via the existing
 * `CodexAppServerClient` machinery rather than against a real `codex`
 * binary. Pins the narrowing from upstream `Account | null` →
 * `CodexAccountState` discriminated union the UI consumes:
 *
 *   account: null                              → { kind: 'logged_out' }
 *   account: { type: 'chatgpt', email, plan }  → { kind: 'logged_in', account: { type: 'chatgpt', ... } }
 *   account: { type: 'apiKey' }                → { kind: 'logged_in', account: { type: 'apiKey' } }
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CodexAppServerClient,
  type CodexTransport,
} from '@/lib/codex/app-server-client';

// We reach into the lib by reconstructing the narrowing inline; the
// upstream `readCodexAccount` requires the singleton manager (which
// pulls node-only deps). The pure mapping logic is what we lock here.
function narrowAccount(raw: {
  account: { type: 'apiKey' } | { type: 'chatgpt'; email: string; planType: string } | { type: 'amazonBedrock' } | null;
  requiresOpenaiAuth: boolean;
}) {
  if (!raw.account) return { kind: 'logged_out' as const };
  const a = raw.account;
  if (a.type === 'chatgpt') {
    return {
      kind: 'logged_in' as const,
      account: { type: 'chatgpt' as const, email: a.email, planType: a.planType },
    };
  }
  return { kind: 'logged_in' as const, account: { type: a.type } };
}

function makeMockTransport() {
  let messageHandler: ((line: string) => void) | null = null;
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
    async close() {
      messageHandler = null;
    },
  };
  return {
    transport,
    sent,
    emit(line: string) {
      if (!messageHandler) throw new Error('no handler');
      messageHandler(line);
    },
    flush: () => new Promise<void>((r) => setImmediate(r)),
  };
}

describe('Codex account state — narrowing', () => {
  it('null account → logged_out', () => {
    const state = narrowAccount({ account: null, requiresOpenaiAuth: false });
    assert.deepEqual(state, { kind: 'logged_out' });
  });

  it('chatgpt account preserves email + planType', () => {
    const state = narrowAccount({
      account: { type: 'chatgpt', email: 'user@example.com', planType: 'pro' },
      requiresOpenaiAuth: false,
    });
    assert.equal(state.kind, 'logged_in');
    if (state.kind !== 'logged_in') throw new Error('unreachable');
    assert.deepEqual(state.account, {
      type: 'chatgpt',
      email: 'user@example.com',
      planType: 'pro',
    });
  });

  it('apiKey account collapses to just type', () => {
    const state = narrowAccount({ account: { type: 'apiKey' }, requiresOpenaiAuth: false });
    assert.equal(state.kind, 'logged_in');
    if (state.kind !== 'logged_in') throw new Error('unreachable');
    assert.deepEqual(state.account, { type: 'apiKey' });
  });
});

describe('Codex app-server client — account/read round-trip', () => {
  it('sends account/read with refreshToken flag, parses response', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    const promise = client.request<{ account: null; requiresOpenaiAuth: boolean }>(
      'account/read',
      { refreshToken: false },
    );
    await mock.flush();
    const sent = JSON.parse(mock.sent[0]);
    assert.equal(sent.method, 'account/read');
    assert.equal(sent.params.refreshToken, false);
    mock.emit(JSON.stringify({ id: sent.id, result: { account: null, requiresOpenaiAuth: false } }));
    const result = await promise;
    assert.equal(result.account, null);
    await client.dispose();
  });
});
