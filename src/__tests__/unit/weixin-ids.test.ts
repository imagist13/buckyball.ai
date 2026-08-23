/**
 * Unit tests for WeChat chat ID encoding/decoding.
 *
 * Run with: npx tsx src/__tests__/unit/weixin-ids.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWeixinChatId, decodeWeixinChatId, isWeixinChatId } from '../../lib/bridge/adapters/weixin/weixin-ids';

describe('encodeWeixinChatId', () => {
  it('produces correct format', () => {
    assert.equal(encodeWeixinChatId('acc123', 'user456'), 'weixin::acc123::user456');
  });

  it('handles special characters in IDs', () => {
    assert.equal(encodeWeixinChatId('acc-im-bot', 'user@test'), 'weixin::acc-im-bot::user@test');
  });
});

describe('decodeWeixinChatId', () => {
  it('round-trips correctly', () => {
    const encoded = encodeWeixinChatId('myAccount', 'peerUser');
    const decoded = decodeWeixinChatId(encoded);
    assert.deepEqual(decoded, { accountId: 'myAccount', peerUserId: 'peerUser' });
  });

  it('returns null for non-weixin chatId', () => {
    assert.equal(decodeWeixinChatId('telegram:12345'), null);
    assert.equal(decodeWeixinChatId('random_string'), null);
  });

  it('returns null for malformed weixin chatId', () => {
    assert.equal(decodeWeixinChatId('weixin::'), null);
    assert.equal(decodeWeixinChatId('weixin::acc'), null);
    assert.equal(decodeWeixinChatId('weixin::::user'), null);
  });

  it('handles empty components', () => {
    assert.equal(decodeWeixinChatId('weixin::::peer'), null);
    assert.equal(decodeWeixinChatId('weixin::acc::'), null);
  });
});

describe('isWeixinChatId', () => {
  it('returns true for valid weixin chatIds', () => {
    assert.equal(isWeixinChatId('weixin::acc::user'), true);
  });

  it('returns false for non-weixin chatIds', () => {
    assert.equal(isWeixinChatId('telegram:123'), false);
    assert.equal(isWeixinChatId('qq:456'), false);
  });
});
