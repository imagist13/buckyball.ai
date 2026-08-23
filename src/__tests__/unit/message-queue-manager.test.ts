/**
 * 稳定性审�?Phase 2 �?�?排队消息上移 stream-session-manager �?sessionId 分桶�? *
 * �?messageQueue �?ChatView �?useState —�?切走会话（ChatView 卸载）再切回
 * （重挂载）时组件本地状态丢失，排队消息一起没了。修复：队列上移�? * stream-session-manager，按 sessionId 分桶、放�?stream 同一�?globalThis 模块�? * （与流同生命周期），�?ChatView 卸载/重挂载存活�? *
 * 真实行为驱动（非仅源码钉）：直接驱动 store，复现「入�?�?切走(卸载) �?切回(重读)
 * 队列仍在」，并覆盖分桶隔�?/ 订阅通知 / 出队 / 清空（空队列删表项防泄漏）�? * 末尾加源码钉确认 ChatView 已改�?manager store，不再持有本�?useState 队列�? */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getMessageQueue,
  updateMessageQueue,
  enqueueMessage,
  subscribeMessageQueue,
  type QueuedMessage,
} from '@/lib/stream-session-manager';

const QUEUES_KEY = '__streamSessionQueues__';
const QUEUE_LISTENERS_KEY = '__streamSessionQueueListeners__';

beforeEach(() => {
  (globalThis as Record<string, unknown>)[QUEUES_KEY] = new Map();
  (globalThis as Record<string, unknown>)[QUEUE_LISTENERS_KEY] = new Map();
});

const msg = (content: string): QueuedMessage => ({ content });

describe('message queue store �?分桶 + 跨重挂载存活（Phase 2 ④）', () => {
  it('入队 �?切走(卸载) �?切回(重读) 队列仍在（核心反例：修复前会丢）', () => {
    const sid = 'sess-A';
    // 「ChatView 挂载#1」入队两条（一条在流式中排队，一条追加）
    enqueueMessage(sid, msg('first'));
    enqueueMessage(sid, msg('second'));
    assert.deepEqual(getMessageQueue(sid).map((m) => m.content), ['first', 'second']);

    // 「切走�? ChatView 卸载：store 是模块级、不随组件卸载清�?—�?无操作即可�?    // 「切回�? ChatView 重挂载：新组件用 getMessageQueue(sid) 作为初始状态�?    const onRemount = getMessageQueue(sid);
    assert.deepEqual(
      onRemount.map((m) => m.content),
      ['first', 'second'],
      '重挂载时队列必须仍在（旧 useState 版本此处为空 —�?这就是修复的反例�?,
    );
  });

  it('�?sessionId 分桶隔离：一个会话的队列不影响另一�?, () => {
    enqueueMessage('sess-A', msg('a1'));
    enqueueMessage('sess-B', msg('b1'));
    enqueueMessage('sess-A', msg('a2'));
    assert.deepEqual(getMessageQueue('sess-A').map((m) => m.content), ['a1', 'a2']);
    assert.deepEqual(getMessageQueue('sess-B').map((m) => m.content), ['b1']);
  });

  it('getMessageQueue 返回快照拷贝，外部改动不污染 store', () => {
    enqueueMessage('sess-A', msg('x'));
    const snap = getMessageQueue('sess-A');
    snap.push(msg('sneaky'));
    assert.deepEqual(getMessageQueue('sess-A').map((m) => m.content), ['x'], 'store 不被外部数组改动影响');
  });

  it('订阅：入�?出队/清空都通知订阅者（ChatView 靠它把镜�?state 保持同步�?, () => {
    const sid = 'sess-A';
    let notified = 0;
    const unsub = subscribeMessageQueue(sid, () => { notified += 1; });
    enqueueMessage(sid, msg('one'));      // +1
    updateMessageQueue(sid, (prev) => [...prev, msg('two')]); // +1
    updateMessageQueue(sid, ([, ...rest]) => rest);           // 出队 �?+1
    updateMessageQueue(sid, []);          // 清空 �?+1
    assert.equal(notified, 4, '每次队列变更都应通知一�?);
    unsub();
    enqueueMessage(sid, msg('after-unsub'));
    assert.equal(notified, 4, 'unsub 后不再通知');
  });

  it('出队语义：dequeue 取首条、其余回写（对齐 ChatView dequeue effect�?, () => {
    const sid = 'sess-A';
    enqueueMessage(sid, msg('m1'));
    enqueueMessage(sid, msg('m2'));
    enqueueMessage(sid, msg('m3'));
    const queue = getMessageQueue(sid);
    const [next, ...rest] = queue;
    updateMessageQueue(sid, rest);
    assert.equal(next.content, 'm1');
    assert.deepEqual(getMessageQueue(sid).map((m) => m.content), ['m2', 'm3']);
  });

  it('清空后删�?map 表项（drained/stopped 会话不在模块�?map 泄漏�?, () => {
    const sid = 'sess-A';
    enqueueMessage(sid, msg('m1'));
    updateMessageQueue(sid, []); // 用户 stop / 清空
    const map = (globalThis as Record<string, unknown>)[QUEUES_KEY] as Map<string, unknown>;
    assert.equal(map.has(sid), false, '空队列必须删表项，避免泄�?);
    assert.deepEqual(getMessageQueue(sid), [], '读回为空数组');
  });

  it('保留 selectedSkills / files 等字段（出队后仍带得回生产者）', () => {
    const sid = 'sess-A';
    enqueueMessage(sid, {
      content: 'with-skill',
      selectedSkills: ['deep-research'],
      displayOverride: '/deep-research',
    });
    const [m] = getMessageQueue(sid);
    assert.deepEqual(m.selectedSkills, ['deep-research']);
    assert.equal(m.displayOverride, '/deep-research');
  });
});

describe('ChatView 接线源码钉（Phase 2 ④）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../components/chat/ChatView.tsx'), 'utf8');

  it('�?stream-session-manager 引入队列 API，不再本地声�?QueuedMessage', () => {
    assert.match(src, /getMessageQueue,/, '必须引入 getMessageQueue');
    assert.match(src, /updateMessageQueue,/, '必须引入 updateMessageQueue');
    assert.match(src, /subscribeMessageQueue,/, '必须引入 subscribeMessageQueue');
    assert.match(src, /type QueuedMessage,/, 'QueuedMessage 必须�?manager 引入');
    assert.doesNotMatch(src, /^interface QueuedMessage \{/m, '不得再本地声�?QueuedMessage（已上移 manager�?);
  });

  it('本地队列状态用 getMessageQueue 初始化并订阅 manager store', () => {
    assert.match(
      src,
      /useState<QueuedMessage\[\]>\(\(\) => getMessageQueue\(sessionId\)\)/,
      '本地镜像 state 必须�?store 当前值初始化（切回时不丢�?,
    );
    assert.match(src, /subscribeMessageQueue\(sessionId/, '必须订阅 store 变更保持镜像同步');
  });
});
