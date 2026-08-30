/**
 * MessageList 虚拟滚动。
 *
 * 覆盖两层：
 * 1) 行为测试（真实驱动纯逻辑）：`message-list-virtual.ts` 抽出的行判定 /
 *    prepend 锚点解析——组件与测试 import 同一份实现（反假数据）。
 * 2) 源码钉（无法在 headless / 无 DOM 下行为测的接线）：MessageList.tsx 确实
 *    用 @tanstack/react-virtual + stable key + dynamic measurement，且保留了
 *    runtime-switch marker / TaskRunMarker / waiting panel / rewind / streaming /
 *    empty state / stick-to-bottom / msg-${id} 定位 / prepend scrollToIndex。
 * 3) 依赖门：package.json / lockfile 只新增 @tanstack/react-virtual 直接依赖，
 *    未引入 virtua / react-window / 新状态库 / @shikijs/stream。
 *
 * 用 `node --import tsx --test` 运行可绕开 reviewer 沙箱的 tsx IPC EPERM 假阴性。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Message, TaskRunSummary } from '@/types';
import {
  MESSAGE_ROW_ESTIMATE,
  MESSAGE_ROW_OVERSCAN,
  isFirstMessageOfTaskRun,
  resolveRewindUuid,
  getWaitingPanelRun,
  findAnchorIndex,
  shouldAutoScrollOnGrowth,
} from '@/components/chat/message-list-virtual';

const ROOT = path.resolve(__dirname, '../../..');
const MESSAGE_LIST_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../components/chat/MessageList.tsx'),
  'utf8',
);
const CHATVIEW_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../components/chat/ChatView.tsx'),
  'utf8',
);

/** Minimal Message factory — helpers only touch id / role / task_run_id. */
function msg(partial: Partial<Message> & { id: string }): Message {
  return {
    session_id: 's1',
    role: 'assistant',
    content: '',
    created_at: '2026-07-06T00:00:00.000Z',
    token_usage: null,
    ...partial,
  } as Message;
}

describe('message-list-virtual — 行判定纯逻辑（行为测试）', () => {
  it('isFirstMessageOfTaskRun：只在某 task_run_id 的第一条 true，同 run 后续 false', () => {
    const messages = [
      msg({ id: 'a' }), // 无 task_run_id
      msg({ id: 'b', task_run_id: 'run1' }), // run1 首条
      msg({ id: 'c', task_run_id: 'run1' }), // run1 后续
      msg({ id: 'd', task_run_id: 'run2' }), // run2 首条（切换）
      msg({ id: 'e' }), // 回到无 run
    ];
    assert.equal(isFirstMessageOfTaskRun(messages, 0), false, '无 task_run_id → 不显示 marker');
    assert.equal(isFirstMessageOfTaskRun(messages, 1), true, 'run1 首条 → 显示 marker');
    assert.equal(isFirstMessageOfTaskRun(messages, 2), false, 'run1 后续 → 不重复 marker');
    assert.equal(isFirstMessageOfTaskRun(messages, 3), true, '切到 run2 首条 → 显示 marker');
    assert.equal(isFirstMessageOfTaskRun(messages, 4), false, '无 run → 不显示');
  });

  it('isFirstMessageOfTaskRun：index 0 且有 task_run_id 视为首条', () => {
    const messages = [msg({ id: 'a', task_run_id: 'run1' })];
    assert.equal(isFirstMessageOfTaskRun(messages, 0), true);
  });

  it('resolveRewindUuid：按位置把 rewind point 映射到可见 user 消息，非 user / 无 session / 越界返回 undefined', () => {
    const u0 = msg({ id: 'u0', role: 'user' });
    const a0 = msg({ id: 'a0', role: 'assistant' });
    const u1 = msg({ id: 'u1', role: 'user' });
    const messages = [u0, a0, u1];
    const userMessages = messages.filter((m) => m.role === 'user'); // [u0, u1]
    const rewindPoints = [{ userMessageId: 'sdk-uuid-0' }, { userMessageId: 'sdk-uuid-1' }];

    assert.equal(
      resolveRewindUuid({ message: u0, userMessages, rewindPoints, sessionId: 's1' }),
      'sdk-uuid-0',
      '第一个 user 消息 → 第一个 rewind point',
    );
    assert.equal(
      resolveRewindUuid({ message: u1, userMessages, rewindPoints, sessionId: 's1' }),
      'sdk-uuid-1',
      '第二个 user 消息 → 第二个 rewind point',
    );
    assert.equal(
      resolveRewindUuid({ message: a0, userMessages, rewindPoints, sessionId: 's1' }),
      undefined,
      'assistant 消息不参与 rewind 映射',
    );
    assert.equal(
      resolveRewindUuid({ message: u0, userMessages, rewindPoints, sessionId: undefined }),
      undefined,
      '无 sessionId → 不映射',
    );
    assert.equal(
      resolveRewindUuid({ message: u1, userMessages, rewindPoints: [{ userMessageId: 'only-0' }], sessionId: 's1' }),
      undefined,
      'rewindPoints 少于 user 消息 → 越界位置不映射',
    );
  });

  it('getWaitingPanelRun：仅当非流式 + 最后一条属 waiting_for_permission run 时返回该 run', () => {
    const run: TaskRunSummary = {
      id: 'run1', task_id: 't1', status: 'waiting_for_permission', created_at: '2026-07-06T00:00:00.000Z',
    };
    const taskRuns = { run1: run };
    const messages = [msg({ id: 'a' }), msg({ id: 'b', task_run_id: 'run1' })];

    assert.equal(
      getWaitingPanelRun({ messages, taskRuns, isStreaming: false }),
      run,
      '非流式 + 末条 waiting → 返回 run',
    );
    assert.equal(
      getWaitingPanelRun({ messages, taskRuns, isStreaming: true }),
      null,
      '流式期间不显示 panel',
    );
    assert.equal(
      getWaitingPanelRun({ messages, taskRuns: undefined, isStreaming: false }),
      null,
      '无 taskRuns → 不显示',
    );
    assert.equal(
      getWaitingPanelRun({ messages: [msg({ id: 'a' })], taskRuns, isStreaming: false }),
      null,
      '末条无 task_run_id → 不显示',
    );
    assert.equal(
      getWaitingPanelRun({
        messages,
        taskRuns: { run1: { ...run, status: 'running' } },
        isStreaming: false,
      }),
      null,
      '末条 run 非 waiting_for_permission → 不显示',
    );
  });
});

describe('message-list-virtual — prepend 锚点解析（capped prepend 场景）', () => {
  it('findAnchorIndex：普通 prepend 后锚点新 index = 前置消息数（不跳顶/底）', () => {
    const prev = Array.from({ length: 20 }, (_, i) => msg({ id: `p${i}` }));
    const older = Array.from({ length: 10 }, (_, i) => msg({ id: `o${i}` }));
    const anchorId = prev[0].id; // 加载前记录的第一条
    const merged = [...older, ...prev]; // 未超 cap
    assert.equal(
      findAnchorIndex(merged, anchorId),
      older.length,
      'prepend 后锚点位于 older.length（原第一条被推到新位置，视觉保持）',
    );
  });

  it('findAnchorIndex：capped prepend（裁尾 300 上限）后锚点仍存活且可定位', () => {
    // 复刻 ChatView.loadEarlierMessages 的裁尾逻辑：
    // merged = [...older, ...prev]; 超 300 → slice(0, 300)（裁的是尾部新消息，非头部旧消息）
    const MAX = 300;
    const prev = Array.from({ length: 250 }, (_, i) => msg({ id: `p${i}` }));
    const older = Array.from({ length: 100 }, (_, i) => msg({ id: `o${i}` }));
    const anchorId = prev[0].id;
    const merged = [...older, ...prev]; // 350
    const capped = merged.length > MAX ? merged.slice(0, MAX) : merged; // 300

    const idx = findAnchorIndex(capped, anchorId);
    assert.ok(idx >= 0, 'capped prepend 裁尾不裁头 → 锚点必然存活（不返回 -1）');
    assert.equal(idx, older.length, '锚点新 index = older.length，可交给 scrollToIndex 保持位置');
    assert.equal(capped.length, MAX, '裁到 300 上限');
  });

  it('findAnchorIndex：anchorId 为 null 或已不在列表 → -1（调用方跳过滚动）', () => {
    const messages = [msg({ id: 'a' }), msg({ id: 'b' })];
    assert.equal(findAnchorIndex(messages, null), -1, 'null → -1');
    assert.equal(findAnchorIndex(messages, 'gone'), -1, '不存在 → -1');
  });
});

describe('shouldAutoScrollOnGrowth — ScrollOnStream 自动置底判定（append vs prepend 回归）', () => {
  /**
   * 复刻 ScrollOnStream count-growth effect 的 ref 追踪：喂一串真实 message 数组
   * 转换，用 prevCount / prevFirstId ref 语义逐帧驱动纯判定函数，收集每帧是否会
   * scrollToBottom。断言的是组件真正跑的逻辑（同一份实现），不是平行副本。
   */
  function driveScroll(sequence: Message[][]): boolean[] {
    const calls: boolean[] = [];
    let prevCount = sequence[0].length;
    let prevFirstId = sequence[0][0]?.id;
    for (let i = 1; i < sequence.length; i++) {
      const count = sequence[i].length;
      const firstId = sequence[i][0]?.id;
      calls.push(shouldAutoScrollOnGrowth(prevCount, count, prevFirstId, firstId));
      prevCount = count;
      prevFirstId = firstId;
    }
    return calls;
  }

  it('append（尾部追加，firstId 不变 + count 增）→ 置底（乐观 user 消息 + assistant 完成）', () => {
    const base = Array.from({ length: 5 }, (_, i) => msg({ id: `m${i}` }));
    const afterUser = [...base, msg({ id: 'user-optimistic', role: 'user' })];
    const afterAssistant = [...afterUser, msg({ id: 'assistant-done' })];
    // 逐帧：base → +user → +assistant，两帧都是尾部追加
    assert.deepEqual(
      driveScroll([base, afterUser, afterAssistant]),
      [true, true],
      'append 头不变 + count 增 → 每帧都置底',
    );
  });

  it('prepend（"加载更早"往头部插旧消息，firstId 变 + count 增）→ 不置底（anchor restore 生效）', () => {
    const prev = Array.from({ length: 20 }, (_, i) => msg({ id: `p${i}` }));
    const older = Array.from({ length: 10 }, (_, i) => msg({ id: `o${i}` }));
    const merged = [...older, ...prev]; // 头部第一条从 p0 变成 o0
    assert.equal(merged[0].id !== prev[0].id, true, '前提：prepend 改变 firstId');
    assert.equal(merged.length > prev.length, true, '前提：prepend 使 count 增长');
    assert.deepEqual(
      driveScroll([prev, merged]),
      [false],
      'prepend 头变 → 跳过 scrollToBottom，让 scrollToIndex anchor restore 生效',
    );
  });

  it('capped prepend（裁尾 300 上限，firstId 变 + 尾部裁 → lastId 也变）→ 不置底', () => {
    const MAX = 300;
    const prev = Array.from({ length: 250 }, (_, i) => msg({ id: `p${i}` }));
    const older = Array.from({ length: 100 }, (_, i) => msg({ id: `o${i}` }));
    const merged = [...older, ...prev]; // 350
    const capped = merged.slice(0, MAX); // 300：裁掉尾部新消息 p200..p249
    assert.equal(capped[0].id !== prev[0].id, true, '前提：capped-prepend 头部第一条改变（o0）');
    assert.equal(
      capped[capped.length - 1].id !== prev[prev.length - 1].id,
      true,
      '前提：capped-prepend 裁尾 → lastId 也变（所以不能用 lastId 判定）',
    );
    assert.deepEqual(
      driveScroll([prev, capped]),
      [false],
      'capped prepend 头仍变 → 跳过 scrollToBottom',
    );
  });

  it('无增长（流式期间同一条 assistant 内容原地更新，count 平 + 头不变）→ 不置底', () => {
    const stable = Array.from({ length: 5 }, (_, i) => msg({ id: `m${i}` }));
    // 流式 token 增量：数组身份变但长度/头部不变（内容原地改）
    const restreamed = stable.map((m) => msg({ id: m.id }));
    assert.deepEqual(
      driveScroll([stable, restreamed]),
      [false],
      '无 count 增长 → 计数 effect 不置底（流式跟随交给 isStreaming effect / stick-to-bottom）',
    );
  });

  it('边界：count 增但 firstId 从头部裁掉（append 越过 cap 同时裁头）→ 不置底（保守，避免与 prepend 混淆）', () => {
    // 罕见批量 append 跨过 cap：299 → 追加导致裁头 → firstId 变。判定保守跳过；
    // 真实置底由 isStreaming effect / stick-to-bottom 的锁底兜住。
    assert.equal(shouldAutoScrollOnGrowth(299, 300, 'm0', 'm1'), false, '头变即跳过');
    // 对照：同为 299→300 但头稳定（未裁头）→ 置底
    assert.equal(shouldAutoScrollOnGrowth(299, 300, 'm0', 'm0'), true, '头稳定 → 置底');
  });
});

describe('MessageList.tsx — 虚拟化接线（源码钉）', () => {
  it('引入 @tanstack/react-virtual 的 useVirtualizer 并构建 virtualizer', () => {
    assert.match(MESSAGE_LIST_SRC, /from '@tanstack\/react-virtual'/, '必须 import @tanstack/react-virtual');
    assert.match(MESSAGE_LIST_SRC, /useVirtualizer\(/, '必须调用 useVirtualizer');
  });

  it('不再对全部 messages 直接 map 成 DOM 行（改用 virtualizer.getVirtualItems）', () => {
    assert.doesNotMatch(MESSAGE_LIST_SRC, /messages\.map\(/, '不得残留全量 messages.map 渲染');
    assert.match(MESSAGE_LIST_SRC, /getVirtualItems\(\)/, '必须渲染 virtualizer.getVirtualItems() 的可见子集');
  });

  it('stable key = message.id（getItemKey）+ dynamic measurement（estimateSize + measureElement）', () => {
    assert.match(MESSAGE_LIST_SRC, /getItemKey:\s*\(index\)\s*=>\s*messages\[index\]\?\.id/, 'getItemKey 以 message.id 为主');
    assert.match(MESSAGE_LIST_SRC, /estimateSize:\s*\(\)\s*=>\s*MESSAGE_ROW_ESTIMATE/, '必须提供 estimateSize');
    assert.match(MESSAGE_LIST_SRC, /ref=\{virtualizer\.measureElement\}/, '必须用 measureElement 动态测高');
    assert.match(MESSAGE_LIST_SRC, /data-index=\{virtualItem\.index\}/, 'measureElement 行需带 data-index');
  });

  it('scrollElement 取自 use-stick-to-bottom 的 scrollRef（复用现有滚动引擎，不重造）', () => {
    assert.match(MESSAGE_LIST_SRC, /useStickToBottomContext\(\)/, '仍用 use-stick-to-bottom context');
    assert.match(MESSAGE_LIST_SRC, /getScrollElement:\s*\(\)\s*=>\s*scrollRef\.current/, 'virtualizer 挂到 stick-to-bottom 的 scrollRef');
  });

  it('保留 msg-${message.id} 定位 + prepend 用 scrollToIndex 锚定', () => {
    assert.match(MESSAGE_LIST_SRC, /id=\{`msg-\$\{message\.id\}`\}/, '每行保留 msg-${message.id} 定位');
    assert.match(MESSAGE_LIST_SRC, /virtualizer\.scrollToIndex\(/, 'prepend 后用 scrollToIndex 保持锚点');
    assert.match(MESSAGE_LIST_SRC, /findAnchorIndex\(/, '用 findAnchorIndex 查锚点新位置');
  });

  it('保留全部消息行语义：runtime switch marker / TaskRunMarker / waiting panel / rewind / streaming / empty state', () => {
    assert.match(MESSAGE_LIST_SRC, /RuntimeSwitchMarker/, '保留 runtime switch marker');
    assert.match(MESSAGE_LIST_SRC, /parseRuntimeSwitchMarker\(/, '保留 runtime switch 解析');
    assert.match(MESSAGE_LIST_SRC, /<TaskRunMarker\b/, '保留 TaskRunMarker');
    assert.match(MESSAGE_LIST_SRC, /<TaskWaitingForPermissionPanel\b/, '保留 waiting-for-permission panel');
    assert.match(MESSAGE_LIST_SRC, /<RewindButton\b/, '保留 rewind button');
    assert.match(MESSAGE_LIST_SRC, /<StreamingMessage\b/, '保留 streaming message');
    assert.match(MESSAGE_LIST_SRC, /<ConversationEmptyState\b/, '保留 assistant empty state');
  });

  it('保留 stick-to-bottom 语义接线：ScrollOnStream + scrollToBottom（初次置底 / 追加 / 流式跟随）', () => {
    assert.match(MESSAGE_LIST_SRC, /<ScrollOnStream\b/, '保留 ScrollOnStream（追加/流式起点置底）');
    assert.match(MESSAGE_LIST_SRC, /scrollToBottom\(\)/, '保留 scrollToBottom 调用');
    assert.match(MESSAGE_LIST_SRC, /wasStreaming/, '保留 streaming-start 置底判定');
  });

  it('ScrollOnStream 接入 firstId 并用 shouldAutoScrollOnGrowth 区分 append/prepend（Phase 5A 回归修复）', () => {
    assert.match(
      MESSAGE_LIST_SRC,
      /<ScrollOnStream[^>]*firstId=\{messages\[0\]\?\.id\}/,
      'ScrollOnStream 调用处必须传 firstId={messages[0]?.id}',
    );
    assert.match(
      MESSAGE_LIST_SRC,
      /shouldAutoScrollOnGrowth\(\s*prevCount\.current,\s*messageCount,\s*prevFirstId\.current,\s*firstId\s*\)/,
      'count-growth effect 必须用 shouldAutoScrollOnGrowth(prevCount, messageCount, prevFirstId, firstId) 判定',
    );
    assert.match(MESSAGE_LIST_SRC, /prevFirstId\s*=\s*useRef\(firstId\)/, '必须用 prevFirstId ref 跟踪头部第一条');
    // isStreaming effect 不动：streaming-start 仍无条件置底
    assert.match(
      MESSAGE_LIST_SRC,
      /if \(isStreaming && !wasStreaming\.current\)/,
      'isStreaming streaming-start 置底判定保持不变',
    );
  });

  it('保留分页接线：hasMore / loadingMore / onLoadMore（fetch/paging API 不变）', () => {
    assert.match(MESSAGE_LIST_SRC, /hasMore/, '保留 hasMore');
    assert.match(MESSAGE_LIST_SRC, /loadingMore/, '保留 loadingMore');
    assert.match(MESSAGE_LIST_SRC, /onLoadMore/, '保留 onLoadMore');
  });
});

describe('no-overreach — 300 cap 与依赖边界', () => {
  it('ChatView 仍保留 MAX_MESSAGES_IN_MEMORY = 300（未移除硬顶）', () => {
    assert.match(CHATVIEW_SRC, /const MAX_MESSAGES_IN_MEMORY = 300;/, '300 cap 必须保留');
  });

  it('package.json 新增 @tanstack/react-virtual 直接依赖；未引入 virtua/react-window/新状态库/@shikijs/stream', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(deps['@tanstack/react-virtual'], '@tanstack/react-virtual 必须是直接依赖');
    for (const forbidden of ['virtua', 'react-window', '@shikijs/stream', 'zustand', 'jotai', 'valtio', 'redux']) {
      assert.equal(deps[forbidden], undefined, `不得新增直接依赖 ${forbidden}（Phase 5A 只准 react-virtual）`);
    }
  });

  it('package-lock.json 已解析 @tanstack/react-virtual + virtual-core；未新增 virtua/react-window/@shikijs/stream 顶层依赖', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    assert.ok(lock.packages['node_modules/@tanstack/react-virtual'], 'lockfile 必须含 react-virtual');
    assert.ok(lock.packages['node_modules/@tanstack/virtual-core'], 'lockfile 必须含其 core 依赖');
    // 根包（顶层直接依赖）不得出现禁用项
    const rootDeps = lock.packages[''].dependencies ?? {};
    for (const forbidden of ['virtua', 'react-window', '@shikijs/stream']) {
      assert.equal(rootDeps[forbidden], undefined, `根 dependencies 不得含 ${forbidden}`);
    }
  });
});
