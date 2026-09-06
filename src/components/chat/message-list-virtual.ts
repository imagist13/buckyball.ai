/**
 * MessageList 虚拟滚动的纯逻辑抽取。
 *
 * `MessageList.tsx` 从"全量 messages.map 成 DOM 行"改为 `@tanstack/react-virtual`
 * 虚拟化渲染。虚拟化组件本身依赖 hooks / DOM 测量，无法在 headless（node --test）
 * 环境里当纯函数驱动，所以把「哪些行显示 marker / rewind / waiting panel」以及
 * 「prepend 后如何重新锚定」的判定抽成本模块的纯函数——组件与测试 import 同一份
 * 实现（反假数据：测的就是组件真正跑的逻辑，不是平行副本）。
 *
 * 语义保持与虚拟化前 1:1：
 * - 行仍与 `messages` 一一对应（marker / rewind 渲染在消息行内部，不占独立行）。
 * - key 以 `message.id` 为主（`getItemKey`），避免流式更新整表重挂。
 */
import type { Message, TaskRunSummary } from '@/types';

/**
 * 虚拟化行高的初始估算（px）。聊天行高度差异极大（一行文字 vs. 超长代码块），
 * 这个值只是未测量行的种子 + totalSize 估算用；`measureElement` 在每行挂载后
 * 用真实高度校正。含虚拟化前由 flex `gap-6` 提供的行间距（并入行内 padding-bottom
 * 后被一并测量）。
 */
export const MESSAGE_ROW_ESTIMATE = 220;

/**
 * overscan——视口上下额外多渲染的行数，减少快速滚动时的空白闪烁。保守值即可，
 * 过大反而抵消虚拟化收益。
 */
export const MESSAGE_ROW_OVERSCAN = 6;

/**
 * TaskRunMarker 门：在属于某个 `task_run_id` 的**第一条**消息（相对列表里上一条）
 * 前渲染 marker，同一 run 的后续消息不重复。纯抽取自旧的行内 `leadingMarker` 判定，
 * 语义不变。
 */
export function isFirstMessageOfTaskRun(messages: Message[], index: number): boolean {
  const message = messages[index];
  if (!message?.task_run_id) return false;
  const prev = index > 0 ? messages[index - 1] : null;
  const prevRunId = prev?.task_run_id ?? null;
  return prevRunId !== message.task_run_id;
}

/**
 * Rewind point → 可见 user 消息的位置映射。后端只对 prompt-level user 消息发出
 * rewind_point（不含 tool_result / auto-trigger），因此与可见 user 消息 1:1。
 * 返回该消息对应的 SDK UUID，或在它不是可回退 user 消息时返回 undefined。
 *
 * 注意：`userMessages` 必须是 `messages.filter(role==='user')` 的同一批对象引用
 * （用 `indexOf` 做身份匹配），与虚拟化前的行内实现一致。
 */
export function resolveRewindUuid(params: {
  message: Message;
  userMessages: Message[];
  rewindPoints: { userMessageId: string }[];
  sessionId?: string;
}): string | undefined {
  const { message, userMessages, rewindPoints, sessionId } = params;
  if (message.role !== 'user' || !sessionId || rewindPoints.length === 0) {
    return undefined;
  }
  const userIndex = userMessages.indexOf(message);
  if (userIndex >= 0 && userIndex < rewindPoints.length) {
    return rewindPoints[userIndex].userMessageId;
  }
  return undefined;
}

/**
 * WaitingForPermissionPanel 门：当**最后一条**消息属于一个
 * waiting_for_permission run（且当前非流式）时，在 transcript 底部内联渲染面板。
 * 纯抽取自旧的行内 IIFE，语义不变。
 */
export function getWaitingPanelRun(params: {
  messages: Message[];
  taskRuns?: Record<string, TaskRunSummary>;
  isStreaming: boolean;
}): TaskRunSummary | null {
  const { messages, taskRuns, isStreaming } = params;
  if (isStreaming) return null;
  if (!messages.length || !taskRuns) return null;
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg.task_run_id) return null;
  const run = taskRuns[lastMsg.task_run_id];
  if (!run || run.status !== 'waiting_for_permission') return null;
  return run;
}

/**
 * Prepend 锚点索引解析。"加载更早"前，调用方记录当前第一条消息 id；更早的一页
 * prepend 之后（可能被 `MAX_MESSAGES_IN_MEMORY` 封顶——封顶裁的是**尾部**新消息而非
 * 头部，所以锚点必然存活），用它在新数组里查 NEW index，交给
 * `virtualizer.scrollToIndex(index, { align: 'start' })` 重新锚定，避免跳到顶/底。
 * 锚点未知或已不在列表里时返回 -1（调用方跳过滚动）。
 */
export function findAnchorIndex(messages: Message[], anchorId: string | null): number {
  if (!anchorId) return -1;
  return messages.findIndex((m) => m.id === anchorId);
}

/**
 * ScrollOnStream 的自动置底判定（Phase 5A prepend-anchor 回归修复）。
 *
 * 仅当「消息数增长 **且** 头部第一条 id 未变」时才在计数变化时 `scrollToBottom()`——
 * 这唯一对应**尾部追加**（append：乐观 user 消息 / assistant 完成）：append 只在
 * 尾部加，头部永远不变；只有当条数已达 300 cap 时追加才会裁头，而那种情况条数不增长
 * （grew=false），所以「增长的 append」必然头稳定。
 *
 * prepend（"加载更早"往头部插旧消息）会改变 firstId：即便被 300 cap 裁尾
 * （capped-prepend——裁的是尾部新消息 → lastId 也变），头部第一条**永远变**。此时返回
 * false，跳过 scrollToBottom，让 `virtualizer.scrollToIndex(index,{align:'start'})` 的
 * anchor restore 生效，避免用户点"加载更早"后被拽回最新消息（Phase 5A 生产 smoke
 * 抓到的回归）。
 *
 * 为什么用 firstId 而非 lastId：append 永远头不变、prepend 永远头变，firstId 是区分
 * 两者的可靠信号；lastId 在 capped-prepend 裁尾时也会变，无法区分 append / prepend。
 */
export function shouldAutoScrollOnGrowth(
  prevCount: number,
  count: number,
  prevFirstId: string | undefined,
  firstId: string | undefined,
): boolean {
  const grew = count > prevCount;
  const headStable = firstId === prevFirstId;
  return grew && headStable;
}
