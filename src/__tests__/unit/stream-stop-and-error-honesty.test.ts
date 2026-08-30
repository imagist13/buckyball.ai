/**
 * tech-debt #52 / #53（2026-07-04 真实浏览器 smoke findings）回归钉。
 *
 * #52 三症状同根因：用户停止后 dequeue effect 立刻补发队列消息 →
 * "停止无效 + 重复发送 + 仍在 streaming"。修复 = stopStreaming 同时清队列。
 * #53 错误面具：ai@7 textStream 对 error part 静默收尾，上游 4xx 变"空文本"，
 * 调用方报误导性下游错误。修复 = pumpTextStream 走 fullStream 并抛真实错误。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pumpTextStream } from '@/lib/text-generator';

async function* parts(items: Array<{ type: string; text?: string; error?: unknown }>) {
  for (const p of items) yield p;
}

describe('pumpTextStream — 错误如实传播（#53）', () => {
  it('正常流：只透传 text-delta，其他 part 忽略', async () => {
    const out: string[] = [];
    for await (const t of pumpTextStream(parts([
      { type: 'start' },
      { type: 'text-delta', text: '{"ok":' },
      { type: 'reasoning-delta', text: '(内心独白不透传)' },
      { type: 'text-delta', text: 'true}' },
      { type: 'finish' },
    ]))) out.push(t);
    assert.equal(out.join(''), '{"ok":true}');
  });

  it('error part 必须抛出真实上游信息（含 responseBody），不得静默变空文本', async () => {
    const upstream = {
      message: 'Bad Request',
      statusCode: 403,
      responseBody: '{"error":"invalid model format. Expected format: modelType/model"}',
    };
    const run = async () => {
      for await (const _ of pumpTextStream(parts([
        { type: 'start' },
        { type: 'error', error: upstream },
      ]))) void _;
    };
    await assert.rejects(run, (e: Error & { cause?: unknown }) => {
      assert.ok(e.message.includes('Bad Request'), e.message);
      assert.ok(e.message.includes('invalid model format'), 'must carry upstream body: ' + e.message);
      assert.equal(e.cause, upstream, 'structured status/code must survive as a non-enumerable cause');
      assert.equal(Object.prototype.propertyIsEnumerable.call(e, 'cause'), false);
      return true;
    });
  });

  it('error 在部分文本之后到达：已产出文本照常，随后抛错', async () => {
    const out: string[] = [];
    const run = async () => {
      for await (const t of pumpTextStream(parts([
        { type: 'text-delta', text: 'partial' },
        { type: 'error', error: { message: 'mid-stream failure' } },
      ]))) out.push(t);
    };
    await assert.rejects(run, /mid-stream failure/);
    assert.equal(out.join(''), 'partial');
  });
});

// ── 源码钉：行为修复不被无声回退 ──

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf-8');

describe('停止语义与 aria 三态（#52 源码钉）', () => {
  it('ChatView.stopStreaming 必须清空 messageQueue（停止=全停，不许停止后自动补发）', () => {
    const src = read('../../components/chat/ChatView.tsx');
    const m = src.match(/const stopStreaming = useCallback\(\(\) => \{([\s\S]{0,200}?)\}, \[/);
    assert.ok(m, 'stopStreaming callback must exist');
    assert.ok(
      m![1].includes('setMessageQueue([])'),
      'stopStreaming 必须先 setMessageQueue([]) —— 否则 isStreaming 翻 false 时 dequeue effect 会立刻补发队列消息（#52 三症状之源）',
    );
  });

  it('FileAwareSubmitButton 的 aria-label 必须按状态切换，不得写死发送', () => {
    const src = read('../../components/chat/MessageInputParts.tsx');
    assert.ok(src.includes('messageInput.stopAriaLabel'), '流式中（非排队）必须暴露停止语义');
    assert.ok(src.includes('messageInput.queueAriaLabel'), '流式中有文本必须暴露排队语义，而非普通发送');
    assert.ok(
      !/aria-label=\{t\('messageInput\.submitAriaLabel' as TranslationKey\)\}/.test(src),
      '不得无条件写死 submitAriaLabel（#52：停止按钮被读作发送）',
    );
  });

  it('zh/en 两侧 i18n key 齐备', () => {
    for (const f of ['../../i18n/zh.ts', '../../i18n/en.ts']) {
      const src = read(f);
      assert.ok(src.includes('messageInput.stopAriaLabel'), f);
      assert.ok(src.includes('messageInput.queueAriaLabel'), f);
    }
  });

  it('PromptInputTextarea 必须让显式 value 覆盖内部 controller（#52 P1：乐观清空要能到达 DOM）', () => {
    const src = read('../../components/ai-elements/prompt-input.tsx');
    assert.ok(src.includes('hasExplicitValue'), 'must branch on an explicit value prop');
    assert.ok(
      /value: hasExplicitValue \? \(props\.value as string\) : controller\.textInput\.value/.test(src),
      '显式 value 存在时以它为准，否则回退 controller —— 否则受控清空被 controller 覆盖，textarea 滞留已发文字',
    );
  });

  it('agent-loop 用户中止不得标记为 error 状态', () => {
    const src = read('../../lib/agent-loop.ts');
    assert.ok(
      src.includes("onRuntimeStatusChange?.(isAbort ? 'idle' : 'error')"),
      '用户主动中止是 idle 不是 error（语义诚实）',
    );
  });
});
