import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  sendTextMessage,
  sendTyping,
} from '../../lib/bridge/adapters/weixin/weixin-api';

const creds = {
  botToken: 'token',
  ilinkBotId: 'bot-id',
  baseUrl: 'https://example.test',
  cdnBaseUrl: 'https://cdn.example.test',
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('weixin-api empty success bodies', () => {
  it('sendTextMessage tolerates empty 200 response bodies', async () => {
    let requestBody = '';
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body || '');
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const { clientId } = await sendTextMessage(creds, 'peer-user', 'hello', 'ctx-token');

    assert.match(clientId, /^codepilot-wx-/);
    const parsed = JSON.parse(requestBody);
    assert.equal(parsed.msg.to_user_id, 'peer-user');
    assert.equal(parsed.msg.context_token, 'ctx-token');
    assert.equal(parsed.msg.message_state, 2);
  });

  it('sendTyping tolerates empty 200 response bodies', async () => {
    let requestBody = '';
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body || '');
      return new Response('', { status: 200 });
    }) as typeof fetch;

    await assert.doesNotReject(() => sendTyping(creds, 'peer-user', 'ticket-1', 1));

    const parsed = JSON.parse(requestBody);
    assert.equal(parsed.ilink_user_id, 'peer-user');
    assert.equal(parsed.typing_ticket, 'ticket-1');
    assert.equal(parsed.status, 1);
  });
});
