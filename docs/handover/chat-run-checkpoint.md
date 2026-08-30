# Chat Run Checkpoint — 技术交接（Round 1）

> 产品思考见 [docs/insights/chat-run-checkpoint.md](../insights/chat-run-checkpoint.md)
> 执行计划见 [docs/exec-plans/deferred/chat-run-checkpoint.md](../exec-plans/deferred/chat-run-checkpoint.md)

## 范围

Round 1 only — 三类触发：
- `no-compatible-provider` — `state.noCompatibleProvider`（session-scoped via `useProviderModels`）
- `pinned-invalid` — chat-page 本地 `invalidDefault` 或 `overview.defaultInvalid`，**仅在新会话入口（`/chat`）**；已建会话页 ChatView **不订阅这个信号**（见下方 Codex P2.1 修复）
- `runtime-fallback` — `agentRuntime === 'claude-code-sdk' && effectiveRuntime !== 'claude-code-sdk'`（全局，在两个入口都生效）

后续 Round 2 / Round 3 增加 context-cost / permission-elevation / dangerous-tool-call，**不包含在本期**。

### Codex P2.1 修复（2026-04-29）

`overview.defaultInvalid` 描述的是"新会话默认是否可用"——它跟一个**已经存在的会话**能不能继续发消息无关（已建会话用自己保存的 `currentProviderId/currentModel`）。原 Round 1 实现把它直接接进了 `ChatView`，结果是：用户打开一个能正常工作的会话也会看到红色"默认不可执行"横条，但 `MessageInput.disabled` 又没有跟着真的拦截，造成"看起来阻断但实际没阻断"的认知错位。

修复后 ChatView 只接两类信号：`noCompatibleProvider`（session-pair 检查）+ `runtimeFallback`（全局规则但每会话都适用）。全局 pinned-default-invalid 留给 `/chat` 新会话入口、Settings → Overview / Runtime / Health。

### Codex P2.2 修复（2026-04-29）

原版本只有"逐 helper 的 unit test"+"chip 生命周期 e2e"，没有真实 submit 路径覆盖。修复后：
- 抽出 `composeSubmitPayload()` 把 `handleSubmit` 的 payload 组装收成一函数
- MessageInput 三个分支（normal / image-agent / badge）全部走它
- 新单测模拟真实 submit 周期：构造 pre-state → 调 composeSubmitPayload → 通过 mock setX 清理 → 断言 `directoryRefs === []` / `inputValue === ''` / `pendingContextTokens === 0` / `displayOverride` 不含 `[Referenced Directories]` / files 含 `inode/directory`
- 反向：cleared-state 再次 submit 必须直接 early-return，不产生 onSend 调用

## 核心文件

| 文件 | 作用 |
|------|------|
| `src/lib/run-checkpoint.ts` | `CheckpointReason` union + `buildCheckpoints()` pure 推导 |
| `src/components/chat/RunCheckpoint.tsx` | 单一 inline banner 组件 |
| `src/app/chat/page.tsx` | 首消息页接入（替换原 `<ErrorBanner>`） |
| `src/components/chat/ChatView.tsx` | 已建会话页接入（新增，挂在 `RateLimitBanner` 后 `MessageInput` 前） |
| `src/i18n/{en,zh}.ts` | 9 个 i18n key（`runCheckpoint.*.{title,description,action}`） |
| `src/__tests__/unit/run-checkpoint.test.ts` | 10 用例 |

## 数据流

```
useOverviewData() ─┬─> noCompatibleProvider ─┐
                   ├─> defaultInvalid ───────┼─> buildCheckpoints({...})
                   ├─> agentRuntime ─┐       │       │
                   └─> cliEnabled ───┤       │       v
                                     │       │  CheckpointReason[]
useClaudeStatus().connected ─────────┴─> computeEffectiveRuntime()
                                             │       │
                                             v       v
                                       runtimeFallback ──┘   <RunCheckpoint reasons={...} />
```

`buildCheckpoints` 每次 render 跑一次（`useMemo`），单纯依赖 props/state，不持有自身状态——**没有 dismiss、没有 sessionStorage 记忆**（和 Round 1 plan 的"危险操作每次都问"原则一致）。

## API 契约

### `buildCheckpoints(opts)`

```ts
interface BuildCheckpointsOpts {
  noCompatibleProvider: boolean;
  defaultInvalid: boolean;
  runtimeFallback: boolean;
  pinnedDescriptor?: string;  // "Anthropic / sonnet-4-5" 等
}

type CheckpointReasonId =
  | 'no-compatible-provider'
  | 'pinned-invalid'
  | 'runtime-fallback';

interface CheckpointReason {
  id: CheckpointReasonId;
  tone: 'error' | 'warning' | 'info';
  titleKey: string;          // i18n key
  descriptionKey?: string;
  descriptionValues?: Record<string, string | number>;
  action?: { labelKey: string; href?: string; onClick?: () => void };
}
```

**Precedence**：`noCompatibleProvider` 出现时**只**返回它一项（其它 banner 没有意义——没有服务商可发送，再说"你 pin 错了"无用）。
**Stacking**：`pinned-invalid` + `runtime-fallback` 可同时出现，pinned 在前。

### `<RunCheckpoint reasons={...} />`

```tsx
<RunCheckpoint
  reasons={CheckpointReason[]}
  className?: string
/>
```

- `reasons.length === 0` → 不渲染任何 DOM
- 每个 reason 渲染一个 inline 卡片：图标 + 标题 + 描述 + 单一 action 按钮
- `data-checkpoint-reason="..."` / `data-checkpoint-tone="..."` 属性方便 e2e 测试断言
- action 通过 `next/navigation` 的 `router.push(href)` 跳转，不做 full reload

## 设计强约束（不要破坏）

1. **Banner only** — 永不做 modal、dialog、wizard。打断流是糟糕的中断模式。
2. **每个 banner 只一个 primary action** — 单测有 guard，违反就挂。
3. **不持久化"已确认"** — Round 1 范围内的三类都是"硬性阻断/警告"，没有"以后不再问"的入口。
4. **Round 1 reason id 三个就是三个** — 单测有 guard，新增（context-cost / permission-elevation / dangerous-tool）必须先正式开 Round 2/3。

## 视觉契约

Round 1 范围内的 trust-layer banner 共享 `bg-status-*-muted` token 族：
- `error` → `border-status-error-muted bg-status-error-muted text-status-error-foreground`
- `warning` → `border-status-warning-muted bg-status-warning-muted text-status-warning-foreground`
- `info` → `border-status-info-muted bg-status-info-muted text-status-info-foreground`

**已对齐**（Round 1 完成）：`RunCheckpoint` / `RateLimitBanner` / `TerminalReasonChip` 同一族 token。新加 banner 必须沿用，不要引入 raw `bg-red-*` / `bg-amber-*`。

**未对齐**（Round 3 收编）：`PermissionPrompt` 仍是 `border-t + bg-background` 的独立 in-context 确认面板。它跟工具执行链状态机耦合（"Agent 正在调 Bash"-style 实时拦截），跟"发送前 inline banner"是两个层级。Round 3 危险工具调用拦截上线时，会让两者共享同一个触发协议但保留各自的渲染层——发送前 inline 适合 banner，执行中 in-context 适合卡片。

## 测试

```bash
# 纯逻辑单测
npx tsx --test src/__tests__/unit/run-checkpoint.test.ts

# 全量回归
npm run test  # 1300 tests / 313 suites
```

CDP 终验：注入 sample DOM + 截图 → docs/exec-plans/screenshots/run-checkpoint-round1-banner-preview.png 确认三 tone 视觉一致。

## 已知边界

- **OpenAI OAuth 强制 Native** — `chat/page.tsx` 和 `ChatView.tsx` 都把 `currentProviderId === 'openai-oauth'` 的 `effectiveRuntime` 直接 hardcode 到 `'native'`，与 `RunCockpit.tsx` 同步。如果将来支持其它"provider 强制 runtime"的逻辑，建议抽到 `src/lib/runtime/effective.ts` 集中。
- **`overview.loading === true` 时返回空** — 避免在数据加载中闪烁 banner。代价是首屏短暂期间不报警，但发送链路本身有独立的 `disabled` gate 兜底。
- **`pinnedDescriptor` fallback** — chat/page.tsx 用本地 `invalidDefault`（携带 providerName/modelValue）；ChatView 直接读 `overview.defaultProviderName + defaultModelLabel`；都 fallback 到 `'?'` 占位符。

## Round 2 / Round 3 接入点（前瞻）

新增触发时只需扩展两处：

1. `src/lib/run-checkpoint.ts` 的 `CheckpointReasonId` union + `buildCheckpoints` 分支
2. `src/i18n/{en,zh}.ts` 加对应 i18n key

**不要**碰 `RunCheckpoint.tsx` 渲染逻辑（除非加新 tone）——它已经是纯 dispatch。
