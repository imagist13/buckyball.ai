/**
 * 稳定性审�?�?�?POST /api/chat 非法 body 必须返回 400 而非 500�? *
 * 修复前：route 在校验之前就 `console.log('�?content length:', content.length)`�? * content 缺失/非字符串会同步抛�?�?客户端拿到误导�?500。修�?= 校验前置�? * 任何 content 使用之前，非�?body 返回 400。route.ts 无法在单测中导入
 * （传递依�?Electron ABI �?better-sqlite3），故校验逻辑抽成纯函数在此覆盖，
 * 并源码钉校验调用位于日志之前�? */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateSendMessageBody } from '@/lib/chat-request-validation';

describe('validateSendMessageBody（③非法 body �?400�?, () => {
  it('合法 body 返回 null（放行）', () => {
    assert.equal(validateSendMessageBody({ session_id: 's1', content: 'hello' }), null);
  });

  it('content 缺失 �?400', () => {
    const r = validateSendMessageBody({ session_id: 's1' });
    assert.equal(r?.status, 400);
  });

  it('content 非字符串（number）→ 400，而不是让 .length/.slice �?500', () => {
    const r = validateSendMessageBody({ session_id: 's1', content: 123 as unknown as string });
    assert.equal(r?.status, 400);
  });

  it('content 为对�?�?400', () => {
    const r = validateSendMessageBody({ session_id: 's1', content: { a: 1 } });
    assert.equal(r?.status, 400);
  });

  it('content 空串 �?400', () => {
    assert.equal(validateSendMessageBody({ session_id: 's1', content: '' })?.status, 400);
  });

  it('session_id 缺失/非字符串 �?400', () => {
    assert.equal(validateSendMessageBody({ content: 'hi' })?.status, 400);
    assert.equal(validateSendMessageBody({ session_id: 42 as unknown as string, content: 'hi' })?.status, 400);
  });

  it('错误信息与旧内联校验保持一�?, () => {
    const r = validateSendMessageBody({});
    assert.ok(r, '�?body 必须返回校验错误');
    assert.equal(r.error, 'session_id and content are required');
  });
});

// ── 源码钉：校验前置于任�?content 使用 ──
describe('chat/route.ts 校验前置（③源码钉）', () => {
  it('validateSendMessageBody 调用早于读取 content.length 的日�?, () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/api/chat/route.ts'), 'utf-8');
    const validateIdx = src.indexOf('validateSendMessageBody(body)');
    const logIdx = src.indexOf("console.log('[chat API] content length:'");
    assert.ok(validateIdx > -1, 'route 必须调用 validateSendMessageBody');
    assert.ok(logIdx > -1, 'content length 日志仍存�?);
    assert.ok(validateIdx < logIdx, '校验必须在读�?content.length 之前（否则非�?body �?500�?);
  });
});
