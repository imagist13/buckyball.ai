# Markdown Live Preview × Explorer 文件树交接

> 产品取舍见 [docs/insights/markdown-live-preview-file-tree.md](../insights/markdown-live-preview-file-tree.md)。
>
> 执行记录见 [docs/exec-plans/active/markdown-live-preview-and-file-tree.md](../exec-plans/active/markdown-live-preview-and-file-tree.md)（归档后路径改为 `completed/`）。

## 交付边界

本轮把三条原本分散的体验收成一个工作流：

1. `.md/.mdx` 打开后直接进入 CodeMirror Live Preview，不再保留 Edit / Preview 双切换；活动行显示无损源码，非活动行渲染标题、强调、链接、列表、引用、图片、表格、代码块、Mermaid 与 KaTeX。
2. 文件树支持空白区/文件/文件夹右键菜单、F2 行内重命名、创建和移入系统废纸篓；文件夹只显示展开箭头。
3. 文件显示 `material-icon-theme` 构建期提取的静态类型图标；运行时不加载第三方主题包。

明确不在本轮：多选、拖放、剪切粘贴、方向键 roving focus、大目录虚拟化、外部文件系统 watcher、wikilink/callout 增强。

## Markdown 数据流与不变量

`PreviewPanel` 仍持有 `loadedPath`、`editContent`、dirty、冲突检测和自动保存状态。`MarkdownEditor` 只接收字符串并通过 CodeMirror transaction 回传；Live Preview decoration 不生成第二份富文本数据。

```text
disk source
   ↓ load
PreviewPanel.editContent ──→ MarkdownEditor / CodeMirror document
   ↑ onChange                         │
   └──── autosave / Cmd+S ←──────────┘
                                      │ visible ranges + syntax tree
                                      └─→ ephemeral decorations/widgets
```

关键不变量：

- Markdown 原文是唯一事实源；widget 只是一层可丢弃的视图。
- 光标所在 block/line 必须回到源码，点击 widget 只移动 selection，不改文档。
- composition 期间冻结并 map 已有 decoration；composition end 再重建，装饰变化不进入 undo history。
- 外部 value 同步走最小 diff transaction，并继续受 `loadedPath` 身份门禁保护。
- 相对图片通过当前 session 的文件读取入口解析；Mermaid 使用 strict security；KaTeX `trust=false`。
- Live Preview 属于内容层：CodeMirror canvas 必须使用 `--background` / `--foreground`，inactive 标题及其嵌套 syntax span 必须继承 `--foreground`；代码主题只能影响活动源码 token，不能覆盖文档 surface 或渲染后的标题颜色。

实现入口：

- `src/components/editor/markdown-live-preview.ts`：语法树遍历、inline/block decoration、atomic range、widget。
- `src/components/editor/MarkdownEditor.tsx`：CodeMirror 生命周期、direct dependency、Live Preview 接入。
- `src/components/layout/panels/PreviewPanel.tsx`：加载/保存/冲突/文件身份与 mutation participant。
- `src/components/markdown/markdown-contract.tsx`：聊天与传统渲染视图共享的中立 Markdown 表现契约。
- `src/app/globals.css`：统一 Markdown 和 `.cm-lp-*` 样式。

## 文件 mutation transaction

rename/delete 不允许由文件树直接调用 API 后再各自 fire-and-forget 更新状态。`FileMutationProvider` 在 AppShell 共同祖先提供一个 `FileMutationCoordinator`，参与者按三阶段执行：

1. `prepare`：匹配目标路径；取消 pending autosave、等待 in-flight save，保存本地快照并加 mutation guard。
2. 执行 `/api/files/rename` 或 `/api/files/delete`。
3. `commit`：PreviewPanel、WorkspaceSidebar、AppShell preview source 等 owner 同步迁移或清理路径，全部 acknowledgement 完成后才释放 guard。API 失败则逆序 `rollback`。

目录匹配必须使用 segment boundary：`foo` 不能命中 `foobar`。rename 后所有后代路径用相同规则迁移；delete 后关闭受影响 tab、清空 preview source，不能让延迟 autosave 把文件复活。

核心文件：

- `src/lib/file-mutation.ts`：请求/participant 契约、路径边界、API executor、coordinator。
- `src/hooks/useFileMutation.tsx`：provider、注册与统一 refresh event。
- `src/lib/workspace-sidebar.ts`：tab/path 纯函数迁移。
- `src/components/layout/panels/FileTreePanel.tsx`：用户动作、确认框、错误翻译。
- `src/components/ai-elements/file-tree.tsx`：context menu、F2 inline rename、Enter/Escape/blur 协议。

受保护路径由前后端双守：UI 禁用常见敏感/生成目录操作，服务端仍是最终安全边界。删除文案必须明确“移入系统废纸篓，可恢复”；Trash 不可用时 fail closed，不回退为永久删除。

## FileTypeIcon 构建管线

`material-icon-theme` 仅是 devDependency。`scripts/generate-file-type-icons.mjs` 从其 manifest 提取固定 50 个 SVG，生成：

- `public/file-type-icons/*.svg`
- `src/components/ui/file-type-icons.generated.ts`
- `src/components/ui/file-type-icons/file-type-icons.manifest.json`
- `src/components/ui/file-type-icons/LICENSE.material-icon-theme`

`FileTypeIcon` 的解析优先级是：精确文件名 → `.env*` → 最长 compound suffix → extension → generic file。文件夹不使用类型图标，只保留 Caret。ESLint 禁止产品代码直接 import `material-icon-theme` 或 generated mapping。

这是 [Icon System](./icon-system.md) 的受控例外：文件类型 artwork 表达外部文件格式，不进入 CodePilot semantic alias 字典。

## 验证入口

- Live Preview：`src/__tests__/unit/markdown-live-preview.test.ts`
- 六类 mutation race：`src/__tests__/unit/file-mutation-coordinator.test.ts`
- 图标解析、manifest、license：`src/__tests__/unit/file-type-icon.test.ts`
- 固定长文 fixture：`scripts/generate-live-preview-fixture.mjs` 与 `src/__tests__/fixtures/md/live-preview-100k.md`
- 通用回归：`npm run test`
- UI smoke：Live Preview 各 block、F2 rename、Trash delete、tab/path 迁移、亮暗主题文件图标。

本轮最新基线：原生主题/磨砂 targeted 12/12、unit 3879/3879；既有 Playwright smoke 20/20。117,929-byte 固定夹具的 production Live Preview 滚动 p95 16.8ms、输入 p95 48ms、无 >100ms 卡顿帧。macOS Developer ID 签名 DMG/ZIP 中的 `/api/files/delete` 已验证真实进入 Finder Trash 且可以恢复。macOS 外围材质必须保持 renderer transparent，由 Electron `nativeTheme.themeSource` 跟随 app `system/light/dark`；整窗默认使用较轻的 `under-window` 材质，需要比较候选时走 `ELECTRON_VIBRANCY` 开关；禁止恢复已被用户否决的 82% window / 88% sidebar 高不透明度遮罩。

用户已于 2026-07-30 实机确认中文 IME 候选与输入正常；Windows Trash 仍必须在 Windows 打包环境复验，不能由 macOS 结果代替。`afterPack` 会把工作区 `better-sqlite3` 留在 Electron ABI，打包后继续运行 Node 命令前先执行 `npm rebuild better-sqlite3`。

## 修改检查表

- [ ] Live Preview decoration 未改写 Markdown 原文，也未污染 undo history
- [ ] 新 block widget 同时覆盖 inactive render、active lossless source、click reveal
- [ ] rename/delete 只通过 coordinator；新增路径 owner 已注册 participant
- [ ] pending timer 和 in-flight save 都在 mutation prepare 中处理
- [ ] 路径迁移使用 boundary-safe helper，不用裸 `startsWith`
- [ ] 新错误码同时补 `en.ts` / `zh.ts`
- [ ] 新文件图标通过 generator 和 manifest 添加，不在组件里手写映射或运行时 import 源包
- [ ] 文件夹仍是 arrow-only；文件完整路径仍可通过 tooltip 查看
