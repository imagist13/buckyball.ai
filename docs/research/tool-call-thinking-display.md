# 工具调用思考过程展示 — 调研与方案

> 目标：在 CodePilot 的工具调用区域展示 Claude 的 extended thinking 内容，让用户能看到模型在调用工具时的推理过程。

## 现状分析

### 数据链路断点

SDK 已经在发出 thinking content block，但 `claude-client.ts:1192` 只提取了 `text` 类型的 delta，thinking block 被静默丢弃。前端只有一个占位 shimmer（"Thinking..." → "Thinking deeply..."），没有实际思考内容。

```
SDK stream_event (content_block_delta)
  → type === 'thinking' → ❌ 被忽略
  → type === 'text'     → ✅ 正常转发
```

### 已有基础设施

| 组件 | 文件 | 状态 |
|------|------|------|
| `Reasoning` 折叠组件 | `src/components/ai-elements/reasoning.tsx` | 已实现，含计时、折叠、Streamdown 渲染，但只在设置页 ProviderForm 中使用 |
| `ThinkingPhaseLabel` 占位 | `src/components/chat/StreamingMessage.tsx:122-139` | 纯 shimmer 动画，无实际内容 |
| `ToolActionsGroup` 工具展示 | `src/components/ai-elements/tool-actions-group.tsx` | 成熟组件，支持实时状态、计时、分类 |
| thinking SDK 配置 | `src/lib/claude-client.ts:425,688-689` | 已正确传递 `queryOptions.thinking` 给 SDK |

### 当前工具调用数据流（正常工作）

```
SDK assistant message
  → tool_use blocks (claude-client.ts:1054)
  → SSE 'tool_use' event
  → useSSEStream (case 'tool_use')
  → stream-session-manager.onToolUse → toolUsesArray
  → StreamingMessage → ToolActionsGroup 渲染
```

## 实现方案

### 需要修改的文件

#### 1. `src/lib/claude-client.ts` — 提取 thinking delta

**位置**: `stream_event` handler (~line 1189)

当前只处理 text delta：
```typescript
if ('text' in delta && delta.text) {
  controller.enqueue(formatSSE({ type: 'text', data: delta.text }));
}
```

需要增加：
- 检测 `content_block_start` 事件中 `type === 'thinking'` 的 block
- 提取 `content_block_delta` 中的 thinking text delta
- 发送 `SSE { type: 'thinking', data: thinkingText }`
- 检测 `content_block_stop` 标记 thinking block 结束

注意事项：
- thinking block 和 text block 交替出现（一次 turn 可能有多个 thinking block，每个对应不同的工具调用决策）
- 需要区分 thinking block 的 index，因为同一个 assistant turn 中 thinking 和 text 的 content_block_delta 通过 index 区分

#### 2. `src/types/index.ts` — 类型扩展

**SSEEventType** (~line 477): 加入 `'thinking'`

**SessionStreamSnapshot** (~line 961): 加入：
```typescript
thinkingContent?: string;       // 当前累积的 thinking 文本
thinkingStartedAt?: number;     // thinking 开始时间戳（用于计时显示）
```

**SSECallbacks**: 加入 `onThinking?: (text: string) => void`

#### 3. `src/hooks/useSSEStream.ts` — 解析 thinking 事件

在 `handleSSEEvent` 的 switch 中加入：
```typescript
case 'thinking': {
  callbacks.onThinking?.(event.data);
  return accumulated; // thinking 不拼接到 accumulated text
}
```

#### 4. `src/lib/stream-session-manager.ts` — 累积 thinking

**ActiveStream** 接口加入：
```typescript
thinkingAccumulated: string;
thinkingStartedAt: number;
```

**onThinking callback**:
```typescript
onThinking: (text) => {
  if (!stream.thinkingStartedAt) {
    stream.thinkingStartedAt = Date.now();
  }
  stream.thinkingAccumulated += text;
  // 同步到 snapshot
  stream.snapshot = {
    ...stream.snapshot,
    thinkingContent: stream.thinkingAccumulated,
    thinkingStartedAt: stream.thinkingStartedAt,
  };
  emit(stream, 'snapshot-updated');
},
```

thinking 在新的 text/tool_use 到来时清空（表示进入下一个阶段）。

#### 5. `src/components/chat/StreamingMessage.tsx` — UI 渲染

替换 `ThinkingPhaseLabel` 占位组件，改用 `Reasoning` 组件：
- 当 `thinkingContent` 非空时，显示可折叠的思考内容
- 在 `ToolActionsGroup` 上方或内部嵌入
- 工具执行期间持续展示最近一段 thinking
- 工具执行完成后自动折叠

#### 6. `src/components/chat/MessageItem.tsx` — 持久化消息中的 thinking

已完成对话的 thinking 需要：
- 在消息持久化时保存 thinking blocks（可选，取决于是否要在历史消息中展示）
- `parseToolBlocks()` 中识别 thinking 类型的 content block
- 渲染时在对应工具调用前展示折叠的思考过程

## 设计决策待定

| 决策点 | 选项 | 建议 |
|--------|------|------|
| thinking 展示位置 | A. 工具组上方独立区域 / B. 嵌入工具组内部 | A — 更清晰，thinking 是决策过程，工具是执行结果 |
| 历史消息是否保存 thinking | A. 保存（占存储）/ B. 不保存（只流式展示） | B — thinking 对回顾价值不大，省存储 |
| 多个 thinking block | A. 只显示最新一个 / B. 全部显示可折叠 | A — 避免信息过载 |
| 默认折叠状态 | A. 流式时展开、完成后折叠 / B. 始终折叠 | A — 流式时用户想看推理过程 |

## 工作量估算

| 文件 | 改动量 | 风险 |
|------|--------|------|
| claude-client.ts | 中 — 需要理解 SDK event 结构 | 中 — 需确认 thinking block 的实际 event 格式 |
| types/index.ts | 小 | 低 |
| useSSEStream.ts | 小 | 低 |
| stream-session-manager.ts | 小 | 低 |
| StreamingMessage.tsx | 中 — UI 布局调整 | 中 — 需要和 ToolActionsGroup 协调布局 |
| MessageItem.tsx | 小（如果不保存 thinking 则可跳过） | 低 |

整体属于中等改动，核心工作在 `claude-client.ts` 的 thinking block 提取和 `StreamingMessage.tsx` 的 UI 集成。建议先做一个 POC 验证 SDK 实际发出的 thinking event 格式。
