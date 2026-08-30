> **Archive note（2026-06-05，document-system-governance）**：本计划已完成并移出 `active/`，归入 `completed/`——Phase 0-2 + 7c 已落地；Phase 3-5 用户 2026-05-29 决定不做。作为历史执行记录保留；当前任务入口见 [exec-plans README](../README.md)。

# Phase 7b: macOS Native Visual Profile

> 创建时间：2026-05-22
> 最后更新：2026-05-26（Phase 0-2 已落地；卡片几何收口拆出为 7c 并已归档；剩 Phase 3-5）
> 父计划：[`refactor-closeout.md`](./refactor-closeout.md)
> 子计划：[`phase-7c-card-primitive.md`](../completed/phase-7c-card-primitive.md)（浮动卡片 layout primitive，从本计划 Phase 2 的卡片几何问题拆出，✅ 已完成并归档）
> 前置：Phase 7 图标体系主体完成后启动；不阻塞 Phase 8 Codex MCP 调研

## 用户会看到什么变化

- macOS 上的 CodePilot 更像一个长期运行的 Mac 桌面应用：窗口 chrome、顶部栏、侧栏、浮层和输入区更吃系统材质，视觉更轻、更少网页感。
- 页面内容、信息架构、按钮位置、设置项、聊天消息、插件卡片、模型卡片不做 macOS 专属分叉。用户看到的仍然是一套 CodePilot 产品语言。
- Windows / Linux 不在本计划内做视觉改造；本计划只保证新增 token / API 不破坏后续 Windows profile。

## 背景上下文

本计划来自一次关于 Raycast 2.0 技术文章和 macOS 新设计语言的讨论。

用户目标：

> 总体上，细节以及每个页面的内容，我不想有特别大的差别。我就是想在背景材质以及一些独特的样式上，体现出一些平台特色，也就是用户能看得见的地方。至于页面里的细节，我希望还是维持一套同样的设计语言和设计风格。

结论：

- 不学习 Raycast 的完整重写路线。Raycast 的“Swift / C# native shell + WebView + Node + Rust”很重，CodePilot 现在已经是 Electron，不应为了平台感重写宿主。
- 要学习的是 Raycast 的产品原则：共享 Web UI 负责产品速度，平台宿主负责窗口、材质、标题栏和 native feel。
- macOS 方向先做“壳层与浮层材质”，不做页面内容差异。

参考资料：

- Raycast 技术解析本地剪藏：`/Users/op7418/Downloads/深入技术解析：全新 Raycast-A Technical Deep Dive Into the New Raycast.md`
- 当前设计规范：[`docs/design.md`](../../design.md)
- 当前图标体系计划：[`phase-7-icon-system.md`](../completed/phase-7-icon-system.md)（已归档）
- Electron 入口：`electron/main.ts`
- Renderer 平台信息入口：`electron/preload.ts`
- 主题系统入口：`src/app/layout.tsx`、`src/components/layout/ThemeFamilyProvider.tsx`、`src/app/globals.css`
- Phase 0 必须复核 Apple 官方 HIG / macOS / Materials / Liquid Glass 相关页面，避免只靠聊天记忆写设计规则。

### macOS 最新设计语言（2025-06 WWDC 起，截至 2026-05）

Apple 在 WWDC 2025 公布 **Liquid Glass** 设计语言，覆盖 iOS 26 / iPadOS 26 / **macOS Tahoe 26** / watchOS 26 / tvOS 26。HIG 已同步更新，Phase 0 必须复核以下三层一手资料（不要只靠二手文章）：

1. [Apple HIG — Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
   - macOS 提供具语义化的 material（window / menu / popover / sidebar / title bar / HUD 等），不是"统一一种玻璃"。每个 surface 用 HIG 推荐的对应 material，不要混用。
   - Vibrancy 保证 material 之上的内容（文字 / 图标）在不同背景下仍然可读 —— 不是"装饰效果"，是"对比度保险"。
   - 官方明确：Liquid Glass 适合 **controls / navigation** 这类功能层，**不建议放到 content layer**。本计划"内容区保持不透明"的红线直接来自这条 Apple guidance，不是我们自己的保守取舍。
2. [Apple Developer — Liquid Glass overview](https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass)
3. [Apple Developer — Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass)
   - 官方明确：既有 app **不需要推倒重来** —— 默认能继承新设计的大部分外观，开发者主要工作是把 chrome / navigation / 浮层校准到新 material 语义。本计划"只动壳层 + 浮层、不分叉页面内容、不重写宿主"的范围由此官方背书。
4. [Apple Newsroom — Liquid Glass announcement (2025-06-09)](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)

**核心设计原则**（用于 Phase 0/2 决策时反向校验）：

- **Hierarchy through depth**：界面层级用 translucency / refraction / visual weight 表达，而不是用 color contrast 或 size 差异表达。这意味着：
  - "全屏玻璃" 是反例 —— 玻璃只用于 chrome / nav / popover 这类"覆盖在内容之上的层"，主内容区不应该是玻璃。
  - 多层玻璃之间需要明显的厚度 / 透明度差异，否则层级丢失。
- **macOS Tahoe 26 已有但本计划不在首轮做**：完全透明菜单栏、light/dark/clear/colorful tint 的 widget 和 app icon、桌面/Dock 自定义层。这些是系统级，Electron 应用做不到也不需要做。

**Light vs Dark 是两套不同的视觉**：Liquid Glass 在 light appearance 下偏"清玻璃"、dark appearance 下偏"磨砂深玻璃"。视觉差距比 web 主题切换的 light/dark 大很多。Phase 0 surface audit + 后续 POC 截图都必须 light + dark 双拍，不能只拍一种。

## 当前代码事实

已具备：

- `electron/main.ts` 已按平台分窗口 chrome：
  - macOS: `titleBarStyle = 'hiddenInset'` + `vibrancy = 'sidebar'`
  - Windows: `titleBarStyle = 'hidden'` + `titleBarOverlay`
- `electron/preload.ts` 已通过 `window.electronAPI.versions.platform` 暴露平台信息。
- 主题系统已有：
  - `next-themes` light / dark / system
  - `data-theme-family`
  - `themes/*.json`
  - `renderThemeFamilyCSS()` 注入 theme family CSS variables
- `docs/design.md` 已定义 Settings card / dialog / catalogue card / grid 等共享 CodePilot 设计语言。

缺口：

- 没有 root 级 `data-platform="darwin|win32|linux"`。
- 没有平台 profile token；现在 theme family 只表达颜色主题，不表达 macOS / Windows 的材质、hover、radius、font、chrome spacing。
- macOS 虽然开了 `vibrancy: 'sidebar'`，但 renderer 大量 surface 是实色 `bg-background` / `bg-card`，实际会盖住系统材质。
- `docs/design.md` 里 outer card 规范是 8px，但 `globals.css` 里 `--radius` 已被提升到 1rem，说明“产品设计 token”和“平台 token”还混在一起。
- 业务组件大量使用 `cursor-pointer` / `hover:bg-*`，适合 Web，但在 macOS 上会显得网页感更强。不能一刀切删除，必须只在壳层 / 高频导航层先做。

## 非目标

- 不重写 Electron 为 Swift / AppKit / WKWebView 自研宿主。
- 不做 Windows Mica / Acrylic；只保留后续可扩展的 token 形态。
- 不复制两套页面，不新增 macOS-only Settings 页面内容。
- 不改 Provider / Runtime / Codex / Harness / Context Accounting 逻辑。
- 不改 Chat message rendering、Widget rendering、Markdown / Artifact 内容层。
- 不全仓删除 hover / cursor；只治理窗口壳层、导航层和浮层。

## 状态

| Phase | 内容 | 状态 | 用户结果 |
|-------|------|------|----------|
| Phase 0 | macOS HIG + 当前 surface 审计 | ✅ 已完成 | 明确哪些区域能平台化，哪些必须保持共享；见 [`docs/handover/macos-visual-profile.md`](../../handover/macos-visual-profile.md) |
| Phase 1 | Platform profile 基础设施 | ✅ 已完成 | `data-platform` + `data-platform-style` 落在 `<html>`；`--platform-*` token 层声明 + 默认值 = 产品 token 等价（无视觉 diff）；`docs/design.md` 新增 Token 分类章节；6 个 source-pin 单元测试 |
| Phase 2 | macOS chrome + material POC | ✅ 主体完成（`1202fef`，Codex round 3 final review 收口；卡片几何后续由 7c 完成）| 5 个壳层 surface 接 token（ChatListPanel / SettingsSidebar / UnifiedTopBar chat 分支 / MessageInput / Popover）+ 空态 topbar + 右侧 WorkspaceSidebar / TabBar / AssistantPanel / FileTreePanel；macOS profile alpha 拉到 48/55/78/72；Electron BrowserWindow `backgroundColor: '#00000000'` + `visualEffectState: 'followWindow'`；body 在 darwin profile 下 `transparent`；traffic light 安全区 + 垂直对齐 token；`electron:dev` 引入 esbuild watch（避免 main.js stale）|
| Phase 3 | macOS hover / cursor / density 收口 | ❌ 不做（用户 2026-05-29 决定） | — |
| Phase 4 | macOS 浮层视觉 POC | ❌ 不做（用户 2026-05-29 决定） | — |
| Phase 5 | CDP / Electron smoke + 文档归档 | ❌ 不做（用户 2026-05-29 决定） | — |

## 设计边界

### 三层模型

1. **Shared Product UI**
   - 页面结构、数据流、组件职责、文案、按钮顺序。
   - 这层跨平台保持一致。

2. **Platform Visual Profile**
   - font、radius、hover policy、surface alpha、material token、titlebar safe area。
   - 本计划只实现 macOS profile。

3. **Native Window Chrome**
   - Electron `BrowserWindow` options、vibrancy、traffic light safe area、drag region。
   - 只做 macOS 校准，不做宿主重写。

### 允许 macOS 化的区域

| 区域 | 例子 | 允许改什么 |
|------|------|------------|
| Window chrome | 窗口背景、标题栏、traffic light 附近 | vibrancy、safe area、drag region、背景透明度 |
| Top bar | `UnifiedTopBar` | 材质、边界、hover 强度、标题栏空间 |
| Left sidebar | `ChatListPanel` / Settings sidebar | 背景材质、分隔线、selected/hover |
| Right sidebar | `WorkspaceSidebar` / `PanelZone` | 背景材质、分隔线、surface alpha |
| Composer shell | 输入框外层、底部工具区 | 浮动层阴影、材质、边界 |
| Popover / Flyout | Model picker、RunCockpit、command menu、tooltip | 背景 alpha、blur fallback、边框、阴影 |

### 不允许 macOS 化的区域

| 区域 | 原因 |
|------|------|
| Chat message body | 内容阅读优先，不能用材质影响可读性 |
| CodeBlock / Terminal | 对比度和等宽渲染优先 |
| Settings 表单内容 | 产品一致性优先 |
| Provider / Models / Runtime 卡片结构 | 三层心智模型必须跨平台一致 |
| Widget / Artifact / Markdown 内容 | 用户产物必须忠实呈现 |

## 详细阶段

### Phase 0: macOS HIG + surface audit

用户能看到什么：

- 暂无 UI 变化；会得到一份“哪些 surface 可以 macOS 化”的审计清单。

任务：

- 复核 Apple 官方 HIG / macOS / Materials / Liquid Glass 资料，记录可执行原则，不把“玻璃感”泛化成所有区域都透明。
- 审计当前高频 surface：
  - `electron/main.ts`
  - `src/components/layout/UnifiedTopBar.tsx`
  - `src/components/layout/ChatListPanel.tsx`
  - `src/components/layout/SettingsSidebar.tsx`
  - `src/components/layout/WorkspaceSidebar/*`
  - `src/components/layout/PanelZone.tsx`
  - `src/components/chat/MessageInput*`
  - `src/components/chat/RunCockpit*`
  - `src/components/ui/popover.tsx`
  - `src/components/ui/dialog.tsx`
  - `src/components/ui/tooltip.tsx`
- 输出 surface matrix：
  - surface name
  - current background / border / hover **(light + dark 两列)**
  - whether content layer or chrome layer
  - macOS candidate change（含 HIG material 语义与当前实现方式，见下表）
  - risk
- 拍 **改造前 baseline 截图矩阵** 钉死当前外观，作为后续 POC 的对照基准：
  - 至少覆盖 `/chat`、`/settings/runtime`、`/settings/assistant`、`/plugins` 四个页面
  - 每页 light + dark 两张，共 8+ 张
  - 截图存放 `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/`，文件名 `{page}-{appearance}.png` —— 与现有 `completed/_smoke-evidence-phase-7/` 体系对齐，归档时整目录 move 到 `completed/_smoke-evidence-phase-7b/` 即可
  - 之后每个 Phase 的截图都跟 baseline 同名对照，diff 一眼可见

**HIG material 语义映射 + 实现方式**：

⚠️ **重要事实**：Electron `BrowserWindow.vibrancy` / `setVibrancy()` 是 **窗口级** 配置 —— 一个 BrowserWindow 只能选一个 vibrancy 值，整窗共享。CodePilot 现在的 Popover / RunCockpit / Tooltip / Model picker 都是 **Radix / DOM 内浮层**，不是独立 native window，因此它们 **不能** 直接使用 Electron 的 `'popover'` / `'menu'` / `'hud'` / `'tooltip'` vibrancy。

下表把每个 surface 的 HIG material 语义和当前可用的实现方式分开，不要混为一谈：

| Surface | HIG material 语义 | 当前可用实现 |
|---------|------------------|--------------|
| 主窗口背景 / Left sidebar 区域 | Sidebar | **Electron 窗口级 vibrancy**（整窗只能选一个值，Phase 2 POC 在 `'sidebar'` / `'under-window'` / `'content'` 中决定） |
| Top bar (`UnifiedTopBar`) | Header / Title bar | **CSS platform token 模拟**（`--platform-surface-bar`、透明度、border） + Electron `titleBarStyle: 'hiddenInset'` 保留 safe area |
| Right sidebar (`WorkspaceSidebar` / `PanelZone`) | Sidebar | **CSS platform token 模拟**（沿用窗口级 vibrancy 透出的底材质 + 自己叠半透 surface） |
| Popover / Dropdown / Model picker | Popover | **CSS platform token 模拟**（`--platform-surface-popover` + `backdrop-filter` fallback + 边框 + 阴影）。仅在改造为独立 BrowserWindow 时才能用 Electron `'popover'` |
| Slash command / Command menu | Menu | **CSS platform token 模拟**（`--platform-surface-popover` 复用，可加独立 `--platform-surface-menu`）。同上 |
| RunCockpit 临时浮层 | HUD | **CSS platform token 模拟**（`--platform-surface-hud`：更深背景 + 更强阴影）。同上 |
| Tooltip | Tooltip | **CSS platform token 模拟**（`--platform-surface-tooltip`）。同上 |
| 全窗口 base 背景 | Under-window | **Electron 窗口级 vibrancy** —— 可选 `'under-window'`，但与 sidebar 候选互斥（只能选一个） |

**Phase 2 关键决策**：整窗 vibrancy 只能选一个值。先验证当前 `'sidebar'` 是否合适；如果觉得整窗 sidebar 太"侧栏化"了，就换 `'under-window'` 或 `'content'`。这是 Phase 2 POC 截图驱动的决策，文档里只列候选，不预先指定结果。

**未来 native overlay POC**（不在本计划范围）：如果要让 popover / menu / HUD / tooltip 真正使用对应的 Electron vibrancy，需要把它们改造为独立 BrowserWindow / native overlay（参考 Raycast 的 Native Popover Window 思路）。本计划首轮只做 DOM 浮层的 CSS token 模拟，对齐 HIG material **视觉语义**，不主张声称"我们给浮层用了 Electron `'popover'` vibrancy"。

**禁用的 deprecated `vibrancy` 值**（macOS 即将移除）：`appearance-based` / `light` / `dark` / `medium-light` / `ultra-dark` / `selection`。

`visualEffectState` 必须跟整窗 `vibrancy` 一起设，默认 `followWindow`（窗口非激活时 material 自动变灰），不要手动改成 `active`。

验收：

- ✅ 审计表进入 [`docs/handover/macos-visual-profile.md`](../../handover/macos-visual-profile.md)。
- ✅ 明确列出 12 个 surface。
- ✅ 每个 surface 标记 `chrome_layer` / `navigation_layer` / `content_layer` / `floating_control_layer` / `modal_layer`。
- ✅ baseline 截图矩阵已提交（8 张，覆盖 light + dark）。
- ⚠️ baseline 截图为 3001 renderer 截图，不包含 Electron native vibrancy；Phase 2 必须补 Electron-window material smoke。

### Phase 1: Platform profile infrastructure

用户能看到什么：

- 视觉基本不变；这是基础设施阶段。

任务：

- 增加 root 平台标记：
  - `data-platform="darwin|win32|linux|web"`
  - `data-platform-style="auto|macos|neutral"`，首版只实现 `auto` 和 `macos`。
- Renderer 从 `window.electronAPI.versions.platform` 读取平台；非 Electron fallback 到 `web`。
- 新增 CSS token 层，不替代 theme family：
  - `--platform-font-ui`
  - `--platform-radius-window`
  - `--platform-radius-control`
  - `--platform-hover-alpha`
  - `--platform-surface-sidebar`
  - `--platform-surface-bar`
  - `--platform-surface-popover`
  - `--platform-border-subtle`
- 默认值必须与当前视觉接近，避免基础设施阶段产生大 diff。
- **在 `docs/design.md` 增加 token 分类说明**，明确划清"产品 token"和"平台 token"两个层级：
  - 产品 token（跨平台一致）：`--color-*`、`--radius`（产品组件圆角）、theme family 色板、状态色（`--status-*`）
  - 平台 token（仅 macOS profile 当前注入）：`--platform-*` 前缀，列表见上 — 这些只表达"平台壳层和浮层的视觉特征"
  - 写明决策规则：组件用产品 token；窗口 chrome / 顶栏 / 侧栏 / 浮层用平台 token
  - 防止后续新人把 `--platform-radius-control` 当成"组件圆角"乱用

验收：

- `html` 上能看到 `data-platform`。
- `npm run test` 通过。
- 不改变 Settings / Chat 截图主体布局（与 Phase 0 baseline 同名截图对比，diff 仅在 token 默认值微调范围内）。
- 有单元测试或 source pin 防止平台标记丢失。
- `docs/design.md` 已新增"产品 token vs 平台 token"分类章节，并被 README 索引引用。

### Phase 2: macOS chrome + material POC

用户能看到什么：

- macOS 下顶部栏、侧栏、右侧栏有更轻的系统材质感。
- 内容区仍然清晰，不变成大面积透明。

任务：

- Electron:
  - 复核 `vibrancy: 'sidebar'` 是否是合适值；必要时在 `'sidebar'` / `'under-window'` / `'content'` 这三个整窗底材质候选中选一个 POC 分支评估。**不评估 `'header'` / `'titlebar'`** —— 它们是"标题栏专用"语义，不适合作整窗默认底材质，否则容易又绕回"topbar 单独 vibrancy"的误会。
  - 校准 traffic light safe area，避免 `UnifiedTopBar` 与红黄绿按钮视觉冲突。
  - 保持 `titleBarStyle: 'hiddenInset'`，不切 frameless 重写。
- Renderer:
  - Top bar / sidebars 使用 platform surface token。
  - 内容主区域保持 `bg-background` 或等价实色，避免文本可读性下降。
  - 控制 `backdrop-filter` 使用范围；不能在长列表内容层大量使用。

验收：

- macOS Electron dev smoke：
  - `/chat`
  - `/settings/runtime`
  - `/plugins`
- **light + dark 两套截图**，与 Phase 0 baseline 同名对照（`docs/exec-plans/active/_smoke-evidence/phase-7b/phase2/{page}-{appearance}.png`）。
- 截图确认 traffic light safe area 不遮挡。
- Console 无 *新增* error / warn（视觉改造层面）。注：`/api/providers/codex_account/models?all=1` 在某些会话条件下会返回 404 — 这是 Codex Account 虚拟 provider 的既有问题，跟 Phase 7b 视觉无关，需要单独 slice 处理，不阻塞本 Phase 验收。
- 不影响 web dev server 预览：非 Electron 环境 fallback 正常。
- 验证 Liquid Glass "hierarchy through depth" 原则：chrome / nav / popover 之间能看出明显层次，不是"一坨均匀玻璃"。

### Phase 3: macOS hover / cursor / density

用户能看到什么：

- 左侧栏、顶部栏、右侧栏不再像网页列表一样到处强 hover。
- 点击目标仍然清楚，键盘 focus 仍然可见。

任务：

- 只治理 chrome / navigation layer：
  - `UnifiedTopBar`
  - `ChatListPanel`
  - `SettingsSidebar`
  - `WorkspaceSidebar/TabBar`
  - `ProjectGroupHeader`
  - `SessionListItem`
- 对 macOS profile 降低 hover fill 强度，保留 selected 状态清晰度。
- 不删除可访问性 focus ring。
- 不对 catalogue cards / Settings 内容卡片做平台 hover 分叉。
- `cursor-pointer` 不全仓删除，只在 macOS chrome layer 评估是否由 token 控制。

验收：

- CDP / Browser smoke 点击：
  - 切换会话
  - 折叠左侧栏
  - 切换右侧 workspace tab
  - 打开 Settings 页面
- keyboard focus 可见。
- hover 弱化不影响可点击性。
- light + dark 截图各一组（`docs/exec-plans/active/_smoke-evidence/phase-7b/phase3/`），与 baseline 对照确认仅 hover/cursor 层变化。

### Phase 4: macOS popover / flyout POC

用户能看到什么：

- RunCockpit、模型选择器、命令菜单这类浮层更接近 macOS 控制层，但内容结构不变。

任务：

- 先选 2-3 个高频浮层：
  - `RunCockpitPopoverContent`
  - Model selector dropdown
  - Slash command / command menu
- 使用 platform popover surface token。
- Dialog 不在首轮重做；dialog 内容层保持清晰稳定。
- 暂不实现 Raycast 那种 native popover window；只做 DOM 浮层视觉 profile。

验收：

- 打开 model picker，切换 provider/model。
- 打开 RunCockpit，确认 context breakdown / aux rows 仍正常。
- 打开 slash command menu。
- light + dark 截图各一组（`docs/exec-plans/active/_smoke-evidence/phase-7b/phase4/`），确认浮层与底层 chrome 之间能看出层次（不是同一坨玻璃）。
- 浮层 CSS token 命名和视觉语义对齐 HIG material 映射表（popover / menu / hud / tooltip 各自一组 token），**不得在文档/代码注释/PR 里声称这些浮层使用了 Electron per-surface vibrancy** —— Electron vibrancy 是窗口级，DOM 浮层只能 CSS 模拟。

### Phase 5: QA + docs closeout

用户能看到什么：

- macOS 样式有固定规范，后续改 UI 不再凭感觉。

任务：

- 更新 `docs/design.md`：
  - 增加 Platform Native Visual Profile 章节。
  - 明确 macOS profile 不改变页面内容结构。
- 新增或更新 `docs/handover/macos-visual-profile.md`：
  - platform token 表
  - surface matrix
  - screenshot matrix
  - known exceptions
- 更新 `docs/exec-plans/README.md` 索引。
- 若完成，归档本计划到 `completed/`。

验收：

- `npm run test` 通过。
- macOS Electron smoke 至少覆盖 `/chat`、`/settings/runtime`、`/plugins`。
- Smoke Ledger 填真实记录。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| 2026-05-22 | n/a | n/a | n/a | n/a | Phase 0 renderer baseline: `/chat`, `/settings/runtime`, `/settings/assistant`, `/plugins` light + dark | ✅ | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/{chat,settings-runtime,settings-assistant,plugins}-{light,dark}.png`; console: no errors introduced by this round (preexisting 404 on `/api/providers/codex_account/models?all=1` unchanged) |
| 2026-05-26 | n/a | n/a | n/a | n/a | Phase 2 macOS chrome / material 收口（卡片几何走 7c）：Electron diag `dataPlatform=darwin` / `dataShell=electron` / `opaqueElementCount=0` | ✅ | 见 7c 验收：[`handover/macos-visual-profile.md`](../../handover/macos-visual-profile.md) Phase 7c 章节 + `_smoke-evidence/phase-7c-{light,dark}.png`。**注**：该组截图为 browser 模拟 darwin profile（手动注入 `.dark` class），非真实 Electron 窗口 vibrancy 截图；Phase 5 收口仍需补一次真实 Electron-window material smoke |

## 决策日志

- 2026-05-29: **Phase 3/4/5 不做（用户决定）**。macOS 平台视觉收口在 Phase 0-2（壳层材质 + 平台 token + 卡片 primitive 经 7c 完成）。hover/cursor/density 收弱、浮层视觉 POC、CDP/Electron 回归截图矩阵、design.md "Platform Native Visual Profile" 章节、计划归档均不做；Phase 2 遗留的"真实 Electron 窗口材质截图"缺口也一并不补。若未来重启 macOS 视觉，另起新子计划。
- 2026-05-22: 用户确认优先做 macOS 方向。范围收紧为”平台材质和壳层”，不做 Mac / Windows 两套页面，不改内容层。
- 2026-05-22: Raycast 借鉴点定为”共享 Web UI + 平台宿主兜 native feel”，不采用 Raycast 的自研 Swift/C# shell 路线。
- 2026-05-22: macOS profile 先落在 window chrome / topbar / sidebars / composer shell / popover；Chat 内容、Settings 表单、Widget / Artifact 内容保持共享 CodePilot 语言。
- 2026-05-22: 复核 Apple Liquid Glass（WWDC 2025 / macOS Tahoe 26）+ HIG Materials 后补 4 点：
  - 加 vibrancy material 语义映射表（sidebar / header / popover / menu / hud / tooltip / under-window），禁用 deprecated `appearance-based|light|dark|medium-light|ultra-dark|selection`
  - Phase 0 surface audit 改为 light + dark 双列，并要求拍 baseline 截图矩阵作为后续 Phase 对照基准
  - Phase 1 必须在 `docs/design.md` 增加”产品 token vs 平台 token”分类章节，防止后续混用
  - 引入 “hierarchy through depth” 原则作为 Phase 2/4 视觉验收红线 —— chrome / nav / popover 之间要看出层次，反例是”全屏均匀玻璃”
- 2026-05-22 (Codex P1 修正): Electron `vibrancy` 是 **窗口级**（一个 BrowserWindow 只能选一个值），DOM 浮层（Radix Popover / RunCockpit / Tooltip）不能直接用 Electron `'popover'` / `'hud'` / `'tooltip'`。映射表标题改为 “HIG material 语义映射 + 实现方式”，列出两层实现：(a) 整窗 vibrancy 只能选一个（sidebar / under-window / content，Phase 2 POC 决定），(b) 其它 surface 用 CSS platform token 模拟 HIG material 视觉语义。Phase 4 验收里删除”浮层必须用 popover/menu/hud/tooltip vibrancy”措辞，改成”CSS token 命名对齐 HIG material，不得声称用了 Electron per-surface vibrancy”。Future native overlay POC（把浮层做成独立 BrowserWindow）作为非首轮选项备注。
- 2026-05-22 (Codex P2 修正): screenshot 路径从 `screenshots/phase-7b-*/` 改为 `_smoke-evidence/phase-7b/{baseline,phase2,phase3,phase4}/`，对齐现有 `completed/_smoke-evidence-phase-7/` 体系，归档时整目录 move 即可。
- 2026-05-22 (Codex 二轮): Phase 2 整窗 vibrancy 候选统一为 `'sidebar' / 'under-window' / 'content'`，删除原 `'header'` —— 因为 `'header' / 'titlebar'` 是"标题栏专用"语义，放到整窗会再次诱导成"topbar 单独 vibrancy"的错误理解。同时引入 Apple [Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass) 文档作为"既有 app 不推倒重来 + 主要校准 chrome/navigation/浮层"的官方背书。
- 2026-05-23 (Phase 2 第一轮收尾 → Codex round 2 review): Phase 2 不能视为"已完成"。Codex 提出 5 点 — (a) `electron:dev` 不会自动 rebuild `dist-electron/main.js`，导致 14 天 stale 复发；(b) UnifiedTopBar 空态分支没接 surface token，空态首屏看不到 chrome 材质；(c) 视觉对比太保守（sidebar 65 / bar 70 / popover 92 跟原 80 / 100 / 100 差距小）；(d) 覆盖面只到左侧栏 + Settings sidebar + chat topbar + composer + popover，右侧 WorkspaceSidebar / 文件树 / 内容 panel 仍是不透明；(e) 不能用 web/localhost 验证 vibrancy，必须 Electron 窗口截图。本轮全部接受并修复：流程 (a) 用 `scripts/build-electron-dev.mjs` + esbuild watch；覆盖 (d) 加 5 个 surface (空态 topbar / WorkspaceSidebar / TabBar / AssistantPanel / FileTreePanel legacy)；对比 (c) alpha 拉到 48/55/78/72；(b) 含在覆盖里。截图 (e) 留待 Phase 2 收尾时单独跑（依赖 Electron 窗口实际渲染验证）。
- 2026-05-23 (Codex round 3 final review): 收口前的 3 个 finding。(P1.1) `right-rail-mutex.test.ts:143` 还期望 `railVisible = fileTreeOpen || ws?.state.open`，但 round 7+ wrapper card 把这个 flag 替换为常驻 top/bottom border。删除该 assertion 并在 test 头部记录 round 7+ 语义变化。(P1.2) anti-FOUC inline script 用 UA sniff 把普通 macOS 浏览器 / Playwright 也标成 `data-platform="darwin"`，触发 Electron-only 的 body transparency + traffic-light safe area。拆分语义：`data-platform="darwin\|win32\|linux\|web"` (OS) 跟 `data-shell="electron\|web"` (host shell) 独立；macOS 材质 CSS gate 改成 `[data-platform="darwin"][data-shell="electron"][data-platform-style="auto"]`。(P2) `/api/providers/codex_account/models?all=1` 404 是 Codex Account 虚拟 provider 既有问题，跟视觉无关 — 改 Smoke Ledger 口径为"this round 无新增 console error"而不是"console clean"。
- 2026-05-22 (Phase 0): 完成 macOS surface audit，并新增 [`docs/handover/macos-visual-profile.md`](../../handover/macos-visual-profile.md)。审计结论：Electron chrome 已有 `hiddenInset + vibrancy: sidebar`，但 renderer 多数 surface 仍用 opaque `bg-background/bg-card/bg-popover` 盖住材质；左侧/Settings sidebar 是当前最接近目标的 surface；内容层和 Settings card 仍应保持不透明。基线截图覆盖 4 页 x light/dark，console clean。截图是 3001 renderer baseline，不替代 Phase 2 Electron native material smoke。

## Open Questions

- macOS `vibrancy` 最终用 `sidebar` 还是改成 `under-window` / `content` 需要 Phase 2 POC 截图决定。
- Settings 是否未来升级成独立 BrowserWindow 不在本计划首轮内，只在 Phase 0 审计里评估。
- 是否提供用户可选的 `platform-style: neutral` 设置，等 macOS profile 稳定后再决定。
