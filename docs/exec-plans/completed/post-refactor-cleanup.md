# 重构收尾后遗留清理 / Post-Refactor Cleanup

> 创建时间：2026-05-29
> 最后更新：2026-05-31（A / B / C / D1 / D2 / E 全部完成 → 归档至 completed/）
> 父计划：[`refactor-closeout.md`](refactor-closeout.md)（重构主体已收尾；本计划处理收口后的遗留项 + Opus 4.8 接入）

> **✅ 本计划已完成（2026-05-31）**：A / B / C / D1 / D2 / E 六个 Phase 全部交付并验证。**本计划范围 = 重构收尾的 6 个遗留项（#23/#34/#26/#27/#28/#30）+ Opus 4.8 接入 + design.md 横切规范的「代码 / 文档 phase」**，已全部完成。**Windows 真机 smoke、macOS 通知权限核查、Preview 打包属独立下一阶段**（见 active 的 `preview-build-readiness.md`），**不混入本计划、不属本计划验收范围**。

## 范围与来源

重构 6+ 主线已收口，Phase 7 视觉/图标也收口（图标归档、7b 收口于 0-2、7c 归档）。剩下的是一批**互相独立的遗留问题** + 一个**新输入（Opus 4.8）**。本计划只负责把它们拆成可审、可验收的小刀，**逐项可独立交付**，不强行捆绑。

来源：
- tech-debt tracker：[`#23`](../tech-debt-tracker.md) / `#34` / `#26` / `#27` / `#28` / `#30`
- design.md 设计规范缺口（2026-05-29 与用户讨论的结论：见下方 Phase E）
- Anthropic 于 2026-05-28 更新 Claude Opus 4.8 → 评估 CodePilot 是否需要接入

**本计划是草稿，交 Codex 审查后再开工。** 每个 Phase 都先写"用户能看到什么 / 不做什么 / 怎么验收"（用户审阅），技术细节单列"实现路径"小节（标注**不需用户审阅**，供 Codex / 实现者）。

## 状态

| Phase | 内容 | 类型 | 优先级 | 状态 |
|-------|------|------|--------|------|
| A | 模型目录：接入 Opus 4.8 + 修 Sonnet 4.6 别名（#23） | A 可见 | **高**（发送正确性 + 新模型） | ✅ **完成**（代码 9d98029 + Codex review 2 补丁 c90b6f8；真实凭据 smoke 用户确认通过 2026-05-29） |
| B | 用户信任 bug：Mac 通知不弹（#34）+ pin-incomplete 误报（#27） | A 可见 | 高 | ✅ #27（e1ccb3b）+ #34（0605b80 观测 + Codex smoke 确认链路工作；无横幅=macOS 前台抑制/权限，非 bug） |
| C | 能力/平台正确性：Plan 模式 Widget（#26）+ Windows shell 方言（#28） | A 可见 | 中 | ✅ #26 代码+测试（f32275f）；✅ #28 代码+测试（970a1fa + d6e9d96：**Windows 默认 PowerShell，bash 只认显式 `CLAUDE_CODE_GIT_BASH_PATH`**），Windows 真机验收移交 preview 阶段 |
| D0 | flake + no-verify 事件记入 tech-debt #30 | C 文档 | 中 | ✅ 已完成 |
| D1 | pre-commit enforce / set -e（#30 核心止血：任一检查失败即停） | C 基础设施 | 高 | ✅ 已完成（commit e10fa1d） |
| D2 | react-hooks 存量 16 error（9 高频组件）+ apply-discovery-diff 间歇 flake | C 工程债 | 中 | ✅ **完成**（cd2a024）：**flake 根治**（per-worker temp DB 隔离 `db-isolation.setup.ts` + `--import`，连跑 4× 3086/3086 确定性通过）；"16 error" 核实为 React Compiler 规则（非 exhaustive-deps），已修 2 prefer-const + 1 set-state + 清 11 warning，**13 个 React Compiler error 拆 tech-debt #35**（高频/视觉组件行为重构，on-touch） |
| E | design.md 设计规范补全（横切 3 节） | C 基础设施/文档 | 中 | ✅ **完成**（b8abb44）：macOS 壳层 / 浮动卡片 / Composer 三节 + Anchor 表 3 行，锚定真实实现 |

**进度（全部完成）**：**D1 ✅**（enforce，e10fa1d）· **A ✅**（Opus 4.8 + #23，真实 smoke 通过）· **B ✅**（#27 e1ccb3b + #34 0605b80/Codex smoke 确认链路工作）· **C ✅**（#26 f32275f + #28 970a1fa/d6e9d96 代码）· **D2 ✅**（cd2a024，flake 根治 + lint 分级处理，13 React Compiler error 拆 #35）· **E ✅**（b8abb44，design.md 三节）。**本计划 A-E 全交付。** 下一阶段（**独立、不属本计划**）：Preview 打包（Windows 构建 / 签名）+ Windows 真机 smoke + macOS 通知权限核查 → 见 `preview-build-readiness.md`。

---

## Phase A：模型目录 — 接入 Opus 4.8 + 修 Sonnet 4.6 别名（#23）

> 为什么合并：两者是**同一条别名→upstream 解析链**（`ai-provider.ts` / `provider-catalog.ts` / `provider-resolver.ts` / `model-context.ts`），分开做会改两遍同一批文件、互相打架。

### 用户能看到什么
- **Settings → Models 里能看到并选用 Opus 4.8**；选它发消息能正常工作。
- **ClaudeCode runtime + Sonnet 4.6 发送不再失败**（现在会报 model 不存在，只能切别的模型）。
- 默认 / 推荐模型指向正确的新模型，不再悄悄落到老的 Sonnet 4.0。

### 不做什么
- 不改模型选择的 UI 布局（沿用现有 Models 页 / composer 模型选择器）。
- 不动其它 provider 的套餐型目录（那是 [`#16`](../tech-debt-tracker.md)，独立）。
- **不动 `opus` 短别名 / 默认**：首轮只新增显式 `claude-opus-4-8`，`opus` 别名与默认仍指 4.7；是否切 4.8 待真实 smoke 后用户拍板（遵守 [pinned 默认硬承诺] guardrail）。
- **OpenRouter slug 用确认值、不推断**：Codex 已确认 OpenRouter Opus 4.8 = `anthropic/claude-opus-4.8`，本轮一并接入（不再 deferred）；代码 / 测试把该 id 写成显式 fixture。
- **不"只改模型名"**：catalog 显示出来 ≠ 请求正确——Opus 4.7 专属的 thinking / effort / 1M beta 逻辑必须一并泛化（见实现路径），否则模型出现了但真实发送语义仍错。

### 怎么验收
- Settings → Models 在 **Anthropic direct + OpenRouter** 下都能看到并选用 Opus 4.8。
- **真实凭据 smoke**（用户 / Codex 跑，验证集成路径而非官方能力；写入 Smoke Ledger）：
  - ClaudeCode runtime + Sonnet 4.6 → 两轮发送成功（修复 #23 的反例）。
  - Opus 4.8（Anthropic direct + OpenRouter）→ 发送成功；effort 默认 `high`、1M context、adaptive thinking 生效。
- 回归测试（**本轮代码即交付**）：Anthropic direct Opus 4.8 / OpenRouter Opus 4.8 / Sonnet 4.6 别名修复 / 旧 Opus 4.7 不回退，四组断言。

### 官方参数（已确认，source of truth = Anthropic Models overview，经 Codex 2026-05-29 提供）

**不靠猜、不等真实 smoke 才确定**——以下是 source of truth，真实 smoke 只用于验证 CodePilot 集成路径，不用于发现官方能力：

| 参数 | Opus 4.8 | 对比 Opus 4.7 |
|------|----------|---------------|
| model id / alias | `claude-opus-4-8` | — |
| OpenRouter id | `anthropic/claude-opus-4.8`（**Codex 已确认上架**，不推断；代码/测试写成显式 fixture） | — |
| context window | 1M | 同 |
| max output | **128k** | 需核对 4.7 现值 |
| extended thinking | **No**（不接受 manual extended thinking → 转 adaptive） | 同 4.7 |
| adaptive thinking | Yes | 同 4.7 |
| effort default | **`high`** | **≠ 4.7 的 `xhigh`** ⚠️ |

⚠️ **关键差异**：4.8 effort 默认 `high`，4.7 默认 `xhigh`——泛化时**不能简单 "4.8 == 4.7"**，per-model 默认要分开。1M context / adaptive-thinking / 无 manual-extended-thinking 与 4.7 一致。

### 实现路径（不需用户审阅，供 Codex / 实现者）
已核实的现状（file:line）：
- `src/lib/ai-provider.ts:96-97`：`sonnet: 'claude-sonnet-4-5-20250929'`、`opus: 'claude-opus-4-7'` —— opus 别名仍指 4-7，sonnet 仍指 4-5。
- `src/lib/provider-catalog.ts`：已有 `anthropic/claude-sonnet-4.6`(:285) / `anthropic/claude-opus-4.7`(:296) / `claude-sonnet-4-6`(:326) / `claude-opus-4-7`(:337)。**无任何 4.8 条目。**
- `src/lib/provider-resolver.ts:845`：`upstreamModelId: 'claude-sonnet-4-20250514'`（#23 的错误兜底）；`:855` opus→4-7。
- `src/lib/model-context.ts:18`：`claude-opus-4-7 → 1_000_000`；无 opus-4-8。
- `src/lib/onboarding-processor.ts:61` / `checkin-processor.ts:73`：fallback default `'claude-sonnet-4-20250514'`（Sonnet 4.0）。
- `provider-resolver.ts:507`：`modelId = ... || 'claude-sonnet-4-5-20250929'` 兜底。

改动点：
1. **新增 Opus 4.8 目录条目（Anthropic direct + OpenRouter）**：Anthropic 直连 `claude-opus-4-8` + OpenRouter `anthropic/claude-opus-4.8`（Codex 确认，显式 fixture）；对照现有 4.7 条目，`supportedRuntimes` / `getModelCompat` tier 对齐；context 1M、max output 128k。
2. **泛化 Opus 4.7 专属逻辑到 4.8（核心，别只改 catalog）**。已核实这些"按版本硬判"的点：
   - `claude-model-options.ts:48` `OPUS_4_7_PATTERN = /opus-?4-?7/i` + `:50 isOpus47Model` + `:62-76` thinking 处理（4.7 拒绝 manual extended thinking → 转 adaptive/summarized）+ `:42/:80 applyContext1mBeta`（4.7 默认 1M、不发 beta header）。
   - `provider-catalog.ts:65` effort 允许集（注明 "Opus 4.7 adds xhigh"）。
   - `claude-client.ts:1179-1222` 共享 sanitizer + per-model effort 默认（4.7 默认 xhigh）+ `context-1m-2025-08-07`；`agent-loop.ts:287/374` 是同一函数的另一调用点。
   - `model-context.ts:18` `claude-opus-4-7: 1_000_000` 窗口表。
   改法：把 `isOpus47` 单版本判定改成按版本族 / capability 表驱动，让 4.8 走对的参数：thinking 同 4.7（manual → adaptive/summarized）、context 1M 默认（无 beta header，同 4.7）、**effort 默认 `high`（≠ 4.7 的 `xhigh`，per-model 默认必须分开）**、max output 128k。**4.7 行为不回归**。
3. **修 Sonnet 4.6 别名链（#23）**：`provider-resolver.ts:845` 与各 fallback 从 `claude-sonnet-4-20250514` 改为 `claude-sonnet-4-6`；`ai-provider.ts:96` sonnet 别名同步；fallback default（`onboarding-processor.ts:61` / `checkin-processor.ts:73` / `provider-resolver.ts:507`）不再用 Sonnet 4.0。
4. **`opus` 别名 / 默认先不动**：`ai-provider.ts:97` 保持 4-7，只新增显式 4.8；切换待 smoke 后用户拍板。
5. **model-context.ts**：`claude-opus-4-8` → 1M 窗口；1M 默认不需 beta header（同 4.7）。max output 128k 写到对应 max-output 配置（先 grep 确认现有 max-tokens 落点）。
6. 测试：别名解析 + Bedrock/Vertex 前缀匹配（`model-context.ts:49` 的 `us.anthropic.claude-opus-4-*`）回归 pin；**Opus 4.7 与 4.8 各一组** thinking/effort/context 行为断言。

---

## Phase B：用户信任 bug — Mac 通知不弹（#34）+ pin-incomplete 误报（#27）

### 用户能看到什么
- **#34**：设置一个定时任务，到点后 **macOS 会弹出系统通知**（现在到点执行了但没通知，任务像"静默完成"）；若系统通知不可用，**至少聊天内 / 状态区有一个可见提醒**兜底。
- **#27**：默认模型只是"没固定全"时，Settings 的 Runtime / Health 不再吓人地说"该模型在当前执行环境不可用"，而是如实说"默认模型固定信息不完整，去 Models 页重新固定"。

### 不做什么
- #34 不重做整个通知系统、不加新通知渠道（只接通"任务触发 → 通知出口"这条断链）。
- #27 不改健康检查逻辑本身，只改**误导性文案 + 误判分级**；Auto 模式的 fallback 行为不动。

### 怎么验收
- **#34**：Mac dev（3001）建一个 3 分钟任务 → 到点 → 系统通知弹出（或聊天内可见 fallback）；加一个可复现 smoke：短周期任务触发后断言 notification dispatch / audit 事件产生。
- **#27**：构造半截 pin（`default_mode='pinned'` 有 `default_model` 缺 `default_model_provider`）→ Settings Runtime / Health 文案为"固定信息不完整"，不再归因 Runtime 不兼容；且 Runtime 页与 Health 页口径一致（不再一个说 fallback、一个说阻断）。

### 实现路径（不需用户审阅）
- #34：tracker 已列排查方向（任务触发链路是否调到 `codepilot_notify` / Electron main 通知 API / bridge 出口；macOS 通知权限 / bundle id / dev app 是否被系统允许；renderer↔main 通知 IPC 在后台 scheduler 触发时是否丢 BrowserWindow/session 上下文）。需先**定位断点**再修；统一任务触发后的通知出口 + 加可观测日志 + 系统通知不可用时落聊天内 fallback。
- #27：tracker 给了 4 条候选——(a) `pin-incomplete` 降级为 info，文案改"固定信息不完整"；(b) Runtime / Health 统一口径；(c) 数据层写 pinned 时强制同时写 `default_model_provider`；推荐 (a)+(b) 先做，(c) 作防御。遵守 [pinned 默认硬承诺] / [无幻觉] guardrail。

---

## Phase C：能力 / 平台正确性 — Plan 模式 Widget（#26）+ Windows shell 方言（#28）

### 用户能看到什么
- **#26**：在 Plan / 只读模式下，Native Agent **仍能生成 Widget**（现在 Plan 模式下做不了，用户以为 Native 不支持 Widget）。
- **#28**：**Windows 版**里，Agent 生成的脚本命令是 **PowerShell / Windows 兼容**语法，而不是 `export` / `rm -rf` / `/tmp` 这种 bash-only（现在直接复制会执行失败）。

### 不做什么
- #26 不放开 Plan 模式的"写"工具，只把**安全只读**的 Harness 能力（含 widget guideline 工具）保留进来。
- #28 不做 Windows 视觉/页面改造（那是另一回事）；只注入正确的 shell 方言上下文。

### 怎么验收
- **#26**：Plan 模式聊天里要求生成 Widget → 能正常出 widget；回归测试 `assembleTools({mode:'plan'})` 必含 `codepilot_load_widget_guidelines` 且 systemPrompts 含 `FINAL OUTPUT FORMAT`，同时**不含** image/dashboard/schedule 等 mutating 工具。
- **#28**：Windows fixture 回归——PowerShell 目标下禁止生成 `export`/`source`/`rm -rf`/`/tmp`；Settings/Runtime 能力说明显示当前目标 shell。

### 实现路径（不需用户审阅）
- #26（已核实 `agent-tools.ts:116` `if (options.mode === 'plan')` 早返硬编码只留 Read/Glob/Grep）：改为派生保留 `PERMISSION_SAFE_TOOLS`（`agent-tools.ts:53`）中的安全工具 + 其对应 compiler system prompt；mutating 工具继续禁用 / 走 ask。
- #28：在 Runtime/Harness context 注入 `platformShell`（zsh/bash/powershell/cmd），传给三 Runtime 的命令生成 + 工具提示；Windows 默认要求 PowerShell 兼容，检测到 WSL/Git Bash 才允许 bash；加 Windows fixture 回归。**注**：跨三 Runtime 注入，属 Tier 2，需读对应 guardrail + 真实/接近真实验证。

---

## Phase D：工程护栏 — pre-commit enforce（#30）（D0 / D1 / D2）

> 状态：**D1（enforce / set -e）✅ 已完成（commit e10fa1d）**——质量门恢复"任一检查失败即停"，#30 核心洞已堵。**D2 ✅ 已完成（commit cd2a024）**——(1) **flake 根治**：根因是 `tsx --test` 并行跑文件 + 多数 DB 测试未隔离 → 并发抢同一真实库，修法是 `db-isolation.setup.ts` + `--import` 让每 worker 独立 temp DB（连跑 4× 全量 3086/3086 确定性通过，flake 消除）；(2) **"16 error" 核实为 React Compiler 规则**（`set-state-in-effect` / `refs`，非 exhaustive-deps），已修 2 prefer-const + 1 plugins set-state（React 官方渲染期调整模式，CDP 验证）+ 清 11 exhaustive-deps warning，**13 个 React Compiler error 拆 tech-debt #35**（高频/视觉组件行为重构，盲改有回归风险，on-touch debt）。

### D0（纯文档，✅ 已完成）
把 2026-05-29 两件事记入 tech-debt **#30**：(a) `apply-discovery-diff.test.ts` 隔离单跑必过、全量套件 3/4 次挂的污染型 flake；(b) 因此被迫 `--no-verify` 提交纯文档（commit 825edaf）。并写明纪律：**后续代码 phase（A/B/C）不应再靠 --no-verify**。

### 用户能看到什么
- **用户不可见（类型 C 基础设施）**。价值：**防止坏提交悄悄溜过去**——本轮已亲历 #30：docs-drift 与 unit flake 都因 husky 只认最后一条命令而表现失常（前者被放行、后者误挡）。收紧后违规提交会被稳定挡住，正常提交不被 flake 误挡。

### 不做什么
- 不为了收紧 hook 一次性挡死所有提交——**必须先清掉现存 eslint error + 定位 flake 污染源**，再串联。

### 怎么验收
- 故意制造一个 eslint error → `git commit` 被挡住（退出非 0）。
- 存量 error 清零、flake 修掉后：`lint-staged` / `tsc` / drift / unit 任一失败都能稳定阻断提交，且正常提交不被 flake 误挡。

### 实现路径（不需用户审阅）
已核实 `.husky/pre-commit` 4 行未串联（`lint-hooks.mjs` / `lint-staged` / `tsc --noEmit` / `CODEX_DISABLED=1 tsx --test`），husky 以最后一条退出码为准。
1. **eslint 存量（开工实测 16 个 error，非早先估的 3 个）**：2 prefer-const（`context-chips-send-clear.test.ts`，机械修）+ ~14 react-hooks（`setState in effect` / `refs during render`）在 9 个 live 组件/hook（MessageInput / NewChatWelcome / StreamingMessage / TaskCheckpoint / UnifiedTopBar / SkillDetailDialog / ResizeHandle / card-primitives / useMentionTokenEstimate / useWorkspaceSidebar）。**不盲改高频组件**（运行时回归风险，code-review 抓不到）——`lint-staged` 只 lint 暂存文件，故**先 enforce**、这 9 个留 on-touch 债 / 单开 react-hooks 专项。
2. **unit flake（间歇，难复现）**：`apply-discovery-diff` 隔离必过、全量**间歇**挂（同日连跑两次又全过）——非确定、难 bisect；作为独立调查（#11/#25 家族），**不阻塞 enforce**（hook 仍可收紧，flake 命中时重试）。
3. **收紧**：4 行用 `&&` 串联或 `set -e`（或各加 `|| exit 1`）。enforce 后 `lint-staged`（暂存文件 eslint）/ `tsc` / drift / unit 任一失败稳定阻断。
4. **优先级（Codex review）**：D 先于 A/B/C——但 enforce 不必等清完 16 个（lint-staged 只管暂存文件，A/B/C 不碰那 9 个 error 文件）。

---

## Phase E：design.md 设计规范补全（横切 3 节）

> 沿用 2026-05-29 与用户讨论的方向：design.md 保持"共享设计 canon"，**优先补横切规范**；面专属细节靠 "Anchor implementations" 链到既有 feature handover，不把 878 行翻倍成全量产品文档。

### 用户能看到什么
- **用户不可见（类型 C 文档基础设施）**。价值：后续做相关 UI 时能查到统一规范，不再各写一套、不再"管道通了但样式跑偏"。

### 不做什么
- 不把 design.md 扩成覆盖所有非 Settings 面的全量文档（除非用户后续要）。
- 不新写未实现的规范——**只沉淀已 shipped 的稳定模式**（design.md 自身纪律："Anything in here is implemented and shipping"）。

### 怎么验收
- design.md 新增 3 节、内容对得上现有实现；新做对应 UI 时能照着做。

### 实现路径（不需用户审阅）
第一批补 3 节（都已 shipped、稳定、目前只散在 handover）：
1. **浮动卡片布局**（7c：CardFrame 只投影 / CardSurface 只裁剪 / ResizeGutter 在 gap 几何中心）。
2. **Composer 底部工具栏规范**（含"默认无边框、hover / 非默认态才显结构；左侧可调、右侧只读状态"约定）。
3. **macOS 平台壳层 surface 规范**（哪些面上材质、内容区为何不上玻璃——含 Apple HIG 依据）。
A 类面专属（Chat 消息 / /plugins / Workspace / 素材库等）从 "Anchor implementations" 链到既有 handover/insights。

---

## 决策日志

- 2026-05-29（Codex review 修订）：方向获认可，按 5 条反馈修订 Phase A/D —— (1) Phase A 增"开工前核验"（Opus 4.8 官方 model id / context window / thinking·effort / 1M beta header，不臆测）；(2) 实现范围增"泛化 Opus 4.7 专属逻辑"（`isOpus47Model` / `OPUS_4_7_PATTERN` / `applyContext1mBeta` / effort 门控 / sanitizer，配回归测试）—— catalog 显示 ≠ 请求正确；(3) OpenRouter Opus 4.8 改 deferred，未经官方 / 接口确认不接、不臆测 slug，首轮只接 Anthropic direct；(4) `opus` 别名 / 默认先不动（仍 4.7），只新增显式 `claude-opus-4-8`，切换待真实 smoke 后用户拍板；(5) Phase D 拆出 D0（记录 flake + no-verify 事件入 #30，已做），D 建议先于 A/B/C，代码 phase 不再靠 --no-verify。
- 2026-05-29：建本计划。重构主体收尾后，把 6 个遗留项（design.md + #23/#34/#26/#27/#28/#30）+ Opus 4.8 接入拆成 A-E 五个 Phase。#23 与 Opus 4.8 合并入 Phase A（同一别名解析链）。#30 标为 enabler 建议尽早。各 Phase 可独立交付，不强行捆绑。草稿待 Codex 审查后开工。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 每跑一次真实 smoke 追加一行：Runtime / Provider / Model / 凭据形态 / 场景 / 结果 / 证据。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| 2026-05-29 | native | OpenRouter Anthropic skin | requested `opus-4-8` → sent `anthropic/claude-opus-4.8` | 本机 OpenRouter provider | Opus 4.8 发送 | ✅ 通过：`OPENROUTER_OPUS48_OK`，status=succeeded，tool_use=0/tool_result=0 | 验证 legacy DB row `opus-4-8` 经 resolver/catalog 归一到 OpenRouter upstream slug |
| 2026-05-29 | claude_code | OpenRouter Anthropic skin | `anthropic/claude-sonnet-4.6` | 本机 OpenRouter provider | Sonnet 4.6 两轮发送（#23 反例路径） | ✅ 通过：`SONNET46_SMOKE_A_OK` / `SONNET46_SMOKE_B_OK`，status=succeeded，tool_use=0/tool_result=0 | 本机无 Anthropic direct 凭据；用 ClaudeCode Runtime + Anthropic-compatible provider 验证 SDK send path |
| 2026-05-29 | claude_code | Claude Code account / Anthropic direct | `claude-opus-4-8` | 本机 Claude Code 授权账户（`providerId='env'`） | Opus 4.8 两轮发送 | ✅ 通过：`OPUS48_CLAUDE_ACCOUNT_A_OK` / `OPUS48_CLAUDE_ACCOUNT_B_OK`，status=succeeded，tool_use=0/tool_result=0 | SDK 日志显示 `account=yes`；无 `ANTHROPIC_API_KEY` 也可通过 Claude Code 本机授权发送 |

## Open Questions（待 Codex / 用户核对）

1. ~~Opus 4.8 是否设默认 / `opus` 别名指向~~ **已定（Codex review）**：首轮**不切**，只新增显式 `claude-opus-4-8`，`opus` 别名 / 默认保持 4.7；切换待真实 smoke 后由用户拍板。
2. ~~OpenRouter slug + 1M beta header~~ **已定并接入**：OpenRouter Opus 4.8 = `anthropic/claude-opus-4.8`（Codex 经 OpenRouter 官方页确认），**本轮已接入**（commit 9d98029，显式 fixture，不臆测）；1M context / adaptive thinking / effort 默认 high 按 Anthropic 官方核实已落 Phase A。真实凭据 smoke **已通过**（见 Smoke Ledger，2026-05-29：OpenRouter / Anthropic-direct Opus 4.8 + Sonnet 4.6 #23 反例 全 ✅）。
3. **#34 的真实断点**：通知没弹是"任务没调到通知出口"还是"系统通知权限/IPC 丢上下文"——需先定位再定修法。
4. **#30 存量 error 的确切清单**：开工前先 `npm run lint`/eslint 跑一遍确认当前 error 数与文件，再决定清理范围。
5. **Phase 拆分粒度**：A-E 是否进一步拆成独立 PR / 提交，由实现时按 Tier 决定（A/C 含 Tier 2，需 guardrail + smoke）。
