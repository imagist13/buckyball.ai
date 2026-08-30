# Markdown 渲染/编辑体系 × Artifact 网页预览扩展 — 执行计划

> 创建时间：2026-04-19
> 完成时间：2026-04-21
> 状态：✅ 已合并准备 — Phase 1-5 全部落地，0.1 被 Phase 1 实际方案覆盖
> 技术交接：[docs/handover/markdown-artifact-overhaul.md](../../handover/markdown-artifact-overhaul.md)
> 产品思考：[docs/insights/markdown-artifact-overhaul.md](../../insights/markdown-artifact-overhaul.md)
> 对应调研：
> - [docs/research/markdown-editor-tiptap-evaluation.md](../../research/markdown-editor-tiptap-evaluation.md)
> - [docs/research/artifact-preview-ai-elements.md](../../research/artifact-preview-ai-elements.md)
> - [docs/research/craft-agents-markdown-internals.md](../../research/craft-agents-markdown-internals.md)
> 隔离：worktree `feat/markdown-artifact-overhaul`，由用户发起合并

## 用户核心诉求（本计划的"为什么"）

1. **Artifact 支持更多网页预览** — 现只能预览 `.html`/`.htm`，希望扩展到 AI 生成/修改的 React（`.jsx`/`.tsx`）文件；交互模式是"聊天里出卡片 → 用户点击再拉起 PreviewPanel"，不做静默自动弹。
2. **文件树中 Markdown 预览优化** — 当前后端 `readFilePreview` 硬 cap 1000 行（`src/app/api/files/preview/route.ts:52`），长 Markdown 文件被截断看不全。
3. **新建和编辑 Markdown 文档** — 不用切到 Obsidian 即可在 CodePilot 内新建 `.md` 并以源码模式编辑，兼容已有 vault。
4. **Artifact 中的网页一键导出长图** — HTML / JSX 预览内容可一键导出为全页 PNG（超过视口高度也要完整）。

## 状态

| Phase | 内容 | 状态 | 价值形态 | 备注 |
|-------|------|------|---------|------|
| Phase 0 | 前置 POC + 实测（9 项 POC，覆盖所有未确定技术路径与产品决策） | ✅ 已完成 | C 基建 | 8/9 项 POC 产出（0.2 / 0.3 / 0.4 / 0.5 / 0.6 / 0.7 / 0.8 + 0.9 汇总到决策日志）；0.1 CDP 实测被 Phase 1 的"分档放开 + 截断提示"实际方案覆盖，未走 100k 压测分支 |
| Phase 1 | 文件树 Markdown 预览放开截断 + 性能验证 + API 合同闭合 | ✅ 已完成 | A 可见 | commit `8313b2a`：EXTENSION_LINE_CAPS 分档 + 10MB 字节上限 + 二进制检测 + truncated/bytes_read/bytes_total 字段 + TruncationBanner UI + 4 条 i18n + FilePreviewError 映射 HTTP 状态 |
| Phase 1.5 | PreviewPanel 数据模型迁移（`{filePath? \| inlineContent? + kind}` 双通道） | ✅ 已完成 | C 基建 | commit `3c8482a`：PreviewSource 联合 + AppShell state 迁移 + PanelZone R1 gate 同步 + PreviewPanel 内容区 kind switch + InlineHtmlView + FileTreePanel 零改动（adapter 透明） |
| Phase 2 | Artifact 网页预览扩展（工具结果落点 + 卡片 UI + PreviewPanel 扩展 .jsx/.tsx） | ✅ 已完成 | A 可见 | commits `812f905`/`151932d`/`6cfd28f`/`7fb7c17`：DiffSummary 抽组件（4 处改造）+ Artifact 卡片样式 + PreviewPanel 加 .jsx/.tsx 分支 + Sandpack 集成（s4 默认 sandbox）+ 5 个 i18n key |
| Phase 3 | Artifact 网页一键导出长图（复用隐藏 BrowserWindow 通道） | ✅ 已完成 | A 可见 | commit `19adaae`：新 IPC artifact:export-long-shot + CDP captureBeyondViewport + 独立 session + module-level 导出锁 + PreviewPanel header 按钮 + DiffSummary 行按钮 + base64 Blob 下载。Markdown/JSX 的 render-to-HTML 预处理 + pngjs 回退为 follow-up |
| Phase 4 | 文件树新建 `.md` + 通用 CodeMirror 编辑器（+ 写入 API 规范）+ Obsidian 兼容 | ✅ 已完成（P1 范围） | A 可见 | commits `8a54c56`/`20edd61`：`/api/files/write/mkdir/rename/delete` 四同级 API + FileIOError + path safety helpers + trash 包接系统回收站 + CodeMirror 6 MarkdownEditor（Compartment 主题切换）+ SkillEditor textarea 替换 + FileTreePanel "+" 新建 Markdown。frontmatter 高亮 / 图片粘贴 / 文件树右键菜单为 follow-up |
| Phase 5 | 配套增强（ShikiThemeContext / Collapsible / 表格 Artifact + 导出 / LRU 核对 / loadedPath / validateFsAccess / 产品边界文档） | ✅ 主体已完成（5.1/5.2 已决策跳过） | 混合 | 6 个子项落地：5.4 DataTable viewer、5.5 shared LRU、5.6 loadedPath、5.7 validateFsAccess、5.8 insights 文档；5.1 已被 useThemeFamily 机制覆盖不做；5.2 Collapsible 因 rehype-raw 依赖影响面过大，推到独立 follow-up |

**状态符号：** 📋 待开始 / 🔄 进行中 / ✅ 已完成 / ⏸ blocked / ❌ 放弃

**价值形态说明（对齐已有 feedback「Plan must state user value」）：**
- **A** 用户可见 UI / 直接可感知的新能力
- **B** 静默体感提升，以量化指标验收（帧耗时、内存、缓存命中率）
- **C** 基建/前置验证，无直接用户价值，为后续 Phase 铺路

## 决策日志

- 2026-04-19 [全局] 三份调研合并。场景 3 由"自动拉起预览"改为"聊天里插入 Artifact 卡片 → 用户点击再拉起"。**原因：** 对齐已有 feedback「no silent auto-irreversible in UI design」。卡片是可关闭、非外部导航、非消息重放的可逆操作。
- 2026-04-19 [场景 2] 内联富块（Mermaid/Math/表格/Diff/JSON）全部不做。**原因：** Streamdown 插件链（`@streamdown/code/math/mermaid/cjk`）已覆盖主要场景；用户判断当前渲染效果可接受。`diff`/JSON 树/datatable 不做内联替换，有需要时通过 5.4 的 Artifact 预览卡片处理。
- 2026-04-19 [场景 3.5] URL 预览先不做。**原因：** 本次核心诉求是"生成/修改文件→卡片"闭环，URL 预览独立情形，留作后期。
- 2026-04-19 [Artifact 能力核实] AI Elements 官方 `Artifact` 仅 8 件套 UI 原语，**不含**多版本切换、版本历史、Diff、下载、side-by-side、全屏切换——全部要自建。`Canvas`/`Panel` 是 React Flow 节点编辑器相关，与侧栏 Artifact 无关，排除。`Attachments` 组件（附件 grid/inline/list + hover 预览）留作未来"AI 回复中插入可下载文件组"时复用。
- 2026-04-19 [第二次修订] Codex 审查捕获 8 项问题（P1×4 / P2×4）。核实结论：
  - `electron/main.ts:775-779` 当前 `webPreferences` **未开** `webviewTag`，原计划"切 webview 做导出"不成立
  - `electron/main.ts:1356-1407` 已存在 `widget:export-png` 隐藏 BrowserWindow 导出通道（独立 session 分区 + `loadURL(data:text/html,...)` + `capturePage`），**4000px 高度上限**在 1398 行
  - `src/app/api/files/preview/route.ts:52` 服务端硬 cap 是 **1000 行**（不是计划之前写的 500 行；500 是客户端调用参数）
  - `src/types/index.ts:49-56` `FilePreview` 类型**无** `truncated` 字段
  - `src/components/chat/MessageItem.tsx:712-728` **已存在** `<DiffSummary>`，从 `write/edit/writefile/create_file/notebookedit` 等工具结果里抽 `modifiedFiles` 并渲染——Artifact 卡片与其关系必须提前定义，否则双 UI
  - `package.json:73` 已有 `html-to-image ^1.11.13`，不是新增依赖
  - AI Elements 正确 CLI 是 `npx ai-elements@latest add <name>`（不是 shadcn 直链）
  - `react-jsx-parser` **不是**完整沙箱，需显式 allowlist/denylist 验收条件
  - **本次修订把所有决策点推进到 Phase 0 POC**，由 POC 结论写回此决策日志，然后再更新各 Phase 的技术方案段
- 2026-04-19 [长图导出基线] 改为复用 `widget:export-png` 的隐藏 BrowserWindow 通道（独立 session 分区 + `loadURL` + `capturePage`）。去掉 4000px 上限，改为分段 `capturePage(rect)` 拼接或 CDP `Page.captureScreenshot({ captureBeyondViewport: true })`（Phase 0.3 二选一）。废弃原先"iframe attach debugger / 切 webview"路径——iframe 非独立 webContents，主窗口也未开 webviewTag。
- 2026-04-19 [Q1/Q2/Q3 选定] 用户确认按默认推荐落地：
  - **Q1** `.tsx` 预览走 **Sandpack**（`@codesandbox/sandpack-react`）——AI 真实输出几乎都带 `import`，Sandpack 是覆盖面最广的方案；Phase 0.5 POC 从"三选一对比"收敛为"单方案集成验证 + 回退判据"
  - **Q2** Artifact 落点走 **升级 DiffSummary**——一个入口，消除 Codex 警告的双 UI 风险；Phase 0.6 POC 从"三选一"收敛为"升级方案的改造接口设计"
  - **Q3** Markdown 编辑范围取 **中等**（核心 + frontmatter 高亮 + 图片粘贴）；Obsidian 完整兼容（wikilinks/callouts）标 P2 后置
  - 回退方案全部保留为"风险 → 回退"条目（见风险表），避免 POC 发现死路时无 plan B
- 2026-04-19 [第三轮修订] Codex 再审查捕获 6 项（P1×3 / P2×3），核实全部准确：
  - `src/components/layout/PanelZone.tsx:15,22` 的 `anyOpen` 与 PreviewPanel 挂载条件都依赖 `!!previewFile`——Phase 1.5 不能只改 PanelZone 内部，**必须同步扩展 PanelZone 的 gate 条件**，否则 inline-* 面板根本挂不上
  - `src/components/chat/MessageItem.tsx:535` 的 `DiffSummary` 是**内联函数**不是独立文件 `DiffSummary.tsx`；Phase 0.6 POC 要重新定位，且必须决定"抽组件再改"还是"原地改造"
  - `@codesandbox/sandpack-react@2.20.0` 的实际 API：`bundlerURL` 在 `SandpackProvider` 的 `options.bundlerURL` 而非 `customSetup`；`SandpackPreview` 暴露的是 div props，**没有** iframe sandbox 直接控制接口——Phase 0.5 必须先验证 sandbox 的实际可控路径（webRequest/CSP header/低层 `sandpack-client` 三选一，或接受默认策略）
  - Sandpack 运行在 iframe 内，父页面 + `allow-same-origin` 禁用后**无法读取 iframe DOM**；Phase 3.3 原计划的"querySelector + outerHTML"**不可行**，必须改为"基于 Sandpack files 重建独立 HTML → 隐藏 BrowserWindow 导出"或"iframe 内 capture + postMessage 回传"
  - `sharp` 是 native dep，当前 `package.json` 无此依赖，`after-pack.js` 只重编译 `better-sqlite3`；Phase 3.1 不能假设 sharp 可用，改用 Electron `nativeImage.createFromBuffer` + composite 或纯 JS 拼接（`pngjs`），sharp 作为可选重性能方案但需明确 ABI 重编译成本
  - Phase 2.5 的"默认 CSP / sandbox 会拦截外部脚本"不是已知事实而是 POC 待验证的断言；若 Sandpack 默认不满足，可通过 Electron `session.webRequest.onHeadersReceived` 注入 CSP 响应头、或 local bundler 配置收紧
- 2026-04-19 [第四轮修订] Codex 补充 2 项 P2 + 1 处文案残留，全部闭环：
  - **离线 bundler fallback 写成了不存在的 npm 包**：npm registry 无 `@codesandbox/sandpack-bundler` 包，不能 `npm i`。正解 = 克隆 GitHub 仓库 `codesandbox/sandpack-bundler` → `yarn dev` 或 `yarn build && yarn start` 启服务 → `options.bundlerURL` 指本地服务。4 处相关描述已全部修正（Phase 0.5 POC 要点 + Phase 2.1 Bundler 配置 + Phase 2.5 若 CSP 不可控切换本地 bundler + 风险表）
  - **rename/delete API 无安全合同**：原 Phase 4.1 只规定了 write，rename/delete 仅出现在右键菜单描述里。现扩展为 4.1.a-d 四个 API 同等规范，rename 额外有 `cross_base_dir` / 两端 path safety / 类型校验，**delete 改用 Electron `shell.trashItem` 走系统回收站**（不 `fs.unlink`/`rm`）+ 回收站不可用时返回 `trash_unavailable` 拒绝降级真删 + 文件夹 delete 必须 `recursive=true` + UI 文案"可在回收站恢复"（不是"不可恢复"）。相应 i18n 键更新（`deleteConfirmFile` / `deleteConfirmDir` / `deleteTrashUnavailable`）+ 验收标准新增 4 条
  - Phase 2.8 验收文案"2.5 的 5 个安全攻击样本…若 2.1 选 (a)"已拆为两条：主路径验收 Sandpack 的 4 个 iframe 样本、snippet-only 回退路径验收 `react-jsx-parser` 的 5 个样本
- 2026-04-19 [Phase 0 静态 POC 四项完成] 0.2 / 0.6 / 0.7 / 0.8 产出独立文档在 `docs/research/phase-0-pocs/`，结论汇总：
  - **0.2 Streamdown LRU 核对 → 未复用**。`code-block.tsx:164-170` 的 LRU 仅被同文件 `highlightCode()` / `CodeBlockContent` 消费，跨仓库 grep 无 import，在聊天路径上是死代码。聊天路径走 `@streamdown/code`，其 `node_modules/@streamdown/code/dist/index.js` 自建**无上限**模块级 Map 并独立 `shiki.createHighlighter`。Phase 5.5 改造方向：用 `code-block.tsx` 的 `highlightCode()` 实现自定义 `CodeHighlighterPlugin`（接口在 `@streamdown/code/dist/index.d.ts:18-39`）替换 `createCodePlugin()`；需 shim `TokenizedCode → TokensResult` 补 `themeName`/`rootStyle`
  - **0.6 DiffSummary 改造接口 → 抽组件**。耦合度为零：仅用 `files` prop + 本地 `useState(open)`，不读 MessageItem closure。Props `{ files, onPreview?, onExportLongShot? }` 缺省不渲染按钮。扩展名规则：`.md/.mdx` 仅预览；`.html/.htm/.jsx/.tsx` 预览+导出；其他扩展名无按钮。改造 4 处：新建 `src/components/chat/DiffSummary.tsx` / 删 `MessageItem.tsx:531-572` / 改 `:727` 调用点 + `:13` import / 按需清理 `NotePencil` 导入（`CaretRight` 保留）。与 ToolActionsGroup 独立互补，不改 `TOOL_REGISTRY`
    - **Phase 3 实际出货修订（2026-04-21）：** LONGSHOT 收窄到 `.html/.htm`；`.jsx/.tsx` 仅预览不导出，因为当前导出链路把原文送进隐藏 BrowserWindow，TSX 原文是源码而不是渲染页面。PREVIEWABLE 反向扩展到 `.csv/.tsv`（DataTable viewer）。TSX 长图等 Sandpack→HTML 预处理链（参见 0.3 的 X-jsx-1）落地后再放开。
  - **0.7 PreviewSource 迁移 → 5 文件触点 + 12 风险点**。`usePanel.ts:47-48` / `AppShell.tsx:355-452`（唯一 state 所有者）/ `PanelZone.tsx:13,15,22`（**R1 最高风险：gate 漏改导致 inline-\* 挂不上**）/ `PreviewPanel.tsx:90,103,152` / `FileTreePanel.tsx:18,48-55`（adapter 透明兼容零改动）。adapter 策略可行：主 state = `previewSource`，`previewFile` 变派生（`previewSource?.kind === 'file' ? previewSource.filePath : null`）。smoke test 覆盖 `inline-html` + `inline-datatable` 专压 R1
  - **0.8 Streamdown 接 remark → 走 `remarkPlugins` prop 不走 `plugins` 对象链**。Streamdown `Options` 同时暴露 `remarkPlugins?: PluggableList`（标准 unified）和 `plugins?: PluginConfig`（自定义四槽 code/mermaid/math/cjk）。Phase 5.2 `remarkCollapsibleSections` 走 `remarkPlugins`。顺序固定：`plugins.cjk.remarkPluginsBefore` 在前，`...After` 和 `math.remarkPlugin` 在后。`mode="streaming"` 下按 block 切片，折叠插件需对 heading-only / 空 section 单 block 鲁棒。无需降级方案
- 2026-04-19 [Phase 0 深度调研 3 项完成] 0.3 / 0.4 / 0.5 产出独立文档在 `docs/research/phase-0-pocs/`（纯调研，未装包未跑代码，所有 API 引用带官方文档 URL）：
  - **0.5 Sandpack 集成 → API 精确确认 + iframe sandbox 控制路径选定 s2 为升级路径，s4 为 Phase 2.1 初版**。从 `@codesandbox/sandpack-react` 源码确认：`bundlerURL` 在 `SandpackProvider options={{ bundlerURL }}`，**不在** `customSetup`；`SandpackPreview` 仅暴露 div props + `SandpackPreviewRef { getClient, clientId }`，**没有** iframe sandbox prop。关键发现：`sandpack-client/clients/runtime/index.ts` 的 `if (!this.iframe.getAttribute("sandbox")) {...}` —— 用户传已设 `sandbox` 的 iframe 给低层 `SandpackRuntime`，Sandpack 不覆盖。默认 sandbox = `allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads allow-pointer-lock`。Phase 2.1 初版接受 s4 默认（保留 `allow-same-origin`），Phase 2.5 若要去掉 `allow-same-origin` 必须切 s2（低层 `sandpack-client` + 自建 iframe）。离线 bundler 正解：`git clone github.com/codesandbox/sandpack-bundler` → `yarn dev`。Tailwind v4 通过 `options.externalResources` 挂 `@tailwindcss/browser@4` CDN。A/B fixture 直接通过 `customSetup.dependencies` 支持；C 别名 `@/...` 需 `files` 字段注入虚拟 `/tsconfig.json` + `/components/ui/*.tsx`（Phase 2.1 P1 先显示提示条，P2 补虚拟 shadcn 子集）
  - **0.3 长图导出 → pngjs 拼接库 + CDP captureBeyondViewport 优先 + X-jsx-1 为 JSX 主路径**。现有 `widget:export-png` 的安全配置（sandbox + 独立 partition + 无 preload + will-navigate/setWindowOpenHandler 拦截 + `__scriptsReady__` 监听）全部保留；仅 L1398 `Math.min(contentHeight + 20, 4000)` 的 4000 上限删除。**拼接库决策**：pngjs（零 native dep，bitblt 专为块拷贝，~50KB gzipped）；`nativeImage` 排除（无 compositing API）；`sharp` 排除（需改 `scripts/after-pack.js` 加第二条 ABI 重编译 + macOS/Windows prebuilt + `asarUnpack`，收益不匹配）。**全页路径**：`debugger.attach('1.3')` + `Page.captureScreenshot({ captureBeyondViewport: true })` 优先（一次成图），`isDevToolsOpened() || contentHeight > 16000 || OOM` 时回退 pngjs 分段。**JSX 路径**：X-jsx-1（esbuild 预编译 → 独立 HTML → 隐藏 BrowserWindow，复用 HTML 通道）为主，X-jsx-2（Sandpack iframe 内注入 `html-to-image` + postMessage）作降级。IPC 完整签名：`artifact:export-long-shot({ source, width, pixelRatio?, outPath?, maxHeightPx?, timeoutMs? })`，discriminated 错误码 `timeout / canvas_limit / oom / debugger_busy / compile_error / busy`，主进程模块级 `exportLock` 单例
    - **Phase 3 实际出货修订（2026-04-21）：** 第一版只做 HTML 全页路径 + CDP captureBeyondViewport（commit `19adaae`）。**JSX 两条路径都后置**：X-jsx-1 的 "esbuild 预编译 → 独立 HTML" 链路未落地，X-jsx-2 的 iframe 内 capture 也没做。`.jsx/.tsx` 当前仅预览，不出现在 LONGSHOT 集合；pngjs 分段回退也未激活（CDP 一次成图已够用）。等 JSX 的独立 HTML 序列化落地后再开 TSX 长图。
  - **0.4 CodeMirror 集成 → bundle ~135KB gzipped + Tailwind v4 路径 C + dynamic SSR 排除**。`basicSetup + lang-markdown + oneDark` 合计 ~135KB gzipped，按 `next/dynamic({ ssr: false })` 独立 chunk 不入首屏。所有核心包 dual ESM/CJS，Electron 渲染进程 ESM 加载无问题。**Tailwind v4 隔离路径 C（推荐）**：用 `@layer base` + `revert-layer` 反制 preflight（`.cm-editor * { all: revert-layer }` 恢复 CodeMirror 内部样式），成本最低、保留 Tailwind token 继承；Shadow DOM 作回退。完整 `MarkdownEditor` TS 代码草案：Compartment 主题切换无闪 + `updateListener` onChange + `indentWithTab` + `Mod-s` keymap + 受控 value + cleanup destroy。SkillEditor 迁移 diff：删 ~25 行手写 Tab/Save 逻辑，替换 `<Textarea>` 为 `<MarkdownEditor value onChange onSave filename>`，`content/setContent/isDirty/handleSave` 数据流不变

---

## Phase 0 — 前置 POC + 实测

**价值形态：** C 基建

**目的：** 在主代码落地前，解决所有技术不确定性 + 产品选型（对齐 CLAUDE.md「不确定的技术点先做 POC 验证」）。每项 POC 产出必须写回"决策日志"段。

### 0.1 CDP 实测长 Markdown 渲染瓶颈 — ⏭️ 被 Phase 1 实际方案覆盖（未走压测分支）

**结论（2026-04-21）：** Phase 1 直接按"备选 (b) 分档放开 + 截断提示"实现（commit `8313b2a`）。服务端 50000 行 + 10MB 字节双上限构成 DoS 防线，TruncationBanner 在超限时明确提示用户看到的是子集。决策规则里的 "1.2a 分段 memo / 1.2b code fence 降级" 分支没有走——用户在真实使用中没有反馈首屏卡顿，放在 follow-up 观察池。

~~**原计划：**~~
- ~~构造 10k / 30k / 100k 字符 fixture + chrome-devtools MCP Performance 采样~~
- ~~决策规则：100k 首屏 < 1s → 仅改 API 上限；不达标 → 追加分段 memo + 超长 code fence 降级~~

**为什么跳过实测：** Phase 1 的分档上限本身是一个保守路径（没开无限放开）；即便 100k 文件 > 50000 行也会被截断到安全区间。实测"能否扛 100k"在上限已经比这低的前提下不 load-bearing。

### 0.2 Streamdown 代码块是否复用已有 Shiki LRU

**目标：** 验证聊天消息流中重复代码块的高亮链路是否命中 `code-block.tsx:163-170` 的 `highlighterCache`（10 项）/ `tokensCache`（200 项）

- **步骤：** 读 `@streamdown/code` 源码 + 运行时断点确认。若未复用 → 记录缓存命中率 0 的证据
- **决策规则：**
  - 若已复用 → 移除 Phase 5.5
  - 若未复用 → Phase 5.5 改造为"对齐 Streamdown 代码块走既有 LRU"
- **预算：** 0.5 人时

### 0.3 长图导出技术路径 POC（改向基线：`widget:export-png`）

**目标：** 验证复用现有隐藏 BrowserWindow 通道（`electron/main.ts:1359-1407`）做全页长图的可行性

- **基线：** 现有 `widget:export-png` IPC 已具备：独立 session 分区 + `loadURL(data:text/html,...)` + `waitForScriptsReady` + `setSize` + `capturePage` + 返回 PNG base64。**4000px 上限**是第 1398 行的 `Math.min(contentHeight + 20, 4000)`
- **POC 要点：**
  - 实测去掉 4000px 上限后 `capturePage` 在 20000px 高度下是否稳定（内存 / GPU 纹理上限）
  - 若 `capturePage` 一次性太大崩 → 分段截图：每段 4000px 用 `capturePage({ x, y, width, height })` → 拼接（具体库选型见下方 POC 对比）
  - 备选：用 `webContents.debugger.sendCommand('Page.captureScreenshot', { captureBeyondViewport: true })` 一次取全页
  - 两个输入源：
    - **HTML 文件** —— 直接 data URL 加载，最简单
    - **Sandpack JSX 预览** —— 不能从父页面读 iframe DOM（Sandpack 禁 same-origin 导致跨域），要选一条路径：
      - **路径 (X-jsx-1)：** 基于 Sandpack `files` 字段重建一个独立 HTML（内联 React/ReactDOM/Tailwind，用 esbuild 预编译 TSX，或用 Sandpack 的 bundler 输出），送入隐藏 BrowserWindow 走一样的导出通道
      - **路径 (X-jsx-2)：** 在 Sandpack iframe 内部注入脚本执行 `canvas.toDataURL()`（用 `html-to-image` 或原生 canvas），通过 `postMessage` 回传 base64；受限于 iframe 内 DOM 大小与跨域字体
  - **分段拼接底层实现（若选 X）：** 不引入 `sharp`（native dep，打包成本高），改用 Electron 内置 `nativeImage` 的 `createFromBuffer` + Canvas 2D（渲染进程侧）拼接，或纯 JS `pngjs` 在主进程拼接；产出 POC 对比：`nativeImage`、`pngjs`、`sharp`（仅在性能证据充分时才引入 native dep）
- **产出：**
  - HTML 场景的导出路径（分段拼接底层实现 + captureBeyondViewport 二选一）
  - JSX 场景的导出路径（X-jsx-1 基于 files 重建 vs X-jsx-2 iframe 内 capture）
  - 新 IPC 签名草案：`artifact:export-long-shot({ html | sandpackFiles, width, pixelRatio, outPath? })` → 返回 PNG 路径或 base64
  - 拼接库选型决策（`nativeImage` / `pngjs` / `sharp`）
  - 废弃原"iframe attach debugger / 临时开 webview"方案（已核实 `webPreferences` 未开 webviewTag）
- **预算：** 1.5-2 人天（含 JSX 跨域导出路径验证）

### 0.4 CodeMirror 6 在 Electron + Next 16 + Tailwind v4 的集成可行性

**目标：** 确定编辑器集成模式与样式隔离方案

- **最小 POC：** 在独立路由（如 `/debug/codemirror`）挂 `@codemirror/view` + `@codemirror/lang-markdown`，验证：
  - Electron 渲染进程加载无 ESM 问题
  - Tailwind v4 `@layer` 是否污染 CodeMirror 内部样式（特别是 `.cm-*` 类）
  - Next 16 SSR 下是否需要 `dynamic(() => import(...), { ssr: false })`
  - bundle 体积增量（`@codemirror/view + state + lang-markdown + basic-setup` 组合）
- **产出：** bundle 增量数字 + 集成模式决策（dynamic import vs 直接 import vs Shadow DOM 隔离）
- **预算：** 0.5 人天

### 0.5 Sandpack 集成 POC（Q1 已定：用 Sandpack）

**目标：** 验证 `@codesandbox/sandpack-react` 在 Electron + Next 16 + Tailwind v4 下可用，覆盖 AI 生成 `.tsx` 的真实场景

- **Fixture：**
  - **A** — 简单 TSX（只用 React + hooks，无外部 import）
  - **B** — 真实 AI 输出样本（带 `import React from 'react'` + 类型标注 + 多 hooks + 第三方 npm 包如 `lucide-react`）
  - **C** — 用到项目 `@/components/ui/*` 别名的完整 TSX module
- **POC 要点（注意：以下都是 POC 待验证项，不是已知事实）：**
  - **bundle 增量：** 实测 `next/dynamic` 按需加载下 `@codesandbox/sandpack-react@^2.20` 的压缩后体积
  - **实际 API 表面：**（Codex 已指出文档里前版用错）
    - `bundlerURL` 位于 `<SandpackProvider options={{ bundlerURL: '...' }}>`，不在 `customSetup`
    - `SandpackPreview` 组件暴露的是 **div props**，**没有**直接的 `iframe sandbox` prop — 控制 iframe 属性必须另寻路径
  - **Sandpack iframe sandbox 控制路径**（三选一 + 一个兜底，POC 要选定可行方案）：
    - **(s1)** Electron `session.webRequest.onHeadersReceived` 为 Sandpack bundler origin 注入 CSP / `Content-Security-Policy` 响应头，限制 `script-src` / `connect-src`
    - **(s2)** 降级到低层 `@codesandbox/sandpack-client`，自己创建 iframe 并手动设 `sandbox` 属性
    - **(s3)** 官方 `<SandpackPreview>` + `ref` 拿到 iframe DOM 后运行时改 `sandbox` 属性（不一定有效，Sandpack 可能重建 iframe）
    - **(s4 兜底)** 接受 Sandpack 默认 iframe 策略（现状默认是 same-origin-free bundler host，已有相当程度隔离），在 Phase 2.5 安全清单中明确"受 Sandpack 默认策略保护，不做额外 CSP"
  - **Bundler 网络依赖：** 默认 CDN 拉模板/依赖；Electron 离线场景下的自托管方案 = 克隆 GitHub 仓库 `codesandbox/sandpack-bundler` → 本地 `yarn dev` 或 `yarn build && yarn start` 启服务 → `SandpackProvider` 的 `options.bundlerURL` 指向本地服务（**注意：npm registry 无 `@codesandbox/sandpack-bundler` 包，不能 `npm i`**，必须走源码启动）
  - **Tailwind v4 样式注入：** 在 Sandpack iframe 内需通过 `files` 字段挂 `index.css` 或 `customSetup.entry` 引入；验证 v4 的 `@layer` 语法兼容性
  - **模板选择：** 默认 `react-ts`；若发现更稳或更快的（如 `vite-react-ts`）按实测结果
  - **Fixture C 项目别名 `@/...`：** 能否通过 `files` 字段把 shadcn 子集作为只读模块注入 iframe
- **产出：**
  - Sandpack 实际 API 使用示例（`SandpackProvider options` + `files` + `customSetup`）
  - iframe sandbox 控制路径选定（s1/s2/s3/s4）+ 证据
  - bundle 增量数字（压缩后 KB）+ 首次加载时延
  - iframe 安全配置清单（对应 Phase 2.5）
  - `SandpackPreview` 组件 props 草案
  - A/B/C 三类 fixture 的成功率记录
- **决策规则：**
  - 若 A + B 通过、C 可接受（或可标注"别名 import 不支持"）→ Phase 2.1 按 Sandpack 落地
  - 若 bundle > 1MB gzipped 或 CDN 失败在离线环境不可接受 → 回退到 **snippet-only（`react-jsx-parser`）** 并更新决策日志；相应 AI system prompt 补一条"`.tsx` 预览要求无 import"的提示
- **预算：** 1-1.5 人天

### 0.6 DiffSummary 升级改造 POC（Q2 已定：升级 DiffSummary）

**目标：** 为"把 `<DiffSummary>` 升级为带 Artifact 预览按钮的单一入口 UI"设计改造接口 + 预估工作量 + 覆盖 Codex 警告的"双 UI"风险

- **现状核实（Codex 第三轮已指出）：**
  - `src/components/chat/MessageItem.tsx:712-728` 渲染 `<DiffSummary files={modifiedFiles} />`，从 `write/edit/writefile/create_file/notebookedit` 等工具结果抽取
  - **`DiffSummary` 是 `MessageItem.tsx:535` 的内联 `function DiffSummary({ files })`，不是独立文件** — POC 第一步必须决定"先抽组件再改"还是"原地改造"
  - 现 props 极简只有 `{ files: Array<{ path; name }> }`，行 item 渲染结构待读 535+ 原码
  - `ToolActionsGroup` 已有 write/edit 工具展示行 — 需读代码确认与 DiffSummary 的职责边界（是否有重叠）
- **POC 步骤：**
  1. **读 `MessageItem.tsx:535+` 的内联 DiffSummary**，记录现有 props + 行 item 渲染结构（不是读独立 `DiffSummary.tsx`，该文件不存在）
  2. **决定抽组件 or 原地改：**
     - 若 `DiffSummary` 行为与 `MessageItem` 的其他渲染强耦合（共享 state / context 多） → 原地改造，新 props 通过 `MessageItem` 的闭包传入
     - 若职责清晰、无强耦合 → 先抽成 `src/components/chat/DiffSummary.tsx` 独立组件，便于测试 + 未来迁移
  3. 读 `ToolActionsGroup` 确认与 DiffSummary 的关系（独立 / 互补 / 有重叠）；若 ToolActionsGroup 已有"预览"能力则本 Phase 不重复造，否则明确两者分工
  4. 设计新 props 契约：
     ```tsx
     <DiffSummary
       files={modifiedFiles}
       onPreview?: (file: ModifiedFile) => void;          // 按扩展名决定行内是否显示"预览"按钮
       onExportLongShot?: (file: ModifiedFile) => void;   // 仅 HTML 类扩展显示（见按钮可见性规则）
     />
     ```
  4. 定义按钮可见性规则：
     - `.md` / `.mdx` / `.html` / `.htm` / `.jsx` / `.tsx` / `.csv` / `.tsv` → 行内显示"预览"
     - `.html` / `.htm` → 额外显示"导出长图"（JSX/TSX 当前会导出源码截图，等 Sandpack→HTML 捕获路径落地再放开）
     - 其他扩展 → 保留原 diff 摘要样式，不加按钮
  5. 做 mock UI：一张列表同时包含"可预览+导出"行、"仅可预览"行、"仅 diff 摘要"行
  6. CDP 下实测交互连贯性：点击预览行→PreviewPanel 打开；点击仅 diff 行→现有行为不变
- **产出：**
  - 抽组件 vs 原地改的决策 + 理由
  - DiffSummary 改造点清单（受影响行数 + 是否抽组件 + 受影响的 `MessageItem` 区段）
  - 新 props 契约 + 按钮可见性规则表
  - 与 ToolActionsGroup 的关系定性（独立 / 合并 / 互不影响）
- **决策规则：**
  - 若改造点 ≤ 10 处、无破坏性接口变更 → Phase 2.3 按升级方案直接落地
  - 若改造点 > 20 处或 props 冲突严重 → **回退方案**：保留原 DiffSummary + 新增 lightweight Artifact 行在其下方（视觉上明显区分，如右对齐 / 不同背景色），明确两者分工（DiffSummary = diff 摘要，Artifact 行 = preview 入口），避免双 UI 感；更新决策日志
- **预算：** 0.5-1 人天

### 0.7 PreviewPanel 数据模型 POC（支撑 Phase 1.5）

**目标：** 为 PreviewPanel 从"仅接 `filePath` 字符串"迁移到"接 `{filePath? | inlineContent? + kind}`"的契约变更做最小验证

- **步骤：**
  1. 读 `src/hooks/usePanel.ts` 或等价 Context 的 `previewFile` 类型定义
  2. 设计新类型 discriminated union：
     ```ts
     type PreviewSource =
       | { kind: 'file'; filePath: string }
       | { kind: 'inline-html'; html: string; virtualName?: string }
       | { kind: 'inline-jsx'; jsx: string; virtualName?: string }
       | { kind: 'inline-datatable'; rows: unknown[][]; header: string[] }
     ```
  3. `PreviewPanel` 入口拆分 useEffect：`kind==='file'` 走原 fetch API；`kind==='inline-*'` 跳过 fetch 直接进渲染分支
  4. `setPreviewFile(path)` 调用点全部迁移到 `setPreviewSource({ kind:'file', filePath:path })`（保持 API 契约兼容或加 adapter）
- **产出：** 新类型定义 + 改造清单（影响文件列表 + 迁移顺序）
- **决策规则：** 若迁移点超过 15 个 → Phase 1.5 拆两步（adapter 兼容 + 分批迁移）；否则一次性迁移
- **预算：** 0.5 人天

### 0.8 Streamdown 能否接 remark 插件 POC（支撑 Phase 5.2）

**目标：** 验证 `remarkCollapsibleSections` 能否插入 Streamdown 渲染链

- **步骤：**
  1. 读 Streamdown 源码 / 类型定义，确认其 `plugins` prop 是否接受 unified/remark 插件对象
  2. 若是对象链（非标准 unified pipeline）→ 验证 `@streamdown/math` / `@streamdown/code` 的插件结构，看能否按相同 pattern 挂自定义 remark 插件
  3. 最小 POC：写一个打印 AST 的 noop remark 插件，塞进 `PreviewPanel.tsx` 的 `_streamdownPlugins`，看是否被调用
- **决策规则：**
  - 若能接 → Phase 5.2 按原计划
  - 若不能接 → Phase 5.2 改为"自建 markdown-to-html pipeline + 折叠装饰"，或降级为"仅在 PreviewPanel 里用 react-markdown（不再 Streamdown），聊天消息侧放弃折叠"
- **预算：** 0.5 人天

### 0.9 Phase 0 验收

- 0.1-0.8 每项产出结论写回本文档的"决策日志"段
- 更新 Phase 1/2/3/4/5 的技术方案段，把 POC 前的"待定"替换为"已定"（或在回退触发时切到 plan B 并更新决策日志）
- 状态表中 Phase 0 标 ✅
- POC 文档若篇幅较大，独立放到 `docs/research/phase-0-pocs/` 下，以 `0.1-markdown-perf.md` 等子文件命名

---

## Phase 1 — 文件树 Markdown 预览放开截断 + API 合同闭合

**价值形态：** A 可见

**用户痛点：** 10 万字符级 Markdown 文件打开看不全——根因是 `src/app/api/files/preview/route.ts:52` 的 `Math.min(maxLines, 1000)` 硬 cap。

### 1.1 服务端 `readFilePreview` 分档 + 字节保护

- `src/lib/files.ts` 的 `readFilePreview` 改造：
  ```ts
  const EXTENSION_LINE_CAPS: Record<string, number> = {
    '.md': 50000, '.mdx': 50000, '.txt': 50000, '.log': 10000,
    '.csv': 10000, '.tsv': 10000,
    // 代码文件保留 1000
    '.ts': 1000, '.tsx': 1000, '.js': 1000, '.jsx': 1000, '.py': 1000, ...
  };
  const BYTE_LIMIT = 10 * 1024 * 1024; // 10MB 单文件硬上限
  ```
- 执行顺序：
  1. `fs.stat` 先拿 byte size，若 > 10MB 直接返回 `{ error: 'file_too_large', bytes_total }`
  2. 读前 4KB 检测二进制（Null byte `\x00` 或非 UTF-8 解码失败）→ 返回 `{ error: 'binary_not_previewable' }`
  3. 通过上述两关后，按扩展名查 `EXTENSION_LINE_CAPS`（未知扩展默认 1000）
  4. `maxLines` query 参数作为上限约束（`Math.min(queryMax, extensionCap, 100000)`——最外层硬保底 10 万行防异常）
- `src/app/api/files/preview/route.ts` 调整：
  - 移除第 10 行 `parseInt(searchParams.get('maxLines') || '200', 10)` 的默认 200，改为"不传则用扩展名上限"
  - 移除第 52 行 `Math.min(maxLines, 1000)`，转嫁给 `readFilePreview` 内部

### 1.2 `FilePreview` 类型加 `truncated` / `bytes_read` / `bytes_total` 字段

- `src/types/index.ts:49-56` 改为：
  ```ts
  export interface FilePreview {
    path: string;
    content: string;
    language: string;
    line_count: number;
    line_count_exact: boolean;
    truncated: boolean;        // 新增：true = 内容被截断，未读完整个文件
    bytes_read: number;         // 新增：实际读取字节数
    bytes_total: number;        // 新增：文件总字节数
  }
  ```
- 前端 `SourceView` / `RenderedView` 在 `truncated === true` 时在内容底部显示"文件已截断，显示前 X 行 / Y 字节 / 总 Z 字节"提示条

### 1.3 前端 `PreviewPanel.tsx:117` 调用侧

- 移除 `maxLines=500` 硬编码参数，让后端按扩展名决策
- 若用户明确希望某扩展名超过默认 cap（配置侧未纳入本 Phase），可留作 Phase 4.x+ 的编辑器续作

### 1.4 性能验证（依赖 0.1 结论）

- 若 0.1 证明前端能扛 → 本 Phase 到 1.3 即结束
- 若 0.1 证明前端卡 → 追加：
  - 1.4a `RenderedView` 按 heading 切段，每段独立 memo（key=段落哈希）
  - 1.4b 超长 code fence（>5k 字符）渲染为无 Shiki 的 `<pre>`，降级保命

### 1.5 i18n 同步

- `src/i18n/en.ts` / `zh.ts` 新增 key：
  - `filePreview.truncated` — 例如 "File truncated, showing first {lines} lines / {bytesRead} of {bytesTotal}"
  - `filePreview.tooLarge` — "File too large to preview (>{limit})"
  - `filePreview.binaryNotPreviewable` — "Binary file, cannot preview"

### 1.6 验收标准

- 打开 10 万字符 Markdown 文件，内容完整显示，不被截断
- 打开 50MB `.log` 文件 → 返回 `file_too_large` 错误提示，不会卡 Node 进程
- 打开 `.png` / `.exe` 等二进制 → 返回 `binary_not_previewable` 提示，不尝试 UTF-8 解码
- `.ts` 等代码文件仍 1000 行上限，确认无回归
- `FilePreview` 响应体带 `truncated` + `bytes_*` 字段
- `npm run test` + `npm run test:smoke` 通过
- CDP 验证 PreviewPanel 显示截断提示条（对齐 CLAUDE.md）

---

## Phase 1.5 — PreviewPanel 数据模型迁移

**价值形态：** C 基建

**用户痛点：** 无直接用户价值，但 Phase 2（.jsx/.tsx 预览）/ Phase 5.4（表格 Artifact）都需要 `PreviewPanel` 能接受 inline 内容。如果不独立做这件事，两个 Phase 会各自拼一套机制，产生契约分裂。

**依赖：** Phase 0.7 POC 结论 — **已完成**，全仓触点锁定 5 文件 + 12 个风险点；完整清单见 [`docs/research/phase-0-pocs/0.7-preview-source-migration.md`](../../research/phase-0-pocs/0.7-preview-source-migration.md)。

**5 文件触点（按改造优先级）：**

1. `src/hooks/usePanel.ts:47-48` — 类型定义（新增 `PreviewSource` 联合 + adapter 字段）
2. `src/components/layout/AppShell.tsx:355-452` — 唯一 state 所有者，`useState`+`useCallback`+`useMemo`+路由清理 effect 全部迁移
3. `src/components/layout/PanelZone.tsx:13,15,22` — **R1 最高风险**：gate 条件 + 挂载条件必须同步改为 `!!previewSource`，否则 inline-\* 面板永远挂不上
4. `src/components/layout/panels/PreviewPanel.tsx:90,103,105-142,151-154,156,158-163,165-175,186-238` — 主消费端按 `previewSource.kind` switch 分派渲染；`useEffect(loadPreview)` 加 `kind === 'file'` guard
5. `src/components/layout/panels/FileTreePanel.tsx:18,48-55` — **通过 adapter 透明兼容，零改动**

**12 风险点（R1-R12）：** R1 gate 漏改 / R2 扩展名判断对 inline-\* 无意义 / R3 `loadPreview` guard / R4 `ViewModeToggle` 对 inline-\* 语义 / R5 FileTreePanel adapter 互动 / R6 路由切换清理 / R7 `useMemo` 依赖 / R8 不持久化 / R9 `setPreviewSource(null)` 与 `setPreviewFile(null)+setPreviewOpen(false)` 等价 / R10 adapter 单向 / R11 实施前重跑 grep / R12 smoke test 覆盖 `inline-html` + `inline-datatable` 专压 R1

### 1.5.1 `PreviewSource` 类型引入

基于 0.7 POC 的类型草案落地，替换现有 `previewFile: string | null`：

```ts
// src/hooks/usePanel.ts 或对应 Context
export type PreviewSource =
  | { kind: 'file'; filePath: string }
  | { kind: 'inline-html'; html: string; virtualName?: string }
  | { kind: 'inline-jsx'; jsx: string; virtualName?: string; bindings?: Record<string, unknown> }
  | { kind: 'inline-datatable'; rows: unknown[][]; header: string[]; virtualName?: string };

interface PanelContext {
  previewSource: PreviewSource | null;
  setPreviewSource: (source: PreviewSource | null) => void;
  // 兼容旧 API 的 adapter：
  previewFile: string | null;  // = previewSource?.kind === 'file' ? previewSource.filePath : null
  setPreviewFile: (path: string | null) => void;  // 内部转成 setPreviewSource({ kind:'file', filePath })
}
```

### 1.5.2 `PreviewPanel.tsx` 内部改造

- 头部 `useEffect(loadPreview)` 现只对 `kind === 'file'` 跑 fetch
- `RenderedView` / `SourceView` 接收的不再是 `FilePreview` 对象，而是统一的 `content` + `language`（file 分支里从 API 响应拿，inline-* 分支里直接从 source 构造）
- 新增渲染分支：`inline-html` → 现有 iframe srcDoc 通路；`inline-jsx` → 接 Phase 2.1 决定的预览组件；`inline-datatable` → Phase 5.4 的 DataTable viewer

### 1.5.3 `PanelZone` gate 条件迁移（Codex P1 指出，必须同步）

**现状：** `src/components/layout/PanelZone.tsx:15,22` 的 gate 条件是：

```tsx
const anyOpen = (previewOpen && !!previewFile) || gitPanelOpen || ...;  // L15
if (!anyOpen) return null;                                                // L17
// ...
{previewOpen && previewFile && <PreviewPanel />}                          // L22
```

如果只改 `PreviewPanel` 和 `usePanel` 的内部数据模型、不改 `PanelZone`，**inline-html / inline-jsx / inline-datatable 根本挂不上**（没有 `previewFile`）。

**迁移：**

- `PanelZone.tsx:15` 的 `anyOpen` 公式改为 `(previewOpen && !!previewSource) || ...`
- `PanelZone.tsx:22` 的挂载条件改为 `{previewOpen && previewSource && <PreviewPanel />}`
- 保留 `previewFile` adapter（`previewSource?.kind === 'file' ? previewSource.filePath : null`）以兼容任何其他直接读 `previewFile` 的调用点
- grep 全仓确认还有哪些组件直接读 `previewFile`（至少 `PreviewPanel` 内部 + `PanelZone` 外部有），逐点迁移或通过 adapter 兼容

### 1.5.4 调用点迁移

- 现有 `setPreviewFile(path)` 调用全部保持（通过 adapter 兼容）
- 新功能用 `setPreviewSource({ kind: 'inline-*', ... })`

### 1.5.5 验收标准

- 旧代码路径（文件树点击 .md 预览）零回归
- `setPreviewSource({ kind: 'inline-html', html: '<p>test</p>' })` 能打开 PanelZone 并正确渲染 iframe（验证 PanelZone gate 已迁移）
- `setPreviewSource({ kind: 'inline-datatable', rows: [[1,2]], header: ['a','b'] })` 能打开 PanelZone 渲染 datatable（Phase 5.4 依赖项预留）
- `npm run test` 通过
- TypeScript 类型系统强制 caller 按 discriminated union 写代码
- grep 全仓确认无漏改的 `previewFile` 直接读取点

---

## Phase 2 — Artifact 网页预览扩展

**价值形态：** A 可见

**用户痛点：** AI 写出 `.html`/`.jsx`/`.tsx` 文件时，消息里只看到代码块，用户要手动去文件树找并点开。

**交互原则：** 聊天消息里的 AI 修改文件列表中出现对应文件时，列表行升级为 Artifact 卡片 → 用户点击 → 拉起 PreviewPanel。**不自动弹**，遵守 feedback「no silent auto-irreversible」。

**依赖：** Phase 0.5（`.tsx` 预览方案决策）+ Phase 0.6（Artifact 卡片落点决策）+ Phase 1.5（PreviewPanel 数据模型）

### 2.1 Sandpack 集成（Q1 已选定）

**前置：** Phase 0.5 POC 产出的 Sandpack 模板配置 + bundle 策略 + iframe 安全配置。

- 依赖：`npm i @codesandbox/sandpack-react`（具体版本由 0.5 POC 锁定，当前参考 `^2.20`）
- 新增 `src/components/editor/SandpackPreview.tsx`：
  - `next/dynamic(() => import('@codesandbox/sandpack-react'), { ssr: false })` 按需加载，不进首屏 bundle
  - 从入参 `{ filePath?, content? }` 构造 Sandpack `files` 字段；`filePath` 决定挂载点（如 `/App.tsx`）
  - **模板：** `react-ts`（或 0.5 POC 发现更稳的模板）
  - **iframe sandbox 控制：** 按 Phase 0.5 POC 选定的路径（s1 webRequest CSP / s2 低层 sandpack-client / s3 ref 改 iframe / s4 接受默认策略）；**不要**假设 `SandpackPreview` 能直接接 `sandbox` prop（它只暴露 div props）
  - **Bundler 配置：** `customSetup.dependencies` 给依赖清单（`react`、`react-dom`、`lucide-react` 等按白名单扩展）；离线场景用 `SandpackProvider` 的 `options={{ bundlerURL: '...' }}` 指向**本地从 GitHub 源码构建启动的 `codesandbox/sandpack-bundler` 服务**（**位置在 `options`，不在 `customSetup`**；npm registry 无此包，必须走源码启动）
- 处理项目别名 `@/components/ui/*`：
  - 若 0.5 POC 证实可用 → Sandpack `files` 字段注入 shadcn 子集（只读虚拟模块）
  - 若不可用 → 在预览组件顶部展示"此文件引用项目别名 `@/...`，预览仅编译到外部 npm 依赖"的说明条
- **回退：** 若 Phase 0.5 POC 失败（bundle > 1MB gzipped 且无法压缩 / 离线 CDN 不通 / 集成不稳定）→ 回退到 `react-jsx-parser` snippet-only：
  - `npx ai-elements@latest add jsx-preview`（**正确命令**，不是 `npx shadcn@latest add https://...`）
  - 落地 `src/components/ai-elements/jsx-preview.tsx`，白名单组件见 2.5
  - AI system prompt 补一条"`.tsx` 文件预览要求无 `import`"提示
  - 更新决策日志

### 2.2 `PreviewPanel` 扩展 `.jsx` / `.tsx` 渲染分支

- `RENDERABLE_EXTENSIONS` 追加 `.jsx`、`.tsx`（`.mdx` 已在列表，复核即可）
- `RenderedView` 内追加分支：扩展名为 `.jsx` / `.tsx` 时，用 `<SandpackPreview>` 渲染（若 2.1 回退到 snippet-only，则用 `<JSXPreview>`）
- `.jsx` / `.tsx` 文件走 file 分支（读取文件内容）；未来若有 inline .tsx snippet（AI 直接内联生成而非写入文件）通过 Phase 1.5 的 `inline-jsx` 通道

### 2.3 工具结果落点：升级 DiffSummary（Q2 已选定 / 0.6 POC 已落定）

**Phase 0.6 POC 结论：抽独立组件，改造 4 处，耦合度为零。**

**改造步骤（共 4 处）：**

1. **新建** `src/components/chat/DiffSummary.tsx`：
   - 迁移 `MessageItem.tsx:535-572` 实现
   - 在每个 `files.map` 行（原 `:560-565`）右侧追加按钮槽（条件渲染）
   - 导出 `DiffSummary` 组件 + `DiffFile` / `DiffSummaryProps` 类型
2. **删除** `src/components/chat/MessageItem.tsx:531-572` 原内联定义
3. **修改** `src/components/chat/MessageItem.tsx:727` 调用点 + `:13` 附近新增 `import { DiffSummary } from './DiffSummary'`
4. **按需清理** `MessageItem.tsx:15` 中未再使用的 `NotePencil` 导入（`CaretRight` 仍被 `:696-701` 用户消息展开复用，保留）

**Props 契约：**

```ts
export type DiffFile = { path: string; name: string };

export interface DiffSummaryProps {
  files: DiffFile[];
  /** 点击"预览"，宿主负责打开 artifact 面板 */
  onPreview?: (file: DiffFile) => void;
  /** 点击"导出长图"，宿主负责渲染 + 下载 */
  onExportLongShot?: (file: DiffFile) => void;
}
```

**按扩展名的按钮可见性规则（组件内私有辅助）：**

```ts
function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}
const PREVIEWABLE = new Set(['.md', '.mdx', '.html', '.htm', '.jsx', '.tsx', '.csv', '.tsv']);
const LONGSHOT    = new Set(['.html', '.htm']);
// .jsx/.tsx 不在 LONGSHOT：当前导出管线把原文送进隐藏 BrowserWindow，
// TSX 原文是源码而不是渲染页面，会导出一张源码截图。Sandpack→HTML
// 的捕获路径（POC 0.3 §X-jsx-1 / X-jsx-2）落地后再放开。
```

- `onPreview && PREVIEWABLE.has(ext)` → 显示"预览"
- `onExportLongShot && LONGSHOT.has(ext)` → 显示"导出长图"
- 回调未传时**一律不渲染按钮**（保证宿主未接线时零视觉变化，便于分阶段上线）

**调用点（`MessageItem.tsx:727`）：**

```tsx
<DiffSummary
  files={unique}
  onPreview={(file) => setPreviewSource({ kind: 'file', filePath: file.path })}
  onExportLongShot={(file) => /* Phase 3 导出 IPC */}
/>
```

**其他约束：**
- 行本体可点击（整行 click 区域 = "预览"），与按钮等价
- **禁止自动拉起**：DiffSummary 挂载时不调用 `setPreviewSource`，仅由用户点击触发
- 与 `ToolActionsGroup`（`tool-actions-group.tsx:500-628`）**独立互补**：后者是动作时间线，DiffSummary 是本轮产出物汇总；按钮**只**落 DiffSummary，不改 `TOOL_REGISTRY`

### 2.4 Artifact 行 UI（在 DiffSummary 行内实现）

- DiffSummary 行内的预览/导出按钮使用 shadcn `Button` + phosphor icon；无需引入独立 Artifact 卡片组件
- 若 Phase 0.6 POC 证明 `src/components/ai-elements/artifact.tsx` 的 8 件套原语能无缝嵌入 DiffSummary 行（视觉风格一致），则复用；否则保持现有 DiffSummary 的行级 CSS
- 行内微交互：
  - 操作类型标签（"已创建" / "已修改"）
  - 文件名（basename）+ 相对路径（tooltip）
  - 预览按钮 + （Phase 3 后）导出长图按钮
- 不在聊天消息里新增独立的 Artifact 卡片组件；一切挂在 DiffSummary 上
- 同一次工具调用只渲染一次 DiffSummary（已有行为）
- 同一文件被多次 Edit，每次消息里各自渲染一次（保留时间线）

### 2.5 Sandpack iframe 安全边界（POC 待验证的断言，非已知事实）

Sandpack 运行在 iframe 里提供基础隔离，但**具体能控制到哪一层 sandbox 属性 / CSP 由 Phase 0.5 POC 决定**（s1-s4 四条路径之一）。本节列"我们希望的安全约束"，实际落地由 POC 选定的控制路径决定是否满足；若某条默认不满足，Phase 0.5 需给出注入方案。

- **希望的 iframe sandbox 属性（具体是否能控制由 POC 定）：**
  - `allow-scripts` 必须（Sandpack bundler 执行）
  - 禁 `allow-same-origin`（避免访问主窗口 cookie / localStorage）
  - 禁 `allow-top-navigation`（避免跳走主页面）
  - 禁 `allow-popups`（避免弹窗逃逸）
  - **如果 Phase 0.5 选 (s4) 接受默认策略**：明确记录 Sandpack 默认 iframe 对应的实际属性，评估差距是否可接受；差距太大则切 s1/s2
- **希望的 CSP（具体是否能注入由 POC 定）：**
  - `script-src` 白名单：Sandpack bundler 域 + `'unsafe-eval'`（bundler 需要）
  - `connect-src`：限制到 bundler 域 + `data:`
  - 注入路径：Electron `session.webRequest.onHeadersReceived` 监听 Sandpack 域 → 写 `Content-Security-Policy` 响应头
  - **若 Sandpack 响应头已被其服务端固定**：评估是否需要切换本地 bundler（从 GitHub `codesandbox/sandpack-bundler` 源码 build + start，`options.bundlerURL` 指向本地服务），从而完整控制 CSP
- **父子通信：**
  - 只接受 `@codesandbox/sandpack-client` 约定的消息结构；主窗口**不执行** iframe 任意指令
- **外部网络：**
  - iframe 内 `fetch` / `XHR` 受浏览器 CORS 限制
  - 项目内资源通过 `files` 字段静态注入（不经网络）
- **错误隔离：**
  - Sandpack Preview runtime error 仅在 iframe 内 ErrorOverlay 显示
  - `SandpackPreview` 外层包 React ErrorBoundary 兜底
- **POC 验收攻击样本（4 个，作为 Phase 0.5 安全路径验收项）：**
  - iframe 内 `parent.document.title = 'x'` — 期望：被 same-origin 限制拦截；若未拦截则 POC 必须切换 s1/s2 加控
  - iframe 内 `window.top.location = '...'` — 期望：top-navigation 拦截
  - iframe 内 `window.open('...')` — 期望：popup 拦截
  - iframe 内加载 `<script src="外部 URL">` — 期望：CSP script-src 拦截（若走 s1/s2）或默认策略拦截（若走 s4）
  - 若任一样本未被拦截且该行为超出安全容忍 → 切更严格的控制路径或在 i18n 错误条里明确安全警告
- **回退方案（snippet-only 路径）的安全清单：**
  - 组件 allowlist：`Button / Card / CardHeader / CardTitle / CardContent / Input / Label / Badge / Separator / Dialog` 共 10 个，显式注入 `components` prop
  - Props allowlist：`className / children / href / onClick / onChange / value / disabled / type / placeholder / title / aria-*`
  - 事件：仅 bindings 显式注入的函数
  - 链接：`<a href>` 仅 `https?://`；禁 `javascript:` / `data:`
  - 图片：`<img src>` 仅 `https?://` + `data:image/*`；禁 `<script>` / `<iframe>` / `<object>`
  - ErrorBoundary 包裹
  - 回退验收 5 样本：`<script>` / `javascript:` href / `onerror=alert(1)` / 白名单外组件 / 循环引用 props

### 2.6 一致性校验（文档写作纪律，非代码任务）

写完 Phase 2 代码后，grep 本计划文件 + 代码改动：
- 关键词：`自动弹` / `auto-open` / `静默打开` / `自动拉起`，确认所有命中均为否定描述
- `inlineContent` 出现位置限定在 Phase 1.5 / 2（inline-jsx）/ 5.4 三处，其他地方不应出现
- 对齐 feedback「Plan consistency pass」

### 2.7 i18n 同步

- `filePreview.preview` — "Preview" / "预览"
- `filePreview.exportLongShot` — "Export Long Screenshot" / "导出长图"
- `filePreview.artifactCreated` — "Created" / "已创建"
- `filePreview.artifactModified` — "Modified" / "已修改"
- `filePreview.sandpackLoading` — "Loading sandbox..." / "正在加载沙箱..."
- `filePreview.sandpackError` — "Sandbox failed to load: {error}" / "沙箱加载失败：{error}"
- `filePreview.aliasNotSupported` — "This file uses `@/` path aliases, preview compiles to external npm deps only" / "该文件使用 `@/` 别名，预览仅编译外部 npm 依赖"
- `filePreview.jsxNotSupported` — "Preview requires the file to be a self-contained JSX snippet" / "预览要求文件为自包含的 JSX 片段"（仅 2.1 回退 snippet-only 时使用）

### 2.8 验收标准

- AI 调用 `Write index.html` → 消息底部 DiffSummary 列表中该文件行有"预览"按钮
- 点击 → 右侧 PreviewPanel 打开，渲染 HTML
- AI 调用 `Edit App.tsx` → 同样出现"预览"按钮；点击打开 Sandpack 预览（或回退后的 JSXPreview）
- 若 App.tsx 带 `import React` + hooks + 第三方依赖（如 `lucide-react`）→ Sandpack 能正确渲染并显示；若只能部分渲染（如别名未解析），UI 有明确提示而不是静默失败
- 4 个 iframe 安全攻击样本全部被拦截（见 2.5）
- AI 调用 `Edit config.yaml`（非可预览扩展）→ DiffSummary 行不出现"预览"按钮，保留 diff 摘要原行为
- 用户未点击时 PreviewPanel 不被拉起（核心纪律）
- Sandpack 主路径：Phase 2.5 列的 4 个 iframe 安全样本全部被阻断（依 Phase 0.5 选定的 s1/s2/s3/s4 路径验证）
- 回退到 snippet-only 路径时：Phase 2.5 列的 5 个 `react-jsx-parser` 攻击样本全部被拦截
- `npm run test` + CDP 验证（对齐 CLAUDE.md「UI 改动必须用 CDP 验证」）

---

## Phase 3 — Artifact 网页一键导出长图（基线：`widget:export-png` 复用）

**价值形态：** A 可见

**用户痛点：** 预览一个 HTML/JSX 网页后没法简单分享，截屏只能截视口。

**技术基线：** **复用 `electron/main.ts:1356-1407` 的 `widget:export-png` IPC 通道**（独立 session 分区 + data URL 加载 + capturePage）。Phase 0.3 POC 决定去 4000px 上限的具体手段（分段拼接 vs CDP captureBeyondViewport）。**废弃原"iframe attach debugger / 切 webview"路径。**

### 3.1 扩展 `widget:export-png` → `artifact:export-long-shot`

- 新 IPC handler `artifact:export-long-shot`（与 widget 保留独立 handler，避免污染现有 widget 导出路径）：
  ```ts
  ipcMain.handle('artifact:export-long-shot', async (_e, params: {
    source: { kind: 'html'; html: string } | { kind: 'serialized-dom'; html: string };
    width: number;
    pixelRatio?: number;
    outPath?: string;  // 未传则返回 base64
  }) => { ... });
  ```
- 内部流程：
  1. 创建隐藏 BrowserWindow（独立 session partition、无 preload、禁止 will-navigate/setWindowOpenHandler —— 复用现有 widget:export-png 的安全配置）
  2. `loadURL(data:text/html;charset=utf-8,${encodeURIComponent(html)})`
  3. 等脚本 ready（复用 `__scriptsReady__` console message + timeout fallback）
  4. `contentHeight = await exec('document.body.scrollHeight')`
  5. **去掉 4000px 上限**：按 Phase 0.3 POC 决定走 (X) 或 (Y)：
     - (X) **分段拼接**：`setSize(width, 4000)` → `for (y=0; y<contentHeight; y+=3800) { capturePage({x:0,y,width,height:3800}) }` → 按 Phase 0.3 POC 选定的拼接库（优先 Electron 内置 `nativeImage` + Canvas 2D；次选纯 JS `pngjs`；**不默认引入 `sharp`**——native dep，需 after-pack ABI 重编译 + macOS/Windows 双平台打包 + CI 验证，仅在性能证据充分时才评估引入）
     - (Y) **CDP captureBeyondViewport**：`webContents.debugger.attach('1.3')` → `sendCommand('Page.captureScreenshot', { captureBeyondViewport: true, format: 'png' })`
  6. 返回 PNG base64 或写入 outPath
- 错误处理：超时、canvas size 上限、内存不足都要显式返回错误码（不能静默失败）

### 3.2 HTML 预览导出

- PreviewPanel 在 `kind === 'file' && ext === '.html'` 或 `kind === 'inline-html'` 时显示"导出长图"按钮
- 点击 → 读取 file 内容（file 分支）或直接用 html（inline 分支）→ 调 `window.electronAPI.artifactExportLongShot({ source: { kind:'html', html }, width: pixelWidth })`
- 保存到 `~/Downloads/{文件名}-{时间戳}.png`

### 3.3 JSX (Sandpack) 预览导出 — 跨域重写

**前置问题：** Sandpack 运行在 iframe 内且 Phase 2.5 禁 `allow-same-origin`（或接受 Sandpack 默认策略），**父页面无法读取 iframe DOM**。原计划"父页面 `querySelector` + `outerHTML`"**不可行**（Codex P1 指出）。两条可行路径，由 Phase 0.3 POC 选定：

- **路径 (X-jsx-1) 首选：基于 Sandpack `files` 重建独立 HTML → 走 HTML 导出通道**
  - 渲染进程从当前 `SandpackPreview` 组件的 state 拿到 `files` + 依赖清单
  - 用 `esbuild` 或内置 Sandpack bundler 在隐藏 BrowserWindow 内预编译 TSX（或直接加载 `import` + `<script type="importmap">` 让浏览器运行时解析）
  - 拼装完整 HTML：`<html><head>` 内 inline Tailwind CSS + React/ReactDOM UMD CDN 链 + mount script `<body>` 内容 `<div id="root">`
  - 送入 `artifact:export-long-shot({ source: { kind: 'html', html }, width })` —— 与 HTML 场景完全复用同一通道
  - **优点：** 独立 BrowserWindow 可完整控制，capturePage / CDP 全可用
  - **缺点：** 拼装 HTML 有工作量，Tailwind v4 inline / CDN 依赖策略要确定

- **路径 (X-jsx-2) 备选：iframe 内 capture + postMessage 回传**
  - 注入脚本到 Sandpack 预览 iframe：使用 `html-to-image`（已在依赖 `package.json:73`）`toPng(document.body)` → 拿到 base64
  - 通过 `postMessage` 回传给父页面
  - 父页面按 base64 保存为 PNG
  - **优点：** 不需要重建 HTML，复用 Sandpack 运行时状态
  - **缺点：** iframe 内 DOM 大时 `toPng` 可能 OOM；跨域字体/图片可能加载失败；需要绕开 Sandpack 自身对 iframe 内注入的限制（sandbox/CSP 可能阻止 `html-to-image` 加载）

- **Phase 0.3 POC 选定：** 两条路径都跑 20000px 高度 JSX 预览 fixture，比较：产物完整性、Tailwind 丢失率、失败率、耗时；产出选型结论写回决策日志

- **Tailwind 运行时 CSS 获取策略：**
  - 路径 (X-jsx-1)：Tailwind v4 的生产 CSS 预构建并 inline 到独立 HTML 的 `<style>`；若使用 CDN 则带 `<link>`
  - 路径 (X-jsx-2)：`html-to-image` 会用 `getComputedStyle` 内联关键样式，但某些伪类/动画/filter 会丢

### 3.4 导出按钮集成

- `PreviewPanel.tsx:182-206` 头部追加一个导出按钮（图标 `Download` 或 `Camera`）
- 仅在 `html` / `inline-html` / `inline-jsx` / `.jsx` / `.tsx` 类预览类型下显示
- 点击：按钮 disabled + loading → 调 IPC → 完成后 Toast 提示路径
- DiffSummary 行的"导出长图"按钮（Phase 2.3）也走同一个 IPC

### 3.5 安全约束（沿用 widget:export-png）

- 独立 session partition（每次导出新建，销毁时回收）
- 禁止主窗口 preload 注入
- Block `will-navigate` + `setWindowOpenHandler`
- 外部资源加载遵守 CSP
- 导出期间主窗口用户输入不受影响（异步流程）

### 3.6 i18n 同步

- `artifact.exportLongShot.button` — "Export long screenshot" / "导出长图"
- `artifact.exportLongShot.loading` — "Exporting..." / "正在导出..."
- `artifact.exportLongShot.success` — "Saved to {path}" / "已保存到 {path}"
- `artifact.exportLongShot.failure` — "Export failed: {error}" / "导出失败：{error}"
- `artifact.exportLongShot.tooLarge` — "Page too tall, exported as {segments} segments" / "页面过长，分 {segments} 段导出"（若走分段拼接方案）

### 3.7 验收标准

- 打开一个 `scrollHeight` = 20000px 的 HTML 文件 → 导出的 PNG 完整包含所有内容（宽度=视口宽、高度=20000px ±2%）
- JSX 预览同样，导出后 Tailwind 样式未丢失（按钮/Card 视觉完整）
- 5MB 大图片背景的 HTML 导出不 OOM
- 主窗口开 DevTools 状态下依然能导出（独立 BrowserWindow 无冲突）
- macOS + Windows 双平台手动验证（对齐 CLAUDE.md「涉及多平台需考虑差异性」）
- 导出失败（如分段中途 timeout）有清晰错误 Toast，不会默默无反应

### 3.8 风险与回退

| 风险 | 回退方案 |
|------|---------|
| 分段拼接在超大页（>50k px）仍 OOM | 限制最大导出高度 = 50000px，超过提示用户"页面过长，无法导出完整，建议拆分查看" |
| Tailwind CSS inline 失败导致 JSX 预览样式丢失 | 切走"方案 2 html-to-image"路径，容忍局部 CSS 损失 |
| `widget:export-png` 与新 `artifact:export-long-shot` 出现资源冲突（同时导出） | 主进程加队列锁，一次一个 export window |

---

## Phase 4 — 文件树新建 `.md` + 通用 CodeMirror 编辑器

**价值形态：** A 可见

**用户痛点：** 新建 Markdown 文档要切到 Obsidian；现有 SkillEditor 是原生 `<textarea>`，无高亮无折叠无大文件支持。

**依赖：** Phase 0.4 的 CodeMirror 集成 POC 结论

**范围（Q3 已选定 = 中等）：** 本 Phase 交付 **4.1-4.5**（核心编辑器 + frontmatter 高亮 + 图片粘贴），**Obsidian 完整兼容（4.6 wikilinks/callouts）标 P2 可单独后置**。

### 4.1 文件 I/O API 独立设计（write / mkdir / rename / delete 同等规范）

**Codex P2 指出 `/api/workspace` 和 `/api/files` 都不是通用写入入口**，需新增四个同级 API，所有 API 共用下面的"Path safety 规则"。

#### 4.1.a `POST /api/files/write`

```ts
Body: {
  path: string;              // 绝对路径或相对 baseDir
  baseDir?: string;          // 项目根，用于 path safety 校验
  content: string;
  overwrite?: boolean;       // 默认 false，已存在返回 409
  createParents?: boolean;   // 默认 false，父目录不存在返回 404
}
Response: { path, bytes_written } | { error: 'path_unsafe' | 'already_exists' | 'parent_not_exists' | 'symlink_detected' | 'root_path' | 'blocked_directory' }
```

#### 4.1.b `POST /api/files/mkdir`

```ts
Body: {
  path: string;
  baseDir?: string;
  createParents?: boolean;   // 默认 false，相当于 mkdir -p 开关
}
Response: { path } | { error: 'path_unsafe' | 'already_exists' | 'parent_not_exists' | 'symlink_detected' | 'root_path' | 'blocked_directory' }
```

#### 4.1.c `POST /api/files/rename`

```ts
Body: {
  from: string;              // 源路径（必须存在）
  to: string;                // 目标路径（必须不存在，除非 overwrite=true）
  baseDir?: string;          // from 和 to 都必须在 baseDir 范围内
  overwrite?: boolean;       // 默认 false
}
Response: { from, to } | { error: 'path_unsafe' | 'not_found' | 'already_exists' | 'symlink_detected' | 'cross_base_dir' | 'root_path' | 'blocked_directory' }
```

**rename 特殊规则：**
- `from` 和 `to` **都**要通过 path safety（两端都做 `isPathSafe` + symlink 检查 + baseDir 一致性）
- 跨 `baseDir` 移动直接拒绝（`cross_base_dir`）——避免用户误把文件拖出项目根
- 重命名目录时递归 symlink 检查目录树的每一层
- 不允许把 file 改名为 dir 或反之（通过 `fs.lstat` 类型校验）

#### 4.1.d `POST /api/files/delete`（走系统回收站，不真删）

```ts
Body: {
  path: string;
  baseDir?: string;
  recursive?: boolean;       // 删除非空目录时必须 true，否则返回 dir_not_empty
}
Response: { path, trashed: true } | { error: 'path_unsafe' | 'not_found' | 'dir_not_empty' | 'symlink_detected' | 'root_path' | 'blocked_directory' | 'trash_unavailable' }
```

**delete 关键安全约束：**
- **不调 `fs.unlink` / `fs.rm`**，改用 **Electron 的 `shell.trashItem(fullPath)`**（主进程 IPC）走系统回收站（macOS Trash / Windows Recycle Bin / Linux XDG trash）；用户可在系统层恢复，避免不可挽回的误删
- 若系统回收站不可用（`shell.trashItem` 抛错）→ 返回 `trash_unavailable`，**拒绝降级到真删**
- 删除目录必须显式传 `recursive: true`；未传且目录非空直接拒绝（`dir_not_empty`）
- 文件树 UI 调用前必须弹 Confirm Modal（见 4.2），文件夹额外显示"包含 N 个文件 / 子目录"
- 黑名单路径（`.git` / `node_modules` / `.env*`）直接拒（`blocked_directory`）——防止误删项目关键目录

#### 4.1 统一 Path safety 规则（所有 API 硬约束）

- `path.resolve(p)` 后必须在 `baseDir`（或默认 `os.homedir()`）范围内，复用 `src/lib/files.ts:isPathSafe`
- 拒绝 `isRootPath(path)`（如 `/` 或 `C:\`）
- 用 `fs.lstat` + `isSymbolicLink()` 检查目标及父目录链，拒绝 symlink 穿越（rename/delete 对目录树递归检查）
- 禁对 `.git` / `node_modules` / `.env*` / `Library` (macOS) / `System32` (Windows) 等敏感目录下任何操作（配置化黑名单）
- 文件名禁特殊字符（`\0`、Windows 保留名 `CON/PRN/AUX/NUL`、以 `.` 开头的系统文件如 `.DS_Store` 允许读但阻止 UI 直接 write/delete 到这类名）

#### 4.1 测试要求

- 每个 API 都有单元测试（Jest）覆盖正常路径 + 所有错误码
- 关键安全测试必须有：
  - `path = '../../../../etc/passwd'` → 拒绝
  - `from` 是 symlink → 拒绝
  - `to` 越出 baseDir → 拒绝
  - 删除空目录不传 recursive → 拒绝
  - 删除黑名单路径 → 拒绝
  - 系统回收站不可用时 delete 不降级真删

### 4.2 文件树右键菜单

> **2026-07-29 superseded**：本节原先是未落地的 follow-up 描述。实际 Explorer 右键菜单、F2 行内重命名、Trash 删除和跨 owner 文件 mutation transaction 已由 [Markdown Live Preview × Explorer 文件树交接](../../handover/markdown-live-preview-file-tree.md) 接管。本历史计划不再作为实现合同。

- 定位 `src/components/ai-elements/file-tree.tsx`
- 追加右键菜单项（使用 shadcn ContextMenu 或 Radix）：
  - "新建 Markdown 文件" → 调 `/api/files/write` + `overwrite=false` + 默认内容 `# {untitled}\n\n`
  - "新建文件夹" → 调 `/api/files/mkdir`
  - "重命名" → 行内 input 可编辑 → `/api/files/rename`（保持 `baseDir` 与当前文件树根一致）
  - "删除" → **必须**弹 Confirm Modal，显示"文件 {name} 将移入系统回收站（可在 Trash / Recycle Bin 恢复）"；文件夹额外显示子项数量 → 调 `/api/files/delete` + `recursive=true`（若用户确认）
- 默认文件名 `untitled.md`，同目录冲突加 `-1` / `-2` 后缀
- 创建后自动选中新文件并打开到编辑器

### 4.3 CodeMirror 6 集成（按 Phase 0.4 结论）

- 依赖：`@codemirror/view` + `@codemirror/state` + `@codemirror/lang-markdown` + `@codemirror/theme-one-dark` + `codemirror` 基础 setup
- 新增 `src/components/editor/MarkdownEditor.tsx`，按 0.4 POC 结论选择 dynamic import / 直接 import / Shadow DOM 隔离
- 扩展：
  - 语法高亮（lang-markdown）
  - 行号、折叠、搜索替换（basic-setup）
  - Cmd/Ctrl+S 保存（调 `/api/files/write` with overwrite=true）
  - 未保存时切文件给确认 Modal
- Tailwind v4 样式隔离：按 0.4 POC 结论

### 4.4 替换 SkillEditor 的 textarea

- `src/components/skills/SkillEditor.tsx:65-89` 的 textarea → 用 `<MarkdownEditor>` 替换
- 保留现有 Tab 缩进 / Cmd+S 行为
- Skills 场景回归：改 SKILL.md → 保存 → 热重载生效

### 4.5 frontmatter 高亮 + 图片粘贴（Q3 中等范围）

- **frontmatter 高亮：** CodeMirror lang-markdown + `@codemirror/lang-yaml` 叠加，检测文档头 `---...---` 区段切换到 YAML mode
- **图片粘贴：**
  - 监听编辑器粘贴事件，检测 `event.clipboardData.files` 含图片
  - 保存到同目录 `assets/` 下（不存在则创建），文件名 `{basename}-{YYYYMMDD-HHmmss}.{ext}`
  - 插入 Markdown 引用：`![](./assets/xxx.png)`
  - 调 `/api/files/write`（复用 4.1）

### 4.6 Obsidian 兼容（P2 可后置）

标 P2，**本 Phase 可选交付**。若工期紧，4.1-4.5 闭环即发布，此节独立后续：

- **wikilinks `[[link]]`：** 编辑器侧 CodeMirror decoration；渲染侧 remark 插件转 `<a>`（依赖 Phase 0.8 结论，若 Streamdown 不接 remark 则改为"仅编辑器可见，预览不转换"）
- **callouts `> [!note]`：** 渲染侧 remark 插件（同上依赖）

### 4.7 i18n 同步

- `fileTree.newMarkdown` — "New Markdown file" / "新建 Markdown 文件"
- `fileTree.newFolder` — "New folder" / "新建文件夹"
- `fileTree.rename` — "Rename" / "重命名"
- `fileTree.delete` — "Delete" / "删除"
- `fileTree.deleteConfirmFile` — "Move {name} to Trash? You can restore it from Trash/Recycle Bin." / "将 {name} 移入系统回收站？可在回收站恢复。"
- `fileTree.deleteConfirmDir` — "Move folder {name} and its {count} items to Trash?" / "将文件夹 {name} 及其中 {count} 个文件/子目录一起移入系统回收站？"
- `fileTree.deleteTrashUnavailable` — "System trash unavailable, deletion aborted for safety" / "系统回收站不可用，为安全起见已取消删除"
- `fileTree.renamePlaceholder` — "New name" / "新名称"
- `editor.unsavedChanges` — "You have unsaved changes" / "有未保存的修改"
- `editor.imagePasted` — "Image saved to {path}" / "图片已保存到 {path}"
- `fileIO.errors.*` — 各种 safety / conflict 错误（`path_unsafe` / `already_exists` / `parent_not_exists` / `symlink_detected` / `root_path` / `blocked_directory` / `cross_base_dir` / `dir_not_empty` / `trash_unavailable` / `not_found`）

### 4.8 验收标准

- 文件树右键 → "新建 Markdown" → 生成 `untitled.md` → 自动进入编辑（编辑器已打开）
- 编辑 50 行 Markdown，有语法高亮、折叠、搜索替换、Cmd+S 保存
- 打开 10 万字符 Markdown → CodeMirror 原生虚拟化，滚动流畅
- SkillEditor 场景：改 SKILL.md → 保存 → 技能生效
- `/api/files/write` / `mkdir` / `rename` / `delete` 四条路径共用的安全测试：
  - 传 `../../../../etc/passwd` → 拒绝（`path_unsafe`）
  - 传 symlink 目标 → 拒绝（`symlink_detected`）
  - 未授权根目录 → 拒绝（`root_path`）
  - 命中黑名单（`.git` / `node_modules` / `.env*`）→ 拒绝（`blocked_directory`）
- `/api/files/rename` 额外：
  - `from` 与 `to` 跨 `baseDir` → 拒绝（`cross_base_dir`）
  - `to` 已存在且未传 `overwrite=true` → 拒绝（`already_exists`）
- `/api/files/delete` 额外：
  - 删除后文件在系统回收站可见（macOS Trash / Windows Recycle Bin）、本地磁盘对应路径不存在
  - 系统回收站被禁用（如沙箱环境 `shell.trashItem` 抛错）时返回 `trash_unavailable`，**未**降级到真删
  - 非空目录不传 `recursive` → 拒绝（`dir_not_empty`）
  - UI 层 Confirm Modal 显示回收站可恢复的文案（不是"不可恢复"）
- `npm run test` + CDP 验证

---

## Phase 5 — 配套增强（可与 Phase 1-4 并行）

**价值形态：** 混合（下表分别标注）

### 5.1 ShikiThemeContext 显式主题传递 — B 静默（**已合并到现有机制，不做**）

**2026-04-21 复查结论：跳过。** craft-agents 的 `ShikiThemeContext` 解决的是"深色专属主题在浅色系统模式下 fallback 错乱"——CodePilot 的 `code-block.tsx:463-467` 已经走 `useThemeFamily` + `resolveShikiThemes` 显式传 [light, dark] 给 Shiki 的 `codeToTokens`，生成 dual-theme 输出后由 CSS 变量（`:root.dark`）切换，**不依赖 DOM class 嗅探**。额外加 Provider 是重复造轮子。若未来有新主题族引入，只需扩 `theme/code-themes.ts` 即可，无需新 Context。

### 5.1 ShikiThemeContext（原文保留作历史参考）

**用户痛点：** 当前暗色主题下某些代码块语言的 fallback 颜色错乱（依赖 DOM class 嗅探，时序不稳）

- 借鉴 craft `ShikiThemeContext` 模式（`packages/ui/src/context/ShikiThemeContext.tsx:1-68`）
- 在 `src/components/ai-elements/code-block.tsx` 顶层建 `ShikiThemeProvider`，显式传主题名
- 废弃 DOM class 嗅探链路
- **成本：** 1-2 人时
- **验收：** 切换主题后代码块颜色立刻对齐，不闪；CDP 验证

### 5.2 Collapsible 折叠 — A 可见（**已推到独立 follow-up**）

**2026-04-21 复查结论：本批次不做。** POC 0.8 证实 Streamdown 的 `remarkPlugins` prop 能接标准 unified 插件，但要真的让 `<details><summary>` 渲染出来，还需要 Streamdown 底层的 `react-markdown` 启用 `rehype-raw`（默认不启）——否则生成的 raw HTML 会被 escape。这个 flag 牵涉到现有 sanitize 策略 + 全仓复用 `<Streamdown>` 的多个入口，影响面远超 Phase 5 预期。独立 follow-up：先评估 `rehype-raw` 对 streamdown 其他调用点（chat、doc preview）的安全影响，再决定是否开；或退而求其次用 MDAST 自定义节点 + 对应的 `components` 渲染器，绕开 raw HTML。

### 5.2 Collapsible（原文保留作后续实施依据）

**用户痛点：** 聊天里的长 AI 报告没法折叠，每次都要滚动

**Phase 0.8 POC 已确认 → 走 `remarkPlugins` prop（不走 `plugins` 对象链）。**

- 自建 `remarkCollapsibleSections` 插件，按 heading 层级包 `<details>` 语义（标准 `function (): Transformer { return (tree) => ... }`）
- 挂到 **`<Streamdown remarkPlugins={[remarkCollapsibleSections]} plugins={_streamdownPlugins} ... />`** —— 不要塞进 `plugins` 对象，那里只认 `code/mermaid/math/cjk` 四个具名槽
- 顺序约束（固定不可调）：`plugins.cjk.remarkPluginsBefore` 排在 `props.remarkPlugins` **之前**，`...After` 和 `math.remarkPlugin` 排在之后；折叠插件放 `remarkPlugins` 末尾即可
- `mode="streaming"` 下 Streamdown 按 block 切片，插件**必须**对 heading-only / 空 section 单 block 鲁棒（否则流式追加中途会崩）
- 应用范围：聊天消息（`src/components/ai-elements/message.tsx` 的 `MessageResponse`）+ PreviewPanel `RenderedView`
- **成本：** 1 人天
- **i18n：** `markdown.collapseSection` / `markdown.expandSection`
- **验收：** AI 回复含 5 个 `##` 的长报告，每个 `##` 旁有折叠三角，点击生效；嵌套 `###` 也能分层折叠；流式追加期间不崩

### 5.3 Safe HTML Proxy（已按用户决策移除）

**用户在讨论阶段明确：** 当前未启用 `rehype-raw`，Safe Proxy 防御不紧急，本计划不做。

保留编号 5.3 为占位符，以便 5.1-5.5 编号连续不跳跃，避免读者疑惑。

### 5.4 表格 Artifact 预览（两轨）— A 可见（依赖 Phase 1.5）

**用户痛点：** 聊天输出的大表格挤占消息空间；文件树点击 `.csv` 现在只能看源码

#### 5.4-A 聊天输出大表格 → Artifact 预览

- 定位 Streamdown 渲染链的 `<table>` 组件
- 触发阈值：**列 > 6 OR 行 > 30**（默认值，可观察后调）
- 超阈值时：表格正常渲染 + 底部挂"在 Artifact 中查看"按钮
- 点击 → 序列化表格 AST 为结构化数据 → `setPreviewSource({ kind: 'inline-datatable', rows, header })`（依赖 Phase 1.5 通道）
- PreviewPanel 的 datatable viewer：列排序 / 列筛选 / 导出 CSV / 导出 JSON
- 实现参考 craft `MarkdownDatatableBlock.tsx:1-718`（借鉴设计不照抄代码）

#### 5.4-B 文件树 `.csv` / `.tsv` 点击预览

- `PreviewPanel` 的 file 分支：`.csv` / `.tsv` 走 datatable viewer 而非 SourceView
- 解析：`papaparse` ~15KB，支持大文件流式解析
- `.xlsx` 支持：**不在本 Phase**（需 `xlsx` 或 SheetJS +150KB）；若用户后续要，独立加 Phase

#### 5.4.C i18n 同步

- `datatable.export.csv` / `datatable.export.json`
- `datatable.sort.asc` / `datatable.sort.desc`
- `datatable.filter.placeholder`
- `datatable.openInArtifact` — "View as table" / "在表格视图中查看"

#### 5.4.D 验收标准

- 聊天里 10 列 × 50 行表格 → 底部有"在表格视图中查看"按钮
- 点击 → PreviewPanel 打开 datatable，可排序/筛选/导出
- 文件树点 `test.csv` → 同样进 datatable viewer
- 导出 CSV 用 Excel 打开内容正确
- 小表格（5 × 10）不出按钮，保持内联渲染

### 5.5 Streamdown 代码块 LRU 对齐 — B 静默

**Phase 0.2 POC 已确认 → 未复用**（`code-block.tsx:164-170` 的 LRU 仅被同文件 `highlightCode()` 消费，跨仓库 grep 无 import；聊天路径走 `@streamdown/code`，后者在 `node_modules/@streamdown/code/dist/index.js` 自建**无上限**模块级 Map 并独立 `shiki.createHighlighter`）。

**改造动作：**
- 在 `src/components/ai-elements/message.tsx` 中封装自定义 `CodeHighlighterPlugin`（接口在 `@streamdown/code/dist/index.d.ts:18-39`），取代 `createCodePlugin()` 的默认实例
- `highlight()` 内部转发到 `code-block.tsx` 的 `highlightCode()`，复用既有 `highlighterCache`(10) + `tokensCache`(200)
- Shim `TokenizedCode → TokensResult`：补 `themeName`（用当前 lightTheme name）、构造 `rootStyle`（`` `background: ${bg}; color: ${fg};` ``）
- `PreviewPanel.tsx:25,32` 的 `_streamdownPlugins.code` 同步替换为新实例

**验收：**
- DevTools Memory 快照：Shiki highlighter 实例数在语言 ≤10 时稳定为 1 份/(lang,theme) 组合
- 长会话（100+ 条含代码块消息）下聊天路径的内存占用线性增长被抑制
- 现有 `code-block.tsx` 的直接调用场景（如 UI 折叠/复制按钮）保持不变

**成本：** 1-2 人时。

### 5.6 PreviewPanel "loaded path" 抽象 — B 静默（Codex 复盘新增）

**触发：** 2026-04-20 Codex 第 N 轮审查定位的 autosave 跨文件错写 bug（9d3d459 已打补丁），连同先前的"Sandpack 首帧用旧 content 编译"、"切文件时 stale preview 闪烁"三类问题，根因都是 **"PreviewPanel 的各块状态没有一个统一的 'currently loaded file' 锚"**。9d3d459 用 `editContentFile` 给 editor 侧加了锚，但 render 侧、export 侧、header 侧各自判断是否 fresh — 散在各个 useMemo 里，下次加新 inline kind 很容易漏。

**改造动作：**

- 引入 `loadedPath: { kind: 'file'; path: string } | { kind: 'inline-*'; id: string } | null` state（或 reducer）
- 所有"读 preview/content"的派生值（exportableHtml、MarkdownEditor 的 value、SourceView 的 content、RenderedView）都 require `loadedPath` 匹配当前 `previewSource`，否则一律走 loading 分支
- `setPreview(data.preview)` 的同时 `setLoadedPath({ kind: 'file', path: preview.path })`
- `filePath` 变化的 useEffect 中同步 `setLoadedPath(null)`（`setPreview(null)` 已有，同级）
- handleSaveEdit、handleExportLongShot 的第一行都加 `if (loadedPath?.path !== previewSource.filePath) return;`
- 抽一个 `useLoadedPreview()` hook 把这些碎片封装起来，对外只暴露一个 `fresh: boolean` + `content: string | null`

**收益：**
- autosave 错写、TSX 首帧旧内容、PreviewPanel 短暂显示旧内容 — 三类边缘 bug 一次收敛
- 后续加 inline-datatable（Phase 5.4）不会重踩"新 kind 没接上 fresh 校验"

**成本：** 0.5-1 人天（主要是把现有 8 处派生值收拢到同一个 gate）

### 5.7 文件 I/O 安全合同收到单一 helper — C 基建（Codex 复盘新增）

**触发：** 2026-04-20/21 Codex 连续两轮审查连续抓到 API 路径安全漏洞：
- write 路由的 symlink 防护只查 parent chain，漏了 target（ba35fd7 打补丁）
- preview 路由的 isPathSafe 只做文本检查，fs.* 仍跟随 symlink 跳出 baseDir（9d3d459 打补丁）

两次都是同一类 bug 在不同路由上复现。当前实现让每条路由各自拼 `assertWritablePath` + `assertNoSymlinkInChain` + `fs.realpath` 检查 — 容易漏、难审计。

**改造动作：**

- 把 `assertWritablePath / assertNoSymlinkInChain / isValidFilename / BLOCKED_SEGMENTS` 和新的 `assertRealPathInBase` 收到 `src/lib/files.ts` 的一个 `validateFsAccess(resolvedPath, { baseDir, mode: 'read' | 'write' | 'mkdir' | 'rename-source' | 'rename-target' | 'delete' })` 统一入口
- 内部按 mode 组合需要的检查项（read 不查 parent-chain symlink 但必须 realpath 重检；write/mkdir 两者都查；rename-target 跟 write 同样；delete 走 write + lstat target 是否 symlink）
- 所有五条 `/api/files/*` 路由改为单行调用 `await validateFsAccess(...)`，删除各自的碎片检查
- 写一个 symlink-attack unit test suite 覆盖每条路由：workspace 内 symlink 指向外部 + overwrite=true → 都应 403；workspace 内合法 symlink（指回 workspace 内） → 200
- 把 writeFileSync/readFile/readdir 的符号链接语义也审一遍（rename 依赖 fs.rename 不跟 symlink → OK；delete 走 shell.trashItem 有没有 follow 需要再看）

**收益：**
- 下一个类似 bug 只需在 helper 改一次，不会再让 Codex 重复抓
- 路由代码可读性上升（业务逻辑不被安全样板遮盖）
- 有了 test suite，未来加 API 复制 helper 模板即可，合规默认继承

**成本：** 1 人天（helper + 迁移 5 条路由 + 测试套件）

### 5.8 产品边界文档：TSX 预览叫"单文件 React 预览" — C 基建（Codex 复盘新增）

**触发：** Phase 2.1 Sandpack 集成后连续踩坑：入口路径（ba35fd7）、多文件 alias 未支持（已记为已知限制）、潜在的 CSS import / 相对 import 边界都不明确。Codex 建议产品边界一次说清。

**改造动作：**

- 在 `docs/insights/markdown-artifact-overhaul.md` 产品思考文档里明确定义第一版能力：
  - **能做：** 单文件 `.jsx`/`.tsx`，自包含的 React 组件（hooks + 白名单 npm 依赖）
  - **不能做：** 多文件项目（`import './Counter'`）、CSS import、项目别名（`@/...`）、图片/字体 import、自定义 tsconfig
  - **未来演进：** Phase 5.8 后续迭代（非本期）可做虚拟文件系统、alias resolver、CSS inline
- 同步在 UI 层：SandpackPreview 的 ErrorBoundary fallback 给"这个文件引用了多文件/别名/CSS，预览暂不支持"的友好提示，而不是让用户看到 bundler 的原生 404 stack
- DiffSummary 的 TSX 卡片 description 行加一行小字说明"单文件预览"（可选，确认不会噪音后再加）

**收益：**
- 用户心智清晰，不会对失败场景投射 bug 归属（bundler 错 ≠ 我们的渲染错）
- 下一轮需求讨论（多文件、alias）有基线文档可参考

**成本：** 0.5 人天（文档 + 2 处 UI 友好化）

---

## 依赖图

```
Phase 0 (POC 8 项)
    ├─0.1─> Phase 1 (是否要分段)
    ├─0.2─> Phase 5.5 (是否存在)
    ├─0.3─> Phase 3 (长图导出：分段拼接 / CDP captureBeyondViewport)
    ├─0.4─> Phase 4 (CodeMirror 集成模式)
    ├─0.5─> Phase 2.1 (Sandpack 集成验证；失败则回退 snippet-only)
    ├─0.6─> Phase 2.3 (DiffSummary 升级改造接口；改造点过多则回退到视觉分开方案)
    ├─0.7─> Phase 1.5 (PreviewPanel 数据模型迁移)
    └─0.8─> Phase 5.2 (Streamdown 接 remark 插件是否可行)

Phase 1.5 ─┬─> Phase 2 (inline-jsx 通道)
           └─> Phase 5.4 (inline-datatable 通道)

Phase 2 ─> Phase 3.2 (DiffSummary 行的导出按钮)
```

**并行建议：** Phase 2 + 4 可并行；Phase 3 必须在 Phase 2 之后；Phase 5 可零散穿插；Phase 1.5 是 2 / 5.4 的共同前置。

## 风险与回退

| 风险 | 影响 Phase | 回退方案 |
|------|-----------|---------|
| `widget:export-png` 加分段拼接超大页 OOM | 3 | 最大高度 50000px 硬保底，提示用户"页面过长无法完整导出" |
| Sandpack bundle 过大（>1MB gzipped）或集成不稳 | 2 | 按需 dynamic import 压体积；若仍不可行，回退 snippet-only（`react-jsx-parser`） + 更新决策日志 |
| Sandpack CDN 离线不通 | 2 | `SandpackProvider` 的 `options.bundlerURL` 指本地自托管服务（从 GitHub `codesandbox/sandpack-bundler` 克隆源码 → `yarn dev` 或 `yarn build && yarn start`；npm registry 无此包不能 `npm i`；位置在 `options` 不在 `customSetup`） |
| Sandpack iframe sandbox / CSP 无法按期望控制（s1/s2/s3 全失败） | 2 | 走 s4 接受默认策略 + 在 2.5 验收记录实际行为差距；若差距不可接受则暂停 Sandpack 方案，回退 snippet-only |
| Sandpack iframe 跨域导致 JSX 长图导出失败（X-jsx-1 files 重建 + X-jsx-2 iframe 内 capture 都不通） | 3 | 保留 HTML 场景导出，JSX 导出标"暂不支持"，Toast 给用户明确提示 |
| `sharp` 引入后 after-pack / CI 打包失败 | 3 | 优先用 Electron `nativeImage` / 纯 JS `pngjs`，不引入 native dep |
| `PanelZone` 迁移漏点，inline-* 面板挂不上 | 1.5 / 2 / 5.4 | grep 全仓 `previewFile` 直接读取点逐项核对；加 `setPreviewSource({ kind: 'inline-html', html: 'x' })` 的 smoke test |
| Sandpack iframe 内别名 `@/...` 无法解析 | 2 | UI 显示"别名不支持，仅编译外部 npm"提示条（i18n 键 `filePreview.aliasNotSupported`） |
| DiffSummary 升级改造点 > 20 处 | 2 | 回退：保留原 DiffSummary + 新增 lightweight Artifact 行（视觉明显区分） |
| DiffSummary 改造引入消息渲染回归 | 2 | Feature flag `settings.enablePreviewButtons` 默认 on，出问题一键关 |
| CodeMirror 与 Tailwind v4 样式冲突（若 0.4 发现严重） | 4 | Shadow DOM 隔离 / `cm-*` class 白名单 reset |
| 大 `.md` 文件前端仍卡（若 0.1 结论是卡） | 1 | Phase 1.4a/1.4b 分段 + 超长 code fence 降级 |
| Streamdown 不接 remark 插件（若 0.8 结论否） | 5.2 | 聊天消息不做折叠，仅 PreviewPanel 支持；或走 DOM post-processor |
| /api/files/write 被滥用写危险路径 | 4 | path safety 审查 + black list + symlink 检测（4.1 已规定） |

## 开放问题

**Q1 / Q2 / Q3 已由用户选定默认推荐方案（见决策日志）：**

- [x] Q1 `.tsx` 预览 — **Sandpack**（Phase 0.5 POC 验证集成，回退方案 = snippet-only）
- [x] Q2 Artifact 卡片落点 — **升级 DiffSummary**（Phase 0.6 POC 设计改造接口，回退方案 = DiffSummary + lightweight Artifact 行视觉分开）
- [x] Q3 Markdown 编辑范围 — **中等**（核心 + frontmatter + 图片粘贴），Obsidian 完整兼容标 P2

**其余开放项：**

- [ ] 大表格阈值默认 **列 > 6 OR 行 > 30**（5.4-A）— 可后续观察调整
- [ ] 表格文件本期仅 `.csv` / `.tsv`，`.xlsx` 后置
- [ ] URL 预览先不做
- [ ] Worktree 隔离策略由用户发起
- [ ] Obsidian 完整兼容（4.6 wikilinks/callouts）标 P2 可单独后置

## Git 纪律

- 每个 Phase 内每个小任务独立 commit，conventional commits 格式
- Commit body 按"改了什么 / 为什么改 / 影响范围"三段
- **禁止** `git push` / `git tag` 除非用户明确指示（对齐 CLAUDE.md「发版纪律」）
- 每 Phase 完成后更新本文档状态表 + 决策日志

## 文档交付（Phase 末尾必须）

按 CLAUDE.md「新功能或大迭代完成后必须同时输出两份文档」：

- `docs/handover/markdown-artifact-overhaul.md` — 技术交接（组件结构、数据流、IPC 契约 `artifact:export-long-shot`、CodeMirror 集成点、`/api/files/write` 合同）
- `docs/insights/markdown-artifact-overhaul.md` — 产品思考（为什么卡片而非自动弹、为什么升级 DiffSummary 而非新建双 UI、为什么 CodeMirror 而非 Tiptap、为什么复用 `widget:export-png` 基线）
- 两份互相反向链接

---

## 附：核心诉求 → Phase 对照

| 用户诉求 | 覆盖 Phase |
|---------|----------|
| Artifact 支持更多网页预览 | Phase 2（HTML 已有 + JSX/TSX 用 Sandpack；回退方案 snippet-only 保留） |
| 文件树 Markdown 预览优化 | Phase 1（+ API 合同闭合：truncated 字段、字节上限、二进制保护） |
| 新建和编辑 Markdown 文档 | Phase 4（+ `/api/files/write` 独立 API 设计） |
| Artifact 网页一键导出长图 | Phase 3（复用 `widget:export-png` 基线，去 4000px 上限） |
| (配套) 代码高亮体验 | Phase 5.1 + 5.5 |
| (配套) 长文档折叠 | Phase 5.2（依赖 0.8 POC） |
| (配套) 表格大视图 + 导出 | Phase 5.4（依赖 Phase 1.5） |
