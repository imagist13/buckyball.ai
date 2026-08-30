# Context Chips — Phase 1（手动文件上下文显式化）

## 状态: 🟢 Track 1-5 已完成（April 2026）— send-clear 自动化覆盖补齐 2026-04-29

> 上一阶段（Chat composer 视觉收敛）见 [handover/chat-composer-redesign.md](../../handover/chat-composer-redesign.md) + [insights/chat-composer-redesign.md](../../insights/chat-composer-redesign.md)
>
> **验证缺口已闭环（2026-04-29）**：抽出 `buildDirectoryAttachments` / `buildMentionAppend` / `composeFinalContent` / `computeDisplayOverride` / `computePendingContextTokens` 进 `src/lib/message-input-logic.ts`，并在 `src/__tests__/unit/context-chips-send-clear.test.ts`（22 个用例）锁定四条不变量：
> - `directoryRefs === []` ⇒ `buildDirectoryAttachments` 返回 `[]`
> - `attachments.files === []` 由 ai-elements 自管，`attachmentPendingTokens=0`
> - `pendingContextTokens === 0` 当所有源为空
> - `displayOverride` 永远是 raw user content，不含 `[Referenced Directories]`
>
> 配套 e2e（`src/__tests__/e2e/context-chips-send-clear.spec.ts`）覆盖 chip add via `attach-directory-to-chat` 事件 + remove via X 按钮的生命周期。未做"完整 send → mock /api/chat → 检查清空"是因为整套 SSE/session 创建链路 mock 跟 mention-ui.spec.ts 同样易碎；纯逻辑 + chip 生命周期已经覆盖 React state 清理路径。

## 概述

Chat 页现在已经告诉用户「这次会用什么 Runtime / Model / 权限」，但还没告诉用户 **Agent 会看什么**。

第一版只解决最核心的"用户手动添加文件作为上下文"——把文件从文件树点进 composer，让用户能看到"我加了这些文件"，发送消息时把它们作为显式上下文传入。

**不做：** 自动召回、记忆系统、diff 上下文、MCP 上下文、向量检索、自动摘要。这些都留给后续 phase。

## 现状盘点

项目里已经有 70% 的基础设施：

- **@ 文件 mention 系统**：textarea 输入 `@path` 触发文件 picker → 选中后 dispatch `insert-file-mention` 事件 → MessageInput 接到事件后插入 `@path` token 到 textarea + 写 `mentionNodeTypes` map
- **Mention 解析**：`parseMentionRefs(inputValue, mentionNodeTypes)` 从 textarea 内容中扫出 mention，得到 `MentionRef[]`
- **Mention chip 渲染**：`MentionBadgeList` / `ComposerBadgeRow` 在 textarea 上方渲染 `@filename` chip，可移除
- **发送 payload**：`onSend(content, files, sysPromptAppend, displayOverride, mentions)` 已经在传 `mentions: MentionRef[]`
- **后端解析**：`/api/chat/route.ts` 把 `mentions` 拼成 `[Referenced Files]` 段附加到消息（已实现）
- **文件树**：dispatchEvent 已经支持 `insert-file-mention`（FileTreeAttachmentBridge 监听）

**缺的 30%：**
1. 文件树每行没有显式的"添加到对话"入口，用户不知道能这样加
2. Mention chip 没显示估算 token，用户不知道"加这个文件会吃多少上下文"
3. Run 状态面板的"上下文"统计只算最近一次 API 响应的 token，**不算当前 chip 的预估**——用户加 chip 时不知道发送后会用多少
4. 文件未读时无法估算 token（需要读取文件大小或字符数）

## 不变量 / 验证基线

发送一条带 chip 的消息后，必须能验证：
- DB 里这条 user message 的 content 已包含 `[Referenced Files]` 段（后端已实现，需回归）
- chip 在发送后从 composer 清掉
- Run 面板"上下文"在发送前显示「已用 + 待加」估算，发送后只显示「已用」实际值
- 刷新页面，chip 不会神奇地恢复（chips 是 ephemeral，绑在当前未发送的 composer state 里）

## 轨道拆分

### Track 1: 文件树"添加到对话"入口

每个文件/目录行：hover 时右侧出现 `+` 图标按钮，点击后触发 `insert-file-mention` 事件（已存在），文件名以 mention chip 形式出现在 composer 上方。

**改动文件：**
- `src/components/sidebar/FileTree*.tsx`（具体文件需先 grep 定位）：每行 hover 新增 `+` Button
- 沿用 `dispatchEvent('insert-file-mention', { detail: { path, nodeType } })`，不动事件协议

**键盘可达：** Tab 进入文件树后能 focus 到这个 `+` 按钮，Enter 触发添加。

**目录的处理：** 已支持，事件 detail 带 `nodeType: 'directory'`，会成为目录类型的 mention chip。

### Track 2: Chip 加 token 估算

当前 `MentionBadge` 显示 `@filename`。改成 `@filename · ~3.2K`（小字、灰色），让用户加 chip 前心里有数。

**估算策略：**
- 文件类 mention：通过 `/api/files/raw` 拿 `Content-Length`，按 `bytes / 4 ≈ tokens` 估算（粗糙但足够）
- 目录类 mention：用现有的 `fetchDirectorySummary`（先 truncate 到 30 项 + `(... N more)`）的字符数 / 4
- 大文件（>256KB）显示 `~省略`，跟现有的 256KB 限制保持一致

**改动文件：**
- 新增 hook `src/hooks/useMentionTokenEstimate.ts`：接收 `MentionRef[]`，返回 `Record<path, tokenEstimate>`，内部 fetch + 简单 LRU cache
- `MessageInputParts.tsx` 的 `MentionBadge`：接收估算值，加副标题显示

**Cache：** 同一个文件在一次会话里只 fetch 一次（按 sessionId × path key）。

### Track 3: 发送 payload 验证

后端 `/api/chat/route.ts` 已经处理 `mentions` 并拼接到 message content（`[Referenced Files]` 段）。Phase 1 不动 API 协议，**只验证它仍然按预期工作**：
- 写一个 unit test 跑 mention → API → DB content 链路
- 现有 e2e（如果有 mention-related）跑通

**改动文件：**
- 加 unit test（如果现有覆盖不足）

### Track 4: Run 面板"上下文"加待加估算

`useContextUsage` 返回 `{ used, contextWindow, ratio }`，反映 **最近一次 API 响应的实际 token**。

Phase 1 在 RunCockpit / RunStatusPanel 里增加一个 `pending` 概念：
- `pending = sum(currentMentionTokens)` — 当前 composer 上方所有 chip 的估算 token 总和
- 状态行：`Claude Code · 16% (+5%)` — 括号里的 `+5%` 是待加预估
- 面板"上下文"行：`16K / 200K tokens · 16% （+10K 待加）`

发送之后 `pending` 自然归零（chip 清空 + 下一轮 useContextUsage 把 pending 内容并入 used）。

**改动文件：**
- `RunCockpit.tsx`：接收 `pendingContextTokens` prop（从 ChatView 传，由 mentions × estimator 算出）
- `RunStatusPanel.tsx`：context 行加 pending 显示
- `ChatView.tsx`：`pendingContextTokens = useMemo(() => sum mentions estimate)`，传给 RunCockpit

### Track 5: CDP 验证

按 CLAUDE.md 规则，UI 改动必须 CDP 验证。验证场景：
1. 进 chat → 文件树点 `+` → composer 上方出现 chip → chip 显示文件名 + token 估算
2. 移除 chip → mention 在 textarea 中也消失
3. 发送消息 → chip 清空 → 消息卡片里能看到 `[Referenced Files]` 段（或 displayOverride）
4. 状态行 / 面板的 "+5%" 在添加 chip 后出现，发送后消失
5. 刷新页面：chip 不会恢复（ephemeral）
6. 加 3 个文件 chip + 发送：DB 里的 user message content 包含三个文件路径

## 依赖关系

- Track 1 独立可做
- Track 2 独立可做（先用 mock 估算就能跑）
- Track 3 是 verification，可在 Track 1+2 后做
- Track 4 依赖 Track 2 的估算 hook
- Track 5 是收尾验证

## 测试清单

| 项 | 测试方式 |
|---|---|
| 文件树 + 按钮可点 + 键盘可达 | CDP click + Tab |
| Chip 显示 token 估算 | unit + CDP screenshot |
| 大文件 chip 显示"省略"占位 | unit |
| 移除 chip 后 mention 同步消失 | CDP click + check textarea |
| 发送后 chip 清空 + DB content 含 `[Referenced Files]` | unit + DB query |
| Run 面板 "+5%" 状态行 | CDP screenshot |
| 刷新后 chip 不复现 | CDP reload + check |

## Out of scope（明确不做）

- 自动召回上下文（向量检索 / 相关性匹配）
- 记忆系统的注入显式化
- diff / git status 作为上下文
- MCP 工具结果作为上下文 chip
- 多次发送间的 chip 持久化（chip 是 ephemeral）
- chip 拖拽排序、批量操作

留给 Phase 2+。

## Decision log

### 为什么不直接做 "Run 面板 → 实时运行态" 而先做 Context chips

Codex 建议过这条思路：Run 面板未来要展示"本次用了哪些上下文 / 调了哪些工具 / 哪一步失败"。但 Run 面板的"上下文"如果都是 Agent 自动决定的（自动召回 / 系统注入），用户仍然在猜。

先把"用户手动加的上下文"显式化，让 chip → context payload → Run 面板的链路跑通。等数据流稳定后再让 Run 面板呈现 Agent 的自动选择，用户才能比较"我加的"和"Agent 用的"差距。

### 为什么 chip token 估算用 char/4 而不用 tokenizer

第一版求够用就行。tokenizer 库（tiktoken / claude-tokenizer）的精度提升对"用户决定要不要加这个文件"的决策门槛没区别——粗糙估算就能拦住"加了 100K 巨型文件"的明显错误。后续如果需要更精确（比如 Pinned 模型 + 容量已知 + 压线警告），再升级估算管线。

### 为什么不用现有 streaming context tracking

`useContextUsage` 的 `used` 来自 SDK result message 的实际 token，**只有发送后才有**。Chip 是发送前的预测，两者语义不同——一个是事实，一个是估计。Run 面板的 `pending` 字段把它们分开，避免混淆。

## 后续 phase 预告（不在本计划范围）

- **Phase 2: chip 类型扩展** — 不只是文件，还包括 git diff / 选区文本 / 终端输出
- **Phase 3: Run 面板的"实时上下文" view** — 包括 Agent 自动召回的部分，用户能看到"Agent 比我还多看了什么"
- **Phase 4: 多 Agent / @agent** — 必须等单 Agent 上下文 + 运行解释稳定后再做

## 反向引用

- 上一阶段 handover: [handover/chat-composer-redesign.md](../../handover/chat-composer-redesign.md)
- 上下文管理底层: [handover/context-management.md](../../handover/context-management.md)
- 已实现的 mention 协议: 见 `MessageInput.tsx` 的 `parseMentionRefs` / `mentionNodeTypes`
