> **Archive note（2026-06-05，document-system-governance）**：本治理计划 Phase 0-5 已全部执行——active 语义清理（23→3）、建立 `deferred/` / `superseded/` 目录、归档合并/preview 旧计划、结构化 docs-drift lint 防线；收尾再修复归档桶内 21 处失效的相对链接，并把"归档桶内部链接完整性"纳入同一条 lint。治理完成后本文件自身移出 `active/`、归入 `completed/`（active 随之 3→2），作历史执行记录保留。当前任务入口见 [exec-plans README](../README.md)。

# Document System Governance / 文档体系治理

> 创建时间：2026-06-05  
> 最后更新：2026-06-05  
> 触发：用户要求统计文档数量、文档/代码比例、过时文档数量，并希望按结论治理文档体系。  
> 可视化输入：[visual-reports/document-health-dashboard/index.html](../../../visual-reports/document-health-dashboard/index.html)

## 背景

CodePilot 的文档体系已经成为驱动 Codex / Claude Code 协作开发的核心基础设施。它不是“附属说明”，而是任务入口、历史判断、技术债务和交接记忆的共同来源。

本次审计发现：文档量本身不失控，真正的问题是 `docs/exec-plans/active/` 语义被污染。当前 active 里混着：

- 真的当前计划
- 已经完成但未归档的发布 / 合并计划
- 被 `refactor-closeout` 接管的 superseded 旧计划
- 明确暂缓但仍在 active 的长期想法

这会直接影响 AI 协作：Claude Code / Codex 可能从旧 active 文档里捡到过期任务，重复开支线，或者误读当前优先级。

## 审计基线

统计口径分两层，避免把外部参考包文档和 CodePilot 自有文档混在一起：

- **全仓跟踪文档**：`git ls-files -z` 中所有 `.md / .mdx / .txt / .rst / .adoc`。
- **CodePilot 自有文档**：全仓跟踪文档中排除 `资料/` 下第三方参考包的文档。

> 注意：不要用 `git ls-files '*.md' '*.mdx' | wc -l` 作为唯一口径。Git 在当前配置下会把 `资料/` 里的非 ASCII 路径 quote 成 C-style 字符串，普通 Node/path 统计容易把这 18 份第三方文档排除掉。下面给出可复现脚本。

可复现统计命令：

```bash
node <<'NODE'
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const files = cp.execFileSync('git', ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
const docExt = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const codeExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.json', '.yml', '.yaml', '.toml', '.html']);
const docs = files.filter((f) => docExt.has(path.extname(f).toLowerCase()));
const ownedDocs = docs.filter((f) => !f.startsWith('资料/'));
const code = files.filter((f) => codeExt.has(path.extname(f).toLowerCase()) && !docExt.has(path.extname(f).toLowerCase()));
const ownedCode = code.filter((f) => !f.startsWith('资料/'));
const loc = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).length;
const sum = (xs) => xs.reduce((n, f) => n + loc(f), 0);
console.log({
  docs: docs.length,
  docsLoc: sum(docs),
  ownedDocs: ownedDocs.length,
  ownedDocsLoc: sum(ownedDocs),
  thirdPartyDocs: docs.length - ownedDocs.length,
  code: code.length,
  codeLoc: sum(code),
  ownedCode: ownedCode.length,
  ownedCodeLoc: sum(ownedCode),
  ownedDocCodeLocRatio: (sum(ownedDocs) / sum(ownedCode)).toFixed(3),
});
NODE
```

| 指标 | 数量 |
|------|------|
| 全仓跟踪文档总数 | 261 |
| 全仓跟踪文档总行数 | 62,257 |
| CodePilot 自有文档总数 | 243 |
| CodePilot 自有文档总行数 | 56,666 |
| 第三方参考包文档 | 18 / 5,591 行 |
| CodePilot 自有代码/配置文件总数 | 1,119 |
| CodePilot 自有代码/配置总行数 | 264,578 |
| 自有文档 / 自有代码文件数比例 | 0.217（约 1:4.6） |
| 自有文档 / 自有代码行数比例 | 0.214（约 1:4.7） |

### 文档分布

| 区域 | 文件数 | 行数 | 判断 |
|------|------:|------:|------|
| `docs/research/` | 42 | 11,693 | 正常，历史调研价值高 |
| `docs/handover/` | 41 | 9,043 | 正常，是 AI 交接主入口 |
| `docs/exec-plans/completed/` | 37 | 12,811 | 正常，历史执行日志 |
| `apps/site/content/docs/` | 36 | 3,544 | 正常，对外文档 |
| `docs/exec-plans/active/` | 23 | 9,181 + 本计划 | **需要治理** |
| `docs/insights/` | 22 | 3,288 | 正常，洞察归档 |
| `docs/guardrails/` | 13 | 1,231 | 正常，但 stub 比例仍高 |
| `docs/future/` | 8 | 1,768 | 正常，未来方向 |
| `docs/preview/` | 4 | 602 | 需要标 archive 语义 |

## 当前判断

| 类型 | 数量 | 处理方向 |
|------|------:|----------|
| 硬过时 | 6 | 应更新状态并移出 active |
| Superseded 但仍在 active | 7 | 移到 `superseded/` 或归档，并由 README 明确“历史参考” |
| 暂缓但仍在 active | 7 | 移到 `deferred/`，保持可读但不作为当前任务入口 |
| 真正当前 | 约 3 | 保留在 active（`issue-tracker` / `development-harness-optimization` / 本治理计划） |

## 状态

| Phase | 内容 | 状态 | 用户能看到什么 |
|-------|------|------|----------------|
| Phase 0 | 审计基线 + 可视化看板 | ✅ 已完成（落地于 `ac96139`） | 有独立 HTML 看板可快速理解文档健康状态 |
| Phase 1 | 定义目录语义 + 让 docs drift 认识新目录 | ✅ 已完成（`ac96139`） | `active / completed / deferred / superseded` 四类入口已建立，规则未先收紧 |
| Phase 2 | 搬迁硬过时 / superseded / deferred 文档 | ✅ 已完成（`1f7b8ea` 14 份 + `93d2f52` 6 份） | `active/` 只剩 3 个真正当前工作入口 |
| Phase 3 | preview 文档 archive 化 | ✅ 已完成（`fc13b98`） | 旧 preview.5 说明已标历史归档，不会被误读为当前测试入口 |
| Phase 4 | 收紧结构化 lint 防线 | ✅ 已完成（`5f5c08f`，含 self-check + fixture 实测） | 以后把 superseded / deferred banner 放进 active，提交即被拦 |
| Phase 5 | 更新索引、交接说明和可视化看板 | ✅ 已完成（本提交） | 看板加「治理已执行」横幅、active 不再大片红；README 目录语义 + lint + 看板三者一致 |

## Phase 0 — 审计基线 + 可视化看板

### 用户能看到什么

用户可以打开一个独立 HTML 看板，看到：

- 当前文档数量
- 文档/代码比例
- 文档分布
- 过时风险
- active 目录实际状态
- 最该处理的 6 份文档

### 不做什么

- 不把看板混进产品代码。
- 不把看板放进正式 docs 索引。
- 不用外部依赖或构建步骤。

### 怎么验收

打开：

```text
visual-reports/document-health-dashboard/index.html
```

确认页面能读懂“文档量不失控，active 语义污染才是问题”。

### 实现路径

> 此部分用户不需审核，仅 Codex / ClaudeCode 对齐用。

- `visual-reports/document-health-dashboard/index.html`
- 纯静态 HTML / CSS。
- 数据来自 `git ls-files` 审计结果。

## Phase 1 — 定义目录语义 + 让 docs drift 认识新目录

### 用户能看到什么

`docs/exec-plans/` 会变成更清楚的四类入口：

- `active/`：真的当前推进，Claude Code 可以从这里领任务。
- `completed/`：已完成，有历史证据。
- `deferred/`：用户明确暂缓，未来可能重启。
- `superseded/`：被新计划接管，仅作历史参考。

### 不做什么

- 不删除历史判断。
- 不重写大段旧计划内容。
- 不把所有旧文档一次性压缩成摘要。
- **本阶段不启用“active 中禁止 superseded/deferred 顶部标记”的严格规则**，避免文件还没搬走时制造必红窗口。

### 怎么验收

- `docs/exec-plans/README.md` 的索引里能一眼看出四类目录。
- `npm run lint:docs-drift` 通过。
- `npm run lint:docs-drift` 在新目录还为空时也通过。
- README 解释四类目录的语义。

### 实现路径

> 此部分用户不需审核，仅 Codex / ClaudeCode 对齐用。

- 新建目录：
  - `docs/exec-plans/deferred/`
  - `docs/exec-plans/superseded/`
- 更新 `scripts/lint-docs-drift.mjs`：
  - 识别 active / completed / deferred / superseded。
  - 本阶段只做目录索引同步和表格结构校验。
  - **不要**在本阶段全文 grep `Superseded by` / `本轮重构暂缓` / `⏸` 并 fail。
  - README 表格列数校验保留。
- 更新 `docs/exec-plans/README.md` 索引结构。

## Phase 2 — 搬迁硬过时 / superseded / deferred 文档

### 用户能看到什么

打开 `active/` 时，不会再看到“合并前计划”“preview 发布前计划”“已被接管计划”“明确暂缓计划”。当前工作入口更干净。

### 不做什么

- 不改业务代码。
- 不重新评估这些计划的技术内容。
- 不把已发布历史伪装成仍需执行。

### 怎么验收

以下 6 份硬过时文档不再留在 `active/`：

| 文件 | 处理方向 |
|------|----------|
| `active/refactor-closeout.md` | 移到 `completed/`，作为重构收口历史 |
| `active/main-merge-readiness.md` | 移到 `completed/`，标注 main 已合并并发布 |
| `active/preview-build-readiness.md` | 移到 `completed/` 或 `superseded/`，标注 0.55.1 已发布 |
| `active/preview-final-blockers.md` | 移到 `completed/`，标注 blocker 已收口 |
| `active/merge-blockers-chat-ownership-openrouter.md` | 移到 `completed/`，标注 #37 已修 |
| `active/phase-7b-macos-native-visual-profile.md` | 默认移到 `completed/`，因为 Phase 0-2 + 7c 已落地，Phase 3-5 用户决定不做；若执行前用户重新要求 macOS 视觉继续推进，则改入 `deferred/` |

以下 7 份 superseded 进入 `superseded/`：

- `agent-runtime-abstraction-revision.md`
- `agent-sdk-0-2-111-adoption.md`
- `agent-trust-ownership-refactor.md`
- `chat-latency-remediation.md`
- `context-storage-migration.md`
- `opus-4-7-upgrade.md`
- `scheduled-tasks-notifications.md`

以下 7 份 deferred 进入 `deferred/`：

- `chat-run-checkpoint.md`
- `memory-system-v3.md`
- `site-and-docs.md`
- `weixin-bridge-channel.md`
- `qq-bridge-channel.md`
- `unified-context-layer.md`
- `git-terminal-integration.md`

`development-harness-optimization.md` 明确保留在 active：它仍是当前协作流程优化的讨论稿，不归 deferred。

### 实现路径

> 此部分用户不需审核，仅 Codex / ClaudeCode 对齐用。

- 使用 `git mv` 保留历史。
- 每份文件顶部补一段 `Archive note`：
  - 为什么移出 active。
  - 当前替代入口是什么。
  - 若未来重启，从哪里开始。
- 更新 README 索引。

## Phase 3 — preview 文档 archive 化

### 用户能看到什么

`docs/preview/` 明确表示：这里是历史测试包记录，不是当前下载入口。用户不会再把 preview.5 文档当成现在该装的版本。

### 不做什么

- 不删除 preview 历史。
- 不改 GitHub Release。
- 不重新发布包。

### 怎么验收

- `docs/preview/README.md` 顶部明确写“历史预览包归档”。
- `internal-test-0.55.0-preview.5.md` 明确标为 archive。
- `branch-preview-2026-05-31.md` 继续保留“已废弃 / 不分发”。

### 实现路径

> 此部分用户不需审核，仅 Codex / ClaudeCode 对齐用。

- 可选新建 `docs/preview/archive/` 并 `git mv` 旧 preview 文档。
- 或保留原目录但统一加 `Archive` 标记。
- 更新 `docs/preview/README.md`。

## Phase 4 — 收紧结构化 lint 防线

### 用户能看到什么

以后如果有人把“已被接管”或“已暂缓”的计划留在 `active/`，提交会直接失败，并指出应该移到哪个目录。

### 不做什么

- 不做全文关键词匹配。
- 不把讨论这些关键词的治理计划误判为违规。
- 不维护越来越长的 allowlist。

### 怎么验收

- `npm run lint:docs-drift` 通过。
- 在临时分支 / 临时 fixture 中构造一个 active 文档，文件顶部写 superseded/deferred banner，lint 会失败。
- 在 active 文档正文中讨论这些词，lint 不失败。

### 实现路径

> 此部分用户不需审核，仅 Codex / ClaudeCode 对齐用。

结构化检测只看文件顶部区域，不看全文：

- 读取文件前 12 行或第一个 heading 后的连续 blockquote banner。
- 仅当顶部 banner 命中以下结构信号时 fail：
  - `^> .*Superseded by`
  - `^> ⚠️ .*Superseded`
  - `^> ⏸`
  - `^> .*本轮重构暂缓`
- 正文中出现这些字符串不算违规。
- 建议给 `scripts/lint-docs-drift.mjs` 增加小型 fixture 测试或内置 self-check。

## Phase 5 — 更新索引、交接说明和可视化看板

### 用户能看到什么

最后会有一个新的“干净版”看板：active 目录不再大片红色，文档健康状态更接近真实可维护状态。

### 不做什么

- 不把看板作为永久产品功能。
- 不要求每次提交都手动更新 HTML。
- 不把这次治理扩大成全仓文档重写。

### 怎么验收

- `npm run lint:docs-drift` 通过。
- `rg "Superseded by|本轮重构暂缓|0.55.0-preview" docs/exec-plans/active docs/preview` 的结果符合预期；若本治理计划正文仍讨论这些词，不算违规。
- `visual-reports/document-health-dashboard/index.html` 更新后的结论仍能自洽。
- `docs/exec-plans/README.md` 是唯一可信索引。

### 实现路径

> 此部分用户不需审核，仅 Codex / ClaudeCode 对齐用。

- 更新 `visual-reports/document-health-dashboard/index.html` 数字。
- 如需持续使用，可后续再把看板生成脚本化；本轮不做。
- 补充 `docs/exec-plans/README.md` 的目录语义说明。

## Smoke Ledger（文档治理验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|----------|------|--------|----------|
| 2026-06-05 | docs | n/a | n/a | n/a | 文档体系统计基线 | ✅ | 261 tracked docs / 243 CodePilot-owned docs / owned doc-code LOC ratio 0.214 / visual report generated |

## 决策日志

- 2026-06-05：用户要求统计文档数量、文档与代码比例、过时文档数量。Codex 审计后判断：文档量本身健康，主要问题是 `active/` 目录语义污染。
- 2026-06-05：用户要求生成可视化看板。Codex 将其放到 `visual-reports/document-health-dashboard/`，不混入正式 docs 索引。
- 2026-06-05：Claude Code review 指出两处关键问题：第一，若用全文关键词检测 active 文档，本治理文档自己会触发 lint 自爆；第二，若先收紧 lint 再搬文件，会制造“中间提交必红”的窗口。Codex 接受该 review，调整为：先让 lint 认识新目录但不收紧；再搬文件；最后用结构化顶部 banner 检测收紧规则。
- 2026-06-05：审计数字拆成两层口径。全仓跟踪文档为 261；排除 `资料/` 第三方参考包后，CodePilot 自有文档为 243。后续看板和文档同时展示这两个数。

## 给 Claude Code 的执行说明

你要执行的是文档治理，不是业务重构。

请先读：

1. `docs/exec-plans/README.md`
2. 本文件
3. `visual-reports/document-health-dashboard/index.html`

执行原则：

- 每个 Phase 独立 commit。
- 先升级 README / docs-drift 目录语义，但不要先启用 active 顶部标记 fail。
- 搬迁完成后再启用结构化 lint 防线。
- 所有移动用 `git mv`。
- 不删除历史文档。
- 不改业务代码。
- 不碰 release / tag / push。
- 每个 commit 前跑 `npm run lint:docs-drift`；改 lint 脚本时额外跑 `npm run lint:hooks`。
