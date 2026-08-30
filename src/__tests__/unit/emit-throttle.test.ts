/**
 * 稳定性审计 Phase 2 ② — 非文本 emit 节流（反假数据）。
 *
 * onThinking / onToolOutput / onToolProgress 此前每个增量都直接 emit
 * 'snapshot-updated' → 快速流式时 React 过量重渲。修复：三者复用 onText 已有的
 * ~100ms throttledTextEmit 合并 emit；终态与 onToolUse 前保持 flush 语义。
 *
 * 这是真实驱动 runStream 的集成反例（非源码钉）：mock fetch 返回可控 SSE 流、
 * fake setTimeout 控制节流窗口、fake window 接收派发，订阅真实 snapshot 事件。
 * 断言：
 *   1) 一段 burst（3 个增量）在节流窗口内 **0 次** 'snapshot-updated'（修复前为 3 次）；
 *   2) 触发节流窗口后 **恰好 1 次** 合并 emit，且其 snapshot 内容含全部增量
 *      （反假数据：合并后的最终态与不节流逐个 emit 的最终态一致）；
 *   3) onToolUse 前会 flush，thinking 不因工具到达而丢。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startStream, subscribe } from '@/lib/stream-session-manager';
import type { StreamEvent } from '@/types';

const STREAMS_KEY = '__streamSessionManager__';
const LISTENERS_KEY = '__streamSessionListeners__';

// ── Fake window（emit 会 window.dispatchEvent；完成路径也 dispatch refresh-file-tree）──
type GlobalAny = Record<string, unknown>;
class FakeWin {
  private listeners = new Map<string, Set<(e: Event) => void>>();
  addEventListener(type: string, fn: (e: Event) => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(e: Event) { this.listeners.get((e as { type: string }).type)?.forEach((f) => f(e)); return true; }
}
function installFakeWindow(): () => void {
  const g = globalThis as unknown as GlobalAny;
  const prevWin = g.window;
  const prevCE = g.CustomEvent;
  g.window = new FakeWin();
  if (typeof g.CustomEvent === 'undefined') {
    class CE<T> extends Event { detail: T; constructor(t: string, o?: { detail?: T }) { super(t); this.detail = o?.detail as T; } }
    g.CustomEvent = CE as unknown;
  }
  return () => { g.window = prevWin; g.CustomEvent = prevCE; };
}

// ── 可控 SSE 响应：手动 push 事件 + close，模拟 /api/chat 流 ──
function makeControlledResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const response = { ok: true, body, json: async () => ({}) } as unknown as Response;
  return {
    response,
    push(event: Record<string, unknown>) { controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)); },
    close() { controller.close(); },
  };
}

/** 让微任务 + reader.read() 解析跑完（setImmediate 未被 fake，真实可用）。 */
async function flush() {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
}

function updates(events: StreamEvent[]): StreamEvent[] {
  return events.filter((e) => e.type === 'snapshot-updated');
}

beforeEach(() => {
  (globalThis as GlobalAny)[STREAMS_KEY] = new Map();
  (globalThis as GlobalAny)[LISTENERS_KEY] = new Map();
});

describe('Phase 2 ② 非文本 emit 节流（真实驱动 runStream）', () => {
  it('onThinking：3 段增量节流窗口内 0 次 emit，触发后 1 次合并 emit 且含全部三段', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const restoreWin = installFakeWindow();
    const ctrl = makeControlledResponse();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => ctrl.response) as typeof fetch;
    const sid = 'thr-thinking';
    const events: StreamEvent[] = [];
    const unsub = subscribe(sid, (e) => events.push(e));
    try {
      startStream({ sessionId: sid, content: 'hi', mode: 'code', model: 'm', providerId: 'p' });
      await flush(); // fetch 解析 + reader 建立

      ctrl.push({ type: 'thinking', data: 'a' }); await flush();
      ctrl.push({ type: 'thinking', data: 'b' }); await flush();
      ctrl.push({ type: 'thinking', data: 'c' }); await flush();

      // 节流窗口内：0 次 snapshot-updated（修复前逐段 emit = 3 次）。
      assert.equal(updates(events).length, 0, '节流窗口内 3 段 thinking 应合并为 0 次 emit（修复前 3 次）');

      t.mock.timers.tick(100); // 触发 throttle timer
      const us = updates(events);
      assert.equal(us.length, 1, '触发节流后恰好 1 次合并 emit');
      assert.equal(
        us[0].snapshot.streamingThinkingContent,
        'abc',
        '反假数据：合并 emit 的 snapshot 必须含全部三段（与不节流逐个 emit 的最终态一致）',
      );

      // 故意不 ctrl.close()：完成路径会 scheduleGC(setTimeout 5min)，若它在
      // teardown 的 mock.timers.reset() 之后跑就会漏成一个真实 5min timer 卡住
      // 进程。节流合并/parity 不依赖完成，未关闭的流只留一个 fake idle interval，
      // reset() 会清掉；「终态 flush」语义由下方源码钉覆盖。
    } finally {
      unsub();
      t.mock.timers.reset();
      globalThis.fetch = prevFetch;
      restoreWin();
    }
  });

  it('onToolOutput：live 输出帧合并，最终 snapshot 含累积全文（反假数据）', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const restoreWin = installFakeWindow();
    const ctrl = makeControlledResponse();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => ctrl.response) as typeof fetch;
    const sid = 'thr-tooloutput';
    const events: StreamEvent[] = [];
    const unsub = subscribe(sid, (e) => events.push(e));
    try {
      startStream({ sessionId: sid, content: 'hi', mode: 'code', model: 'm', providerId: 'p' });
      await flush();

      ctrl.push({ type: 'tool_output', data: 'out1' }); await flush();
      ctrl.push({ type: 'tool_output', data: 'out2' }); await flush();
      ctrl.push({ type: 'tool_output', data: 'out3' }); await flush();

      assert.equal(updates(events).length, 0, '节流窗口内 3 帧 tool_output 应 0 次 emit');
      t.mock.timers.tick(100);
      const us = updates(events);
      assert.equal(us.length, 1, '触发后 1 次合并 emit');
      assert.equal(
        us[us.length - 1].snapshot.streamingToolOutput,
        'out1\nout2\nout3',
        '反假数据：合并后的 streamingToolOutput 必须是累积全文（与不节流一致）',
      );

      // 见上：不 close，避免完成路径 scheduleGC 漏成真实 5min timer。
    } finally {
      unsub();
      t.mock.timers.reset();
      globalThis.fetch = prevFetch;
      restoreWin();
    }
  });

  it('onToolProgress：进度 tick 合并，最终 statusText 为最新一条（丢中间不改最终态）', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const restoreWin = installFakeWindow();
    const ctrl = makeControlledResponse();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => ctrl.response) as typeof fetch;
    const sid = 'thr-progress';
    const events: StreamEvent[] = [];
    const unsub = subscribe(sid, (e) => events.push(e));
    try {
      startStream({ sessionId: sid, content: 'hi', mode: 'code', model: 'm', providerId: 'p' });
      await flush();

      const progress = (s: number) => ({ type: 'tool_output', data: JSON.stringify({ _progress: true, tool_name: 'Bash', elapsed_time_seconds: s }) });
      ctrl.push(progress(1)); await flush();
      ctrl.push(progress(2)); await flush();
      ctrl.push(progress(3)); await flush();

      assert.equal(updates(events).length, 0, '节流窗口内 3 个进度 tick 应 0 次 emit');
      t.mock.timers.tick(100);
      const us = updates(events);
      assert.equal(us.length, 1, '触发后 1 次合并 emit');
      assert.equal(
        us[us.length - 1].snapshot.statusText,
        'Running Bash... (3s)',
        '反假数据：合并后 statusText 为最新进度（3s）—— 中间帧丢弃不改最终态',
      );

      // 见上：不 close，避免完成路径 scheduleGC 漏成真实 5min timer。
    } finally {
      unsub();
      t.mock.timers.reset();
      globalThis.fetch = prevFetch;
      restoreWin();
    }
  });

  it('onToolUse 前 flush：pending thinking 不因工具到达而丢（无需 tick）', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const restoreWin = installFakeWindow();
    const ctrl = makeControlledResponse();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => ctrl.response) as typeof fetch;
    const sid = 'thr-flush-tooluse';
    const events: StreamEvent[] = [];
    const unsub = subscribe(sid, (e) => events.push(e));
    try {
      startStream({ sessionId: sid, content: 'hi', mode: 'code', model: 'm', providerId: 'p' });
      await flush();

      ctrl.push({ type: 'thinking', data: 'a' }); await flush();
      ctrl.push({ type: 'thinking', data: 'b' }); await flush();
      // 此刻 thinking 在节流中未 emit（0 次）
      assert.equal(updates(events).length, 0, 'tool_use 前 thinking 仍在节流窗口内');

      // 工具到达 → onToolUse 先 flushTextThrottle() 再 emit（无需 tick）
      ctrl.push({ type: 'tool_use', data: JSON.stringify({ id: 't1', name: 'Bash', input: {} }) });
      await flush();

      const us = updates(events);
      assert.ok(us.length >= 1, 'tool_use 应触发 flush + 工具 emit');
      const last = us[us.length - 1].snapshot;
      assert.equal(last.streamingThinkingContent, 'ab', 'flush 语义：工具到达时 thinking 已完整落入 snapshot，未丢');
      assert.equal(last.toolUses.length, 1, '工具本身也进了 snapshot');
      assert.equal(last.toolUses[0].id, 't1');

      // 见上：不 close，避免完成路径 scheduleGC 漏成真实 5min timer。
    } finally {
      unsub();
      t.mock.timers.reset();
      globalThis.fetch = prevFetch;
      restoreWin();
    }
  });
});

describe('Phase 2 ② 源码钉 — 复用 throttle + 终态/onToolUse 保持 flush', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../lib/stream-session-manager.ts'),
    'utf8',
  );

  // 用相邻 handler 名做精确边界切片，比固定窗口 regex 稳。
  function handlerBody(name: string, nextName: string): string {
    const start = src.indexOf(`${name}: (`);
    const end = src.indexOf(`${nextName}: (`, start);
    assert.ok(start >= 0 && end > start, `未定位 ${name}..${nextName} 处理块`);
    return src.slice(start, end);
  }

  it('onThinking / onToolOutput / onToolProgress 三者都改走 throttledTextEmit（不再直接 emit）', () => {
    for (const [name, next] of [
      ['onThinking', 'onToolUse'],
      ['onToolOutput', 'onToolProgress'],
      ['onToolProgress', 'onSkillNudge'],
    ] as const) {
      const body = handlerBody(name, next);
      assert.match(body, /throttledTextEmit\(\)/, `${name} 必须复用 throttledTextEmit`);
      assert.doesNotMatch(
        body,
        /\bemit\(stream, 'snapshot-updated'\)/,
        `${name} 不得再直接 emit 'snapshot-updated'（应经节流）`,
      );
    }
  });

  it('onToolUse 前 flushTextThrottle（保证 thinking/text 在工具块前落地）', () => {
    const block = src.match(/onToolUse:[\s\S]{0,500}?\n {6}\},/)?.[0] ?? '';
    assert.match(block, /flushTextThrottle\(\)/, 'onToolUse 必须先 flush 再处理工具');
  });

  it('完成路径 + 错误/停止 catch 都在构建终态前 flushTextThrottle（终态不丢 pending 帧）', () => {
    // 正常完成：flush 后再 buildFinalMessageContent
    assert.match(
      src,
      /flushTextThrottle\(\);[\s\S]{0,400}buildFinalMessageContent\(/,
      '完成路径必须先 flushTextThrottle 再构建最终内容',
    );
    // catch（error/stop/idle）开头即 flush
    assert.match(
      src,
      /\} catch \(error\) \{\s*\n\s*flushTextThrottle\(\);/,
      'catch 分支必须先 flushTextThrottle',
    );
  });
});
