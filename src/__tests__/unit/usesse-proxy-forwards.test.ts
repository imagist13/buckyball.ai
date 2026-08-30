/**
 * 稳定性审计 ② — useSSEStream 的 ref-proxy 必须转发
 * onSkillNudge / onContextCompressed / onFileChanged。
 *
 * consumeSSEStream 解析这三个事件并调用回调，但 useSSEStream() 的 proxied
 * 对象（callbacksRef 代理）此前漏了这三项 → 走 useSSEStream() 的调用方永远收
 * 不到 skill-nudge 横幅 / 压缩提示 / Codex 文件变更刷新。三层验证：
 *   1) 行为钉：consumeSSEStream 对三事件确实派发到回调（解析层契约）；
 *   2) 运行时钉：真正通过 useSSEStream().processStream / ref-proxy 驱动，三事件
 *      必须经 hook proxy 到达最新 callbacks（这是出问题的那一层——用 react-dom/server
 *      SSR 渲染一个探针组件捕获真实的 processStream 闭包，不绕过 proxy）；
 *   3) 源码钉：proxied 对象补齐三项转发（修复层，防无声回退）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { consumeSSEStream, useSSEStream, type SSECallbacks } from '@/hooks/useSSEStream';

function sseLine(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function makeReader(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return stream.getReader();
}

function noopCallbacks(): SSECallbacks {
  return {
    onText: () => {},
    onToolUse: () => {},
    onToolResult: () => {},
    onToolOutput: () => {},
    onToolProgress: () => {},
    onStatus: () => {},
    onResult: () => {},
    onPermissionRequest: () => {},
    onToolTimeout: () => {},
    onModeChanged: () => {},
    onTaskUpdate: () => {},
    onRewindPoint: () => {},
    onKeepAlive: () => {},
    onError: () => {},
  };
}

/** The three events under test, as real SSE lines. */
function threeEventChunks(): string[] {
  return [
    sseLine({ type: 'status', data: JSON.stringify({
      subtype: 'skill_nudge', message: 'save this',
      payload: { reason: { step: 8, distinctToolCount: 3, toolNames: ['a', 'b', 'c'] } },
    }) }),
    sseLine({ type: 'status', data: JSON.stringify({
      subtype: 'context_compressed', message: 'compacted',
      stats: { messagesCompressed: 5, tokensSaved: 1234 },
    }) }),
    sseLine({ type: 'file_changed', data: JSON.stringify({ paths: ['/x.ts', '/y.ts'] }) }),
  ];
}

/**
 * Render the useSSEStream() hook via react-dom/server SSR and capture the real
 * `processStream` closure (real useRef/useCallback, real ref-proxy). Calling the
 * captured function later does NOT re-enter React — it just runs the proxy.
 */
function captureProcessStream(): ReturnType<typeof useSSEStream>['processStream'] {
  let captured: ReturnType<typeof useSSEStream>['processStream'] | null = null;
  function Probe() {
    const { processStream } = useSSEStream();
    // Test-only capture of the hook's returned closure so we can drive the real
    // ref-proxy after render. The React-compiler purity rule (about production
    // re-renders) does not apply here: Probe is rendered exactly once via
    // renderToStaticMarkup and never re-rendered. No test-renderer (renderHook)
    // is available in this node:test setup, so SSR-capture is the only way to
    // exercise useSSEStream().processStream itself (not just consumeSSEStream).
    // eslint-disable-next-line react-hooks/globals
    captured = processStream;
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(captured, 'processStream captured from SSR render of useSSEStream()');
  return captured!;
}

describe('consumeSSEStream 派发 skill_nudge / context_compressed / file_changed（②行为钉）', () => {
  it('三事件都到达对应回调，不被丢弃', async () => {
    const got = { nudge: 0, compressed: 0, files: [] as string[] };
    const callbacks: SSECallbacks = {
      ...noopCallbacks(),
      onSkillNudge: (d) => { got.nudge = d.step; },
      onContextCompressed: (d) => { got.compressed = d.tokensSaved; },
      onFileChanged: (paths) => { got.files = paths; },
    };
    await consumeSSEStream(makeReader(threeEventChunks()), callbacks);
    assert.equal(got.nudge, 8, 'onSkillNudge 必须收到');
    assert.equal(got.compressed, 1234, 'onContextCompressed 必须收到');
    assert.deepEqual(got.files, ['/x.ts', '/y.ts'], 'onFileChanged 必须收到');
  });
});

// ── 运行时钉：真正走 useSSEStream().processStream / ref-proxy（②反例，对照漏转发前）──
describe('useSSEStream() ref-proxy 真正转发三事件（②运行时钉，经 hook proxy 而非 consumeSSEStream）', () => {
  it('三事件通过 processStream / ref-proxy 到达最新 callbacks', async () => {
    const processStream = captureProcessStream();
    const got = { nudge: 0, compressed: 0, files: [] as string[] };
    const callbacks: SSECallbacks = {
      ...noopCallbacks(),
      onSkillNudge: (d) => { got.nudge = d.step; },
      onContextCompressed: (d) => { got.compressed = d.tokensSaved; },
      onFileChanged: (paths) => { got.files = paths; },
    };
    // 修复前 proxied 漏了这三项 → 走 hook proxy 时它们被静默丢弃，下面三断言全 fail。
    await processStream(makeReader(threeEventChunks()), callbacks);
    assert.equal(got.nudge, 8, 'onSkillNudge 经 ref-proxy 到达（修复前漏转发→丢弃）');
    assert.equal(got.compressed, 1234, 'onContextCompressed 经 ref-proxy 到达（修复前漏转发→丢弃）');
    assert.deepEqual(got.files, ['/x.ts', '/y.ts'], 'onFileChanged 经 ref-proxy 到达（修复前漏转发→丢弃）');
  });

  it('ref 语义：proxy 转发到最近一次传入的 callbacks（证明确实经 ref-proxy，而非静态 consumeSSEStream）', async () => {
    const processStream = captureProcessStream();
    const stale = { nudge: -1 };
    const fresh = { nudge: -1 };
    // 第一次用 stale callbacks
    await processStream(makeReader([sseLine({ type: 'keep_alive', data: '' })]), {
      ...noopCallbacks(),
      onSkillNudge: (d) => { stale.nudge = d.step; },
    });
    // 第二次用 fresh callbacks —— 同一个 processStream 闭包，ref 已更新
    await processStream(makeReader(threeEventChunks()), {
      ...noopCallbacks(),
      onSkillNudge: (d) => { fresh.nudge = d.step; },
    });
    assert.equal(stale.nudge, -1, '旧 callbacks 不再收到事件（ref 已切换）');
    assert.equal(fresh.nudge, 8, '最新 callbacks 收到事件（ref-proxy 生效）');
  });
});

// ── 源码钉：proxied 对象补齐三项转发 ──
describe('useSSEStream proxied 三转发（②源码钉，防回退）', () => {
  it('proxied 对象转发 onSkillNudge / onContextCompressed / onFileChanged', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../hooks/useSSEStream.ts'), 'utf-8');
    const m = src.match(/const proxied: SSECallbacks = \{([\s\S]*?)\n {6}\};/);
    assert.ok(m, 'proxied 对象必须存在');
    const block = m![1];
    for (const key of ['onSkillNudge', 'onContextCompressed', 'onFileChanged']) {
      assert.ok(
        new RegExp(`${key}:.*callbacksRef\\.current`).test(block),
        `proxied 必须把 ${key} 转发到 callbacksRef.current（否则该事件被静默丢弃）`,
      );
    }
  });
});
