> **Archive note（2026-06-05，document-system-governance）**：本计划已完成并移出 `active/`，归入 `completed/`——main 已合并重构分支并发布 v0.55.0 / v0.55.1，合并演练与回滚方案已执行完毕。作为历史执行记录保留；当前任务入口见 [exec-plans README](../README.md)。

# Main Merge Readiness / 重构分支合并主分支计划

> 创建时间：2026-06-03
> 最后更新：2026-06-04
> 范围：`worktree-product-refactor-research` → `main`
> 工作目录：`/Users/op7418/Documents/code/opus-4.6-test/.claude/worktrees/product-refactor-research`

## 用户会看到什么

- 主分支从旧版公告 / 预览分支状态，切换到已经完成重构的正式候选状态。
- 内测用户反馈过的 P0/P1 问题在合并前有明确 smoke 入口：Codex 启动、Claude Code 模型加载、Windows Codex `.cmd`、中断后再发送、Windows 单实例托盘、服务商编辑弹窗、MiMo 型号、Feishu 日志。
- 合并后仍不自动发布正式版；先进入测试版本 / release candidate 验证，再决定是否发正式更新。

## 本计划不做什么

- 不自动 `git push`。
- 不自动 merge 到 main。
- 不在主分支修改功能代码。
- 不把未验证的 Windows/macOS 真机项包装成已验证结论。
- 不把 preview-only Release 当作正式自动更新渠道。

## 当前状态快照

| 项 | 状态 | 备注 |
|----|------|------|
| Worktree 分支 | ✅ clean（本提交后） | `worktree-product-refactor-research` 最新提交 `bd7b1fd`（侧栏新建入口 `a1c9997` / 来源建模 strip `403415e` / tech-debt #37 模型 round-trip 修复 `b6d2e43`+`0f73a5f`）|
| 主分支 | ✅ clean（2026-06-04 已处理）| 原 12 行未提交草稿（#11-#22 preview blocker 登记）已 strip：#569 迁入 worktree `issue-tracker.md` B-023，其余已修复或 GitHub issue 永久记录；当前 `git -C <main> status` = `## main...origin/main` 无修改 |
| 本机单元测试 | ✅ | `npm run test`：`3233/3233 pass`（含 `provider-model-roundtrip` 回归）|
| 本机 smoke | ✅ 16/16 | `ba2230d` 后重跑 Playwright `@smoke` 全绿（Settings 概览 `codex_account/models` 404 已闭环）|
| Codex 状态 | ✅ | 本机 `/api/codex/status` 返回 ready，Codex Desktop `0.135.0-alpha.1` |
| Chat 输入框 | ✅ | 本机探针未卡在“正在准备运行环境” |

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 合并前冻结与脏状态处理 | ✅ 已完成（2026-06-04）| main + worktree 均 clean；主分支 tracker 草稿已 strip（#569→B-023）|
| Phase 1 | Worktree 最终验证 | 📋 待开始 | 单测 + smoke + 关键 API 探针 |
| Phase 2 | 建 integration 分支合并演练 | 📋 待开始 | 推荐先在 `merge/refactor-preview-to-main` 演练，不直接动 main |
| Phase 3 | 冲突解决与回归测试 | 📋 待开始 | 重点看 README / docs index / package-lock / Electron build files |
| Phase 4 | 真机 preview 包验证 | 📋 待开始 | macOS arm64 + Windows 包；不触发自动升级 |
| Phase 5 | 主分支正式合并 | 📋 待开始 | 只有 Phase 1-4 通过后执行 |
| Phase 6 | 合并后观察与回滚预案 | 📋 待开始 | release candidate / tester-only channel |

## 决策日志

- 2026-06-03: 合并采用 integration branch 演练，而不是直接在 `main` 上 merge。原因：本次 diff 巨大（约 791 files changed），且主分支已有 README 预览公告提交，先演练能把冲突、文档索引和打包配置风险隔离出来。
- 2026-06-03: 主分支当前 dirty 文件 `docs/exec-plans/tech-debt-tracker.md` 不自动处理。合并前由用户决定：提交、stash、丢弃，或让 Claude Code 单独整理。
- 2026-06-03: Preview 包继续 tester-only，不接正式自动更新通知。原因：Windows / macOS 真机反馈仍是最后一道门，正式发版前需要至少一轮小范围稳定性观察。
- 2026-06-04: merge-blockers 收口——侧栏新建对话入口已交付（`a1c9997`）；对话来源建模按用户否决 strip（tech-debt #38，两空 DB 列因禁破坏性迁移保留）；OpenRouter"无法发送"本机复现不到，真实缺陷是静默 Opus→Sonnet 模型 round-trip（tech-debt #37，已修 `b6d2e43`+`0f73a5f`，de19e576 真机正向确认）。issue-tracker 中 B-020/B-021/B-022 已按提交对齐状态。
- 2026-06-04: **主分支 tech-debt-tracker.md 编号冲突预警**。主分支本地未提交草稿加了 #11-#22（preview blocker 登记），而 worktree tracker 的 #11-#22 是另一批债务条目——直接 merge 会在 tracker 上产生大量冲突且语义错乱。这些 preview blocker 大多已在 worktree 修复（`8ea4b82`…`ea860da`）并由 issue-tracker / preview-final-blockers 计划承载。建议合并前由用户在主分支 **stash 或丢弃**这 12 行草稿（确认 issue-tracker 已覆盖同一批问题后），让 merge 直接采用 worktree 的 tracker；不要让两套 #11-#22 合体。
- 2026-06-04: **主分支 tracker 草稿已 strip + #37 复审通过**。用户授权后主分支 12 行未提交草稿已 `git checkout --` 丢弃（唯一 worktree 未覆盖的 #569 已迁入 issue-tracker B-023，commit `ed83d66`）；main 现 clean。Codex 复审确认 #37（OpenRouter/Opus 静默切 Sonnet）修复通过 → tech-debt #37 标 ✅ 已解决。Phase 0 完成。`git merge-tree` 探针确认硬冲突集中在 4 个文件：`package.json` / `package-lock.json` / `src/app/api/providers/models/route.ts` / `src/components/settings/provider-presets.tsx`（版本 / 依赖 / 模型目录 / preset，两侧都动过），须在 integration 分支手动解。

## 合并前已知问题（非阻断，随测试版发布说明公示）

Codex 复审 2026-06-04 提出：以下已记录、不挡合并，但发测试版时要写进"已知问题"：

- **B-021 Windows 服务商编辑关闭按钮**：双 X 贴脸已修（`2646f23`），"点击无效"待 Windows packaged 真机终验。
- **B-022 消息队列**：中断后发送无响应已修（`fcce794` / #578）；"streaming 期间继续排队"待专项 smoke。
- **B-023 MCP 设置页可见但运行时不可调用**（#569）：属合并后问题，排查 runtime MCP 注入来源 vs 运行状态 UI 来源。

## Phase 0 — 合并前冻结与脏状态处理

### 用户能看到什么

无 UI 变化。目标是把 Git 状态整理干净，避免大合并夹带孤立文档改动。

### 操作

1. 主分支检查：

```bash
cd /Users/op7418/Documents/code/opus-4.6-test
git status --short
git log --oneline -5
```

2. 处理主分支 dirty 文件：

```text
当前已知：docs/exec-plans/tech-debt-tracker.md modified
```

可选处理方式：

- 如果是有效技术债记录：单独 commit 到 main。
- 如果只是草稿：stash，等合并后再恢复。
- 如果无效：由用户明确允许后丢弃。

3. worktree 冻结：

```bash
cd /Users/op7418/Documents/code/opus-4.6-test/.claude/worktrees/product-refactor-research
git status --short
git log --oneline -8
```

验收：两个目录都没有未解释的 untracked / modified 文件。

## Phase 1 — Worktree 最终验证

### 用户能看到什么

确认当前分支本身健康，不把已知 P0/P1 带进合并。

### 必跑命令

```bash
cd /Users/op7418/Documents/code/opus-4.6-test/.claude/worktrees/product-refactor-research
npm run test
PORT=3001 npm run dev
PLAYWRIGHT_BASE_URL=http://localhost:3001 PORT=3001 npm run test:smoke
```

### 重点验收

| 场景 | 预期 |
|------|------|
| `/settings/overview` | console 不再出现 `GET /api/providers/codex_account/models?all=1` 404 |
| `/settings/runtime` | Codex 显示 installed/ready/degraded 中的明确状态，不无限检测中 |
| `/chat` | 输入框不长期显示“正在准备运行环境” |
| Claude Code runtime | 能列出模型，裸 `sonnet` 不再发到上游 |
| Codex runtime | 不带 `--listen`，坏 binary 失败要快速失败，不拖 30s |

### 可选探针

```bash
node -e "fetch('http://localhost:3001/api/codex/status').then(r=>r.text()).then(console.log)"
node -e "fetch('http://localhost:3001/api/providers/codex_account/models?all=1').then(r=>console.log(r.status)).catch(console.error)"
```

第二条在 `ba2230d` 后不应由 Settings 概览触发；如果手动请求仍 404，属于 API 行为，不一定是 UI bug。

## Phase 2 — 建 integration 分支合并演练

### 用户能看到什么

仍无 UI 变化。我们先在临时分支验证合并可行性。

### 推荐操作

```bash
cd /Users/op7418/Documents/code/opus-4.6-test
git switch main
git status --short
git branch backup/main-before-refactor-merge-2026-06-03
git switch -c merge/refactor-preview-to-main
git merge --no-ff worktree-product-refactor-research
```

### 冲突高风险文件

| 区域 | 为什么高风险 |
|------|--------------|
| `README.md` / `README_CN.md` | 主分支刚更新预览下载公告；worktree 可能有旧重构公告上下文 |
| `docs/exec-plans/README.md` | active/completed 索引大量移动 |
| `docs/exec-plans/tech-debt-tracker.md` | 主分支本地已有未提交改动 |
| `package.json` / `package-lock.json` | preview version / 依赖 / scripts 变化 |
| `.github/workflows/*.yml` | preview build/release workflow 与正式 build workflow 同时变化 |
| `electron-builder.yml` / `electron/main.ts` | 打包、Tray、Windows installer、single-instance |
| `next.config.ts` / `cache-handler.js` | packaged standalone Windows 写盘问题 |

验收：integration 分支合并完成，冲突解决后 `git status` 只剩预期合并文件。

## Phase 3 — 合并后回归测试

### 必跑

```bash
npm run test
npm run lint:docs-drift
npm run lint:hooks
```

### UI / 本机 smoke

```bash
PORT=3001 npm run dev
PLAYWRIGHT_BASE_URL=http://localhost:3001 PORT=3001 npm run test:smoke
```

### Electron / packaged 前验证

```bash
node scripts/build-electron-dev.mjs
PORT=3001 npx electron .
```

手工看：

- macOS 菜单栏 template icon 清晰。
- Codex 可进入 ready / installed idle / degraded 明确状态。
- Chat 输入框不被 Runtime catalog 阻塞。
- Settings Provider 编辑弹窗 close button 不在 macOS 回归。

## Phase 4 — 真机 preview 包验证

### 构建原则

- macOS：Apple Silicon / arm64。
- Windows：Windows runner / Windows 真机产物，不在 macOS 上跨编 Windows native module。
- 版本号：必须高于 `0.54.0`，继续使用 preview semver。
- Release：tester-only prerelease，不触发正式自动升级。

### 建议 GitHub Actions

触发 preview workflow：

```text
preview_version = 0.55.0-preview.N
build_macos_arm64 = true
build_windows_x64 = true
commit_sha = integration branch HEAD
```

### macOS 真机验收

| 场景 | 预期 |
|------|------|
| 安装替换旧版 | 版本显示 preview.N，不显示旧 0.53/0.54 |
| Codex 已安装但未启动 | Settings 不无限“检测中” |
| Codex ready | 可以正常进入可用状态 |
| Claude Code | 模型加载完成，输入框不长期“准备运行环境” |
| Tray/Menu bar icon | 浅色/深色模式都可见 |
| Full Access | 开启后连续发送不再每条确认 |

### Windows 真机验收

| 场景 | 预期 |
|------|------|
| 安装器 | 可选择安装目录 |
| Codex `.cmd` | 不再 `spawn EINVAL` |
| 启动 | 不因 `.next/cache` EPERM 崩溃 |
| 多次打开 | 不重复增加托盘图标 / 后台进程 |
| Provider 编辑弹窗 | 系统 X 与应用 X 不贴脸 |
| 中断后再发 | 输入框可恢复发送 |
| shell 方言 | 默认 PowerShell，不生成 bash-only 命令 |

## Phase 5 — 主分支正式合并

只有以下全部满足后执行：

- Phase 0 主分支 clean。
- Phase 1 worktree smoke 通过。
- Phase 2 integration merge 成功。
- Phase 3 integration 回归通过。
- Phase 4 至少一台 macOS + 一台 Windows 真机 preview smoke 通过。

建议命令：

```bash
cd /Users/op7418/Documents/code/opus-4.6-test
git switch main
git merge --ff-only merge/refactor-preview-to-main
```

如果不能 fast-forward，说明 main 在此期间又前进了：回到 Phase 2 重新建 integration merge。

## Phase 6 — 合并后观察与回滚预案

### 合并后立刻做

- 更新 README 下载链接到最新 tester-only prerelease。
- 在 tester 文档里保留“反馈 P0/P1 的表单入口”。
- 收集 24-48 小时反馈，不立即推正式自动更新。

### 回滚

如果出现阻断级问题：

```bash
git switch main
git reset --hard backup/main-before-refactor-merge-2026-06-03
```

如果 main 已 push，则改用 revert：

```bash
git revert -m 1 <merge_commit>
```

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| 2026-06-03 | local dev | Codex | — | local Codex.app | `/api/codex/status` | ✅ | ready: `Codex Desktop/0.135.0-alpha.1` |
| 2026-06-03 | local dev | UI | — | — | `/chat` 输入框 | ✅ | submit button present; no long “准备运行环境” |
| 2026-06-03 | local dev | UI | — | — | Playwright `@smoke` before `ba2230d` | ⚠️ | 15/16; Settings overview `codex_account/models` 404 |
| 2026-06-03 | local dev | UI | — | — | Playwright `@smoke` after `ba2230d` | ✅ | 16/16；codex_account 404 闭环 |
| 2026-06-04 | local dev | OpenRouter | anthropic/claude-opus-4.7 | — | tech-debt #37：重开 de19e576 模型显示/下拉 | ✅ | 修复前 composer Sonnet 4.6 → 修复后 Opus 4.7；下拉渲染全部 provider 分组、console 干净 |
| _待跑_ | packaged macOS arm64 | Claude Code | sonnet | real credential | first-turn chat | 📋 | |
| _待跑_ | packaged macOS arm64 | Codex | gpt / codex account | real login | app-server ready + chat | 📋 | |
| _待跑_ | packaged Windows | Codex | — | installed `.cmd` shim | app-server startup | 📋 | |
| _待跑_ | packaged Windows | UI | — | — | installer path / tray / provider dialog | 📋 | |

## 给 Claude Code 的执行说明

```text
你已经在 worktree-product-refactor-research 分支内。请先阅读：
docs/exec-plans/completed/main-merge-readiness.md

不要 push，不要合 main，不要动主目录代码。

本次目标不是继续开发功能，而是按计划做合并前 readiness：
1. 先确认 worktree clean，并重跑 ba2230d 后的 smoke；
2. 记录 smoke 结果到 Smoke Ledger；
3. 检查主分支是否仍有 dirty 文件；
4. 如果用户明确授权，再建 integration 分支演练 merge；
5. 所有发现都按 Signal → Triage → Fix → Verify → Guardrail 记录。

注意：主分支当前已知可能有 docs/exec-plans/tech-debt-tracker.md 未提交改动，不能自动处理。
```
