/**
 * 稳定性审�?�?�?dequeue 死锁复位�? *
 * ChatView �?dequeue effect 先置 `dequeuingRef.current = true` 再调
 * doStartStream；若某个 guard 抑制了起流（�?resolved provider/model 为空），
 * isStreaming 永不�?true，末�?`if (isStreaming) dequeuingRef.current = false`
 * 永不执行 �?队列永久死锁。修�?= doStartStream 返回 boolean，dequeue �? * 起流失败分支复位 dequeuingRef。ChatView 是大�?React 组件无法纯单测，用源码钉�? */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../components/chat/ChatView.tsx'), 'utf-8');

describe('ChatView dequeue 死锁复位（④源码钉）', () => {
  it('doStartStream 声明为返�?boolean', () => {
    assert.ok(
      /selectedSkills\?: readonly string\[\]\): boolean =>/.test(SRC),
      'doStartStream 必须返回 boolean（起流成�?true / �?guard 抑制=false�?,
    );
  });

  it('doStartStream �?guard 抑制�?return false，成功尾�?return true', () => {
    // 至少一�?guard 分支 return false，且函数体末尾有 return true�?    assert.ok(SRC.includes('return false;'), 'guard 抑制必须 return false');
    assert.ok(/\}\);\n\s*return true;\n\s*\},/.test(SRC), 'startStream 调用后必�?return true');
  });

  it('dequeue 捕获返回值并在起流失败时复位 dequeuingRef', () => {
    const startedIdx = SRC.indexOf('const started = doStartStream(');
    assert.ok(startedIdx > -1, 'dequeue 必须捕获 doStartStream 的返回�?);
    const block = SRC.slice(startedIdx, startedIdx + 600);
    assert.ok(/if \(!started\)/.test(block), '必须判断起流失败分支');
    assert.ok(
      /if \(!started\)[\s\S]{0,400}dequeuingRef\.current = false/.test(block),
      '起流失败时必须复�?dequeuingRef（否则队列死锁）',
    );
  });
});
