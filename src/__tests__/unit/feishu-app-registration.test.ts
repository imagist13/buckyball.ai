/**
 * Unit tests for Feishu App Registration state machine.
 *
 * Covers:
 * - startRegistration — successful begin response parsing, session persistence
 * - pollRegistration — authorization_pending (keeps waiting), slow_down (increases interval),
 *   access_denied (failed + user_denied code), expired_token (expired + timeout code),
 *   successful completion writes credentials to DB + returns completed
 * - Lark fallback — empty client_secret + tenant_brand=lark switches to larksuite endpoint
 *   and continues polling if Lark returns authorization_pending
 * - Error code contract (timeout / user_denied / empty_credentials / lark_empty_credentials)
 * - cancelRegistration removes the session from memory
 */

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-feishu-reg-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

let feishuReg: typeof import('../../lib/bridge/feishu-app-registration');
let getSetting: typeof import('../../lib/db').getSetting;
let closeDb: typeof import('../../lib/db').closeDb;

const originalFetch = globalThis.fetch;

// Helper: build a fetch mock from a queue of responses.
type MockResponse = { status: number; body: Record<string, unknown> };
function mockFetch(responses: Map<string, MockResponse[]>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    // Match by host+path (ignore query)
    const key = new URL(url).origin + new URL(url).pathname;
    const queue = responses.get(key);
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected fetch call: ${url}`);
    }
    const resp = queue.shift()!;
    return new Response(JSON.stringify(resp.body), { status: resp.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const FEISHU_REG_URL = 'https://accounts.feishu.cn/oauth/v1/app/registration';
const LARK_REG_URL = 'https://accounts.larksuite.com/oauth/v1/app/registration';

before(async () => {
  feishuReg = await import('../../lib/bridge/feishu-app-registration');
  ({ getSetting, closeDb } = await import('../../lib/db'));
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('startRegistration', () => {
  it('returns session_id and verification_url on success', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          device_code: 'dc_abc',
          user_code: 'XYZW-1234',
          verification_uri: 'https://open.feishu.cn/page/openclaw',
          verification_uri_complete: 'https://open.feishu.cn/page/openclaw?user_code=XYZW-1234',
          expires_in: 300,
          interval: 5,
        },
      }]],
    ]));

    const result = await feishuReg.startRegistration();
    assert.match(result.sessionId, /^feishu_reg_/);
    assert.equal(result.verificationUrl, 'https://open.feishu.cn/page/openclaw?user_code=XYZW-1234');

    const session = feishuReg.getRegistrationSession(result.sessionId);
    assert.ok(session);
    assert.equal(session!.deviceCode, 'dc_abc');
    assert.equal(session!.status, 'waiting');
    assert.equal(session!.interval, 5000);
  });

  it('throws if response is missing device_code', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 200, body: { user_code: 'xxx' } }]],
    ]));
    await assert.rejects(() => feishuReg.startRegistration(), /missing device_code/i);
  });
});

describe('pollRegistration', () => {
  let sessionId: string;

  beforeEach(async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          device_code: 'dc_test',
          user_code: 'AAAA-1111',
          verification_uri_complete: 'https://open.feishu.cn/page/openclaw?user_code=AAAA-1111',
          expires_in: 300,
          interval: 5,
        },
      }]],
    ]));
    const r = await feishuReg.startRegistration();
    sessionId = r.sessionId;
  });

  it('stays waiting on authorization_pending', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 400, body: { error: 'authorization_pending' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'waiting');
    assert.equal(session.errorCode, undefined);
  });

  it('increases interval on slow_down', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 400, body: { error: 'slow_down' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'waiting');
    assert.equal(session.interval, 10000); // 5000 + 5000
  });

  it('caps interval at MAX_INTERVAL_MS', async () => {
    // Pre-set interval near the cap
    const s = feishuReg.getRegistrationSession(sessionId)!;
    s.interval = 58_000;

    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 400, body: { error: 'slow_down' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.interval, 60000); // capped
  });

  it('maps access_denied to user_denied error code', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 400, body: { error: 'access_denied' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'failed');
    assert.equal(session.errorCode, 'user_denied');
  });

  it('maps expired_token to timeout error code', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{ status: 400, body: { error: 'expired_token' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'expired');
    assert.equal(session.errorCode, 'timeout');
  });

  it('writes credentials to DB on successful completion', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_abc123',
          client_secret: 'secret_xyz',
          user_info: { open_id: 'ou_test', tenant_brand: 'feishu' },
        },
      }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'completed');
    assert.equal(session.appId, 'cli_abc123');
    assert.equal(session.appSecret, 'secret_xyz');
    assert.equal(session.domain, 'feishu');

    // Verify credentials hit the DB
    assert.equal(getSetting('bridge_feishu_app_id'), 'cli_abc123');
    assert.equal(getSetting('bridge_feishu_app_secret'), 'secret_xyz');
    assert.equal(getSetting('bridge_feishu_domain'), 'feishu');
  });

  it('expires session when past expiresAt', async () => {
    const s = feishuReg.getRegistrationSession(sessionId)!;
    s.expiresAt = Date.now() - 1000;

    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'expired');
    assert.equal(session.errorCode, 'timeout');
  });

  it('maps empty credentials to empty_credentials error code', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: '',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'feishu' },
        },
      }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'failed');
    assert.equal(session.errorCode, 'empty_credentials');
  });

  it('throws on invalid session_id', async () => {
    await assert.rejects(() => feishuReg.pollRegistration('nonexistent'), /Session not found/);
  });
});

describe('pollRegistration — Lark fallback', () => {
  let sessionId: string;

  beforeEach(async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          device_code: 'dc_lark',
          user_code: 'LARK-0001',
          verification_uri_complete: 'https://open.feishu.cn/page/openclaw?user_code=LARK-0001',
          expires_in: 300,
          interval: 5,
        },
      }]],
    ]));
    const r = await feishuReg.startRegistration();
    sessionId = r.sessionId;
  });

  it('switches to lark endpoint when tenant_brand=lark and retries successfully', async () => {
    globalThis.fetch = mockFetch(new Map([
      // First feishu response: lark tenant with empty secret
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
      // Lark endpoint returns full credentials
      [LARK_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: 'lark_secret',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
    ]));

    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'completed');
    assert.equal(session.domain, 'lark');
    assert.equal(session.appId, 'cli_lark_id');
    assert.equal(session.appSecret, 'lark_secret');
    assert.equal(getSetting('bridge_feishu_domain'), 'lark');
  });

  it('keeps waiting when lark endpoint returns authorization_pending', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
      [LARK_REG_URL, [{ status: 400, body: { error: 'authorization_pending' } }]],
    ]));

    const session = await feishuReg.pollRegistration(sessionId);
    // Lark is still pending, session should stay waiting (not fail)
    assert.equal(session.status, 'waiting');
    assert.equal(session.domain, 'lark'); // but domain latched to lark for future polls
    assert.equal(session.errorCode, undefined);
  });

  it('subsequent poll after lark detection uses lark endpoint', async () => {
    // First poll: detect lark
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
      [LARK_REG_URL, [{ status: 400, body: { error: 'authorization_pending' } }]],
    ]));
    await feishuReg.pollRegistration(sessionId);

    // Second poll should go straight to LARK endpoint (not feishu)
    globalThis.fetch = mockFetch(new Map([
      [LARK_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: 'lark_done',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'completed');
    assert.equal(session.appSecret, 'lark_done');
  });

  it('increases interval on lark slow_down', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
      [LARK_REG_URL, [{ status: 400, body: { error: 'slow_down' } }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'waiting');
    assert.equal(session.interval, 10000);
  });

  it('maps lark empty credentials to lark_empty_credentials error code', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          client_id: 'cli_lark_id',
          client_secret: '',
          user_info: { open_id: 'ou_test', tenant_brand: 'lark' },
        },
      }]],
      [LARK_REG_URL, [{
        status: 200,
        body: { client_id: '', client_secret: '' },
      }]],
    ]));
    const session = await feishuReg.pollRegistration(sessionId);
    assert.equal(session.status, 'failed');
    assert.equal(session.errorCode, 'lark_empty_credentials');
  });
});

describe('cancelRegistration', () => {
  it('removes the session from memory', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [{
        status: 200,
        body: {
          device_code: 'dc_cancel',
          user_code: 'CXL-0001',
          verification_uri_complete: 'https://open.feishu.cn/page/openclaw?user_code=CXL-0001',
          expires_in: 300,
          interval: 5,
        },
      }]],
    ]));
    const r = await feishuReg.startRegistration();
    assert.ok(feishuReg.getRegistrationSession(r.sessionId));

    feishuReg.cancelRegistration(r.sessionId);
    assert.equal(feishuReg.getRegistrationSession(r.sessionId), null);
  });

  it('is a no-op for unknown session_id', () => {
    assert.doesNotThrow(() => feishuReg.cancelRegistration('nonexistent'));
  });
});

describe('pollRegistration — terminal states are idempotent', () => {
  it('does not re-poll after completion', async () => {
    globalThis.fetch = mockFetch(new Map([
      [FEISHU_REG_URL, [
        {
          status: 200,
          body: {
            device_code: 'dc_idem',
            user_code: 'IDEM-0001',
            verification_uri_complete: 'https://open.feishu.cn/page/openclaw?user_code=IDEM-0001',
            expires_in: 300,
            interval: 5,
          },
        },
        {
          status: 200,
          body: {
            client_id: 'cli_idem',
            client_secret: 'secret_idem',
            user_info: { open_id: 'ou_test', tenant_brand: 'feishu' },
          },
        },
      ]],
    ]));
    const r = await feishuReg.startRegistration();
    const first = await feishuReg.pollRegistration(r.sessionId);
    assert.equal(first.status, 'completed');

    // Second poll should return the same session without additional fetch calls
    // (no more mocks queued — would throw if fetch was called)
    const second = await feishuReg.pollRegistration(r.sessionId);
    assert.equal(second.status, 'completed');
    assert.equal(second.appId, 'cli_idem');
  });
});
