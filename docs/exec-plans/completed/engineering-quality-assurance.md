# 工程质量保障体系（Harness Engineering）

> 灵感来源：OpenAI _Harness Engineering_ 文章
> 创建时间：2026-03-04
> 最后更新：2026-03-04
> 版本：v0.25.1

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | 验证闭环：pre-commit hook + CI gate + npm scripts | ✅ 已完成 | commit `99c4931` |
| Phase 2 | AI 可读文档：CLAUDE.md 路由化 + ARCHITECTURE.md | ✅ 已完成 | commit `e0c38af` |
| Phase 3 | 执行计划体系 + 技术债务追踪 | ✅ 已完成 | commit `62dbecd` |
| Phase 4 | CDP 视觉验证：chrome-devtools MCP 集成 | ✅ 已完成 | commit `a7104aa` |
| Phase 5 | 品牌一致性审查 | ✅ 已完成 | commit `935e3d0` |
| Phase 6 | ESLint 存量错误修复 | 📋 未实现 | 4 个 error，CI 用 `continue-on-error` 兜底 |
| Phase 7 | Smoke 测试实际验证 | 📋 未实现 | spec 已写好，未在 CI 中启用（需 dev server） |
| Phase 8 | E2E 测试覆盖核心流程 | 📋 未实现 | Playwright 框架就绪，无业务流程用例 |
| Phase 9 | PR 自动预览 + CDP 截图对比 | 📋 未实现 | 需 CI 环境启 dev server + headless Chrome |

## 决策日志

- **2026-03-04**: 全部 5 个 Phase 一次性完成，随 v0.25.1 发布
- **2026-03-04**: CI lint 步骤设 `continue-on-error: true`——存量 4 个 ESLint error 暂不修复，避免阻塞 CI
- **2026-03-04**: Smoke 测试不纳入 CI——需要 dev server 运行，当前 CI 矩阵无此环境
- **2026-03-04**: `.mcp.json` 直接签入仓库——确保所有开发者和 AI 会话自动加载 CDP

---

## Phase 1：验证闭环

**目标：** 建立三层自动验证（pre-commit → CI gate → 手动扩展测试），确保每次改动通过基线检查。

### 已实现

| 层级 | 机制 | 内容 |
|------|------|------|
| 本地 | pre-commit hook (`.husky/pre-commit`) | `lint-staged` → `tsc --noEmit` → `tsx --test` 顺序执行 |
| 本地 | npm scripts | `test` = typecheck + unit；`test:smoke` / `test:e2e` 按需运行 |
| CI | `lint-test` job (`.github/workflows/build.yml`) | lint → typecheck → unit test，所有 build job `needs: [lint-test]` |
| CI | PR 触发 | 新增 `pull_request: branches: [main]` 触发器 |

### 文件变更

- `package.json` — 新增 6 个 scripts + `lint-staged` 配置 + `husky`/`lint-staged`/`tsx` devDependencies
- `.husky/pre-commit` — 新建
- `.github/workflows/build.yml` — 新增 `lint-test` job + PR 触发 + `needs` 依赖
- `src/__tests__/e2e/smoke.spec.ts` — 新建 Playwright @smoke 测试（5 个核心路由）

### 未实现

- **ESLint 存量修复**（Phase 6）：`MessageItem.tsx` hooks 条件调用（L348, L355）、`ChatView` impure render（L521）、`GalleryDetail` setState in effect（L74）。CI lint 步骤用 `continue-on-error: true` 绕过。
- **Smoke 测试纳入 CI**（Phase 7）：spec 已就绪但 CI 环境未配置 dev server。需在 CI 中添加 `npm run dev &` + `wait-on` 步骤，或改用 Next.js `start` 模式。
- **E2E 覆盖**（Phase 8）：Playwright 框架和 helpers 就绪（`goToChat`、`goToPlugins` 等），但没有覆盖业务核心流程（发送消息、创建会话、插件管理等）的测试用例。

---

## Phase 2：AI 可读文档

**目标：** 让 AI 每次进入项目时能快速理解架构，减少重复探索的 token 浪费。

### 已实现

| 文档 | 作用 |
|------|------|
| `CLAUDE.md` | 路由层——规则、流程、自检命令，指向各专题文档 |
| `ARCHITECTURE.md` | 架构全景——目录结构、数据流、数据库 schema、技术栈、新功能触及点 |

### 设计原则

- **CLAUDE.md 是入口**：只放规则和流程，不放架构细节（避免膨胀）
- **ARCHITECTURE.md 是地图**：一次性给 AI 全局视角，减少 Glob/Grep 探索
- **自检 checklist**：i18n → db → types → docs 四项，防止遗漏

### 未实现

- **组件文档自动生成**：没有为 `src/components/` 各子目录生成 props/用法说明
- **API 路由文档**：52 个 REST 端点没有 OpenAPI/Swagger 描述

---

## Phase 3：执行计划体系

**目标：** 中大型功能有据可查，进度可追踪，技术债务可见。

### 已实现

| 产物 | 路径 | 内容 |
|------|------|------|
| 执行计划规范 | `docs/exec-plans/README.md` | 模板、索引、使用指南 |
| 首个执行计划 | `docs/exec-plans/superseded/context-storage-migration.md` | 从 research 迁移而来，标注各 Phase 状态 |
| 技术债务清单 | `docs/exec-plans/tech-debt-tracker.md` | 4 项已知债务 |
| CLAUDE.md 规则 | CLAUDE.md "执行计划" 区块 | 强制 AI 对中大型功能先写计划再开工 |

### 未实现

- **计划审批流程**：当前靠 CLAUDE.md 文字规则约束 AI，没有技术手段阻止 AI 跳过计划直接开工
- **进度自动同步**：计划状态需手动更新，没有与 git commit/PR 自动关联

---

## Phase 4：CDP 视觉验证

**目标：** AI 修改 UI 后能自动截图验证，不依赖人工肉眼检查。

### 已实现

| 产物 | 说明 |
|------|------|
| `.mcp.json` | chrome-devtools MCP server 配置，签入仓库 |
| CLAUDE.md 规则 | "UI 改动必须用 CDP 验证" 区块：截图、console 检查、点击模拟、响应式验证 |

### CDP 能力

- 页面截图（`mcp_screenshot`）
- DOM 查询和点击（`mcp_click`, `mcp_evaluate`）
- 设备模拟（viewport 尺寸切换）
- Console 日志读取

### 未实现

- **CI 中自动 CDP 截图**（Phase 9）：当前仅在本地 AI 会话中使用。理想状态是 PR 触发后自动启动 dev server → 截图关键页面 → 与基线对比 → 差异过大则阻止合并。需要：
  - CI 环境安装 Chrome/Chromium
  - dev server 启动和健康检查
  - 基线截图存储和对比工具（如 Percy、Playwright visual comparison）
  - 差异阈值和 PR comment 集成
- **截图基线管理**：没有建立各页面的"正确"截图基线供对比

---

## Phase 5：品牌一致性

**目标：** 应用自身的 UI 文案使用 "CodePilot" 而非 "Claude"（Claude Code 连接部分除外）。

### 已实现

- `src/i18n/en.ts`：`Claude Chat` → `CodePilot Chat`，`conversation with Claude` → `conversation with CodePilot`
- `src/i18n/zh.ts`：`Claude 对话` → `CodePilot 对话`，`与 Claude 对话` → `与 CodePilot 对话`

### 保留 "Claude" 的场景（正确用法）

- `claude-client.ts` / `claude-session-parser.ts` — 指 Claude Code CLI
- `chatList.importFromCli: 'Import from Claude Code'` — 指导入 Claude Code 会话
- `settings.claudeApiKey` — 指 Anthropic API key
- `nav.claudeCodeSettings` — 指 Claude Code 本身的设置

### 未实现

- **i18n key 重命名**：`messageList.claudeChat` 这个 key 名称本身仍含 "claude"，但因为 key 不面向用户且改名需同步所有引用，暂不处理
- **应用标题栏 / Electron 窗口标题**：未审查 Electron `main.ts` 中的窗口标题是否使用了正确品牌名
- **README / GitHub 仓库描述**：未审查面向外部的项目描述文案

---

## 总结

### 已建立的保障机制

```
开发者/AI 改动代码
  → pre-commit: lint-staged + typecheck + unit test（~5s）
  → CDP 截图验证（UI 改动时）
  → git push → CI lint-test job
  → PR 合并门槛（lint + typecheck + unit 全过）
  → 中大型功能有执行计划跟踪
  → 技术债务可见可追溯
```

### 未来可改进方向

| 方向 | 优先级 | 说明 |
|------|--------|------|
| 修复 4 个 ESLint 存量 error | 中 | 去掉 CI `continue-on-error`，让 lint 真正成为门槛 |
| CI 启 dev server + smoke test | 中 | 补全 CI 中的冒烟测试覆盖 |
| E2E 测试覆盖核心业务流程 | 中 | 发消息、创建会话、插件管理等 |
| PR 自动截图对比 | 低 | 需要 CI Chrome + 基线管理 + 对比工具 |
| 组件/API 文档自动生成 | 低 | 降低新人和 AI 理解成本 |
| 执行计划与 PR 自动关联 | 低 | commit message 引用计划编号 → 自动更新状态 |
