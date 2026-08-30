# 工具调用 UX 优化 — 技术交接

> 产品思考见 [docs/insights/tool-call-ux.md](../insights/tool-call-ux.md)
> 竞品调研见 [docs/research/tool-call-ux-competitive-analysis.md](../research/tool-call-ux-competitive-analysis.md)

## 概述

对 CodePilot 工具调用展示层的全面升级，覆盖 thinking 展示、工具分类渲染、上下文归组、状态动画、流式优化等。基于 Claude Code / CraftAgent / Opencode / Codex 四个竞品的调研结论实施。

## 改动清单

### 1. Thinking Display 全链路

**数据流：**
```
claude-client.ts (thinking delta → SSE 'thinking')
  → useSSEStream.ts (onThinking callback)
  → stream-session-manager.ts (accumulatedThinking + phase separation)
  → ChatView.tsx → MessageList.tsx → StreamingMessage.tsx
  → ToolActionsGroup.tsx (ThinkingRow component)
```

**关键文件：**

| 文件 | 改动 |
|------|------|
| `src/lib/claude-client.ts` | 两处 `stream_event` handler 转发 `thinking_delta`；retry 路径补齐 content/is_error/media |
| `src/types/index.ts` | `SSEEventType` + `'thinking'`；`SessionStreamSnapshot` + `streamingThinkingContent`；`MessageContentBlock` + thinking 变体 |
| `src/hooks/useSSEStream.ts` | `SSECallbacks.onThinking`；`handleSSEEvent` case `'thinking'` |
| `src/lib/stream-session-manager.ts` | `accumulatedThinking` / `fullThinking` / `thinkingPhaseEnded` 三层累积；phase 分隔（text/tool_use 到来时重置当前 phase） |
| `src/components/ai-elements/tool-actions-group.tsx` | `ThinkingRow` 组件：Brain 图标 → hover 变 CaretRight 可展开；Streamdown 渲染内容 |

**持久化路径：**
- 客户端：`finalMessageContent` 序列化时包含 `{ type: 'thinking', thinking: allThinking }` block
- 服务端：`/api/chat/route.ts` 的 `collectStreamResponse` 累积 `thinkingText` 并 unshift 到 `contentBlocks`
- 历史渲染：`MessageItem.tsx` 的 `parseToolBlocks` 提取 thinking，传给 `ToolActionsGroup.thinkingContent`
- 归一化：`message-normalizer.ts` 识别 thinking block，生成 `(reasoning: summary)` 摘要

**Phase 分隔机制：**
多轮工具调用场景中，SDK 会在每轮产生新的 thinking block。`thinkingPhaseEnded` 标记在 text/tool_use 到来时设为 true，新 thinking delta 到来时将当前 thinking 保存到 `fullThinking`（用 `---` 分隔），重置 `accumulatedThinking`。UI 只显示当前 phase，持久化保存全部 phases。

**展开时防跳动：**
`ThinkingRow` 展开时调用 `useStickToBottomContext().stopScroll()` 脱离自动滚动模式，避免内容展开触发 `use-stick-to-bottom` 的 resize 自动滚动。

### 2. ToolActionsGroup 重构

**工具注册表（ToolRegistry）：**

```typescript
interface ToolRendererDef {
  match: (name: string) => boolean;
  icon: Icon;
  label: string;
  getSummary: (input: unknown) => string;
  renderDetail?: (tool: ToolAction, streamingOutput?: string) => ReactNode;
}
```

内置 5 种渲染器（bash/edit/read/search/fallback），通过 `registerToolRenderer()` 可扩展。替代了原来的 `getToolCategory` / `getToolIcon` / `getToolSummary` 硬编码函数。

**上下文工具归组：**
`computeSegments()` 线性扫描 tools 数组，连续 3+ 个 CONTEXT_TOOLS（read/glob/grep/list/search）合并为 `ContextGroup`。2 个不归组。ContextGroup 有独立的展开/折叠和 StatusDot。

**Bash 实时输出：**
`renderDetail` 在 running 时显示 `streamingToolOutput` 最后 5 行（滚动窗口），完成后显示 `tool.result` 前 20 行。`streamingToolOutput` prop 去掉了原来的 `_` 前缀启用。

**Flat 模式：**
`flat` prop 跳过 header 和折叠动画，直接渲染工具列表。目前未使用但保留作为扩展点。

**Header 布局：**
内容（数量 badge + 摘要 + 运行描述）在左，CaretRight 箭头在右（`ml-auto`）。

### 3. 状态动画

`StatusDot` 用 `AnimatePresence mode="wait"` 包裹三个状态：
- running: opacity fade（SpinnerGap + animate-spin）
- success: spring scale 弹入（stiffness 400, damping 20）
- error: 同上

Header 运行描述用 `Shimmer` 包裹闪烁。

### 4. is_error 全链路修复

```
claude-client.ts (tool_result SSE 包含 is_error)
  → useSSEStream.ts (提取 is_error)
  → stream-session-manager.ts (透传到 snapshot + finalMessageContent)
  → ToolActionsGroup (StatusDot 显示红色 XCircle)
```

同步修复了 `page.tsx` 和 `route.ts` 中的本地 ToolResultInfo 类型。

### 5. 流式优化

**智能文本缓冲（`useBufferedContent` hook）：**
- 40 词阈值或 2.5s max timeout 后释放
- 结构化块（show-widget/batch-plan/image-gen-request）旁路直通
- Timer 锚定到首次内容到达（`hasContent` boolean gate），不随 delta 重建
- 所有 bypass 决策通过 `useEffect` 执行，render 路径纯计算

**自适应文本节流（stream-session-manager）：**
- `throttledTextEmit()`：100ms 节流，非 text 事件（tool_use 等）触发 `flushTextThrottle()`
- 定义在 try/catch 外层，error path 也能访问

### 6. Diff Summary

`DiffSummary` 组件在 `MessageItem.tsx` 中：从 pairedTools 提取 edit/write 工具的文件路径，去重后显示 "Modified N files" 折叠行。

## 测试覆盖

| 文件 | 覆盖点 |
|------|--------|
| `__tests__/unit/sse-stream.test.ts` | thinking 事件分发、不混入 text、is_error 提取、media 透传 |
| `__tests__/unit/message-normalizer.test.ts` | thinking-only 摘要、heading 提取、组合消息、长文本截断 |

## 已知局限

- Thinking 展开后调用 `stopScroll()` 会脱离自动滚动，需要用户手动点滚动按钮回到底部
- 上下文归组只基于工具名匹配，不区分 MCP vs 内置工具
- Bash renderDetail 在历史消息中总是展开（showDetail 条件含 tool.result），长输出占空间
