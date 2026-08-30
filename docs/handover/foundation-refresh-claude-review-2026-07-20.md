# 基础体验更新：Claude 独立审查任务书

> 日期：2026-07-20
> 审查对象：当前 worktree 的全部未提交修改（包括 untracked 文件）
> 工作目录：本次基础体验恢复批次的隔离 worktree
> 审查方式：直接独立审查，不启动 loop；第一轮只报告 finding，不修改代码。

## 先说结论边界

这不是一个单点修复，而是用户连续真实验收后形成的恢复批次，覆盖模型能力、权限模式、自动命名、Claude Code 网络/延迟诊断和聊天 UI 字体五条链。此前两天 loop 的主要失败是低层测试全绿但用户路径没有实现，因此本轮审查不能只看 helper、类型或 diff 形状，必须核对最终 API、DB 合并、Runtime wire 和真实 UI 语义。

请先执行：

```bash
git status --short
git diff --check
git diff
```

注意：`git diff` 不会显示 untracked 文件，必须结合 `git status --short` 单独读取它们。本批的关键 untracked 文件包括 Codex 权限、Codex 标题镜像、DNS preflight、Claude latency 和用户路径合同测试。

## 用户原始问题与本轮实现

### 1. 模型目录与推理强度

用户报告：Codex GPT-5.6 和 Kimi for Coding 选择后没有推理强度；智谱 CodePlan 获取模型失败；Claude Sonnet/Fable 的强度组件样式与模型组件不一致。

当前实现：

- `/api/providers/models` 在最终序列化边界统一把 nested capability 提升到 composer 实际读取的 top-level 字段，覆盖 DB provider、env、OAuth 和后追加的 Codex virtual group。
- DB 手动模型与 catalog 按 model/upstream identity 做只读 enrichment；用户自定义字段优先，不写回覆盖。Kimi 存量 `sonnet` alias 与真实 `kimi-for-coding` 行可共享渠道名称和 capability。
- 智谱等 catalog-only Coding Plan 的“添加模型”直接返回内置目录，不再依赖可选 `/models` 端点；手动 ID 入口仍保留。
- Claude effort selector 复用模型菜单的字体、宽度、圆角、item container 和 motion；模型切换时不支持的旧档位回到 Auto。
- ClinePass 新增 `cline-pass/kimi-k3`；OpenCode Go OpenAI 新增 `kimi-k3`。已有 DB 模型行的 provider 也会从 catalog tail 看到 K3，不要求重建服务。
- `Kimi for Coding` 继续是产品渠道抽象，UI 不显示 K3，wire 发 `kimi-for-coding`；ClinePass/OpenCode Go 的显式 K3 是两个聚合套餐自己的 SKU，不应混为一谈。
- ClinePass/OpenCode Go 的 K3 暂未声明 `supportsEffort`：Kimi 模型本体支持强度，不等于两个 OpenAI-compatible 网关已确认接受同一个 effort 字段。

重点审查：

1. **已修**：接受 stale capability 判断。`Kimi for Coding` catalog、i18n、DB enrichment 与测试已更新为 Auto/Low/High/Max；展示名和 `kimi-for-coding` wire 不变。三档真实渠道请求仍作为独立 smoke，不把静态声明写成已通过 wire。
2. `normalizeModelCapabilitySurface` 的类型断言是否会把脏 DB/API 数据直接当 `string[]`；未知档位是否真正 fail closed。
3. identity enrichment 是否可能错误合并两个不同模型、复活用户 hidden 行、或覆盖明确的 `supportsEffort:false`。
4. catalog-only search 返回 upstream ID 后，添加/去重/发送是否与模型页和 resolver 一致。

关键文件：

- `src/app/api/providers/models/route.ts`
- `src/app/api/providers/[id]/search-models/route.ts`
- `src/lib/provider-catalog.ts`
- `src/__tests__/unit/foundation-refresh-user-path-contract.test.ts`
- `src/__tests__/unit/catalog-only-discovery.test.ts`
- `docs/exec-plans/active/model-capability-reasoning-refresh.md`

### 2. “替我审批”权限模式

用户要求 Claude Code 与 Codex 支持 auto reviewer；Native AI SDK 只在确有同义能力时提供。

当前实现：

- Claude Code：`auto_review` 映射 Agent SDK `permissionMode:'auto'`，不使用危险 bypass；SDK 0.2.111 版本读取改为以 app cwd/package root 为锚，修复 Next/Turbopack 编译后 `__filename` 指向 chunk 导致误报版本缺失。
- 外部 MCP 存在或探测失败时 Claude auto reviewer fail closed 回到 default；human-only 和 mutating 工具不在 classifier 前裸放行。
- Codex：新增 canonical permission resolver。`auto` 映射 `approvalPolicy:on-request + approvalsReviewer:auto_review + workspace sandbox`；`full_access` 才是 `never + dangerFullAccess`；Plan 始终 read-only。thread/start、thread/resume、turn/start 都显式携带当前策略。
- Native：没有 session-level model reviewer，保存/切换到 auto 时运行边界降级到只读 `explore`，不允许未知字符串落入会自动允许写入的 NORMAL_RULES。
- UI 中“替我审批”使用与相邻模式/Runtime 相同的 muted、normal 文字层级。

重点审查：

1. **已修**：Codex capability route 读取选中 binary 版本，最低已验证门槛为 `0.145.0-alpha.18`；运行时再次门禁，并校验 thread start/resume 的 reviewer 回显。旧版、未知版、缺少/不一致回显均降级到 user reviewer，并发 canonical unavailable。
2. `thread` 与 `turn` 的字段名、enum、`workspaceWrite`/`writableRoots:[]` 语义是否与当前 0.145 schema 精确一致；空 writableRoots 是否意外禁止工作区写入。
3. command/file/MCP approval 的 response shape 仍有计划内未闭项，尤其 `item/permissions/requestApproval` 是否真的接受统一 `{decision}`。
4. Claude SDK 版本解析在 packaged Electron/standalone cwd 下是否有真实证据，还是只有 dev build 通过。
5. external MCP 能力门是否过度保守到让常见用户永远无法选择 auto，或仍存在可命名伪装/settingSources 漏洞。

关键文件：

- `src/lib/permission/profile.ts`
- `src/lib/permission/sdk-capability.ts`
- `src/app/api/chat/permission-capability/route.ts`
- `src/lib/codex/permission.ts`
- `src/lib/codex/runtime.ts`
- `src/__tests__/unit/permission-runtime-capability.test.ts`
- `src/__tests__/unit/codex-permission-wire.test.ts`
- `docs/exec-plans/active/runtime-permission-modes.md`

### 3. 自动聊天命名

当前实现：

- 首条真实消息先生成统一、隐私清洗后的 fallback 标题；附件 manifest、路径、hidden expansion 不进入标题。
- 首轮 assistant 正常完成后后台调用同一 session 的 exact provider snapshot 生成语义标题；不跨 provider，不加载 tools/MCP/history/settings，每 session 最多尝试一次，全局并发上限 2。
- manual/system/import 标题不会被异步生成覆盖，写回使用 title origin + CAS。
- Kimi Code `/coding/` 是已验证 always-thinking 端点，标题调用使用 provider-managed thinking、2048 output budget、30s 后台 timeout；其他 provider 仍为 disabled thinking、16 tokens、8s。
- Codex app-server 没有自动生成标题 API。Codex Runtime 保留本地 fallback，只通过 `thread/name/set` best-effort 镜像已提交的本地标题；失败不阻塞聊天或手动改名。

重点审查：

1. exact provider snapshot 是否真正一路到最终 SDK/Native wire，删除/切换 provider 时不能回退到另一家。
2. Kimi 2048/30s profile 是否只命中官方 `/coding/`，成本、超时和 inherited `MAX_THINKING_TOKENS` 处理是否正确。
3. detached background trigger 是否可能在 session 删除、重复完成或测试/进程退出时泄漏；“每 session 最多一次”是否是调用前门而不是只挡写回。
4. `sessions/[id]/route.ts` 先判断 `session.codex_thread_id`，但 `syncCodexThreadName` 自己从 runtime session store 找 thread id。两套 thread 引用是否始终同步；该 guard 是否会让真实 Codex 手动改名根本不触发镜像。
5. Codex 首轮镜像是否一定发生在 runtime thread id 已持久化之后；手动改名竞态时本地 canonical 标题是否稳赢。

关键文件：

- `src/lib/title-generation.ts`
- `src/lib/claude-client.ts` 的 isolated generateText 路径
- `src/lib/chat-collect-stream-response.ts`
- `src/app/api/chat/sessions/[id]/route.ts`
- `src/lib/codex/thread-name.ts`
- `src/__tests__/unit/title-generation*.test.ts`
- `src/__tests__/unit/generate-text-isolation.test.ts`
- `src/__tests__/unit/codex-thread-name-sync.test.ts`
- `docs/exec-plans/active/automatic-chat-titles.md`

### 4. Claude Code 极慢、DNS 与观测

当前实现：

- SDK query 前对真实 provider hostname 做 3s DNS preflight；代理、localhost 和 IP 地址跳过。失败映射到现有 `NETWORK_UNREACHABLE`，不再沉默等待十分钟首 token fuse。
- `EAI_AGAIN` 纳入网络错误分类。
- 从 SDK 结果/stream event 记录 TTFT、API duration、wall time、retry count、resume/fallback 等事实，写入现有 token usage JSON；SDK 未提供的值保持缺失，不造假 0；日志不含 prompt/title/URL。

重点审查：

1. proxy / lowercase env / NO_PROXY / 代理代解析场景是否会误判或漏判。
2. 每轮 DNS lookup 是否会引入不必要延迟、平台差异或 Electron packaged 环境问题。
3. `api_retry` 在两个消息分支是否可能重复计数；TTFT 和 duration 的单位/来源是否一致。
4. telemetry 是否可能污染 token usage 的既有消费者、导出或类型假设。

关键文件：

- `src/lib/provider-dns-preflight.ts`
- `src/lib/claude-latency.ts`
- `src/lib/claude-client.ts`
- `src/lib/error-classifier.ts`
- `src/types/index.ts`
- 对应三个新单测文件

### 5. 聊天 UI 字体与组件一致性

当前实现：

- 用 npm `geist` 本地字体替换 `next/font/google`，body 真实应用 Geist Sans，同时保留 Sans/Mono CSS variables；生产构建不再依赖 Google Fonts。
- 模型 trigger、模型菜单项、Bridge 模型选择、右侧文件树使用紧凑 sans；代码卡片、inline code、路径/命令继续使用 Geist Mono。
- effort selector 与模型 selector 复用相同视觉合同；“替我审批”颜色/字重对齐相邻控件。

重点审查：

1. Electron/Next 打包产物是否确实包含 geist WOFF2 与 license；SSR/hydration 是否一致。
2. 是否误把真正需要 monospace 的 model ID/技术标识改成 sans，或仍有其他人类可读标签被全局 `font-mono` 放大。
3. 320px effort popover 是否在窄窗口/中文 mapping note 下越界。

原视觉检查使用了临时目录截图，其中多数已随临时目录清理，不能继续作为仓库内证据引用。请按本文件的 UI 检查项重新做一次窄窗口与正常窗口 smoke；未归档的临时路径不计作验收证据。

### 6. loop 失败复盘

新增 `docs/research/multi-agent-loop-acceptance-failure-2026-07-19.md`，记录两天 loop 仍未实现用户路径的根因：共享错误计划、required checks 层级过低、待 smoke 被误报完成、父任务无总门、两个模型相互继承假设而非独立验收。请核对复盘是否与本次实际修复和证据一致，不要只审措辞。

## 当前验证证据

- Claude 两项 P1 与其余 P2/P3 修复后的初轮定向回归：346/346；最终用户路径定向回归 74/74。
- `npx tsc --noEmit`：通过。
- Tier 2 权威串行全量单测：4410 tests / 4410 pass / 0 fail / exit 0。默认并发 `npm run test` 的断言完成后受既有残留句柄影响不退出，因此最终证据使用下方 `--test-concurrency=1 --test-force-exit` 命令。
- `npm run build`：通过；仅有既存的 Turbopack NFT whole-project trace warning。
- 编译后 capability route Playwright smoke：2/2（Claude SDK 版本读取 + Codex native auto reviewer）。
- K3 定向测试：55/55。
- ClinePass `cline-pass/kimi-k3` 最小真实请求：HTTP 200，响应模型 `moonshotai/kimi-k3`。
- OpenCode Go `kimi-k3` 最小真实请求：HTTP 200，响应模型 `kimi-k3`。
- Kimi for Coding isolated title wire：4.043s，成功生成标题。
- 实页 UI：Codex Account GPT-5.6-Sol 已出现 Default/Low/Medium/High/XHigh/Max；Kimi for Coding 已出现 Default/Low/High/Max；Codex 权限菜单完成二次确认后 chip 显示「替我审批」。
- 实页 Settings：GLM (CN)「添加模型」在上游列表不可依赖时约 2s 后回退显示 GLM-5.2 / GLM-4.5-Air，共 2 个，不再报获取失败。
- 正常/360×720 实页：模型与 effort 两种菜单均进入窄窗口安全区；字体/圆角/行间距共享视觉合同。持久化证据：[GPT-5.6 正常窗口](../exec-plans/active/_smoke-evidence/foundation-refresh-gpt56-normal-2026-07-20.jpg) / [模型菜单 360px](../exec-plans/active/_smoke-evidence/foundation-refresh-model-menu-360px-2026-07-20.jpg) / [Kimi effort 360px](../exec-plans/active/_smoke-evidence/foundation-refresh-kimi-effort-360px-2026-07-20.jpg)。

注意：仓库默认并行 `npm run test` 仍可能因既有 node:test 句柄不退出；本轮可审计全量命令是：

```bash
CODEX_DISABLED=1 npx tsx --test --test-concurrency=1 --test-force-exit \
  --test-reporter=spec --import ./src/__tests__/db-isolation.setup.ts \
  src/__tests__/unit/*.test.ts
```

## 仍未完成的真实验收

以下不能被上述单测替代，也不能在审查结论中写成 Smoke passed：

- Codex GPT-5.6：UI 选择器已通过；仍需选择具体 effort 后完成一轮，确认 UI 选择等于真实 turn/start wire。
- GLM-5.2 / Kimi for Coding / Claude Sonnet 5/Fable：真实强度 wire 与上游接受情况。
- Claude/Codex “替我审批”：approve、deny、timeout、command/file/MCP 完整真实矩阵。
- Native AI SDK auto reviewer POC；当前产品语义仍是不支持并 fail closed。
- 自动标题：新会话 UI 中 fallback → generated 的顶部/侧栏即时同步；生成中手动改名竞态；Codex 真实 thread name 镜像。
- packaged Electron 中 SDK 版本探测、字体和 DNS preflight。

## 审查输出合同

请按严重度输出 P0/P1/P2/P3 finding。每条必须包含：

1. 文件与精确行号。
2. 可执行的失败路径或反例，不接受只写“可能有风险”。
3. 用户影响与是否阻断发布。
4. 最小修复方向和应补的回归测试/真实 smoke。

最后单独给出：

- `Blockers`：必须修后才能继续用户验收的项。
- `Non-blocking debt`：可以延期但需要 tracker 的项。
- `Evidence audit`：逐项判断 Code complete / Tests pass / Smoke passed，禁止混用。
- `Requirement matrix`：模型强度、权限、自动命名、延迟诊断、UI 字体、K3 两个套餐六组需求各自是通过、部分还是未实现。

不要因为 4390/4390 或 build 通过就默认整体通过；本次审查的核心是用户可见承诺是否真的到达最终 Runtime wire。
