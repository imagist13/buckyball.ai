# Craft Agents 文档体系对标调研

> 调研日期：2026-04-16
> 对标仓库：`/Users/op7418/Documents/code/资料/craft-agents-oss-main`（craft-agents-oss，Apache-2.0，Electron + Bun monorepo）
> 目的：考察一个同品类开源项目（Agent 桌面客户端）如何组织文档，产出 CodePilot 文档体系可借鉴的具体动作清单。
> 三层结构：**[craft 事实]** 带 `file:line`；**[CodePilot 事实]** 带仓库内路径；**[推断]** 标注。
>
> **范围注记**：本文聚焦 craft 的**对外治理文档**（README / CONTRIBUTING / ISSUE_TEMPLATE 等）。craft 作为"文档驱动 Agent"在**运行时内部的 Markdown 实现**（渲染栈 / 编辑器 / Artifact 化代码块 / Tiptap 使用姿势），单独调研见 [craft-agents-markdown-internals.md](./craft-agents-markdown-internals.md)。

---

## 1. 调研动机

CodePilot 已经形成相对完整的内部文档链（`exec-plans/` + `research/` + `handover/` + `insights/`），但面向**外部用户与社区贡献者**的文档尚薄弱（无 Issue 模板、无 PR 模板、README 未嵌入项目结构图）。本次对标选 craft-agents-oss，因为它与 CodePilot 定位几乎重合（Electron Agent 客户端 + CLI + 远程服务端），但走的是公开开源路线，面向外部读者的治理文档更完整。

对标目标：
1. 抽出 craft 做得好而 CodePilot 缺失的"外部入口"文档形态。
2. 确认 CodePilot 现有"内部研发"文档链是否真的更强（避免反向学习）。
3. 产出可执行的借鉴清单。

---

## 2. Craft 文档体系（craft 事实）

### 2.1 顶层文件清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `README.md` | 635 | 用户旅程型总览：Why → Install → Quick Start → Features → Troubleshooting → License |
| `CONTRIBUTING.md` | 121 | 分支命名规范 + PR 内容要求 |
| `SECURITY.md` | 58 | 漏洞上报流程 |
| `CODE_OF_CONDUCT.md` | 26 | 社区行为准则 |
| `TRADEMARK.md` | 100 | 品牌与商标使用规则（fork 约束） |
| `NOTICE` | 15 | 第三方许可声明 |
| `LICENSE` | 191 | Apache-2.0 完整文本（先前版本误把字节数 10770 当作行数） |
| `docs/cli.md` | 240 | CLI 命令完整参考 |

### 2.2 README 的用户旅程型结构

一级/二级标题顺序（仅列代表性章节）：

- `# Craft Agents`（`README.md:1`）
- `## Why Craft Agents was built`（`:14`）
- `## Things that are hard to believe "just work"`（`:27`）
- `## Installation`（`:61`）
- `## Quick Start`（`:101`）
- `## Features`（`:84`）
- `## Remote Server (Headless)`（`:150`）
- `## CLI Client`（`:244`）
- `## Supported LLM Providers`（`:455`）
- `## Configuration`（`:486`）
- `## Tech Stack`（`:569`）
- `## Troubleshooting`（`:581`）

**关键手法**：在 README 正文里直接嵌入一段 **ASCII 项目结构树**（`README.md:345-365`），承担"架构概览"职能，没有独立的 `ARCHITECTURE.md`。

### 2.3 `docs/` 目录极简

```
docs/
└── cli.md                 # 仅 1 份文档，240 行
```

[推断] craft 刻意把"文档"收敛到三类位置：顶层 `README.md`、子项目 `README.md`、`docs/cli.md`。**没有** 任何分类目录（无 `docs/architecture/`、无 `docs/decisions/`、无 `docs/guides/`）。

### 2.4 子项目 README 分布极不均衡

| 路径 | README 长度 | 说明 |
|------|------------|------|
| `apps/electron/README.md` | 291 行 | **最详尽**：架构树、构建流程、"Key Learnings & Gotchas" |
| `apps/cli/` | — | 无独立 README，文档外移到 `docs/cli.md` |
| `apps/viewer/` | — | 无 README |
| `apps/webui/` | — | 无 README |
| `packages/core/README.md` | 100 行 | 导出类型清单，无使用示例 |
| `packages/server-core/README.md` | 18 行 | 仅写明"out of scope"，对集成者无效 |
| `packages/shared/` | — | 无 README |
| `packages/server/` | — | 无 README |

[推断] craft 对"用户面向的子项目"（如 electron app）文档厚重，对"内部库"（shared / server / webui）直接省略。属于**选择性投入**，不是全面覆盖。

### 2.5 `apps/electron/README.md` 的值得抄的段落

- **嵌入式架构树**：`apps/electron/README.md:16-46` 用 ASCII 树列出 `src/` 下关键模块与各自职责一行注释。
- **"Key Learnings & Gotchas" 段**：`apps/electron/README.md:49-125` 列举 SDK 路径解析、认证、类型不匹配等实战坑点，每条 3–8 行，属于**高浓度知识浓缩**。
- **"See CLAUDE.md for complete route reference"**：`apps/electron/README.md:262` 实际上这份 `CLAUDE.md` 在仓库里不存在，属于**已失效的跨文档引用**（craft 无任何文档链接校验）。

### 2.6 社区治理文件

`.github/` 目录结构：

```
.github/
├── ISSUE_TEMPLATE/
│   ├── bug_report.yml          # YAML 格式，强制字段
│   └── feature_request.yml     # YAML 格式，结构化
└── workflows/
    ├── validate.yml            # typecheck + test + doc-tools
    └── validate-server.yml
```

- **YAML 格式 Issue 模板** 强制要求：版本号、OS、AI Provider、复现步骤、调试日志（`bug_report.yml:114-117`）。
- **无 `pull_request_template.md`**（核实结果）。
- `validate.yml:34` 执行 `bun run validate:ci`，覆盖 typecheck + test；**不含** Markdown lint 或链接校验。

### 2.7 运营性文档与图示

- **无 ADR / RFC 目录**。
- **无 `CHANGELOG.md`**（版本变更仅依赖 GitHub Release）。
- **无 `ROADMAP.md`**。
- **无技术债务追踪文件**。
- **无 Mermaid / Excalidraw 图示**；所有"图"都是 ASCII 树或 Markdown 表格。
- 仅一张用户截图 `README.md:25` 引用的外链图片。

### 2.8 CONTRIBUTING 规范约束度

`CONTRIBUTING.md:39-91`：

- ✅ 分支命名前缀强制：`feature/ | fix/ | refactor/ | docs/`。
- ✅ PR 描述要求包含：Summary / Changes / Testing / Screenshots。
- ❌ 未强制 commit message 风格（如 Conventional Commits）。
- ❌ 未强制 DCO / CLA 签署。
- ❌ 未列"文档是否需更新"的检查项。

---

## 3. CodePilot 当前文档体系（本仓库事实）

### 3.1 根目录文档与 `docs/` 目录

当前 `docs/` 结构（已验证）：

```
docs/
├── CLAUDE.md                  # AI 须知的目录约定
├── exec-plans/
│   ├── active/                # 进行中的执行计划
│   ├── completed/             # 已完成
│   ├── README.md              # 模板与规范
│   └── tech-debt-tracker.md   # 技术债务追踪
├── handover/                  # 技术交接（架构、数据流、设计决策）
├── insights/                  # 产品思考（为什么这样设计）
├── research/                  # 调研文档（本目录）
├── future/                    # 待确认的未来方向
├── ui-governance.md           # UI 治理规范
├── generative-ui-article.md
└── 若干 PNG 图
```

根目录重要文件：
- `README.md`、`ARCHITECTURE.md`、`CLAUDE.md`（AI 开发规范与流程纪律）、`RELEASE_NOTES.md`（版本发布必须遵循的严格模板，见 `CLAUDE.md` "发版"章节）。

`.github/` 目录（已验证）：

```
.github/
└── workflows/
```

**没有** `ISSUE_TEMPLATE/`、**没有** `pull_request_template.md`、**没有** `SECURITY.md`、**没有** `CONTRIBUTING.md`、**没有** `CODE_OF_CONDUCT.md`、**没有** `TRADEMARK.md`。

### 3.2 内部研发文档链

CodePilot 在"研发过程沉淀"上比 craft 明显更重：

- `docs/exec-plans/` 把执行计划拆为 active/completed，且独立维护技术债务追踪文件。craft 无对应物。
- `docs/research/` 已积累 26 份调研（见本目录 `README.md`），每份都遵循"外部事实 / 仓库事实（file:line）/ 推断"三层纪律。craft 无任何调研文档。
- `docs/handover/` 与 `docs/insights/` 形成"技术交接 ↔ 产品思考"互链机制，`CLAUDE.md` 强制两者开头反向引用。craft 无此机制。
- `CLAUDE.md` 的"改动自查"五条（i18n / DB / 类型 / 文档 / 新功能文档）属于 **AI 主导开发场景下的预提交纪律**，craft 无 AI 场景相关规则。

### 3.3 外部入口文档链

CodePilot 此侧明显弱于 craft：

- `README.md` 内是否嵌入架构树、是否有"Quick Start"：[推断] 未在本次调研中核验，需后续对照。
- 无 `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`TRADEMARK.md`、`NOTICE`。
- 无 YAML Issue 模板，外部 bug 上报缺少结构化约束（对照项目已发布到公开 GitHub 的现状，这会让 issue 质量波动大）。
- 无 PR 模板。

---

## 4. 双向对比

### 4.1 craft 强于 CodePilot（应借鉴）

| 维度 | craft 做法 | CodePilot 现状 |
|------|-----------|---------------|
| YAML Issue 模板 | `.github/ISSUE_TEMPLATE/*.yml` 强制收集版本 / OS / Provider / 日志 | 无 |
| 社区治理文件 | `CONTRIBUTING` / `SECURITY` / `CODE_OF_CONDUCT` / `TRADEMARK` | 全部缺失 |
| README 嵌入架构树 | `README.md:345-365` 一段 ASCII 树搞定"项目是什么" | [推断] 需核验 |
| 关键子模块"Gotchas"段 | `apps/electron/README.md:49-125` 高浓度坑点速查 | 分散在 `handover/` 中，无快速入口 |
| CLI 独立参考文档 | `docs/cli.md` 240 行按动词分类 | [推断] 需核验是否已有对应文档 |

### 4.2 CodePilot 强于 craft（应保持）

| 维度 | CodePilot 做法 | craft 现状 |
|------|---------------|-----------|
| 执行计划体系 | `docs/exec-plans/{active,completed}` + tech-debt-tracker | 无 |
| 调研文档三层纪律 | 已有 26 份，外部事实钉 URL + 仓库事实钉 file:line + 推断分层 | 无调研文档 |
| 技术交接 ↔ 产品思考互链 | `handover/` 与 `insights/` 强制反向链接 | 无 |
| AI 开发纪律 | `CLAUDE.md` 改动自查 + 发版模板 + Worktree 规则 | 无 AI 场景规则 |
| Release Notes 严格模板 | `CLAUDE.md` 明确规定正文结构、下载链接、用户可读语言 | 仅依赖 GitHub Release，格式自由 |

**结论**：CodePilot 的"内功"文档链（研发过程沉淀）已显著强于 craft，**不需要向 craft 反向学习**。

### 4.3 两边都缺的项

- ADR（架构决策记录）独立目录。CodePilot 把决策散落在 `exec-plans/` 里，craft 完全不记。
- CHANGELOG 机器可读化。CodePilot 有 `RELEASE_NOTES.md` 模板但仍是人工维护，craft 无。
- 文档链接失效校验。两边都没有 CI 去检查 `file:line` 引用是否还指向真实位置。

---

## 5. 借鉴清单（按优先级）

### 5.1 P0 — 外部入口文档起步包

目标：CodePilot 已公开发布（观察到 `RELEASE_NOTES.md` 正在用 GitHub Release 分发 DMG/Setup），但 Issue 质量与社区协作缺乏结构化约束。

1. **新增 `.github/ISSUE_TEMPLATE/bug_report.yml`**：模仿 `craft/.github/ISSUE_TEMPLATE/bug_report.yml:1-124` 的字段，收集 CodePilot 版本、OS（含 arm64/x64）、Provider、复现步骤、日志位置。
2. **新增 `.github/ISSUE_TEMPLATE/feature_request.yml`**：结构 Problem / Proposed Solution / Alternatives / Additional Context。
3. **新增 `.github/pull_request_template.md`**：列自查清单，对齐 `CLAUDE.md` 的"改动自查"五条（i18n、DB schema、类型、文档、功能文档）。这是 craft **没做** 但 CodePilot **应做** 的，因为我们有更细的自查纪律。
4. **新增根目录 `CONTRIBUTING.md`**：说明 Worktree 规则、commit 规范、如何跑 `npm run test` / `test:smoke`、文档更新约束。**必须引用 `CLAUDE.md`** 作为权威来源，避免双份维护。
5. **新增根目录 `SECURITY.md`**：漏洞上报邮箱与流程。非社区项目也建议有。

### 5.2 P1 — 用户入门体验增强

6. **README 嵌入项目结构树**：借鉴 `README.md:345-365` 的 ASCII 树手法。如果 `ARCHITECTURE.md` 已承担此职责，则在 README 放**精简版 10–15 行树** + 链接到 `ARCHITECTURE.md` 详版。
7. **在 `src/` 主模块目录增加简短 README**（按需，不求全）：仅对外部读者最关心的模块（如 `agent-sdk`、`claude-client`、`chat`）写 50–100 行"本模块做什么 + 常见坑点 3 条"的聚焦文档，参考 `apps/electron/README.md:49-125` 浓缩风格。CodePilot 非 monorepo，不必覆盖所有目录。
8. **"Gotchas" 分类 index**：在 `docs/handover/README.md`（如无则新建）列一个按模块分类的"Known Pitfalls"索引，把 `handover/` 里各文档的坑点段聚合入口化。

### 5.3 P2 — 运营性文档补全（ROI 评估修订）

[修订] Codex review 后确认：`CODE_OF_CONDUCT.md` 与 `TRADEMARK.md` 在当前阶段 ROI 偏低，**暂不列入 P0**，待真正进入多方社区协作阶段（外部 PR 增多、品牌被 fork 滥用等）再补。P0 最高 ROI 聚焦在：
- 结构化 `bug_report.yml` 强制收集版本 / OS / Provider / 日志；
- `pull_request_template.md` 复用现有 `CLAUDE.md` 改动自查五条，**以链接方式引用而非复制**，避免维护两份。

9. **决策日志（ADR）独立化**：从 `exec-plans/` 抽出纯技术决策条目，建 `docs/decisions/`，命名 `ADR-NNNN-topic.md`。不用大改动，把现有执行计划里的"决策日志"章节迁入即可。
10. **`CHANGELOG.md` 或自动生成**：从 `RELEASE_NOTES.md` 归档历史版本入 `CHANGELOG.md`，方便用户无需翻 GitHub Release 就能看版本演进。[推断] 可写个简单脚本把历次 release notes 合并。
11. **文档链接校验 CI**：用 `markdown-link-check` 或自建脚本，扫 `docs/` 下所有 `file:line` 引用是否仍存在。两边仓库都缺，CodePilot 率先补上。

### 5.4 不采纳的 craft 做法

- **`TRADEMARK.md`**：CodePilot 未明确开源路线，暂不需要。未来若对外开源再补。
- **把所有内部库都免 README**：craft 对 `packages/shared` / `packages/server` 直接不写文档，不符合 CodePilot 的"每个核心模块要有可交接的文档"纪律。不借鉴。
- **ASCII-only 图示**：craft 完全不用 Mermaid。CodePilot 的 `handover/` 已有 Mermaid 流程图惯例（[推断] 需核验），保持现状更清晰。

---

## 6. 未决事项

1. CodePilot 根目录 `README.md` 当前结构是否已嵌入架构树 / Quick Start / Troubleshooting —— 本次调研未打开 `README.md`，P1 建议 6 落地前需先核验。
2. `src/` 下哪些模块值得补 README（P1 建议 7）需要与产品对齐优先级。
3. ADR 迁移（P2 建议 9）若执行，需要制定 ADR 编号规则与模板，并从 `exec-plans/` 抽取时避免破坏现有文档的引用。
4. PR 模板（P0 建议 3）需要与 `CLAUDE.md` 的"改动自查"保持同源——建议模板里直接链接 `CLAUDE.md` 对应章节而非复制一份。

---

## 7. 参考路径索引

### craft 仓库（本地路径）

- `README.md:1`（标题）、`:345-365`（架构树）
- `CONTRIBUTING.md:39-91`（分支与 PR 规范）
- `docs/cli.md:1-240`（CLI 参考）
- `apps/electron/README.md:16-46`（嵌入式架构树）、`:49-125`（Gotchas）、`:262`（失效引用）
- `packages/core/README.md:1-100`
- `packages/server-core/README.md:1-18`
- `.github/ISSUE_TEMPLATE/bug_report.yml:1-124`
- `.github/ISSUE_TEMPLATE/feature_request.yml:1-37`
- `.github/workflows/validate.yml:34`（`validate:ci`）

### CodePilot 仓库

- `CLAUDE.md`（开发规则与发版纪律）
- `docs/CLAUDE.md`（目录约定）
- `docs/exec-plans/README.md`（执行计划模板）
- `docs/research/README.md`（本目录索引）
- `.github/workflows/`（当前仅此目录，ISSUE_TEMPLATE 与 PR template 均缺失）
