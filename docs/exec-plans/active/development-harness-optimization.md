# Development Harness Optimization / 开发流程 Harness 优化

> 创建：2026-05-19（Codex 初稿）
> 重写：2026-05-19（ClaudeCode v2 — 按用户"可审核"约束重组结构；事实层面增 3 项 Codex 初稿漏说的已有资产；方向上把 Skill 化暂缓、改主推自动检查脚本 + 测试矩阵补洞）
> 补充：2026-06-28（Codex 复盘规则体系：顶层规则瘦身 / path-scoped rules / 测试分层 / 简化汇报协议）
> 对账：2026-06-28（ClaudeCode — 按代码现状校准状态：Step 2/3 的脚本早已实现并在 pre-commit 运行、Step 4/5 已部分落地，但本文此前一直写成"待做讨论稿"，本身就是它要消灭的那类 docs drift。本次校准各 Step 状态、删除会过期的固定计数、修正 guardrails stub 描述，并记录 docs-drift 现在查不到"计划语义状态漂移"的盲区。未实现 Step 0。）
> 状态：🔄 进行中（2026-06-28 对账 + Step 0/5 落地 + Step 6 核实）；Step 0 ✅ ｜ Step 1 ✅ ｜ Step 2 ✅ ｜ Step 3 ✅ ｜ Step 4 🔄 部分（stub 已建、内容 on-touch 填）｜ Step 5 ✅ ｜ Step 6 ✅（核实：4 桶已被后续修复覆盖，无需单独补）。主体完成，仅剩 Step 4 on-touch 持续填充。
> 触发：用户问"为什么 Phase 5 接入 Codex 花了 3 天，下次接 Hermes / Gemini / OpenClaw 还会重复这种边跑边修吗"
> 参考材料：
> - Anthropic 大型代码库 Claude Code 最佳实践（用户提供本地文档；原文：<https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start>）
> - OpenAI Codex use cases：<https://developers.openai.com/codex/use-cases>（仅作为任务类别参考：review / tests / docs upkeep / web/native verification，不作为执行方案依据；本计划的具体优先级仍以 Anthropic 大代码库文档 + 本仓库 Phase 5 事实审计为准）
> - Anthropic Claude Code memory / `CLAUDE.md`：<https://docs.anthropic.com/en/docs/claude-code/memory>
> - Anthropic Claude Code best practices：<https://www.anthropic.com/engineering/claude-code-best-practices>
> - OpenAI Codex `AGENTS.md` guide：<https://developers.openai.com/codex/guides/agents-md>
> - OpenAI Codex hooks：<https://developers.openai.com/codex/hooks>
> - Ruler（多 Agent 规则文件分发工具）：<https://github.com/intellectronica/ruler>

## 用户审核护栏（本计划的元规则）

用户已明确说明：

> "我可以判断产品方向和用户体验，但是很少理解技术细节，一旦你们给的内容过细，我就无法审核，导致方向偏离我无法发现。"

后续 Codex / ClaudeCode 推动这份计划时，**每一份 Phase / Step 必须满足**：

1. **每个 Step 开头必须先答三件事**——用日常语言：
   - 用户能看到什么变化（visible result）
   - 不做什么（explicit scope cut）
   - 怎么验收 / 用户怎么自己判断成功（verification the user can perform）
2. **技术实现细节集中在该 Step 的"实现路径"小节**，并明确标注 `> 此部分用户不需审核，仅 Codex / ClaudeCode 对齐用`。脚本名 / 函数名 / 文件路径 / 测试名只能出现在这里，不能出现在目标里
3. **不要把脚本名作为目标**——"加 `lint:docs-drift` 脚本"不是目标，"提交时 active 文档说在跑但代码已完成会自动报错"才是目标
4. **决策变化（删 Step / 砍范围 / 调整顺序）必须先用用户能看到的层面解释**——不能只用"contract test 矩阵补洞效率更高"这种用户无法判断的理由

## 用户视角 — 为什么发起这次讨论

四件用户能感知到的事，三天内重复发生：

1. **真实凭据 smoke 反复打补丁**——"我让你跑通的，第二天换个模型 / 凭据形态又炸；改完又通了；过一会还报错"，共 4 轮
2. **提交一次卡 30 分钟**——用户看着等
3. **Settings 状态显示让人困惑**——"一直转圈说'检测中'"、"按钮文字'待启动'像还没准备好"，共 2 次反复
4. **范围边界事故**——"我让你 Phase 5 收尾，你又回去改代码"

这些都不是单点功能 bug，是"流程没有按用户预期收敛"。Codex 触发本计划的核心问题：以后再接 Hermes / Gemini / OpenClaw 时，是否还会重复这种边跑边修。

## 用户能验收的目标

升级完成后，用户应该能在以下场景**直接观察到流程变得稳定**：

| 用户场景 | 升级前的现象（已观察到） | 升级后用户能看到 |
|---|---|---|
| 接入第 N 个 Agent Runtime | 反复"再 smoke 一次 / 再修一轮" | Agent 在动手前主动展示"我先读了哪几份必读 + 跑了哪条契约测试" |
| 改 docs/exec-plans 文档 | 用户人工 grep 才发现"active 说在跑、代码已完成"漂移 | 提交时自动报错，明确指出哪一行漂移 |
| 跑真实 smoke 后做下一步 | 结果散落聊天，下次问"上次跑过没？" | 每个 Phase 计划里有固定 Smoke Ledger 表 |
| 提交代码 | 偶尔卡 30 分钟 | 提交时间稳定在 30 秒内 |
| Agent 改高风险代码 | 用户反复提醒"你看了 XX 文档没" | Agent 自动引用"我读了 guardrails/Runtime.md 第几条不变量" |

**用户无法直接判断、需要 Codex / ClaudeCode 互相验证的层级**：
- 测试矩阵覆盖度
- SDK 兼容层分流是否正确
- 脚本检查的误报率

→ 这些必须由"是否还在重复出同类问题"间接验证，不直接占用用户审核精力。

## 为什么 Phase 5 花了 3 天 — 耗时归因

Phase 5 收口前的最后 10 个 commit，按用户能感知的类别分桶：

| 类别 | 提交次数 | 用户能感知的现象 | 真正的根因（用户不需审） |
|---|---|---|---|
| 真实凭据 smoke 反复发现新坑 | 4 | 切换 provider / 凭据形态 / 模型就报错 | capability × protocol × credential 矩阵契约测试有洞 |
| 工程隔离 | 1 | 提交卡 30 分钟 | pre-commit hook 与 dev server 抢同一份 SQLite 锁 |
| UI 文案 / 状态机 | 2 | Settings 永远转圈、"待启动"像没准备好 | 用户语言反馈循环不在固定流程里 |
| Docs closeout | 2 | 用户要明确说"归档 Phase 5" | active → completed 移动不是自动触发 |
| 收口本身 | 1 | 用户最终授权才结束 | 边界一直靠用户兜底 |

**结论**：耗时主因（4/10）是契约测试矩阵的洞，第二是工程隔离（1/10）+ docs closeout 自动化缺失（2/10）。**单纯加 Skill / 加 checklist 对这三类都不直接生效**——必须用测试矩阵 + 自动检查脚本 + 流程模板分别打。

> 实现路径（用户不需审核）：上述 10 个 commit 是 b7f6f23 / 752e0bd / 4e6add2 / 4b04f88（4 个真实 smoke 反复）、3458d80（hook 隔离）、db9980c / 76599fc（UI 状态机 + 文案）、c2e631d / 4296d2f（docs closeout）、收口边界。

## 当前事实审计

### 已经存在的流程资产（v2 增 3 项 Codex 初稿漏说的）

| 资产 | 已经在做什么 | 用户能感知 |
|---|---|---|
| `AGENTS.md` 第 102 行 Signal→Triage→Fix→Verify→Guardrail 闭环 | 修复闭环规则 | 已沉淀进 tech-debt-tracker，但执行靠 Agent 记忆 |
| `.husky/pre-commit`（含测试隔离开关）| 自动跑 typecheck + 单测 | 提交不再卡 30 分钟 |
| `docs/exec-plans/README.md` + 总控板 | Phase 状态 + 接管清单 | 用户从一个入口看到全部主线状态 |
| **`docs/guardrails/` 12 份模块契约**（4 份完整 + 8 份七节模板已建，Step 4 产物） | Runtime / ProviderManagement / ModelDiscovery / ComposerModelSelection 四份已填满"不变量 + 关键文件 + 改动检查表 + 常见坑 + 测试覆盖 + 决策日志"；i18n / DatabaseSchema / PermissionBoundary / StreamSession / MCP / Onboarding / ElectronMain / Release 八份已建好同结构骨架、内容按 on-touch 逐步填（StreamSession 已部分填充） | Agent 改对应模块前必须先读，这是"Module Entry Map"的落地形态 |
| **`package.json` 的 `lint:colors` 脚本**（v2 新增 — Codex 初稿漏说） | 颜色合规自动检查 | 改 UI 颜色不合规时自动报错；这是"docs drift 检查"的同形态先例 |
| **`docs/exec-plans/tech-debt-tracker.md`**（v2 新增 — Codex 初稿漏说） | review finding 结构化沉淀（条目持续增减，不在本文写死计数，以 tracker 现状为准） | 用户能在 tracker 看到当前所有"已知没修"的技术债 |
| Phase 5e 后的契约测试基线 `harness-capability-contract.test.ts` | live = zero unsupported exposures | 接 Runtime 前必须先过契约测试 |

### 当前主要缺口

| 缺口 | 用户能看到的现象 | 真正的根因（用户不需审） |
|---|---|---|
| 真实凭据 smoke 反复发现新问题 | "切换模型 / 凭据就报错" | capability × protocol × credential 矩阵契约测试有洞 |
| docs-drift 已脚本化，但只查 README↔文件 | "active 文档说 Step 待做，其实代码早完成"这类漂移仍漏（本计划自己就是例子） | `lint:docs-drift` 校验 README 索引 / 内链 / 表格结构 / 归档 banner，但读不懂"计划正文声明的 Step 状态 vs 代码现状"的语义差 |
| Smoke 结果散落聊天 | "上次跑过没？跑了哪个 provider？" | Smoke Ledger 没固定字段 |
| guardrails 8 类入口已建、内容多为骨架 | "Agent 说读了 guardrail，但读到的可能是空壳"、"改 i18n / DB schema / 权限边界 时该文档还没有可引用的不变量" | 8 类 stub（i18n / DatabaseSchema / PermissionBoundary / StreamSession / MCP / Onboarding / ElectronMain / Release）七节模板已建、索引已扩，但除 StreamSession 外内容多为待填骨架（Step 4 部分完成） |
| 任务开始时 Agent 不主动展示"必读" | 用户要主动问 / 提醒 | 没有 pre-task 自动引用机制 |

### 2026-06-28 追加事实审计：规则体系本身开始拖慢迭代

用户在 v0.56.x 发版前反馈两个新症状：**最近迭代速度明显变慢**，以及**越来越看不懂 Claude / Codex 输出的文档与改动内容**。Codex 复盘 `AGENTS.md`、`CLAUDE.md`、`docs/exec-plans/README.md`、`docs/guardrails/` 后，结论是：当前问题不只是测试矩阵缺口，而是**规则放置层级不对**。

| 发现 | 用户能看到的症状 | 具体问题 |
|---|---|---|
| 顶层规则重复且冲突 | Agent 倾向多跑测试、多写长汇报，避免被打回 | `AGENTS.md` 与 `CLAUDE.md` 都写测试/发版/执行计划；`AGENTS.md` 仍写 pre-commit 会自动执行 `test:smoke` / `test:e2e`，但 `CLAUDE.md` 已写实际 hook 只跑 lint/tsc/unit；`exec-plans/README.md` 还写 "UI 改动必须 CDP 验证"，和顶层"默认不要强制 CDP"冲突 |
| 完成状态没有词典 | "修好了"、"代码完成"、"smoke 通过"混用，用户不知道能否发版 | #629 / #635 / #628 都出现过代码层完成后又被 route / UI / smoke follow-up 打回的情况 |
| 文档回写过细 | 每个 P3 follow-up 都变成清单、状态表、决策日志三处同步 | `CLAUDE.md` 要求任一 Phase / 子项做完立即回写三处，适合大阶段，不适合小 patch |
| guardrails 一半还是 stub | Agent 说"我读了 guardrail"，但读到的可能只是空壳 | `docs/guardrails/` 13 份里只有 Runtime / ProviderManagement / ModelDiscovery / ComposerModelSelection 是完整契约；i18n / DB / Permission / Stream / MCP / Onboarding / ElectronMain / Release 仍是 stub 或半 stub |
| 技术细节默认进入用户汇报 | 用户被迫阅读 source-pin、file:line、commit 串 | `exec-plans/README.md` 要求交付说明包含上下文、讨论过程、被否方案；对 Tier 2 架构决策有用，但普通 bug fix 过重 |

外部资料给出的方向与此一致：

- Claude Code 官方把 `CLAUDE.md` 定位为每个 session 都要加载的 memory；顶层文件应放稳定、短小、反复有用的信息，复杂流程应拆到更聚焦的文档 / skill / hook。官方最佳实践还建议维护 `CLAUDE.md`、常用命令、风格规则、仓库结构等，但不要把所有历史决策塞进顶层。
- Codex 的 `AGENTS.md` 是项目指令入口，有默认大小上限；规则越长，越容易挤占任务上下文。更适合放角色边界、关键命令、不可破坏规则和指向性链接。
- Ruler 的价值是用 `.ruler/` 做多 Agent 规则 single source，再生成 `CLAUDE.md`、`AGENTS.md` 等目标文件；但 Ruler 默认会把 `.ruler/*.md` 拼接到目标规则文件里。如果不先做分层，只会把重复膨胀自动化。因此本计划采用 **Ruler-compatible first**：先把规则分层清楚，再决定是否引入 Ruler。

## 方向比较（替代 Codex 初稿的 "Anthropic 启发 + OpenAI use cases" 两节）

| 方向 | 用户能感知到的变化 | 主要风险 | v2 推荐 |
|---|---|---|---|
| **A. Skill 化（Codex 初稿主推）** | Agent 触发同类任务时引用同一份 Skill；但 Agent 仍可能跳过 / 忘记 | Skill 本质是提示词，跟现有 AGENTS.md + handover/ 重叠。能解决"Agent 忘规则"但**不解决用户实际看到的三件事：切换模型就报错 / 提交卡死 / 文档漂移** | 暂缓 |
| **B. 自动检查脚本（v2 主推）** | 提交时直接报错，用户不需要人工记得检查；和现有"颜色合规检查"同形态 | 写脚本要 1-2 天；不能替代测试矩阵 | ✅ 优先 |
| **C. 测试矩阵补洞（v2 主推）** | 接 Hermes / Gemini 时第一次跑测试就挡掉同类问题 | 用户无法直接审核测试质量；需要 Codex / ClaudeCode 配合 | ✅ 优先 |
| **D. 规则体系瘦身（2026-06-28 新增）** | 用户不再被长汇报和重复规则拖住；Agent 只在相关任务加载相关规则 | 如果只是搬文档、不改 hook / lint / 测试分层，仍会回到"靠记忆" | ✅ 立即加到 Step 0 |

→ **D + B + C 一起做，A 暂缓**。D 负责给系统减负和统一入口；B/C 负责把必须发生的检查做成确定性机制。如果半年后回看"Skill 没人读、测试洞还在出"，再考虑 A。

## 建议的"第一刀"（替代 Codex 初稿的 Phase 0-5）

每一步都用"用户能看到什么 / 不做什么 / 怎么验收"开头。

### Step 0 — 规则体系瘦身 / Rules System Slimdown ✅ 已完成（2026-06-28）

- **用户能看到什么**：Claude / Codex 的输出更短、更一致；不会再把每个 P3 follow-up 都汇报成审计报告；不再因为规则冲突而反复跑 CDP / smoke / 全量测试。用户看到的默认汇报收敛为：**结论 / 用户影响 / 验证 / 剩余风险 / 下一步**。
- **不做什么**：不碰发版；不立即引入 Ruler 改写规则文件；不删除已有 guardrails / handover / research 历史文档；不把安全、DB、Runtime、权限这些高风险规则弱化。
- **怎么验收**：挑一个普通 bug fix 和一个 Tier 2 Runtime fix 对比。普通 bug fix 的汇报不超过 5 行；Tier 2 fix 才附详细证据。再看 `CLAUDE.md` / `AGENTS.md`：顶层不再重复完整测试、发版、执行计划细则，而是指向对应 rule / guardrail。

> 实现路径（用户不需审核，仅 Codex / ClaudeCode 对齐用）：
>
> 1. **顶层规则分工**
>    - `CLAUDE.md`：Claude Code 专属、每次都要知道的最小规则。保留：角色、禁止自动 push/tag、测试分层摘要、文档入口、简化汇报协议。删除或转链：完整 Release Notes 模板、长发版流程、三处回写细则、完整语义验收 checklist、长 Signal→Triage 解释。
>    - `AGENTS.md`：Codex 专属边界。保留：Codex 可审查/测试/文档、不可改产品代码；共享规则入口；review 输出格式。删除和 `CLAUDE.md` 重复的测试、发版、功能文档大段。
>    - `docs/guardrails/*.md`：稳定模块契约。只有七节完整填充的文件才算硬门禁；stub 标成"参考/待填充"，不能作为"已完成必读"的证据。
>    - 新增或整理 `.claude/rules/*.md`（若 Claude Code 确认当前版本支持）：按路径/任务加载 `testing.md`、`docs-governance.md`、`semantic-ui.md`、`release.md`、`db.md`、`stream.md`、`permission.md`、`electron.md`。如果当前 Claude 环境不支持 path-scoped rules，则先放 `docs/guardrails/` + 顶层链接，不强行引入。
>
> 2. **Ruler 采用策略**
>    - 先做 **Ruler-compatible**，不马上引入 Ruler：把规则拆成单一来源，确认哪些内容应该生成到 `CLAUDE.md` / `AGENTS.md`，哪些只能作为按需文档。
>    - 再做一次 Ruler dry-run（不提交产物）：target 只开 Claude + Codex，比较生成文件是否更短、更一致。
>    - 通过条件：生成后的顶层规则更短、无重复、无测试/CDP 冲突；失败条件：只是把 `.ruler/*.md` 拼成更大的 `CLAUDE.md` / `AGENTS.md`。
>
> 3. **统一测试分层**
>    - Tier 0：文档、注释、Release Notes、纯文案、小样式、纯测试可移植性。默认不跑 smoke / CDP；只跑必要的 lint/docs drift/targeted check。
>    - Tier 1：普通 UI 行为、数据接线、i18n、组件状态。跑 targeted test 或轻量 smoke；提交前 `npm run test`。
>    - Tier 2：Runtime / Provider / DB / 权限 / Stream / MCP / Electron / 安装 / 发版链路。跑 targeted + full tests；必要时真实凭据 smoke；结果写 Smoke Ledger。
>    - 删除冲突口径：`exec-plans/README.md` 的 "UI 改动必须 CDP 验证" 改为"UI 改动必须实际验证，CDP 只作为深度诊断备用"；`AGENTS.md` 的 pre-commit 实际执行项与 `CLAUDE.md` 对齐。
>
> 4. **统一完成状态词典**
>    - `Code complete`：产品代码已改完。
>    - `Tests pass`：targeted / full tests 通过。
>    - `Smoke passed`：真实 UI / 凭据 / app 路径通过。
>    - `Review passed`：Codex 或 Claude Code 复审无 blocker。
>    - `Release ready`：文档、测试、smoke、已知风险都可接受。
>    - `Shipped`：已 push/tag/release。禁止把 `Code complete` 直接叫"已修好"。
>
> 5. **简化汇报协议**
>
> ```text
> 结论：可继续 / 需返工 / 暂停
> 用户影响：一句话
> 验证：跑了什么，结果如何
> 剩余风险：没有就写"无阻塞"
> 下一步：谁做什么
> ```
>
> 默认不贴 commit 串、file:line、source-pin、测试全文；只有 review blocker / Tier 2 / 用户要求细节时展开。
>
> ✅ 落地（2026-06-28，应用户"一次性搞完"）：
> - 新建 `docs/rules/`（[reporting.md](../../rules/reporting.md) = 完成状态词典 + 简化汇报协议；[release.md](../../rules/release.md) = 发版流程 + Release Notes 模板）+ README 索引。
> - `CLAUDE.md` 瘦身：发版节 55 行 → 摘要 + 纪律 + 链接；新增「汇报与完成状态」节；文档索引补 rules/ + guardrails/ 入口。
> - `AGENTS.md` 重写：删与 CLAUDE.md 重复的开发规则/语义验收/功能文档/发版大段 → 改为「共享规则入口」链接；保留 Codex 边界 + review 规则；**修正错误**——原写「pre-commit 自动执行前三项（含 smoke/e2e）」，实际只跑 lint/tsc/unit。
> - 消除三处冲突的最后一处：`exec-plans/README.md`「UI 改动必须 CDP 验证」→「必须实际验证，CDP 仅深度诊断备用」（顶层 CLAUDE.md / AGENTS.md 早已是「默认不强制 CDP」）。
> - **path-scoped rules 决策**：claude-code-guide 查证 `.claude/rules/`（含 YAML `paths` 前缀）官方支持按需加载。但 (1) `.claude/` 被 `.gitignore` 整目录忽略（line 70）→ 放那里不进版本库、Codex / CI 读不到；(2) 即便放行，自动按需加载只 Claude 受益，Codex 仍按链接手动读；(3) 当前两个是流程规则、按需收益小。故规则放 `docs/rules/`（两 agent 单一来源），不引入 `.claude/rules/` / Ruler（兑现 Ruler-compatible first）。用户 2026-06-28 复议确认后维持此决策；`.claude/rules/` 的 path-scoped 留给未来绑定代码路径的模块规则（Step 4 guardrail 类）再引入。
> - 测试 Tier 0/1/2 权威定义留 `CLAUDE.md`「自检命令」，AGENTS.md / README 指向它，三处口径统一。
> - 未做（按计划保留）：Step 4 的 8 份 guardrail 内容填充（on-touch）、Step 6 测试矩阵（待定）。

### Step 1 — 写一份 Phase 5 耗时归因表 ✅ 已完成

- **用户能看到什么**：本计划"耗时归因"那一节的 5 行表，每行都能用日常语言复述发生了什么。作为后续投资优先级的事实依据
- **不做什么**：不改任何代码，不动业务逻辑
- **怎么验收**：用户读这张表，要求 ClaudeCode 用日常语言复述其中任意一行的发生过程 → 复述对得上 commit 实际内容

> 实现路径（用户不需审核）：直接读取本 session 上下文里的 10 个 commit hash 和归因结论；产出 markdown 表格已写入"为什么 Phase 5 花了 3 天 — 耗时归因"那一节。等用户认可后冻结。

### Step 2 — docs drift 自动检查 ✅ 已完成（commit 17b7a58 起，2026-06-28 对账确认）

- **用户能看到什么**：提交涉及 `docs/exec-plans/**` 时，如果有"active 说在跑、代码已归档"或"completed 内部链接还指向 ../active/"类漂移，提交自动失败、显示具体哪一行
- **不做什么**：不改任何业务代码；不影响 src/ 的提交速度（脚本只在改文档时触发）
- **怎么验收**：用户手动制造一次漂移（在 README active 表里写一个不存在的 phase 文件），尝试 commit → 应该被脚本挡掉

> 实现路径（用户不需审核）：`npm run lint:docs-drift`（`scripts/lint-docs-drift.mjs`）+ lint-staged path glob 只在改 `docs/exec-plans/**` 时触发；脚本校验 README 索引链接是否存在、active/completed/deferred/superseded 文件是否被索引、completed 不含 `../active/` 内链、归档桶内部相对链接完整性、索引表 3 列结构、active/ 不带 superseded/deferred 顶部 banner。**实际覆盖比原计划更广**（多了表格结构 + banner + 全桶内链）。
>
> ⚠️ 已知盲区（2026-06-28 对账记录，同日 Step 0 实施后再次实证）：docs-drift 只校验「README 索引 ↔ 实际文件」是否存在 / 链接合法，**读不懂状态语义是否一致**——既读不懂「计划正文声明的 Step / Phase 状态 vs 代码真实状态」，也读不懂「README 索引的状态列 ↔ 计划正文的状态行」。两次实证：(1) 对账前 Step 2/3 脚本早已 commit、Step 4/5 已部分落地，正文却长期写「待做讨论稿」；(2) Step 0/5 实施后只更新了正文状态行、漏同步 README 索引状态列，由用户 review 发现。两次 lint:docs-drift 都全程放行（链接、文件位置都合法）。补这类「语义状态漂移」需要新机制（例如让计划顶部状态行可机读 + 对照 README 状态列 / 产物清单），不在现有脚本能力内；是否投入由后续决定，先记录为缺口。

### Step 3 — pre-commit 配置自检 ✅ 已完成

- **用户能看到什么**：保证 pre-commit hook 永远包含"测试隔离"开关；未来如果有人改 hook 把开关弄丢了（就像 Phase 5b 那次卡 30 分钟的事），下次提交直接失败、提示加回来
- **不做什么**：不影响正常 commit 速度（脚本只检查 hook 文件本身，毫秒级）
- **怎么验收**：临时把开关从 hook 里删掉，尝试 commit → 应该被脚本挡掉

> 实现路径（用户不需审核）：`npm run lint:hooks` 脚本 grep `.husky/pre-commit` 必须含 `CODEX_DISABLED=1`，pre-commit 自身先跑这个 lint。

### Step 4 — 把"必读"扩到 guardrails/ 八类高风险入口 🔄 部分完成

- **用户能看到什么**：Agent 改 i18n / DB schema / Permission / Stream / MCP / Onboarding / IPC / Release 这八类代码前，自动引用对应 guardrails 文档并说"我读了第几条不变量"。用户可以随机抽查任意一份让 Agent 复述
- **不做什么**：不一次性把 8 份文档全写满——先建空 stub（只有标题 + 待填充提示），每次真实改动时由实施 Agent 填一节，避免"为写文档而写文档"
- **怎么验收**：用户随便挑一份 stub，要求 Agent 先读 → Agent 必须能引用文档里某条不变量；如果引用不出来，说明这份 stub 还没填充到位

> 实现路径（用户不需审核）：✅ 已完成部分——`docs/guardrails/README.md` 索引已扩到 8 类（commit 84980be）；8 个 stub 文件（i18n.md / DatabaseSchema.md / PermissionBoundary.md / StreamSession.md / MCP.md / Onboarding.md / ElectronMain.md / Release.md）已建，统一七节模板（词汇表 / 不变量 / 关键文件 / 改动检查表 / 常见坑 / 测试覆盖 / 决策日志）就位。🔄 待完成部分——除 StreamSession（已随 2026-06-10 流式 bug 修复部分填充）外，其余 stub 内容仍是骨架，按 on-touch（真实改到对应模块时填一节）推进。

### Step 5 — Smoke Ledger 模板化 ✅ 已完成

- **用户能看到什么**：未来每个 Phase 计划里都有固定一张 Smoke Ledger 表，记录哪个 provider / 模型 / 凭据形态在哪一天跑过、结果如何。这样切回某个 Phase 时不用翻聊天回忆
- **不做什么**：不追溯过往已完成 phase 的 ledger，只对未来生效
- **怎么验收**：下一个新建的 Phase 计划必须自动带这段；如果新建的 Phase 没带，Step 2 的 docs-drift 脚本会挡

> 实现路径（用户不需审核）：✅ 全部完成——(1) `docs/exec-plans/README.md` 执行计划模板含 `## Smoke Ledger` 必填段（表头 + 示例行）；(2) `lint-docs-drift.mjs` 已加强制校验：新建 active 计划缺 `## Smoke Ledger` 段即 commit 失败，带 grandfather 豁免清单（规则落地前的 8 个 active 计划不追溯）+ 自检（heading 检测器对正例 fire、对正文提及 silent）。从此靠脚本强制，不再靠约定。

### Step 6 — 测试矩阵补洞 ✅ 已覆盖（2026-06-28 核实，无需单独做）

- **用户能看到什么**：**用户无法直接审核**（这里 v2 必须如实告诉用户）。但能从"接下一个 Runtime / Provider 时是否还在重复出 OpenRouter Anthropic-skin / OAuth refresh 那类坑"间接判断
- **不做什么**：不为补洞而搭复杂测试基础设施；只补已知踩过的 4 个桶（OpenRouter Anthropic-skin / OAuth refresh / 长尾 retry / 历史 DB 行 canonicalization）
- **怎么验收**：等下次接 Hermes / Gemini 时回看。如果再没出现"切换模型就炸"，这一刀就有效

> 实现路径（用户不需审核）：在 `harness-capability-contract.test.ts` 一类的契约测试里，把 capability × protocol × credential 矩阵的已知洞补成断言；不新建测试框架，只扩已有契约测试。
>
> ✅ 核实结论（2026-06-28，Explore 调研 + spot-verify）：4 个桶**均已被后续 bug 修复顺带覆盖**，无需单独补：
> - OpenRouter Anthropic-skin + 历史 DB 行 canonicalization → `provider-resolver.test.ts:1335-1394`（round 9：legacy `haiku→haiku` DB 行 canonicalize 成 `anthropic/claude-haiku-4.5`）+ `provider-model-roundtrip.test.ts`（21 用例）
> - OAuth refresh → `openai-oauth-fetch-refresh.test.ts`（per-request `ensureTokenFresh`）+ `openai-oauth-retry.test.ts`（14 用例，重试分类）
> - 长尾 retry / 慢渠道分级超时 → `issue-635-idle-tier.test.ts`（7 用例，两层 idle 预算 + api_retry liveness）
>
> 矩阵契约框架本就在位（`harness-capability-contract.test.ts` / `harness-capability-matrix.test.ts` / `harness-runtime-adapter.test.ts`）。这是又一例「计划说待做、实际已完成」（见决策日志 + tech-debt #45）。未来接 Hermes / Gemini 若冒出新桶，按 on-touch 补进对应契约测试即可。

## 已删除 / 不做的项（替代 Codex 初稿对应内容）

| Codex 初稿提议 | v2 决定 | 用户视角理由 |
|---|---|---|
| Phase 2 — Internal Development Skills（5 个 Skill）| 全部暂缓 | 用户能看到的三件事（切换模型报错 / 提交卡死 / 文档漂移）不是"Agent 忘了规则"导致的，Skill 解决不了 |
| Phase 5 — Collaboration Protocol（Codex / ClaudeCode / Explorer 分工固化）| 删除 | 用户已经在用授权式协作（"明确允许做 X、不允许做 Y"）。把角色写死会让该弹性化的地方僵化 |
| Phase 1 表里"必读"指向 `completed/phase-5-codex-runtime.md` | 改指向 `docs/handover/` + `docs/guardrails/` | 归档计划是历史快照不再维护；必读应指持续维护的文档 |
| "Anthropic 启发" + "OpenAI Codex use cases" 两节 | Anthropic 启发已折射进"方向比较"；OpenAI 那节作为任务类别参考保留在顶部参考材料，不作为执行方案依据 | OpenAI use cases 是任务类别清单（review / tests / docs upkeep / web/native verification），不映射到具体执行优先级；本计划优先级以 Anthropic 大代码库文档 + 本仓库 Phase 5 事实审计为准 |
| Module Entry Map 作为 Phase 1 新建产物 | 改为"扩 `docs/guardrails/` 索引到 8 类"，并入 Step 4 | guardrails/ 已经有 4 份模块契约的早期形态，再新建一套必然漂移 |

## 决策日志

- 2026-05-19（Codex）：发起讨论稿 v1，列 Phase 0-5（事实核准 / Module Entry Map / Internal Skills / Deterministic Hooks / Smoke Ledger / Collaboration Protocol）。
- 2026-05-19（Codex）：补 OpenAI Codex use cases 作为第二参考源。
- 2026-05-19（ClaudeCode review）：事实审计补 3 项漏说（`docs/guardrails/` 已有 4 份模块契约、`lint:colors` 脚本、`tech-debt-tracker.md` 17 活跃项 + 2 已解决）；路径修正 1 项（"必读"应指 handover / guardrails，不指 exec-plans/completed/）。
- 2026-05-19（ClaudeCode review）：方向性质疑——Skill 化解决不了 Phase 5 真正的耗时根因（4/10 是契约测试矩阵洞、1/10 是工程隔离、2/10 是 docs closeout 自动化）。推荐 B+C 并行、A 暂缓。
- 2026-05-19（用户）：明确"我能判断产品方向和用户体验、不深入技术细节"的约束。要求本文件每个 Step 都有"用户能看到什么 / 不做什么 / 怎么验收"作为开头，技术细节集中在"实现路径"小节并标注用户不需审核。已写入 ClaudeCode 长期 memory（`feedback_user_cannot_judge_tech_detail.md`）。
- 2026-05-19（ClaudeCode 改写为 v2）：按用户约束重写本计划。结构改成"用户视角 → 用户可验收目标 → 耗时归因 → 事实审计 → 方向比较 → 第一刀 6 步"；删 Codex 原 Phase 2 Skill 化（暂缓，等 Skill 真有信号再回头）；删 Phase 5 Collaboration Protocol（写死角色与用户的授权式协作冲突）；OpenAI use cases 节作为任务类别参考保留在顶部参考材料、不作为执行方案依据；保留 Codex 决策日志全文作为讨论历史。
- 2026-05-19（Codex review v2）：通过 v2 主方向（Skill 化暂缓 / 优先做 docs drift + hook self-check + Smoke Ledger + contract matrix gaps）。两处文档小修：(1) tech-debt 数量从误写的 18 活跃改为 17 活跃 + 2 已解决；(2) OpenAI Codex use cases 措辞软化为"任务类别参考"，不再写"无具体可执行启发"。
- 2026-06-28（用户 + Codex）：发版前复盘发现新的瓶颈不是单个测试或单个计划，而是顶层规则体系本身过重：`CLAUDE.md` / `AGENTS.md` / `exec-plans/README.md` 对测试、CDP、文档回写、交付说明存在重复与冲突，导致 Agent 倾向过度测试、过度汇报、把用户变成 Claude↔Codex 消息总线。Codex 调研 Ruler / Claude Code memory / Claude Code best practices / Codex AGENTS.md / hooks 后，新增 Step 0「规则体系瘦身」：顶层规则最小化、按路径/任务加载规则、stub guardrail 降级、测试 Tier 0/1/2 统一、完成状态词典、简化用户汇报协议。发版不纳入本 Step，由 Claude Code 另行处理。
- 2026-06-28（ClaudeCode 对账，应用户要求）：审查本计划时发现它本身严重 docs drift——Step 2/3 的脚本（`lint-docs-drift.mjs` / `lint-hooks.mjs`）早已实现并在 pre-commit 运行、Step 4（8 类 guardrails stub + 索引）与 Step 5（README Smoke Ledger 模板段）已部分落地，但顶部状态与各 Step 仍写成"待做讨论稿"。本次对账：Step 1/2/3 标 ✅、Step 4/5 标 🔄 部分完成、删除会过期的 tech-debt 固定计数（"17 活跃"实际已 38+）、修正 guardrails「只有 4 份 / 8 类还没建」的过时描述（实为 4 完整 + 8 骨架已建）、并在 Step 2 记录 docs-drift 查不到「计划语义状态漂移」的盲区（即本计划骗过了它自己实现的检查）。**未实现 Step 0**——用户明确要求先让计划重新可信、暂不动规则瘦身。同步更新 README active 表该行状态。根因复核：Step 2/3/4/5 是"实现了没回写计划"（违反 CLAUDE.md「完成即回写进度」），与本计划要解决的同类问题同源。
- 2026-06-28（ClaudeCode 执行 Step 0 + Step 5，应用户"一次性搞完、交 Codex 审"）：**Step 0 规则瘦身**——新建 `docs/rules/`（reporting / release）；`CLAUDE.md` 发版节瘦身 + 新增「汇报与完成状态」节 + 文档索引补 rules/guardrails；`AGENTS.md` 重写为「Codex 边界 + 共享规则入口」并修正「pre-commit 自动跑 smoke/e2e」错误描述；`exec-plans/README.md` 消除「UI 必须 CDP」冲突（三处冲突全清）。**Step 5**——`lint-docs-drift.mjs` 加 Smoke Ledger 强制校验（grandfather 豁免落地前 8 个 active 计划 + 自检）。**path-scoped rules 决策**：Claude Code 官方支持 `.claude/rules/` 按需加载，但 Codex 读不到，为双 agent 单一来源改放 `docs/rules/` + 顶层链接，不引入 `.claude/rules/` / Ruler（兑现 Ruler-compatible first）。**未做**：Step 4 guardrail 内容填充（on-touch）、Step 6 测试矩阵（待定）。验证：`npm run lint:docs-drift` ok（含新校验自检）+ 提交门禁（lint-hooks + lint-staged docs-drift + tsc + 单测）通过。待用户交 Codex 审。
- 2026-06-28（ClaudeCode 返工，用户 review 发现）：Step 0/5 实施时只更新了本文顶部状态行（Step 0 ✅ / Step 5 ✅），漏同步 `exec-plans/README.md` 索引该行状态（还停在「Step 4/5 部分、Step 0 待定」），构成「索引 ↔ 正文状态漂移」——正是本计划要消灭、且 Step 2 盲区记录的同类问题（docs-drift 查不到）。已补 README 状态列同步；并把 README line 52「验证：测试 / CDP 路径」改为「测试 / smoke / 浏览器或 CDP 路径（如有）」，消除残留的默认 CDP 暗示（line 44 上轮已改）。Step 2 盲区描述同步扩充，把「README 状态列 ↔ 正文状态行」也明确纳入，并记为该盲区的第二次实证。
- 2026-06-28（用户复议规则存放位置）：用户提出改用官方 `.claude/rules/` 按需加载机制。核查发现 `.claude/` 被 `.gitignore` 整目录忽略（line 70）→ 放那里不进版本库、Codex / CI 读不到；且自动按需加载只 Claude 受益、当前流程规则（reporting / release）按需收益小。用户知情后确认维持 `docs/rules/`；`.claude/rules/` 留给未来绑定代码路径的模块规则（Step 4 guardrail 类）再引入。
- 2026-06-28（ClaudeCode 核实 Step 6，应用户"继续推进"）：Explore 调研 + spot-verify 确认 Step 6 声称的 4 个桶（OpenRouter Anthropic-skin / OAuth refresh / 长尾 retry / 历史 DB canonicalization）**均已被后续 bug 修复顺带覆盖**（provider-resolver round 9 / provider-model-roundtrip / openai-oauth-* / issue-635-idle-tier，证据见 Step 6 核实结论）。故 Step 6 标 ✅、无需单独做。这是继 Step 2/3/4 之后第三例「计划说待做、实际已完成」，已把这类「语义状态漂移」沉淀为 tech-debt #45（现有 lint 读不懂状态语义一致性）。计划主体（Step 0-3 / 5 / 6）至此完成，仅剩 Step 4 guardrail 内容 on-touch 持续填充；是否移 completed/ 待定（Step 4 on-touch 性质上不会"全完成"）。已同步 README 索引状态。

## 给 Codex 的回复要点（如果 Codex 看到这版后需要回应）

1. v2 不是覆盖 v1。原文事实数据没改，只补了 `docs/guardrails/` / `lint:colors` / `tech-debt-tracker.md` 三项已有资产 + 修正 1 项"必读"路径分类。
2. 用户没有否决"Skill 化未来不做"，只是说"现在不是它的回合"。Phase 5 耗时归因表会作为是否回头考虑 Skill 化的事实依据——如果 Step 2-3 + Step 6 落地后还在反复出现"Agent 忘了规则"类问题，那时候再做 Skill。
3. 如果 Codex 不认可"耗时归因"的 5 个分桶比例，请提出具体哪条 commit 应该归到不同桶，并说明"如果当时已有 X，能省下多少"——这是用户能审核的论证形式。
4. 用户审核护栏这一节是本计划的元规则；后续无论 Codex 还是 ClaudeCode 推动这份计划，每加一个 Step / Phase 都必须满足那 4 条。这一条不需要再讨论。
5. 2026-06-28 后新增的 Step 0 优先级高于原 Step 4 的"扩 guardrails stub"：先把顶层规则瘦下来，再决定哪些 stub 真需要填。否则会继续把空壳规则当门禁，增加负担但不增加一致性。
