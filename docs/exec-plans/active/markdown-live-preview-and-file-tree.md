# Markdown Live Preview 统一样式 × 文件树 Explorer 化 × 文件类型图标

> 创建时间：2026-07-29
> 最后更新：2026-07-30
> 状态：✅ v0.62.0 已发布，Mac/Windows CI 打包与 packaged server 门禁通过；macOS 主功能与人工项已验收，仅保留用户的 Windows 发布后实机验证待办
> 对应调研：
> - [docs/research/markdown-editor-tiptap-evaluation.md](../../research/markdown-editor-tiptap-evaluation.md)（CodeMirror 选型依据）
> - [docs/research/craft-agents-markdown-internals.md](../../research/craft-agents-markdown-internals.md)（渲染/编辑分栈佐证）
> - [docs/research/phase-0-pocs/0.4-codemirror-integration.md](../../research/phase-0-pocs/0.4-codemirror-integration.md)（注意：文内 `src/components/markdown/` 路径已 stale，实际实现在 `src/components/editor/`）
> 前置迭代：[completed/markdown-artifact-overhaul.md](../completed/markdown-artifact-overhaul.md) + [completed/phase-4-markdown-artifact.md](../completed/phase-4-markdown-artifact.md)
> 本计划同时闭环 markdown-artifact-overhaul §4.2（文件树右键菜单）的 plan/代码 drift。

## 用户核心诉求

1. **Markdown 预览删除多主题**（`default/article/report/brief/pitch` 五套 in-place 样式，非应用明暗主题），只保留一套 CodePilot 自有样式，且与聊天消息的 Markdown 样式一致（标题/段距/列表/引用/链接/行内码/代码块/表格）。
2. **编辑、保存、预览合并为同一页面**，交互接近 Obsidian Live Preview：非活动行渲染、活动行显示原始标记、Markdown 原文永远是事实源；保留自动保存/显式保存/磁盘冲突检测/文件身份保护。
3. **文件树补齐 VS Code Explorer 能力**：右键菜单、新建文件/文件夹、重命名、删除进系统废纸篓、文件夹只留展开箭头、文件同槽位显示类型图标、截断名可看全名。
4. 拖放 / 多选 / 剪切粘贴 / 超大目录虚拟化：**本轮明确不做**（tech-debt #62 记录，未来与 Headless Tree 评估合并）。

## 状态

| Phase | 内容 | 状态 | 价值形态 | 备注 |
|-------|------|------|---------|------|
| Phase 0 | 前置 POC（Live Preview 装饰核心 / trash 打包 smoke / 图标提取管线 + 视觉 POC / ContextMenu 行为） | ✅ 已完成 | C 基建 | production DOM 的活动行源码、输入、undo、滚动已验；用户实机确认中文 IME 正常；macOS packaged Trash 可恢复 |
| Phase 1 | 中立 Markdown component contract + 删除 presentation 主题 + Export 脚手架解耦 | ✅ 已完成 | A 可见 | RC-5 / RC-8 targeted 28/28；全量 3850/3850 |
| Phase 2 | Live Preview 接入（2a 行内 marks → 2b 最低渲染 parity）+ viewMode 收敛 | ✅ 已完成 | A 可见 | RC-3 / RC-6 / RC-11 ✅；Live Preview surface/heading 已对齐应用 background/foreground token |
| Phase 3 | 文件树右键菜单 + 行内重命名 + 删除（file mutation transaction） | ✅ macOS 已完成；Windows 发布后验证 | A 可见 | RC-1 / RC-4 ✅；用户明确接受本版跳过发布前 RC-2，不代表 Windows 已验证 |
| Phase 4 | FileTypeIcon（material-icon-theme 静态子集）+ 文件夹仅 chevron + 全名 tooltip | ✅ 已完成 | A 可见 | 固定 50 图标 + manifest/license；亮暗主题视觉 smoke 完成 |
| Phase 5 | 回归、文档漂移修复、handover/insights 双文档、tech-debt 回写 | ✅ v0.62.0 已发布 | C 基建 | 正式 v0.61 发布线集成后 typecheck + unit **4776/4776**、production build、独立端口 smoke **22/22**；CI Mac/Windows 打包、ABI 与 packaged server 验证通过；Windows 实机 RC-2 留作发布后验证 |

**状态符号：** 📋 待开始 / 🚧 进行中 / ✅ 已完成 / ⏸ blocked / ❌ 放弃

## 决策日志

- 2026-07-30 [v0.62.0 正式发布] release commit `bd598563` 与轻量 tag `v0.62.0` 已原子推送到正式发布线；GitHub Actions [run 30513383728](https://github.com/op7418/CodePilot/actions/runs/30513383728) 的 source gate、macOS arm64+x64、Windows x64 和 release job 全部通过。两个平台均完成版本号、native ABI、packaged server 启动与 checksum 门禁；稳定版 [CodePilot v0.62.0](https://github.com/op7418/CodePilot/releases/tag/v0.62.0) 已发布，包含 arm64/x64 DMG+ZIP、Windows EXE 与 `SHA256SUMS.txt`。这证明产物能构建和启动，不替代用户后续的 Windows Trash/restore 交互验收。
- 2026-07-30 [v0.62.0 正式发布线集成] 功能分支没有直接覆盖旧基线，而是迁移到当前正式发布线 `v0.61.0`，保留该线的 Opus/Sonnet 5、Grok 4.5 Sub-agent、代理与 Sub-agent 状态模型等后续能力。排除仅修改 Codex 权限说明的 `6737a9a1`，产品提交逐个通过 pre-commit；最终发布候选完成 `npm install` lock 同步、typecheck + unit **4776/4776**、`npm run build`、独立 `:3012` dev server smoke **22/22**。本地门禁通过后才允许 tag 触发双平台 CI。
- 2026-07-30 [v0.62.0 发布风险接受] 用户明确要求不再等待 Windows RC-2，直接同步发布 macOS 与 Windows，安装后由用户实机验证，若失败再修。该裁决只把 RC-2 从“发布前 fail-closed 门禁”改为“发布后验证”，不构成 Windows Trash/restore 已通过的声明；Release Notes 必须披露未做发布前实机验证，CI 仍需成功生成并校验 Mac/Windows 产物。
- 2026-07-30 [原生磨砂强度微调 — `83e041cd`] 用户在透明材质恢复后继续反馈外围磨砂过于模糊。Electron 官方 `BrowserWindow.vibrancy` 没有可调 blur radius，`setVibrancy` 的 options 只提供淡入淡出时长，因此没有用 CSS 高不透明 tint 伪造“低模糊”。通过既有 `ELECTRON_VIBRANCY` 诊断开关，用隔离 Electron 窗口对比 `menu` 与 `under-window`；后者仍保留原生半透明 backing，但背景轮廓更清楚。默认值改为 `under-window`，环境变量候选矩阵继续保留；renderer body/window 仍为 transparent，sidebar 40% tint 与局部 card blur 均未改。新增 source-pin 防止默认材质被无意改回；targeted **12/12**、typecheck、ESLint、两轮 full unit/pre-commit **3879/3879**，最终无环境变量 Electron 日志确认 `vibrancyOption=under-window`、`bodyBg=transparent`、`opaqueElementCount=0`。
- 2026-07-30 [原生磨砂回归二次修复 — `569b117d`] 用户实机指出第一次深色修复后，外围材质在浅色和深色下都失去半透明感、接近纯色。复核确认第一次方案用 renderer CSS 以 `--background` 82% 覆盖暗色外层、以 `--sidebar` 88% 覆盖暗色侧栏，虽然压住了系统浅色材质，却也遮住了真正的 `BrowserWindow.vibrancy`；这是方案错误，不是需要继续加深颜色的微调。替代实现把 app 的 `system/light/dark` 经 `ThemeProvider → preload → ipcMain` 同步到 Electron `nativeTheme.themeSource`，主进程只接受三个枚举值；macOS 外围恢复 `transparent`，浅/深侧栏都只保留 40% tint 维持卡片边界。隔离 Electron 窗口实测浅/深切换均生效：两种模式 `bodyBackground=rgba(0,0,0,0)`、`windowSurface=transparent`，暗色 `sidebarSurface=var(--sidebar) 40%`，IPC 返回 `bridgeAccepted=true`；真实整窗截图确认原生材质重新出现且主题色随应用切换。targeted **11/11**、typecheck、ESLint、hooks/docs drift 均通过；commit pre-commit 全量 **3878/3878**。
- 2026-07-30 [深色主题首次 follow-up 修复 — Markdown 部分保留，玻璃部分已被 `569b117d` 取代] Markdown CodeMirror canvas 以高优先级内容层规则固定到 `--background` / `--foreground`，保留 One Dark 仅用于活动源码 token；`.cm-lp-heading` 及嵌套 syntax span 显式继承 `--foreground`，阻断红色 heading token 泄漏。首次 shell 方案以应用 `--background` 82% tint 覆盖暗色窗口级 vibrancy、以 `--sidebar` 88% 建立卡片层次；自动测试与当时截图确认深色可读，但随后用户实机指出它让材质变成纯色，因此该 shell 决策不再有效，只有 Markdown surface/heading 修复继续保留。首次验证为 targeted **17/17**、`npm run test` **3875/3875**。
- 2026-07-30 [用户实机验收 + 深色主题 signal] 用户确认原生中文 IME 输入与暗色 5% 选中态均正常，RC-3 人工项关闭。Codex 对运行中的 Electron 整窗截图复现四项深色回归：Markdown 编辑面为 One Dark 的 `rgb(40, 44, 52)`，未使用应用 `--background`；Live Preview 标题子 span 继承 One Dark 的 `rgb(224, 108, 117)` 红色 token；macOS 外层透明窗口 / 顶栏暴露浅色原生 vibrancy；最左侧 sidebar/card 的弱黑色透明叠层因此也偏亮。根因范围收敛为两组：`MarkdownEditor` 在暗色模式直接加载 `oneDark`，而 `.cm-lp-heading *` 未覆盖 syntax color；macOS shell 的透明 surface 未保证应用暗色主题与 native material 的对比度。修复需让 Markdown Live Preview 使用应用 surface/foreground token，并为 macOS dark shell 提供确定性深色 tint（若改用 Electron `nativeTheme` 同步，按 ElectronMain guardrail 做 packaged 回归）。这四项重新打开 Phase 2/5，不随本轮既有自动测试结果视为通过。
- 2026-07-29 [Claude 审查修正闭环 — `5d562a0c`] Codex 逐项实证复核后关闭 2 个 P1 与 4 个 P2：ContextMenu rename 使用 `onCloseAutoFocus` + 延迟聚焦完成菜单到行内输入的焦点交接；会话 rename/delete 不再阻止非受控菜单关闭，也不再把 Radix event 强转 React MouseEvent；行内输入右键交还 Electron 原生编辑菜单；CodeMirror 补回搜索/补全/括号等非视觉 editing extensions；controlled 外部值同步用 annotation 触发 block/inline widget 重建；新建 Markdown 默认只选择文件名 stem。同期补齐 Setext、删除线、有序 Checklist、checkbox 可访问性与 Dialog 关闭动画标题稳定性。Codex 真实 E2E **3/3** 覆盖文件树重命名、会话菜单关闭、quiet refresh Checklist，并完成完整 smoke **20/20**；Claude 随后独立复跑 unit **3873/3873** 并逐条核验实现，结论为六项 P1/P2 全部正确。菜单生命周期规则同步写入 `docs/design.md`。剩余非阻塞 P3（widget tooltip i18n、文件名 `/` 语义提示、更多暗色选中态实机档位）保留为归档前体验复核项，不混作本轮 blocker 已关闭。
- 2026-07-29 [Codex 直接实现 Phase 2–5] 未启动 Claude/loop。`.md/.mdx` 收敛到单一 CodeMirror Live Preview；inactive inline/block 使用官方 decoration/widget，图片、表格、代码 fence、Mermaid、KaTeX 达到 RC-11，active block 显示无损源码。输入期间若仍在同一活动行，只 map 现有 decoration；换行、selection block 或 viewport 变化才重建，避免逐字符重扫可见语法树。旧 Preview Tab 与 presentation 主题入口已移除，autosave/Cmd+S/冲突/`loadedPath` 事实源链保留。
- 2026-07-29 [RC-6 performance] 固定 seed 夹具为 **117,929 bytes / 200 headings / 50 fences / 20 tables**。darwin arm64 production server 同机基线（纯文本）p95 frame **18.3ms**、input **56ms**；Live Preview 最终 p95 frame **16.8ms**、max **17.7ms**、>100ms **0**，31 字符 × 4 event entries 的 input p95/max **48ms**，通过预算。Chrome DevTools connector 能完成 trace/observer 采样，但拒绝把 raw trace 写入已配置 workspace，故本次只登记可复现脚本与数值，不伪造 trace 路径。
- 2026-07-29 [Phase 3/4 UI + transaction] `FileMutationCoordinator` 统一 PreviewPanel、AppShell、Workspace Sidebar 与树状态的 prepare/execute/commit/rollback；六种 race 全覆盖。树内空白/文件/目录右键菜单、F2/Enter/Escape/blur、Trash 确认、受保护路径与 14 个错误码已接通；真实浏览器 smoke 验证文件/目录 rename-delete 及 tab/preview 迁移。文件夹 arrow-only；`FileTypeIcon` 以 exact → env → compound → extension → fallback 解析固定 50 个 `material-icon-theme` SVG，随 MIT license/manifest/商标说明入库，亮暗主题均检查。
- 2026-07-29 [RC-1 packaged macOS] `npm run electron:pack:mac` 生成 Developer ID 签名的 **CodePilot-0.58.0-arm64.dmg（182MB）** 与 ZIP（177MB）；Electron 40.2.1 arm64 `better-sqlite3` ABI rebuild 替换两处产物后，`codesign --verify --deep --strict` 通过。产物内 `trash/lib/macos-trash` 保留 `rwxr-xr-x`。直接启动打包 App，内部 server 绑定 `127.0.0.1:47823`，通过其 `/api/files/delete` 将唯一 `/private/tmp` marker 移入系统 Trash；Finder 能列出同名项，再由 Finder 恢复到原目录并核对首行内容完整。RC-1 通过。Windows helper 虽已打入 standalone，但未在 Windows 运行，RC-2 仍 fail-closed。
- 2026-07-29 [回归与打包环境] targeted Live Preview/mutation/icon **16/16**；`npm run test` **3866 tests / 970 suites / 0 fail**；`npm run test:smoke` **17/17**；typecheck/build 通过。构建仍报告既有 `files/suggest` NFT whole-project trace warning。`afterPack` 会把工作区 `better-sqlite3` 留在 Electron ABI，打包后继续跑 Node 测试/服务器前必须 `npm rebuild better-sqlite3`；本轮已恢复并写入 Electron guardrail。
- 2026-07-29 [Phase 1 Codex 实现 — 完成] 新建中立 `markdown-contract.tsx`，聊天与文件预览共享标题/段落/列表/引用/链接/行内码/表格/代码块视觉基座；聊天仅覆盖带复制动作的 table/code。移除 Preview header 的 Style Select、五套 in-place CSS、PreviewSource/Tab 运行态字段；parse 边界继续接受旧 `presentationTemplate` 并主动剥离。四套 standalone HTML Export templates 保留且不再依赖 in-place style。`tsc` 通过，RC-5/RC-8 与相关回归 targeted **28/28**；全量 `npm run test` **3850 tests / 965 suites / 0 fail**。
- 2026-07-29 [用户要求撤回并重做] 停止 Claude/loop，将专用 worktree 从 `1222167c` 精确 reset 到 canonical 计划提交 `089e4d45`；撤回其后的 `fc10691f`/`1222167c`、未提交 0.C、`material-icon-theme` 安装残留、DMG/ZIP/`.next` 打包产物。此后不再启动 Claude/loop，由 Codex 直接实现。
- 2026-07-29 [Phase 0.A Codex 重做 — partial] 仅在 `src/__tests__` 新增纯 state harness + 11 条测试，证明 inactive decoration / active reveal、半开 visible ranges 去重、atomicRanges provider、IME freeze/map/compositionend 空 update rebuild、controlled value 最小 diff + history/selection 保持；targeted **11/11**、全量 `npm run test` **3851 tests / 964 suites / 0 fail**，零生产 importer。真实 DOM 点击/方向键/selection/delete 与中文 IME 候选框未验证，因此不把 0.A 标完成；详见 [research/phase-0-pocs/0.A](../../research/phase-0-pocs/0.A-live-preview-decoration-core.md)。
- 2026-07-29 [Phase 0.A 首次 commit 门禁 P1 — 已修] 手动全量 3851/3851 后，真实 pre-commit 反而出现 3849/3851 并把主仓库切成 `core.bare=true`。根因是 `pre-commit-tier.test.ts` 的临时 repo 子进程继承 hook 的 repository-local `GIT_*` 环境，`git init` 操作了主仓库；不是 flaky。恢复 `core.bare=false` 后，新增 `scrubbedGitEnv()`（动态剥离 `git rev-parse --local-env-vars` 全集 + `GIT_NAMESPACE`），临时 git/node 全部使用 clean env，并加“变量全集清除 + 外部 repo 零污染”两条 guardrail。修复后相关 targeted（Live Preview 11 + pre-commit 17）**28/28**、tsc 通过；提交必须重新过真实 hook 才算关闭。
- 2026-07-29 [Codex 第二轮 plan review] 修订 canonical plan 的两个剩余 P1：
  - **File mutation 跨 owner 协调**：状态图补成有明确 owner、participant、prepare/commit/rollback acknowledgement 的事务协议。`savingEdit` 只是 boolean，不能被 `await`；实现必须引入 `autosaveTimerRef` / `savePromiseRef`，并由 common-owner `FileMutationCoordinator` 在 API 前等待 PreviewPanel prepare、API 后等待各 participant commit ack，guard 才能解除。
  - **最低渲染 parity 是出货门禁**：2a 只作为内部里程碑，不能在移除 Preview Tab 后单独作为本轮用户交付。图片、表格、代码围栏、Mermaid、数学公式达到非活动块渲染 parity（RC-11）后，RC-10 才允许移除临时 Preview Tab；否则必须保留 fallback 或取得用户明确降级同意。
  - 同轮收口：Phase 0 POC 不得留下 production/debug 入口（RC-12）；RC-2 只作为 Windows 发版门禁；RC-6 改用 production server 基准；CC BY-SA 理由改为履约复杂度判断；rename 默认 `Enter` 提交、`Escape` / blur 取消，避免失焦误改名。
- 2026-07-29 [审查轮] Claude Code 初版审查报告经 Codex review，verdict = fix_requested，7 项修订全部采纳并核验：
  - **F2 降级（事实修正）**：初版称「trash 二进制缺 asarUnpack、生产包可能恒 `trash_unavailable`」不成立——`electron-builder.yml` 的 `extraResources` 已把 `.next/standalone/node_modules/` 整体复制到 ASAR 外，本地 standalone 产物含 `trash/lib/macos-trash` 与 `windows-trash.exe`。打包废纸篓 smoke 保留为 **required check（RC-1/RC-2）**，不再是 P0 已知缺陷。残余风险：可执行位保留、macOS hardened runtime 下 spawn 未签名捆绑二进制、Windows 执行策略——正是 smoke 要覆盖的。
  - **F9 修正**：`@streamdown/code` **不是死依赖**——`src/components/ai-elements/reasoning.tsx:13` 直接 `import { code } from "@streamdown/code"`（2026-07-29 grep 复核）。不得删除。其余疑似死代码逐项复核后属实（`MarkdownEditor.lazy.tsx` 零消费者、`PresentationPicker.tsx` 仅剩注释掉的 import、`lucide-react` src 零 import 但为 apps/site + @lobehub/ui 传递需要），全部移入 tech-debt #60，不进本计划范围。
  - **F3 扩写**：rename/delete 必须走完整 file mutation transaction 契约（见下方专节），含 autosave 暂停/等待 in-flight 写入、dirty 语义、失败回滚、迁移顺序、race test。
  - **F5 改向**：共享样式抽**中立模块**，PreviewPanel 不得直接依赖 `chat/markdown-components`（见 Phase 1 设计）。
- 2026-07-29 [用户裁决 ×3]（经 Codex 转达）：
  1. **最终产品不保留可见 Preview Tab**——Live Preview 是唯一 Markdown 视图；内部 POC / 开发分支可临时保留 rendered Tab 作对照，出货前移除。
  2. **文件图标采用 material-icon-theme**（MIT），先做代表性视觉 POC（Phase 0.C 出亮/暗双主题截图）再全量接入。
  3. **Export 脚手架（presentation-templates.ts 的 4 套 HTML 模板 + 3 个 helper，tech-debt #18 保留物）本轮只解耦、不删除**——从 `MarkdownPresentationStyle` 类型依赖中剥离使其自洽，后续单独处理 tech-debt。
- 2026-07-29 [图标数据源裁决] `@iconify-json/vscode-icons` **否决**：上游 vscode-icons README 明示图标画作为 CC BY-SA 4.0（非 MIT），品牌图标另受版权约束；Iconify 元数据标 MIT 与上游冲突，以上游为准。CC BY-SA 并不自动改变整个桌面应用的许可证，但其署名、再分发、衍生资产与品牌权利履约边界超出本轮希望承担的复杂度，因此不采用。`react-file-icon` 否决（16 种通用类别非技术栈风格、17 个月未发版）。继续 HugeIcons 手工映射否决（实测 free 包 5121 图标中无 Markdown/JSON/YAML/Docker/Go/Rust 专属图标，物理上做不到区分）。**采用 `material-icon-theme`**（MIT、2026-07 活跃、1250 SVG + 现成 `dist/material-icons.json` 文件名/后缀映射）。
- 2026-07-29 [Live Preview 选型] 四个候选库全部否决（均经 GitHub API 核实真实存在）：`react-inline-markdown-editor`（10 stars、周下载 3、创建当天即停更）；`codemirror-markdown-hybrid`（8 stars、仓库无 LICENSE 文件与 npm 声明 MIT 冲突、捆绑 marked/katex/mermaid）；`markdown-inline-editor-vscode`（VS Code 扩展、零 CodeMirror 代码，仅交互参考）；Milkdown/Tiptap（既有调研已否决，ProseMirror 无虚拟化 + 往返有损）。**采用 CM6 官方 API 自研**：`syntaxTree` + `Decoration.replace/mark` + `EditorView.atomicRanges`，装饰仅在 `visibleRanges` 计算；可读源码参考 `kenforthewin/atomic-editor`（MIT，活跃）、`segphault/codemirror-rich-markdoc`（MIT）、`retronav/ixora`（Apache-2.0，休眠）。零新增运行时依赖（需补声明 phantom deps，见 Phase 2）。

## 详细设计

### Phase 0 — 前置 POC

**用户可见变化：** 无（POC 产物在 `docs/research/phase-0-pocs/`，图标视觉 POC 出截图供用户裁决确认）。
**本阶段不做：** 不保留任何生产/debug 路由或临时菜单入口；不装运行时依赖（material-icon-theme 仅 devDependency，且待 0.C 结论后再装）。POC 为验证可以在专用 worktree 暂时加入 harness，但 Phase 0 结束前必须删除临时入口并由 RC-12 证明生产构建不可达。

- **0.A Live Preview 装饰核心 POC** ✅ **完成**：纯 `src/__tests__` state harness 已验证标题/粗斜体/行内码/链接 replace+mark、active reveal、半开 visible range、atomicRanges provider、IME freeze/map/空 compositionend rebuild、undo history 与外部 value 最小 diff/selection mapping；11/11 targeted + tsc 通过，零生产 importer。后续 production DOM 已验证点击、输入、选择、删除与 undo，用户于 2026-07-30 实机确认中文 IME 候选与输入正常。结论见 [research/phase-0-pocs/0.A](../../research/phase-0-pocs/0.A-live-preview-decoration-core.md)。
- **0.B trash 打包 smoke（RC-1 前置）**：完整打包 macOS DMG，在产物内通过 `/api/files/delete` 真删一个文件，确认进入系统废纸篓且可恢复；观察 `macos-trash` 可执行位与 hardened runtime 行为。Windows NSIS 有环境则一并做（RC-2），无环境则记录为发版前 required check。
- **0.C 图标提取管线 + 代表性视觉 POC**：脚本从 `material-icon-theme` npm 包（devDependency）提取代表性 12–15 个 SVG（md/ts/tsx/js/json/yaml/html/css/docker/env/package.json/tsconfig/通用回退），生成静态模块；文件树内亮/暗双主题截图各一张，供用户确认视觉气质后再扩到 30–50 个全量子集。同时产出 license manifest 样例（见 Phase 4）。
- **0.D ContextMenu 行为 POC**：在隔离 harness 中使用 `import { ContextMenu } from 'radix-ui'`（聚合包已含 v2.2.16，无需装包）验证右键触发、键盘菜单键（Shift+F10）、焦点归还、子菜单、禁用项；正式 `src/components/ui/context-menu.tsx` 到 Phase 3 再创建，Phase 0 不留下 production wrapper。

### Phase 1 — 中立 Markdown contract + 删主题 + Export 解耦

**用户可见变化：** Markdown 预览样式与聊天一致；Style Select 从预览头部消失。
**验收入口：** 打开任一 `.md` 的 Preview 视图，与聊天中同内容消息逐块比对。
**本阶段不做：** 不动 Live Preview（Phase 2）、不删 Export helpers（只解耦）。

1. **中立共享模块**：新建 `src/components/markdown/markdown-contract.tsx`（目录同时兑现 POC 0.4 的原始路径设想）：
   - `BASE_MARKDOWN_COMPONENTS` — 中立排版映射（h1-h4/p/ul/ol/li/blockquote/hr/a/strong/img/table 家族/inline code/fence 基座），从现 `chat/markdown-components.tsx` 提炼，**不含聊天上下文行为**。
   - 上下文策略以覆盖层表达：`CHAT_MARKDOWN_COMPONENTS = { ...BASE, a: chatLink, code: chatCode }`（保留 fence preview action、本地路径 chip 等聊天策略，仍住 `chat/markdown-components.tsx`，改为从 contract 组装）；`PREVIEW_MARKDOWN_COMPONENTS = { ...BASE, a: previewLink（wikilink/外链策略）, code: previewCode（无聊天 action） }`。
   - **PreviewPanel 只 import 中立模块与 preview 覆盖层，不 import `chat/markdown-components`**；`InlineMarkdownView` 同步。
2. **删除 presentation 主题**：`PreviewPanel.tsx` 的 `PresentationStyleSelect`（:1380-1401）+ `presentationStyle` 传递链（:1032-1045,1302,1601,1712,1742,1870）；`usePanel.ts:71` / `workspace-sidebar.ts:44,304,404` 的 `presentationTemplate` 字段（**parse 必须容忍旧 localStorage Tab 数据中的残留字段**，back-compat 测试已有先例可循）；`globals.css:747-826` 的 `codepilot-md-template-*` 五套 CSS（`codepilot-md-body` 基座是否保留由 contract 落地方式定）；i18n `filePreview.presentation.*`。
3. **Export 脚手架解耦（用户裁决 3）**：`presentation-templates.ts` 拆分——删除 `MarkdownPresentationStyle` / `MARKDOWN_PRESENTATION_STYLES` / `DEFAULT_MARKDOWN_PRESENTATION_STYLE`（in-place 半边）；`PresentationTemplateId`（4 模板）+ `renderPresentation` + 3 个 artifact helper 保持自洽（`presentationStyleToTemplateId` 改为无 style 入参或内联默认）。legacy inline-html 刷新路径（`PreviewPanel.tsx:914-946`）改走固定默认模板。tech-debt #18 补注「2026-07-29 已与 in-place 样式解耦」。
4. **测试迁移**：`markdown-presentation-style.test.ts` 的 5 主题名单/默认值断言删除，序列化 back-compat 用例改写为「残留 presentationTemplate 字段被安全忽略」；`presentation-templates.test.ts` 保留 Export 半边断言。
5. RC-5（聊天 vs 预览渲染一致性 fixture）+ RC-8（旧 Tab 数据 back-compat）+ `npm run test`。

### Phase 2 — Live Preview 接入

**用户可见变化：** `.md/.mdx` 打开即单页 Live Preview：非活动行渲染、光标行显原文；Edit/Preview 双 Tab 消失（**最终产品不保留 Preview Tab**——用户裁决 1；开发期可临时保留作对照，出货前移除并在决策日志登记移除 commit）。
**本阶段不做：** wikilinks/callouts 渲染增强、`.txt` 仍走纯文本编辑。

- **2a 行内 marks（内部里程碑，不单独作为本轮用户交付）**：标题前缀/粗斜体/行内码/链接/列表 bullet/引用条。表格、代码围栏、数学、Mermaid、frontmatter 在 2a 验证期可保持源码显示（CM lang-markdown 嵌套高亮天然可用；frontmatter 走已声明的 `@codemirror/lang-yaml`），但此时不得移除完整 Preview fallback。
- **2b 最低渲染 parity（出货门禁）**：图片、表格、代码围栏、Mermaid、数学公式在非活动块必须呈现与统一 CodePilot Markdown contract 等价的可读渲染，活动块进入可编辑源码态；frontmatter 可继续作为元数据源码显示。每类独立验收，但 RC-11 全部通过前不得执行 RC-10。若某类无法在本轮安全实现，必须保留可访问的 Preview fallback，或由用户明确接受该类型降级，不能静默删除既有能力。
- **机制保留**：autosave（1s 防抖）/ Cmd+S / 冲突横幅 / `loadedPath` 身份门禁全链路不动；装饰层不得影响 `editContent` 数据流。
- **依赖声明**：补 `@codemirror/commands`（现 phantom，`MarkdownEditor.tsx:9`）、新增直接 import 的 `@codemirror/language`、`@lezer/markdown` 进 dependencies。
- RC-3（IME/undo/光标）+ RC-6（性能预算）+ RC-11（最低渲染 parity）+ `npm run test`。

### Phase 3 — 文件树右键菜单 + 重命名 + 删除

**用户可见变化：** 树内右键出三类菜单（空白=新建；文件=重命名/删除/加入对话；文件夹=在此新建/重命名/删除）；F2 对选中行进入行内重命名；删除弹确认（文件夹显示子项数、文案为「移入系统回收站，可恢复」）。
**本阶段不做：** 方向键树导航 / roving focus（F2 绑定在已选中行）；外部（Finder）改名/删除的感知（无 watcher，超范围）。

- 新建 `src/components/ui/context-menu.tsx`（shadcn 风格 wrapper）；`ai-elements/file-tree.tsx` 行级接 trigger；`FileTreePanel.tsx` 承载动作与 API 调用。
- **行内重命名协议**：Enter 提交 / Escape 还原 / blur 取消 / F2 进入；提交期间禁重入；API 错误（`already_exists`/`blocked_directory` 等）内联显示且保持编辑态不丢输入。若 POC 实证 VS Code 的 blur 行为且产品希望完全追随，再由决策日志显式改为 blur 提交，不能把失焦误改名当默认。
- **删除**：AlertDialog 确认；黑名单项（`.env*` 等，服务端 `isBlockedPath` 必拒）菜单侧直接禁用删除项；`fileIO.errors.*` 全 14 个错误码补 en/zh 文案（现仅 3 个 newFileError 键）。
- **一切 mutation 走下方 transaction 契约**；树刷新统一走 `refresh-file-tree` 事件路径（保留 expandedPaths），并把现有新建流程从 `treeReloadKey` remount（`FileTreePanel.tsx:166,327`，会丢展开态）迁到同一路径。
- 后端零改动：四个 `/api/files/*` API 已齐备（rename/delete 现为零调用死代码，本阶段接活）。
- RC-1（macOS 打包废纸篓 smoke 复验）+ RC-4（race test）+ `npm run test`。RC-2 不阻塞非 Windows 环境下的 Phase 3 收口，但保持为 Windows 构建/发版的 fail-closed 门禁。

### Phase 4 — FileTypeIcon + 文件夹 chevron + tooltip

**用户可见变化：** 文件夹行只剩展开箭头；文件行同槽位显示类型图标（`.md/.ts/.html/package.json/Dockerfile/.env` 等可区分）；截断行 hover 可见完整相对路径。
**本阶段不做：** 不打包 material-icon-theme 全集、不联网 Iconify API、不改 SemanticIcon 既有 alias。

- **构建期提取**：`scripts/generate-file-type-icons.mjs` 从 `material-icon-theme`（devDependency）提取 30–50 个 SVG → 生成 `src/components/ui/file-type-icons.generated.tsx` + **license manifest**（`file-type-icons.manifest.json`：每图标的源包名/版本/源文件/上游仓库 URL/MIT 许可声明 + 生成脚本版本），MIT LICENSE 全文随 manifest 存放。
- **`FileTypeIcon` 单一入口**：解析优先级 = 完整文件名（package.json/tsconfig.json/Dockerfile/Makefile/.env*）→ 复合后缀（`.d.ts`/`.test.ts`）→ 普通后缀 → 通用回退；对照 `material-icon-theme` 自带 `dist/material-icons.json` 校准映射。
- **lint import 边界**：`eslint.config.mjs` 新增 no-restricted-imports——`material-icon-theme` 仅允许生成脚本引用；`file-type-icons.generated` 仅允许 `FileTypeIcon` 引用。（现有 lint 只 ban lucide/Phosphor，对新图标源无约束力，必须新增规则而非依赖注释约定。）
- **品牌/商标免责声明**：manifest 与 `docs/handover/icon-system.md` 受控例外条款中写明——图标中的第三方品牌标识（TypeScript/Docker 等 logo）仍受各自商标条款约束，仅作文件类型指示用途，非品牌背书。
- **树行改动**：`ai-elements/file-tree.tsx:199-213` 文件夹去 `folder/folder_open` 图标只留 CaretRight；`:304` 文件默认图标换 `FileTypeIcon`；`FileTreeName`（:339-347）加 `title`（相对路径，原生 title 而非每行挂 Radix Tooltip——树行数量大）。
- RC-7（manifest + 亮/暗截图验收）+ `npm run test`。

### Phase 5 — 回归与文档

- 全量 `npm run test` + `test:smoke`；打包产物回归（RC-1/RC-2 终验）。
- **文档漂移修复（docs-only commit）**：POC 0.4 文内路径加 stale 注记；`insights/icon-system.md:41` 的 error/warn 口径对齐 `eslint.config.mjs:118`；`FileTree.tsx:264` 注释事件名改 `refresh-file-tree`；`markdown-artifact-overhaul.md` §4.2 加 supersede 指针指向本计划。
- handover + insights 双文档（互链）：`docs/handover/markdown-live-preview-file-tree.md` + `docs/insights/markdown-live-preview-file-tree.md`；`icon-system.md` 受控例外条款。
- tech-debt 回写：#18 补注解耦；#60/#61/#62 状态核对（见 tracker）；本计划移 `completed/`。

#### Claude 审查修正清单（`5d562a0c`）

- [x] P1-1：文件与文件夹右键重命名在菜单关闭后保持输入态和焦点。
- [x] P1-2：会话右键重命名/删除不残留菜单，不再强转 Radix event。
- [x] P2-3：重命名输入框右键交给 Electron 原生编辑菜单。
- [x] P2-4：无 gutter 的编辑器恢复搜索、多光标、括号与补全能力，直接依赖已声明。
- [x] P2-5：quiet refresh / AI 外部写入触发 block 与 inline widget 重建。
- [x] P2-6：新建 Markdown 只选中 stem，保留最终扩展名。
- [x] 非阻塞 P3 顺手闭环：删除线、Setext、有序任务序号、checkbox `aria-disabled`、Dialog 标题闪回；frontmatter 保持 lossless source。
- [x] 自动验证：Codex unit/pre-commit **3873/3873**、smoke **20/20**；Claude 独立复跑 unit **3873/3873**。
- [x] 人工发布矩阵：用户于 2026-07-30 确认原生中文 IME 输入正常。
- [x] 人工发布矩阵：用户于 2026-07-30 确认暗色 5% 选中态正常。
- [x] 深色主题与磨砂 follow-up：Markdown surface 与应用卡片一致；Live Preview 标题使用 `--foreground`；Electron 原生材质跟随 app `system/light/dark`；macOS 外围透明，浅/深 sidebar/card 只保留 40% tint；整窗默认材质按用户反馈从较重的 `menu` 调为 `under-window`。
- [x] Windows RC-2 发布门禁裁决：用户于 2026-07-30 明确接受跳过发布前实机验证，Mac/Windows 同步发布后再验证 NSIS 产物的废纸篓删除与恢复；文档与 Release Notes 不宣称该路径已预验证。
- [x] v0.62.0 发布：commit `bd598563`、tag `v0.62.0`、CI run `30513383728`；Mac/Windows 打包、ABI、packaged server 与 release asset 上传全部通过。
- [ ] Windows 发布后实机验收：用户安装 v0.62.0 后验证文件/文件夹移入系统回收站与恢复；若失败按 fix-forward 处理。

## File Mutation Transaction（rename / delete 状态转换与失败回滚）

所有由 CodePilot UI 发起的 rename/delete 必须走此契约。目标：**任何时序下旧路径不被 autosave 复活、失败后 UI/state 完整回到事务前**。

### 协调所有权与 participant 协议

- 在 `AppShell` 与 Workspace Sidebar、PreviewPanel、FileTree 都可访问的共同上层建立 `FileMutationCoordinator`（可由独立 `FileMutationContext` 承载，provider 必须位于这些消费者的共同祖先）。文件树不得直接“先调 API、再各处 fire-and-forget setState”；所有 rename/delete 只调用 coordinator 暴露的 `runFileMutation(request)`。
- coordinator 为每次操作生成 `transactionId`，并支持 PreviewPanel 注册可选 participant：
  - `matches(targetPath, kind)`：当前 editor 是否命中文件或目录子树。
  - `prepare(transaction)`：同步写入 ref 级 guard，取消 `autosaveTimerRef`，等待 `savePromiseRef` 中已经发出的保存；保存失败则 prepare 失败并阻止文件 mutation。返回事务前 editor snapshot。
  - `commit(transaction)`：先同步更新用于写入门禁的 path refs，再提交 `loadedPath` / dirty-buffer React state；在 `useLayoutEffect` 确认新 path anchor 已生效后 resolve acknowledgement。
  - `rollback(transaction, snapshot)`：恢复 snapshot 并解除 guard；API 失败前不得提交任何 path state，因此 rollback 主要负责恢复 autosave 调度和 UI 编辑态。
- `PreviewPanel` 必须把现有 effect 内部的匿名 autosave timer 改成可取消的 `autosaveTimerRef`；`handleSaveEdit` 必须把当前保存 Promise 写入 `savePromiseRef`，不能把 boolean `savingEdit` 当成可等待对象。guard 同时检查 transactionId 与目标路径/目录子树，防止 stale closure 越过门禁。
- Workspace Sidebar 以单个 reducer action 提交 rename/delete：一次性更新 Tab `id/key/filePath/title`、activeTabId 和持久化数据；AppShell 在同一 coordinator commit 中更新 `previewSource`；FileTree 通过带 `transactionId/oldPath/newPath/kind` 的 commit 事件更新 `expandedPaths` / `selectedFolderPath`。各 participant 回 ack 前 guard 不解除。
- 没有挂载 PreviewPanel 或当前 editor 不命中 mutation 子树时，prepare 视为立即成功；目录 rename/delete 必须用路径边界安全的 descendant 判断，不能用裸 `startsWith`。

```
idle
 └─ 用户触发 rename/delete
     ↓
[1] preparing —— 暂停写入
     · coordinator 生成 transactionId，调用所有 matching participant.prepare()
     · PreviewPanel 同步设置 ref 级 mutation guard（autosave effect 与 handleSaveEdit 首行均检查）
     · clearTimeout(autosaveTimerRef) 取消 pending 的 1s 防抖 autosave
     · await savePromiseRef 中已在飞行的保存；失败则停止 mutation 并进入 [R]
     ↓
[2] dirty 语义分支
     · rename + dirty：保留 editContent 缓冲，不向旧路径 flush；成功后缓冲整体迁移到新路径（dirty 状态延续，savedContent 不变）
     · delete + dirty：确认对话框必须显式声明「有未保存修改，删除将丢弃」；用户取消 → 直接进 [5] 恢复，状态零变更
     · 干净缓冲：直接进 [3]
     ↓
[3] executing —— 调 /api/files/rename | /api/files/delete
     · 失败（任何 FileIOError / 网络错误）→ [R] 回滚
     ↓
[4] migrating —— 仅在 API 成功后执行，顺序固定：
     a. PreviewPanel participant.commit：先改 path refs，再提交 loadedPath / dirty buffer 迁移
     b. AppShell：previewSource filePath 重写（含文件夹 rename 后代）/ setPreviewSource(null)
     c. Workspace Sidebar：单 reducer action 原子迁移 tabs（id/key/filePath/title/activeTabId/localStorage）/ close affected tabs
     d. FileTree commit 事件：expandedPaths 前缀重写 / 子树移除；selectedFolderPath 同规则
     e. 等待 PreviewPanel layout-effect ack 与其他 participant commit ack
     f. 派发 refresh-file-tree 事件（保留已迁移的展开态）
     ↓
[5] resuming —— 清除 mutationInFlight guard，恢复 autosave 调度
     · rename 后首次 autosave 前置断言：loadedPath === previewSource.filePath === 新路径，否则拒绝写入（沿用既有 loadedPath 门禁）
     ↓
idle

[R] rolled-back（prepare / executing 失败时）：
     · coordinator 调用 participant.rollback(snapshot)；此前未做 path state 迁移（迁移只发生在 [4]），所以 editContent/loadedPath/tabs 保持事务前原值
     · prepare 阶段的 in-flight save 若失败，文件 mutation 不执行；保留原路径与 dirty 状态并呈现保存错误
     · rename：行内输入框保持编辑态并内联显示错误码文案，不丢用户输入
     · delete：toast 显示错误（trash_unavailable 等），文件与 Tab 均不动
```

**Race test（RC-4，fake timers + coordinator harness）必须覆盖：**
1. dirty 缓冲 + 防抖计时到 500ms 时启动 rename 事务 → 断言旧路径在事务开始后零写入、后续保存只落新路径、旧路径未被重建。
2. autosave 写入已在飞行（fetch 未返回）时启动事务 → 断言事务等待写入完成后才执行 rename，最终新路径内容 = 飞行写入的内容。
3. delete + dirty 确认后 → 断言旧路径无任何后续写入（含防抖尾巴），Tab 关闭、previewSource 清空。
4. 事务 API 失败 → 断言 guard 释放后 autosave 恢复且仍写旧路径（文件未动，属正确行为）。
5. 人为延迟 React commit/layout-effect acknowledgement → ack 前 autosave guard 始终有效；全部 path owner 对齐后才恢复写入。
6. 无活动 PreviewPanel时执行文件夹 rename/delete → coordinator 不等待不存在的 participant，tabs/expandedPaths 仍按路径边界正确迁移，且相似前缀目录（`foo` / `foobar`）不被误伤。

## Required Checks（结构化，均为对应 Phase 的出货闸门）

| ID | 检查 | 方法 | 闸门 |
|----|------|------|------|
| RC-1 | macOS DMG 打包产物内真实删除进废纸篓且可恢复 | 打包 + 手工操作 + 废纸篓截图 | Phase 0.B 初验；Phase 3 出货复验 |
| RC-2 | Windows NSIS 产物同上（windows-trash.exe 路径） | Windows 构建/发版前必须执行；没有 Windows 证据时不得宣称 Windows ready | Windows 构建/发版，非 Phase 3 的 macOS 收口门禁 |
| RC-3 | 中文 IME / undo-redo / 光标选区在 Live Preview 下无回归 | POC 手工清单 + CM state 层单测（装饰不进 history） | Phase 2 |
| RC-4 | file mutation race/coordinator test 套件全绿（上节 6 条） | `tsx --test` fake timers + participant harness | Phase 3 |
| RC-5 | 聊天 vs 文件预览渲染一致性 | 固定 fixture 双端渲染，逐块（h/p/list/quote/link/inline-code/fence/table）DOM 断言或截图比对 | Phase 1 |
| RC-6 | Live Preview 性能预算达标 | 见下方「性能验收」可复现规程 | Phase 2 |
| RC-7 | 图标 license manifest 完整 + 亮/暗双主题截图验收 | manifest 字段核对 + 截图入 Smoke Ledger | Phase 4 |
| RC-8 | 旧 localStorage Tab 数据（含 presentationTemplate 残留）反序列化零异常 | workspace-sidebar back-compat 单测 | Phase 1 |
| RC-9 | 每 Phase 结束 `npm run test` 全绿；Phase 3/5 追加 `test:smoke` | CI/本地 | 各 Phase |
| RC-10 | RC-11 通过后，移除开发期临时 Preview Tab（用户裁决 1），移除 commit 登记决策日志 | code review + 决策日志；不得早于 RC-11 | Phase 2 收尾 |
| RC-11 | Live Preview 最低渲染 parity：图片/表格/代码围栏/Mermaid/数学公式非活动块可读渲染，活动块可回到无损源码编辑 | 固定 fixture + 逐类型 DOM/视觉 smoke；与现有 Preview 反例对照 | Phase 2，RC-10 前置 |
| RC-12 | Phase 0 不遗留临时 debug route、POC menu 或 production 可达入口 | diff/route manifest 检查 + production build；POC 结论与截图保留在 research/Smoke Ledger | Phase 0 收尾 |

## 性能验收（可复现规程，替代裸 “p95 < 16ms”）

- **Fixture（入库）**：`src/__tests__/fixtures/md/live-preview-100k.md`，由带固定 seed 的生成脚本产出并提交：≈10 万字符、200 标题、50 个 ≤80 行代码围栏、20 表格、中英混排。
- **参考设备与环境**：当前开发机（darwin arm64 / Apple Silicon）。主基准使用 `npm run build` 后的 production server（`npm run start`），关闭 HMR 与 React/Next 开发期检查；Phase 2 收尾再用打包或 production Electron renderer 做一次同场景确认。不得用 `npm run dev` 的 trace 作为性能门禁证据。
- **采样方法**：chrome-devtools Performance trace 覆盖两个脚本化场景——① 固定节奏 PageDown 连续滚动 10s；② 文档中部连续输入 30 字符（含一次中文 IME 组合）。从 trace 提取帧时长与输入延迟。
- **基线**：先在**未启用 Live Preview** 的现有编辑器上对同一 fixture 走完全相同规程，记录基线 B（p95 帧时长、p95 输入延迟），写入 Smoke Ledger。
- **预算**：启用 Live Preview 后，p95 帧时长 ≤ max(16.7ms, B×1.2)；p95 输入延迟 ≤ max(B×1.2, 绝对上限 50ms)；trace 内无单帧 >100ms 的连续卡顿簇。
- **回归幅度**：后续改动允许相对已登记结果 ±20%，超出即回归，需修复或在决策日志明确接受理由。
- **证据**：trace 文件路径 + 数值登记 Smoke Ledger。

## 测试与验收矩阵

| 场景 | 方法 | 通过标准 |
|------|------|---------|
| 中文 IME | POC 清单 + 手工（RC-3） | composition 期间装饰冻结；无丢字/重复；候选框不跳位 |
| Undo/Redo | CM state 单测 | 装饰切换不进 history；外部写回不清 undo 栈 |
| 光标/选区 | 手工 + targeted test | 点击渲染行光标落语义位置；atomicRanges 下跨标记选区/删除整体行为正确 |
| 长文档 | RC-6 规程 | 预算内 |
| 图片/表格/代码块/Mermaid/数学 | 2a 内部源码高亮断言；RC-11 固定 fixture + DOM/视觉 smoke | 出货时活动块还原无损原文；非活动块渲染正确，未达 parity 不移除 Preview fallback |
| 自动保存/磁盘冲突 | 既有 smoke + 反例：Live Preview 下 dirty 时外部改文件 | 冲突横幅出现、不静默覆盖；loadedPath 门禁回归 |
| 文件/文件夹重命名 | UI smoke + API 单测（已有） | Enter 提交、Esc/blur 取消、F2 进入；错误内联不丢输入 |
| 重命名目录后 Tab 迁移 | workspace-sidebar 迁移纯函数单测 | 后代 Tab id/key/filePath/title 全改写；localStorage 往返一致；expandedPaths 前缀迁移 |
| 删除活动文件 | RC-4 race test + UI smoke | Tab 关闭、previewSource 清空、selectedFolderPath 清理、dirty 不复活文件 |
| F2/Enter/Esc + 右键菜单 | 手工 + smoke | 键盘菜单键可开菜单；焦点归还触发行；黑名单项禁用 |
| 同名不同后缀图标 | FileTypeIcon 解析单测 + 视觉 | `a.md`/`a.ts`/`a.html` 互异；`package.json` 命中特殊名 |
| 长文件名截断 + tooltip | 视觉检查 | truncate 行 hover 可见完整相对路径 |
| macOS/Windows 废纸篓 | RC-1/RC-2 | 进系统废纸篓可恢复；trash 失败明确报错且磁盘文件不动 |

## 明确不做（本轮）

- 拖放 / 多选 / 剪切粘贴 / 超大目录虚拟化（tech-debt #62；届时与 Headless Tree 评估合并）
- 方向键树导航 / roving focus 全套
- 外部（Finder/终端）重命名删除的感知（无 watcher）
- wikilinks/callouts 的 Live Preview 增强渲染
- Export pipeline 重启（tech-debt #18，仅解耦）
- `.xlsx`、URL 预览等既有 defer 项

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 跑了真实 smoke 后必须在这里登记一行。RC-1/RC-2/RC-6/RC-7 的证据（截图 / trace 路径）也登记于此。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | - | - | - | - | RC-1 DMG 废纸篓 smoke | - | 截图路径 |
| 2026-07-29 | - | - | - | - | Phase 0.A Codex 重做：Live Preview state 层 decoration / atomic provider / IME freeze / history POC | ⚠️ partial | targeted **11/11**；全量 `npm run test` **3851 tests / 964 suites / 0 fail**；真实 DOM 点击/删除与真机 IME 待补。证据 [research/phase-0-pocs/0.A-live-preview-decoration-core.md](../../research/phase-0-pocs/0.A-live-preview-decoration-core.md) |
| 2026-07-29 | - | - | - | - | RC-3/RC-11 production DOM：inactive parity、active lossless source、连续输入、Cmd+Z | ⚠️ partial | 活动行保留 `$x_91 + y_91$` 原文；31 字符输入后 Cmd+Z marker 消失；图片/表格/fence/Mermaid/KaTeX targeted 通过。原生中文 IME 候选窗仍待人工 |
| 2026-07-29 | - | - | - | - | RC-6 100K production performance | ✅ | baseline frame/input p95 **18.3/56ms**；Live Preview **16.8/48ms**，max frame **17.7ms**，>100ms **0**；raw trace 因 DevTools connector workspace 写入限制未落盘 |
| 2026-07-29 | - | - | - | - | RC-4 file mutation race + browser UI | ✅ | coordinator 六种 race **6/6**；真实 UI 验证 file/folder rename-delete、tab/preview/expanded path 迁移 |
| 2026-07-29 | - | - | - | - | RC-7 FileTypeIcon 许可与亮暗视觉 | ✅ | 固定 50 SVG；manifest/license test 通过；light/dark 文件树检查，folder arrow-only、同名不同后缀可区分 |
| 2026-07-29 | - | - | - | - | RC-1 signed packaged macOS Trash + restore | ✅ | DMG/ZIP + strict codesign；packaged server `:47823` API 返回 `trashed:true`；Finder Trash 列出 marker，恢复后内容完整。RC-2 未在 Windows 执行 |
| 2026-07-29 | - | - | - | - | Phase 5 full regression | ✅ | targeted **16/16**；unit **3866/3866**；Playwright smoke **17/17**；typecheck/build/macOS pack 通过 |
| 2026-07-29 | - | - | - | - | Claude review P1/P2 closure（`5d562a0c`）：菜单动作焦点/关闭、rename 输入右键、编辑器搜索、quiet refresh widget、新建文件 stem | ✅ | Codex targeted E2E **3/3**、unit/pre-commit **3873/3873**、smoke **20/20**；Claude 独立复跑 unit **3873/3873**；targeted ESLint **0 error** |
| 2026-07-30 | - | - | - | - | RC-3 中文 IME + 暗色 5% 选中态人工验收 | ✅ | 用户在实际 Electron 客户端确认两项均无问题 |
| 2026-07-30 | - | - | - | - | Electron 整窗深色主题视觉复核 | ❌ follow-up | 四项均复现；computed style 核验 Markdown editor `rgb(40,44,52)`、标题 syntax span `rgb(224,108,117)`，与应用 background/foreground token 不一致；macOS 外层 vibrancy 与 sidebar/card 偏亮 |
| 2026-07-30 | - | - | - | - | 深色主题 follow-up 修复复验 | ✅ | targeted **17/17**、full unit **3875/3875**；editor/workspace/fileTree background token 完全一致，heading/child 均为 foreground；browser console clean；Electron 整窗确认外层玻璃、顶栏、左侧卡片深色可读 |
| 2026-07-30 | - | - | - | - | 第一次深色 shell 方案实机复核 | ❌ regression | 用户确认 82% window / 88% sidebar renderer tint 在浅色、深色下都使外围磨砂接近纯色；第一次“深色可读”不能替代半透明材质验收 |
| 2026-07-30 | - | - | - | - | 原生主题同步 + 磨砂回归复验（`569b117d`） | ✅ | isolated Electron light/dark 截图；两种模式 body/window 均 transparent，sidebar 40% tint，dark IPC `bridgeAccepted=true`；targeted **11/11**、typecheck、pre-commit full unit **3878/3878** |
| 2026-07-30 | - | - | - | - | 原生磨砂强度微调（`83e041cd`） | ✅ | 隔离 Electron 同机对比 `menu` / `under-window` 后选择较轻的 `under-window`；最终无环境变量窗口日志为 `vibrancyOption=under-window`、body/window transparent、`opaqueElementCount=0`；targeted **12/12**、两轮 full unit/pre-commit **3879/3879** |
| 2026-07-30 | - | - | - | - | v0.62.0 Windows RC-2 发布裁决 | ⚠️ accepted | 用户明确接受跳过发布前 Windows Trash/restore 实机 smoke；Mac/Windows 同步发布后由用户验证，失败则 fix-forward；此记录不等同于 RC-2 通过 |
| 2026-07-30 | - | - | - | - | v0.62.0 正式发布线最终门禁 | ✅ | 基于 v0.61.0 集成；`npm install` lock 同步；typecheck + unit **4776/4776**；production build 通过；独立端口 smoke **22/22**；无 conflict marker / `git diff --check` 问题 |
| 2026-07-30 | - | - | - | - | v0.62.0 Mac/Windows CI + Stable Release | ✅ | release commit `bd598563`；tag `v0.62.0`；Actions run `30513383728` 全绿；Mac arm64/x64 与 Windows x64 均通过版本、ABI、packaged server、checksum；稳定 Release 与 6 个 assets 已发布 |
