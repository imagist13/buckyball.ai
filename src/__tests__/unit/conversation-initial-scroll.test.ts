/**
 * 稳定性审计 Phase 2 ① — Conversation 首次挂载滚动改为 instant。
 *
 * `use-stick-to-bottom` 用 `initial` 决定 transcript 首次挂载时的第一次
 * scroll-to-bottom 行为（后续 resize 走 `resize`）。旧值 `smooth` 让「进历史会话」
 * 可见地从顶部平滑滚到底部约 0.5s；改 `instant` 后直接跳到最新消息、无可见动画。
 *
 * 行为断言（优先于源码钉）：直接调用 Conversation 组件（纯函数组件、无 hooks），
 * 检查它真正传给 StickToBottom 的 props —— `initial='instant'`、`resize` 未被本次
 * 改动波及、且 caller 仍能覆盖默认（证明是真实默认而非无视 props 的硬编码）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Conversation } from '@/components/ai-elements/conversation';

// Conversation 无自身 hooks，可作为纯函数直接调用取回它构造的 React 元素，
// 检查真正传给 StickToBottom 的 props。cast 掉严格的 props 要求（children 等）。
const call = Conversation as unknown as (
  p: Record<string, unknown>,
) => { props: Record<string, unknown> };

describe('Conversation 首次挂载滚动（Phase 2 ①）', () => {
  it('默认把 initial="instant" 传给 StickToBottom（首次挂载直接置底、无平滑动画）', () => {
    const el = call({});
    assert.equal(
      el.props.initial,
      'instant',
      'initial 必须为 instant —— 进历史会话不再有可见的从顶到底平滑滚动动画',
    );
  });

  it('resize 保持 instant（新消息追加/流式仍走原行为，不被本次改动波及）', () => {
    const el = call({});
    assert.equal(el.props.resize, 'instant', 'resize 不在本次收口范围内，必须保持原值');
  });

  it('caller 传入的 initial 仍可覆盖默认（{...props} 展开顺序 —— 是真实默认而非硬编码）', () => {
    const el = call({ initial: 'smooth' });
    assert.equal(el.props.initial, 'smooth', 'props 展开在默认之后，caller 可覆盖 —— 证明 instant 是可配置默认');
  });

  it('源码钉：JSX 里 initial 已从 smooth 改为 instant（防无声回退）', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../components/ai-elements/conversation.tsx'),
      'utf8',
    );
    assert.match(src, /initial="instant"/, 'JSX 必须写 initial="instant"');
    assert.doesNotMatch(src, /initial="smooth"/, '不得残留旧的 initial="smooth"');
  });
});
