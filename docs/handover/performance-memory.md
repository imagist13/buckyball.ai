# 性能与内存优化 — 技术交接

> 产品思考见 [docs/insights/performance-memory.md](../insights/performance-memory.md)

## 概述

v0.45.0 的一次性内存优化，解决长对话/多工具调用场景下的渲染端内存膨胀问题。改动覆盖前端缓存、流式管道、懒加载、消息上限四个维度。

## 前端缓存与资源限制

### Shiki 高亮器缓存 → LRU

**文件**：`src/components/ai-elements/code-block.tsx`

- Highlighter 缓存：`Map` → LRU（10 entries），key = `"lang:lightTheme:darkTheme"`
- Token 缓存：`Map` → LRU（200 entries），key = `"lang:lightTheme:darkTheme:codeLength:first100:last100"`
- 原来无上限，长对话累积数百种 lang+theme 组合导致内存持续增长

### 终端输出上限

**文件**：`src/components/terminal/TerminalInstance.tsx`

终端输出硬上限 `MAX_OUTPUT_CHARS = 500_000`（约 500KB），超出时 `slice(-MAX_OUTPUT_CHARS)` 丢弃最早部分。防止 `npm install` 等命令产生的大量输出撑爆内存。

### 图片引用上限

**文件**：`src/lib/image-ref-store.ts`

统一 `store` Map（包含 pending refs、last-generated refs、message-bound refs）上限 50 entries，超出时按插入顺序淘汰最老条目。原来无限增长，多图场景（image agent 批量生成）会积累大量引用。

### 流式工具输出窗口

**文件**：`src/lib/stream-session-manager.ts`

`toolOutputAccumulated` 滑动窗口从 5000 字符缩减到 2000 字符。这是 stderr 实时输出的缓冲，只用于 UI 展示不需要保留全部。

## 懒加载

### 面板组件

**文件**：`src/components/layout/PanelZone.tsx`

Preview、Git、FileTree、Dashboard、Assistant 五个面板从静态导入改为 `next/dynamic({ ssr: false })`，首屏不加载。

### PreviewPanel 依赖

**文件**：`src/components/layout/panels/PreviewPanel.tsx`

Streamdown + plugins（cjk/code/math/mermaid）改为通过 `loadStreamdown()` 动态 `import()` 按需加载。这些是大包（Shiki 语法库尤其大），按需加载后首屏 JS 体积显著减小。

## 消息列表上限

**文件**：`src/components/chat/ChatView.tsx`、`src/hooks/useStreamSubscription.ts`

**核心机制**：消息列表硬上限 300 条，双向修剪：

| 操作 | 行为 |
|------|------|
| 加载历史（prepend） | 新消息加到头部，超出上限时裁剪尾部。reconciliation 恢复。 |
| 新消息（append） | 新消息加到尾部，超出上限时裁剪头部，重新启用 `hasMore` 按钮。 |
| 流式完成 | `onStreamCompleted` 触发 DB reconciliation 恢复正确的消息列表。 |
| 错误/停止 | 跳过 reconciliation，防止丢弃未持久化的临时内容。 |

**特殊保护**：本地 `cmd-*` 消息（slash command 结果）在 reconciliation 时保留，不因 DB 缺少对应记录而被丢弃。

**滚动锚定**：`MessageList` 的 scroll anchor 从 length-based 改为 ID-based，避免 prepend 时计算错误。

## 服务端流式读取

### 文件预览

**文件**：`src/lib/files.ts`（`readFilePreview` 函数），被 `src/app/api/files/preview/route.ts` 调用

`readFilePreview()` 从 `fs.readFileSync` 整文件读取改为 `createReadStream` + `readline.createInterface` 逐行读取。大文件（如 100MB 日志）不再加载到内存，只读取所需行数。达到行数上限时 `line_count_exact` 标记为 `false`，表示 `line_count` 是基于 `scannedLineCount` 和 `estimatedTotalLines` 的估算值。

### 大文件服务

**文件**：`src/app/api/files/serve/route.ts`、`src/app/api/files/raw/route.ts`

>10MB 的文件使用 stream 响应而非 buffer 整文件。

### 图片 base64 及时清理

**文件**：`src/app/api/chat/route.ts`（line 204）、`src/lib/claude-client.ts`（line ~930）

`/api/chat` 构建 `fileAttachments` 时，已写入磁盘的文件（`meta?.filePath` 存在）将 `data` 设为空字符串：`data: meta?.filePath ? '' : f.data`。`claude-client.ts` 的 vision API 调用对此做了防御性处理——当 `data` 为空时从 `filePath` 按需读取 base64。这样大图片的 base64 不会在内存中长期驻留。

## stream-session-manager 定时器清理

**文件**：`src/lib/stream-session-manager.ts`

原来有 4 个 `setTimeout` 调用分散在代码中，流结束时只清了 `idleCheckTimer` 和 `gcTimer`，其他定时器可能泄漏。

改造：
- `pendingTimers: Set<ReturnType<typeof setTimeout>>` 追踪所有 ad-hoc 定时器
- `streamTimeout()` helper 创建定时器并自动注册到 Set
- `cleanupTimers()` 遍历 Set 全部清理
