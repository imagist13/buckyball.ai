/**
 * 稳定性审�?�?�?Stop/abort watchdog �?setTimeout 句柄 + abort listener
 * 必须�?settle 后清理�? *
 * 修复前：watchdog �?`setTimeout(() => settleLock('interrupted'), grace)` 句柄
 * 未保存、abort listener 未在正常 settle 后移�?�?正常收尾�?timer 仍把事件循环
 * 拉活整个 grace 窗口，listener 悬挂�?abortController。修�?= 保存句柄，settler
 * 的（一次性）clearRenewal 同时 clearTimeout + removeEventListener�? *
 * route.ts 无法在单测导入（Electron ABI 依赖），故源码钉清理接线。settler �? * 幂等性另�?session-lock-settle.test.ts 覆盖�? */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../app/api/chat/route.ts'), 'utf-8');

describe('chat/route.ts watchdog 清理（⑥源码钉）', () => {
  it('保存 setTimeout 句柄�?watchdogTimer', () => {
    assert.ok(
      /watchdogTimer = setTimeout\(\(\) => settleLock\('interrupted'\)/.test(SRC),
      'watchdog �?setTimeout 句柄必须存入 watchdogTimer',
    );
  });

  it('abort listener 存成具名引用并以该引�?addEventListener', () => {
    assert.ok(SRC.includes('watchdogAbortListener = () =>'), 'listener 必须存成具名引用');
    assert.ok(
      /addEventListener\('abort', watchdogAbortListener, \{ once: true \}\)/.test(SRC),
      '必须用具�?listener 注册（否则无�?removeEventListener�?,
    );
  });

  it('clearWatchdog 同时 clearTimeout(watchdogTimer) �?removeEventListener', () => {
    const idx = SRC.indexOf('const clearWatchdog =');
    assert.ok(idx > -1, 'clearWatchdog 必须存在');
    const block = SRC.slice(idx, idx + 400);
    assert.ok(/clearTimeout\(watchdogTimer\)/.test(block), 'clearWatchdog 必须 clearTimeout');
    assert.ok(
      /removeEventListener\('abort', watchdogAbortListener\)/.test(block),
      'clearWatchdog 必须 removeEventListener',
    );
  });

  it('settler �?clearRenewal �?settle 时触�?clearWatchdog', () => {
    assert.ok(
      /clearRenewal: \(\) => \{ clearInterval\(lockRenewalInterval\); clearWatchdog\(\); \}/.test(SRC),
      'clearRenewal 必须同时�?renewal interval �?watchdog（settle 一次性清理）',
    );
  });
});
