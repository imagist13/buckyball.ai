# Markdown / Artifact 体系重构 — 技术交接

> 产品思考见 [docs/insights/markdown-artifact-overhaul.md](../insights/markdown-artifact-overhaul.md)
> 执行计划归档于 [docs/exec-plans/completed/markdown-artifact-overhaul.md](../exec-plans/completed/markdown-artifact-overhaul.md)

CodePilot 的 Markdown 渲染链 + Artifact 预览面板 + 文件读写链 的一次集中改造。五个阶段交付（Phase 1-5），覆盖 40 个源文件、~5600 行新增代码。目标读者：需要独立接手这块能力维护的开发者。

---

## 目录结构

```
electron/
  main.ts                         # artifact:export-long-shot IPC + widget:export-png 复用（同一隐藏窗口配方）
  preload.ts                      # exportLongShot / files.* 新 channel 暴露

src/
  app/api/files/
    preview/route.ts              # 放开 1000 行上限 → 分档 + 字节上限 + 截断字段
    write/route.ts                # 新增：单文件写入（mkdir -p + lstat + 符号链接拒绝）
    mkdir/route.ts                # 新增：文件夹创建
    rename/route.ts               # 新增：改名 / 跨目录移动（两端 path safety）
    delete/route.ts               # 新增：走系统回收站（trash 包，不 fs.unlink）

  components/
    chat/
      DiffSummary.tsx             # 从 MessageItem 抽出的独立组件（Artifact 卡片入口）
      MessageItem.tsx             # 调用点 + resolveToolPath + onExportLongShot 回调

    editor/
      MarkdownEditor.tsx          # CodeMirror 6 封装（Compartment 主题切换）
      MarkdownEditor.lazy.tsx     # next/dynamic ssr:false 包装
      SandpackPreview.tsx         # .jsx/.tsx 单文件 React 预览（固定挂 /App.tsx）
      DataTableViewer.tsx         # .csv/.tsv 表格视图（papaparse + 排序 + CSV/JSON 导出）

    layout/
      AppShell.tsx                # PreviewSource 作为 state 主所有者 + RENDERED_EXTENSIONS
      PanelZone.tsx               # anyOpen gate 扩展到 inline-* 变体
      panels/
        PreviewPanel.tsx          # kind 分支调度 + loadedPath / freshPreview 防漂移 + Edit 视图模式
        FileTreePanel.tsx         # 新建 Markdown/Folder 的 VS Code 风格入口 + 选中文件夹高亮

    ai-elements/
      file-tree.tsx               # isSelected 状态 + 点击文件夹选中
      code-block.tsx              # 对外 export createSharedCodePlugin + highlighterCache

  hooks/usePanel.ts               # usePreview → usePreviewSource 迁移（派生 previewFile）
  lib/
    files.ts                      # assertRealPathInBase / FileIOError / isPathSafe 等共享 helper
    artifact-export.ts            # 前端调 IPC 的封装 + 错误码映射
  types/index.ts                  # PreviewSource 联合 + FilePreview 新字段
  i18n/{en,zh}.ts                 # 17 个新键（filePreview.* / artifact.exportLongShot.* / fileTree.newItem.*）

docs/
  handover/markdown-artifact-overhaul.md     # 本文
  insights/markdown-artifact-overhaul.md     # 产品思考
  exec-plans/completed/markdown-artifact-overhaul.md  # 归档计划
  research/phase-0-pocs/                     # 7 份 POC 文档
```

---

## 核心数据模型

### `PreviewSource` — PreviewPanel 的唯一输入

```ts
// src/types/index.ts
type PreviewSource =
  | { kind: 'file'; filePath: string }                            // 文件树 / DiffSummary 卡片点击
  | { kind: 'inline-html'; content: string; title?: string }       // AI 生成的 HTML 片段（未来）
  | { kind: 'inline-jsx'; content: string; title?: string }        // AI 生成的 JSX 片段（未来）
  | { kind: 'inline-datatable'; rows: unknown[][]; header: string[]; title?: string }  // 聊天内表格提取
```

**迁移意图：** 原先 `previewFile: string | null` 是单通道，只能指向磁盘文件。改为 discriminated union 后，聊天里提取的 inline 内容（未来能力）和磁盘文件共用同一个 PreviewPanel，内部按 `kind` 分支调度。

**派生兼容：** `previewFile` 变成从 `previewSource` 派生（`previewSource?.kind === 'file' ? previewSource.filePath : null`）。所有老 adapter（FileTreePanel 传 `setPreviewFile`）透明兼容。

### `FilePreview` — preview API 返回

```ts
type FilePreview = {
  path: string;
  content: string;
  truncated: boolean;        // 新增：是否被截断（行或字节）
  lines_read: number;
  lines_total: number;
  bytes_read: number;        // 新增
  bytes_total: number;       // 新增
  binary?: boolean;          // 新增：前 4KB null 字节检测命中
}
```

### `DiffFile` — DiffSummary 卡片输入

```ts
// src/components/chat/DiffSummary.tsx
type DiffFile = {
  path: string;              // 绝对路径
  name: string;              // basename
  operation?: 'created' | 'modified';   // 决定 chip 颜色（emerald / amber）
}
```

---

## 4 条关键数据流

### 流 1：AI 修改文件 → 聊天里出 Artifact 卡片 → 用户点开预览

```
claude-client SSE → MessageItem 解析 tool_result
                 ├─ write/edit/writefile/create_file/notebookedit 工具结果
                 └─ 抽 path / operation 生成 DiffFile[]
                       ↓
         <DiffSummary files={...} onPreview={setPreviewSource} onExportLongShot={...} />
                       ↓
         按扩展名分组：
           PREVIEWABLE (.md/.mdx/.html/.htm/.jsx/.tsx/.csv/.tsv) → Artifact 卡片
           其他                                                  → "Also modified: foo.ts" 一行
                       ↓
         用户点 "Open preview" → setPreviewSource({ kind:'file', filePath })
                              → AppShell useEffect 侧触发 setPreviewOpen(true)
                              → PreviewPanel 挂起 + load
```

**MessageItem 里 `resolveToolPath` 处理相对路径：** 部分 tool_result 给的是相对路径（比如 `src/foo.ts`），需要拼 workingDirectory 才能走 /api/files/preview。

### 流 2：文件树点击 → PreviewPanel 渲染

```
FileTreePanel 点击 → setPreviewFile(path)  ← 老 API，AppShell 内部转成 setPreviewSource({kind:'file', filePath:path})
                                              ↓
PreviewPanel useEffect: previewSource 变化
  ├─ setLoadedPath(null)              ← 防止旧 preview.content 在新 filePath 下闪一帧
  ├─ setPreview(null)
  ├─ setLoading(true)
  └─ fetch('/api/files/preview?path=...')
       ├─ 分档行数上限：md/mdx/txt = 50000, yaml/json/md = 10000, 其他 = 5000
       ├─ 字节上限：10MB 硬 cap
       ├─ 二进制检测：前 4KB 含 null 字节 → binary:true 拒渲染
       ├─ symlink / 跨 base 拒：assertRealPathInBase
       └─ 返回 FilePreview → setPreview + setLoadedPath(filePath)
                ↓
RenderedView({ filePath, content, kind })
  ├─ isSandpack(filePath)    → <SandpackPreview />（.jsx/.tsx）
  ├─ isDataTable(filePath)   → <DataTableViewer />（.csv/.tsv）
  └─ Streamdown 渲染（.md/.mdx/.html/.htm）
```

**freshPreview 防漂移：** `loadedPath !== previewSource.filePath` 时主渲染树从 `preview` 切到 `null`，避免旧内容在新路径下短暂渲染（Codex P1 指出的 first-frame 问题）。

### 流 3：Markdown 编辑 + 自动保存

```
PreviewPanel Edit 视图模式
  ├─ editContent 状态（由 loadedPath + preview.content seed）
  ├─ editDirty = editContent !== savedContent && loadedMatchesActive
  └─ 1 秒 debounce saveEffect
       ↓
fetch('/api/files/write', { method:'POST', body:{ path, content, base_dir? } })
  ├─ assertRealPathInBase({ rejectIfSymlink:true, allowMissing:true })
  ├─ mkdir -p 父目录
  ├─ fs.writeFile
  └─ 200 返回 { ok, path, bytes_written }
       ↓
setSavedContent(editContent)
```

**锚点：** `loadedPath` 状态是保存回写的**门禁**。任何时候发现 `loadedPath !== previewSource.filePath`（用户切了文件），自动保存 block——防止 A 文件的内容写到 B 文件路径。

**错误表面化：** 写入失败 → 状态栏显示 FileIOError.message + 保留 editContent（用户可以复制出来）。

### 流 4：长图导出（仅 .html/.htm）

```
PreviewPanel "导出长图" 按钮 / DiffSummary 行按钮
  ↓
src/lib/artifact-export.ts exportHtmlAsLongShot({ html, filename })
  ↓
window.artifact.exportLongShot({ source:'html', content, width:1280, pixelRatio:2, timeoutMs:30000 })   ← preload 暴露
  ↓
electron/main.ts 'artifact:export-long-shot' IPC 处理器
  ├─ module-level exportLongShotBusy 锁 → 拒并发（返回 'busy'）
  ├─ new BrowserWindow({ show:false, webPreferences:{ sandbox:true, ..., partition:'persist:artifact-export' }})
  ├─ loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  ├─ 等待 __scriptsReady__ 或 dom-ready 超时
  ├─ webContents.debugger.attach('1.3')
  ├─ Page.captureScreenshot({ captureBeyondViewport:true, format:'png' })
  └─ 返回 base64 → renderer 转 Blob 下载
```

**错误码**（discriminated）：`busy` / `timeout` / `canvas_limit`（>16384px）/ `debugger_busy` / `oom` / `export_failed`。UI 映射 `artifact.exportLongShot.error.{code}` i18n key。

**TSX 为什么不在 LONGSHOT 集合：** 当前导出链路直接把原文送进隐藏 BrowserWindow。TSX 原文是源码而非渲染页面——放进去会导出一张源码的截图。要解决需要加 "Sandpack files → esbuild → 独立 HTML" 预处理链（见未来演进）。

---

## 新增 API 路由

| 路由 | 方法 | 入参（query 或 body） | 返回 | 关键安全 |
|------|------|---------------------|------|---------|
| `/api/files/preview` | GET | `path`, `limit?` | `FilePreview` | assertRealPathInBase + 分档行数/字节上限 + 二进制拒 |
| `/api/files/write` | POST | `path`, `content`, `base_dir?` | `{ ok, bytes_written }` | rejectIfSymlink + mkdir -p + allowMissing |
| `/api/files/mkdir` | POST | `path`, `base_dir?` | `{ ok, created }` | assertRealPathInBase + recursive |
| `/api/files/rename` | POST | `old_path`, `new_path`, `base_dir?` | `{ ok, from, to }` | 两端 rejectIfSymlink + `cross_base_dir` 校验 + 类型一致性 |
| `/api/files/delete` | POST | `path`, `base_dir?`, `is_directory?` | `{ ok, trashed }` | rejectIfSymlink + `trash` 包（系统回收站，拒降级真删）+ 文件夹需 `recursive:true` |

**通用错误合同：** 所有路由走 `FileIOError` 类（`src/lib/files.ts`），`code` 字段 discriminated（`path_outside_base` / `symlink_forbidden` / `binary_forbidden` / `size_limit` / `trash_unavailable` / ...）。HTTP 状态码从 `FileIOError.httpStatus` 读（400/403/413/500）。

**`assertRealPathInBase` 合同：**
```ts
// src/lib/files.ts
async function assertRealPathInBase(
  resolvedPath: string,
  baseDir?: string,
  opts?: { rejectIfSymlink?: boolean; allowMissing?: boolean }
): Promise<string | null>
```
- 先 `fs.realpath` 解析 baseDir 和 target
- 用 `isPathSafe(realBase, realTarget)` 做字符串级前缀比对
- `rejectIfSymlink`: target 自身的 lstat 检查（防目标是 symlink）
- `allowMissing`: 文件不存在时不抛错（write 路由要用）
- workspace 本身是 symlink 的合法场景：realBase 计算时也 realpath，兼容

---

## 新增 IPC 通道

| channel | 方向 | payload | 返回 |
|---------|------|---------|------|
| `artifact:export-long-shot` | renderer → main | `{ source:'html', content, width?, pixelRatio?, maxHeightPx?, timeoutMs? }` | `{ ok:true, base64, width, height } \| { ok:false, code, message }` |

preload 在 `window.artifact.exportLongShot` 下暴露，sandbox 友好的 contextBridge 模式。

---

## 关键设计决策锚点

**（详细"为什么"见 insights 文档；这里只标代码锚点，方便维护时回溯）**

1. **PreviewSource discriminated union** — `src/types/index.ts` + `src/components/layout/AppShell.tsx`。代替原 `previewFile: string | null` 单通道。
2. **DiffSummary 从 MessageItem 抽成组件** — `src/components/chat/DiffSummary.tsx`。`PREVIEWABLE` / `LONGSHOT` 两个扩展名集合决定按钮可见性。
3. **freshPreview 防漂移** — `PreviewPanel.tsx` 的 `freshPreview = loadedMatchesActive ? preview : null`。所有主渲染树消费者从 `preview` 改读 `freshPreview`。
4. **loadedPath 锚点** — 保存 / 导出 / autosave 三个场景共用同一 gate。防 A→B 切换时把 A 的 buffer 写到 B 路径。
5. **Sandpack 入口固定 /App.tsx** — `SandpackPreview.tsx` 的 `MOUNT_PATH = '/App.tsx'` 常量。不用 `inferMountPath` 衍生路径，因为 react-ts template 的 `/index.tsx` 硬引 `./App`。`providerKey = pathKey::mountToken::contentHash` 做 Sandpack 实例 cache-bust。
6. **共享 Shiki LRU** — `code-block.tsx:164-170` 的 highlighterCache(10) + tokensCache(200) 通过 `createSharedCodePlugin()` 工厂暴露给 Streamdown。之前聊天路径走 `@streamdown/code` 的无界 Map + 独立 createHighlighter（实测内存飙升根因）。
7. **delete 走系统回收站** — `trash` npm 包（`src/app/api/files/delete/route.ts`）。回收站不可用时返回 `trash_unavailable` **拒绝降级** 真删。UI 文案 "可在回收站恢复"。

---

## i18n 新键清单

17 个（en/zh 同步）：

| 区域 | key | 用途 |
|------|-----|------|
| `filePreview.*` | `truncatedBanner` / `truncatedReason.{lines,bytes}` / `binaryPlaceholder` / `sandpackLoading` / `sandpackError` / `aliasNotSupported` | 预览截断提示 + Sandpack 错误兜底 |
| `artifact.exportLongShot.*` | `button` / `inProgress` / `error.{busy,timeout,canvas_limit,debugger_busy,oom,export_failed}` | 长图导出按钮 + 错误码映射 |
| `fileTree.newItem.*` | `newFile` / `newFolder` / `placeholder.{file,folder}` / `duplicate` / `invalidName` | VS Code 风格新建入口 |

---

## 测试策略

单元测试共 1116 项（改造前 → 改造后没有回归）。Phase 5 结束时手工跑过三条 UI smoke：

1. **快速切 3 个 TSX** — 验证 Sandpack 不串文件、无首帧旧内容
2. **文件树点 CSV/TSV** — 默认进入表格视图（不是 Source）
3. **AI 生成 CSV/TSV** — 聊天出现 Artifact 卡片、可点开

**未覆盖：** 长图导出的实机回归（IPC 路径 + CDP 兼容）依赖 Electron 环境，dev server 模式 `window.artifact` 为 undefined，按钮点击 alert "unavailable" —— 这是 feature，需要在 Electron 模式下手工跑一遍。

---

## 已知 follow-up

| 项 | 影响 | 处置 |
|----|------|------|
| JSX/TSX 长图导出 | 当前 LONGSHOT 集合不含 `.jsx/.tsx`（会导出源码截图而不是渲染结果） | 等 "Sandpack files → esbuild → 独立 HTML" 预处理链落地后再开 |
| Markdown 长图导出 | 同上，需要 Streamdown → HTML 的 SSR 序列化 | 同上批次 |
| 切文件时未保存的编辑 | 当前直接丢 editContent | 可加"切换时提示保存"对话框 |
| 文件树右键菜单 rename/delete | API 已全，UI 没接 | 需要 ContextMenu 原语，独立迭代 |
| Phase 5.1 ShikiThemeContext | 已被 useThemeFamily 机制覆盖 | 不做 |
| Phase 5.2 remarkCollapsibleSections | rehype-raw 依赖面过大 | 推到独立 follow-up 批次 |
| frontmatter 语法高亮 / 图片粘贴 | P2 功能 | Phase 4 P1 范围外，下一轮迭代 |

---

## 新增依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `@codesandbox/sandpack-react` | ^2.20.0 | 单文件 React 预览 |
| `@codemirror/view` + state + lang-markdown + theme-one-dark | 6.x | MarkdownEditor |
| `papaparse` | ^5.4 | CSV/TSV 解析 |
| `trash` | ^9.x | 跨平台回收站 |
| `pngjs` | ^7.x | 长图拼接 fallback（当前未激活，CDP 直出 PNG） |

**bundle 影响：** CodeMirror + Sandpack + papaparse 通过 `next/dynamic({ ssr:false })` 懒加载，不入首屏。Electron 渲染进程 ESM 加载无问题。

---

## 入口点速查

想动哪块，进哪个文件：

| 要做的事 | 入口 |
|---------|------|
| 加新的预览扩展名 | `PreviewPanel.tsx` 的 `RENDERABLE_EXTENSIONS` + `AppShell.tsx` 的 `RENDERED_EXTENSIONS` + `DiffSummary.tsx` 的 `PREVIEWABLE` |
| 改预览截断上限 | `/api/files/preview/route.ts` 的 `EXTENSION_LINE_CAPS` + `MAX_BYTES` |
| 改长图导出权限 / 超时 | `electron/main.ts` 的 `artifact:export-long-shot` handler |
| 改编辑器行为 | `src/components/editor/MarkdownEditor.tsx`（CodeMirror 6） |
| 改 Sandpack 模板 / 依赖 | `src/components/editor/SandpackPreview.tsx` 的 `providerOptions` |
| 改 DataTable 列行为 | `src/components/editor/DataTableViewer.tsx` |
| 改文件 I/O 安全策略 | `src/lib/files.ts` 的 `assertRealPathInBase` + `FileIOError` |
| 加新文件树动作 | `FileTreePanel.tsx` 的 `newItemMode` 状态机 + actions bar |
