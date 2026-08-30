# Phase 6：上下文用量可视化 / Context Breakdown

> 创建时间：2026-05-19
> 最后更新：2026-05-20
> 状态：✅ 已完成并归档
> 父计划：[`refactor-closeout.md`](refactor-closeout.md)
> 参考：用户提供的 Cursor Context Usage Breakdown 截图；Cursor context docs；CodePilot `docs/handover/context-management.md`

## 归档说明

Phase 6 的视觉入口、点阵组成条、popover breakdown、三 Runtime context-accounting 持久化与真实 smoke evidence 已完成。真实数据契约与收口证据见 [`context-accounting-runtime-contract.md`](./context-accounting-runtime-contract.md) 与 [`_smoke-evidence-phase-7/`](./_smoke-evidence-phase-7/)。

本文件下方保留原始设计与执行拆分，作为 Phase 7 视觉锚点和后续 context accounting 扩展的背景材料；若与上方归档说明或 `context-accounting-runtime-contract.md` 冲突，以归档说明和已完成计划为准。

## 用户会看到什么变化

输入框右下角的上下文状态不再只是一个百分比，而是一个**点阵式组成条**：

- 用户能看到总上下文用了多少、还剩多少。
- 用户能看到每一类上下文占比：系统提示、工具、规则、Skills、MCP、Memory、文件与附件、对话历史、本次待加入、缓存 / 上轮。
- 用户能从明细里判断该清理哪一类：删附件、减少文件引用、压缩历史、关掉高占用工具 / MCP，或调整 Memory。
- 容量未知时仍显示“已知组成”，但不假装给出精确百分比。

## 设计目标

1. **点阵进度条**：由小格 / 小点组成，不使用普通线性 progress bar。
2. **格子代表来源**：不同类别用不同低饱和色，小面积点阵承载分类，不做大面积彩虹条。
3. **符合新视觉方向**：克制、工程感、低噪声；作为 Phase 7 点阵视觉锚点的第一处小范围落点。
4. **借 Cursor 的信息架构，不照搬彩色条**：保留 Cursor 截图里的标题、总量、tokens、分类列表、数字右对齐等整体 popover 布局；只把中间线性彩色条替换成 CodePilot 点阵条。

## 状态

| Phase | 内容 | 状态 | 用户结果 |
|-------|------|------|----------|
| Phase 0 | 数据审计 + contract 定义 | ✅ 已完成 | 明确哪些来源可拆、哪些只能估算；假数据 snapshot 已止损 |
| Phase 1 | `ContextUsageBreakdown` 数据层 | ✅ 已完成 | 同一份结构驱动 UI / tests / smoke |
| Phase 2 | 现有 Context UI 改造 | ✅ 已完成 | 在现有入口上看到 dot-matrix mini bar + popover 明细 |
| Phase 3 | Chat / RunCockpit 接入 | ✅ 已完成 | 输入框右下角正式替换成组成条入口 |
| Phase 4 | 三 Runtime 冒烟 + 文档收口 | ✅ 已完成 | ClaudeCode / CodePilot Native / Codex Runtime 均有真实 smoke / DB evidence |

## 收口结果

- 输入框右下角 context 入口已从单一百分比升级为点阵式组成条。
- Popover 已展示可解释的分类明细，隐藏 unsupported / 无真实来源的类别，避免用 0 或 placeholder 误导用户。
- ClaudeCode / CodePilot Native / Codex Runtime 均通过 context-accounting producer 落 `result.usage.context_breakdown`。
- `rules`、`tools` 等已通过真实 invocation / DB row 验证；Skills / MCP / Tools 的历史 fixture 回归也已覆盖。
- 剩余非阻塞债务：tech-debt #22（selectedSkills 同名歧义）与 #24（footer cost 双计）。

## 先读文档

实施前必须先读：

- `docs/exec-plans/completed/refactor-closeout.md` — Phase 6 父计划与验收口径。
- `docs/handover/context-management.md` — 现有上下文预估 / 压缩 / UI 交接。
- `docs/handover/compact-coverage-boundary.md` — summary boundary，避免把压缩覆盖范围显示错。
- `docs/guardrails/StreamSession.md` — 双入口 `/chat` 与 `/chat/[id]` 的流状态不变量。
- `docs/guardrails/Runtime.md` — Runtime 相关变更边界。
- `docs/exec-plans/active/development-harness-optimization.md` — 本轮执行流程要求。
- `docs/design.md` — 当前 worktree 内能找到的视觉规范文件；未找到名为“底单”的 md，若用户另有文件需在开工前补路径。

## 当前项目现状

已有基础：

- `src/hooks/useContextUsage.ts` 已经计算总量、比例、context window、cache / input / output，并能处理 `contextUsageSnapshot`。
- `src/lib/context-usage-walk.ts` 能从历史 message 的 `token_usage` / `context_window` 恢复最近一次用量。
- `src/components/chat/RunCockpit.tsx` 是输入框右下角入口，适合承载新触发器。
- `src/components/chat/RunCockpitPopoverContent.tsx` 已有上下文详情弹层，但仍是 input / output / cache 视角。
- `src/components/chat/ContextUsageIndicator.tsx` 也已有 HoverCard + ai-elements/context 原语。Phase 6 不新增第三套上下文浮层，必须先确认当前挂载入口，再改造现有入口链路。
- `src/components/chat/MessageInput.tsx` 已经估算 attachment / mention / directory pending tokens，但目前只向上暴露总数。
- Phase 5d/5e 的 Context Compiler / HarnessBundle / capability contract 可作为 system / tools / skills / memory 估算来源。

主要缺口：

- 没有“按来源分解”的统一数据契约。
- pending context 只有总数，没有按附件、文件引用、目录引用拆分。
- 对话历史、系统提示、工具描述、MCP、Memory 的 token 来源还未统一到同一个 breakdown。
- UI 仍是百分比 / 环形 / 常规 progress，没有点阵视觉。
- Cursor 图里的 Subagents 第一版不单独建槽；CodePilot 的对应用户价值先落到 Memory。未来如果 SubAgent token 成为真实可量化来源，再新增独立类别。

## 数据契约

新增纯数据结构，建议放在 `src/lib/context-breakdown.ts` 或相邻模块。

```ts
type ContextBreakdownKind =
  | 'system_prompt'
  | 'tools'
  | 'rules'
  | 'skills'
  | 'mcp'
  | 'memory'
  | 'files_attachments'
  | 'conversation'
  | 'pending_next_turn'
  | 'cache_or_previous';

interface ContextBreakdownPart {
  kind: ContextBreakdownKind;
  label: string;
  tokens: number;
  source: string;
  detail?: string;
}

interface ContextUsageBreakdown {
  usedTokens: number;
  contextWindow?: number;
  remainingTokens?: number;
  ratio?: number;
  parts: ContextBreakdownPart[];
}
```

硬规则：

- `contextWindow` 未知时，不显示“百分比满载”，只显示已知组成和相对大小。
- 真实 API usage 优先级最高；本地估算可以参与计算，但 UI 不展示额外可信度标签。
- 若只有总量可用，`conversation` 可以用 `usedTokens - knownParts` 计算。
- `pending_next_turn` 不计入历史已用量，用点阵描边 / 半透明显示，避免和已发生 token 混淆。
- 任何负 residual 必须 clamp 到 0。

## 类别口径

| 类别 | 用户文案 | 数据来源 |
|------|----------|----------|
| `system_prompt` | 系统提示 | base system prompt、runtime prompt fragments |
| `tools` | 工具 | tool descriptors、runtime capability descriptors（不含 MCP） |
| `rules` | 规则 | workspace rules、project instructions、user-supplied agent rules |
| `skills` | Skills | skill prompts、HarnessBundle user/external extensions、widget contract prompt（Harness 是内部概念，用户文案只显示 Skills） |
| `mcp` | MCP | MCP server tool definitions |
| `memory` | Memory | assistant memory fragments、memory search injection、session summary；承接 Cursor 图里的 Subagents 槽位 |
| `files_attachments` | 文件与附件 | attachment pending tokens、mentions、directory estimates、explicit file refs |
| `conversation` | 对话历史 | persisted messages + latest usage residual |
| `pending_next_turn` | 本次待加入 | composer input、attachments、mentions、directories |
| `cache_or_previous` | 缓存 / 上轮 | prompt cache read/create、last result usage |

## UI 设计

### 入口

位置：聊天输入框右下角，即当前 `RunCockpit` 的 context 状态处。实现时不新增平行入口；先确认当前实际挂载的是 `RunCockpit` 链路还是 `ContextUsageIndicator` 链路，再在现有组件内替换 trigger 视觉和 body 分类内容。

状态：

- 默认：点阵迷你条 + `14% context` 或 `~27.3K / 200K`。
- warning：超过 70% 后使用 muted warning 色，不用强红。
- critical：超过 90% 后显示明确“建议压缩 / 清理”提示。
- unknown：显示“容量未知”，仍可点开看组成。

### 点阵进度条

- 桌面采用 100 个 cell，2 行 × 50。
- 窄屏密度不要直接拍板；实现前给两个候选 mockup，例如 2 行 × 32 与 2 行 × 24，由用户确认。
- 每个 cell 表示固定 token bucket 或固定百分比。
- 已用 cell 按类别着色，未用 cell 用低对比灰。
- pending cell 用虚线描边或半透明，不覆盖已用部分。
- hover / focus 展示类别和 tokens。
- 不能依赖 hover 才能读懂；popover 列表必须保留完整文字。

### Popover

结构：

1. 标题：Context。
2. 总量：`14% full` + `~27.3K / 200K tokens`。
3. 点阵主条。
4. 分类列表：
   - 色块 / 点阵标识
   - 用户文案
   - token 数

## 非目标

- 不做 billing-grade 精确 token 计费。
- 不重写 context assembler / compressor。
- 不改变 Runtime 发送链路。
- 不自动删除用户上下文。
- 不全局重做视觉系统；点阵只在 Context 组件局部试点。

## 分阶段执行

### Phase 0：数据审计 + contract

任务：

- 读并确认以下文件的数据出口：
  - `src/hooks/useContextUsage.ts`
  - `src/lib/context-usage-walk.ts`
  - `src/components/chat/RunCockpit.tsx`
  - `src/components/chat/RunCockpitPopoverContent.tsx`
  - `src/components/chat/MessageInput.tsx`
  - `src/lib/context-estimator.ts`
  - `src/lib/harness/context-compiler.ts`
  - `src/lib/harness/harness-bundle.ts`
- 写 `ContextUsageBreakdown` contract。
- 建立 fixture：known window、unknown window、pending-only、cache-heavy、near-limit、negative residual。
- 确认当前 UI 入口：`RunCockpit` / `RunCockpitPopoverContent` 与 `ContextUsageIndicator` 哪条是实际挂载路径；不得新增第三套平行入口。

验收：

- 单元测试覆盖每个类别的排序、合计、unknown window、negative residual clamp。
- 文档说明哪些字段来自既有 usage，哪些来自本地估算，但 UI 不展示额外可信度标签。

### Phase 1：数据层实现

任务：

- 新增 `buildContextUsageBreakdown()`，输入包括：
  - latest usage snapshot
  - messages
  - context window
  - pending attachment / mention / directory estimates
  - optional compiler / harness fragment estimates
- `MessageInput` 向上暴露 pending breakdown，而不是单个总数。
- 保持 `useContextUsage` 兼容旧调用，先旁路产出 breakdown。

验收：

- 旧 `RunCockpit` 百分比不回退。
- `pending_next_turn` 不污染 `usedTokens`。
- contextWindow unknown 时不会显示错误百分比。

### Phase 2：现有 Context UI 改造

任务：

- 在现有 `ContextUsageIndicator.tsx` / `RunCockpit.tsx` / `RunCockpitPopoverContent.tsx` 链路里替换 trigger 视觉和 body 分类内容。
- 不默认新增独立平行组件；如实现中确需抽子组件，只能作为现有入口的内部子组件。
- 避免一色系；颜色集中在小面积 cell 和 label swatch。
- 键盘可访问：trigger 可 focus，popover 可读，tooltip 不承载唯一信息。
- 先给窄屏点阵两个 mockup，再定最终密度。

验收：

- fixture 渲染截图：normal / warning / critical / unknown / mobile narrow。
- 无文字溢出，无 cell 抖动，无 hover 改变布局。

### Phase 3：Chat 接入

任务：

- `RunCockpit` trigger 改为点阵迷你状态。
- `RunCockpitPopoverContent` 展示 breakdown。
- ChatView / page 两条入口都传入同一种 pending breakdown。
- 保留旧数据路径作为 fallback，避免消息为空或首轮未返回 usage 时空白。

验收：

- 新聊天未发送前：显示 pending context 或空状态。
- 首轮回复后：显示上下文用量。
- 加附件 / mention / directory 后：`pending_next_turn` 增加，发送后归入 used / conversation。

### Phase 4：真实冒烟 + 收口

必须补 Smoke Ledger，每次真实验证追加一行。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | claude_code | Claude Code | Opus / Sonnet | 本机登录 | 新聊天首轮 | ✅ | screenshot + console clean |

验收：

- `npm run test` 通过。**报告口径**：commit message / closeout 文档报告测试结果时，必须用"相对增量 + commit hash"（例："本 commit +6 unit tests (i18n)，HEAD `2f25909` 实跑 ok"），不再写绝对的 "N/N pass"。原因：绝对数字假设读者环境跟作者一样，readers 在不同 commit / staging / worktree 跑出来数字可能不一致，导致 closeout 假阴误判。Codex P2 finding (2026-05-19)。
- UI 改动额外跑 `npm run test:smoke`。
- 浏览器打开聊天页，console 验收口径：**clean except known noise**。当前已知预存在噪音必须列出，不能笼统说"console clean"：
  - `GET /api/providers/codex_account/models?all=1` 404 — tech-debt `#20`，OAuth 占位 provider getProvider 返 null，Settings → Models 页打开后会触发。本 Phase 不修；smoke ledger 行的 Evidence 列必须明确写 "console clean except tech-debt #20"。
  - 如果有新噪音出现，必须 (a) 修掉，或 (b) 单独登记 tech-debt 并在此清单加一行。
- CDP / Browser 验证输入框右下角、popover、不同状态。
- 三 Runtime 至少各一条真实 smoke：
  - ClaudeCode：普通长对话。
  - CodePilot Native：附件 + file mention / directory refs。
  - Codex Runtime：Codex Account 或 provider proxy；容量未知或本地估算时文案必须诚实。
- 窄屏：两个点阵密度 mockup 截图，用户确认后再定。

## 风险与防线

| 风险 | 防线 |
|------|------|
| UI 看起来精确但数据其实是估算 | 不展示账单级语气；unknown window 不显示百分比 |
| 三 Runtime 数据来源不一致 | 先 contract，后 UI；每个 Runtime 都有 smoke 行 |
| pending tokens 和 used tokens 混算 | `pending_next_turn` 独立字段 + 独立视觉 |
| 工具 / MCP token 估算偏差大 | 用来源分组解释，避免承诺精确 |
| 点阵在小屏拥挤 | 响应式 cell 数 + 列表保留完整信息 |
| 和 Phase 7 视觉方向冲突 | 只在 Context 组件局部落点阵，不全局改主题 |

## 决策日志

- 2026-05-19: Phase 6 借 Cursor 的整体 popover 信息架构（Context 标题、百分比、tokens、分类列表、数字右对齐），但把中间线性彩色条替换成 CodePilot 点阵条；这才是用户要的“参考 Cursor + 新视觉风格”。
- 2026-05-19: 第一阶段先做数据 contract，再做 UI；原因是上下文分解横跨 Runtime、Harness、Memory、Attachment，直接画 UI 容易制造“视觉上分解、数据上漂移”的假完成。
- 2026-05-19: 桌面点阵密度定为 2×50；窄屏密度需先给两个 mockup 候选再定。
- 2026-05-19: Cursor 图里的 Subagents 槽位在 CodePilot 第一版让给 Memory，不单独显示 Subagents；未来若 SubAgent token 成为真实来源再扩类别。
- 2026-05-19: 类别口径按 Cursor 截图 1:1 拆开，不再合并 system_rules / tools_mcp / skills_harness：拆成 system_prompt + rules（独立两类）、tools + mcp（独立两类）、skills（保留 Harness 在数据源里，用户文案只显示 Skills——Harness 是内部概念，用户读不懂）；额外保留 CodePilot 真实来源 files_attachments / conversation / pending_next_turn / cache_or_previous；最终 10 类。
