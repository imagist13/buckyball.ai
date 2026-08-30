# macOS Native Visual Profile

> 产品思考见 [docs/insights/macos-visual-profile.md](../insights/macos-visual-profile.md)

Phase 7b Phase 0 audit for bringing a macOS-flavored shell to CodePilot without forking the product UI.

## Scope

The product structure stays shared across platforms: chat, Settings, plugins, runtime/model/provider cards, message rendering, Widget/Artifact rendering, and button order do not get macOS-only branches.

The macOS profile is allowed to affect only the shell and control layers:

- Window chrome and titlebar safe area
- Top bar
- Left and right sidebars
- Composer shell
- Popover / menu / HUD / tooltip surfaces
- Hover and cursor treatment in chrome/navigation layers

Content layers remain opaque and stable.

Dark appearance has one additional shell invariant: application dark mode
must remain readable even when macOS itself is using a light appearance.
The renderer must not solve that mismatch with an opaque window tint:
`ThemeProvider` sends the app mode through the preload bridge and the main
process assigns it to `nativeTheme.themeSource`. The outer renderer surface
stays transparent; navigation cards add only a low-alpha
`--platform-surface-sidebar` tint above the correctly themed native material.

Theme synchronization contract:

```text
next-themes system/light/dark
  → ThemeProvider.NativeThemeSync
  → electronAPI.theme.setSource
  → ipcMain validation
  → nativeTheme.themeSource
```

Only `system`, `light`, and `dark` are accepted at the IPC boundary.

## Reference Notes

- Raycast v2's useful lesson is not the full Swift/C# shell rewrite. The useful lesson is the boundary: shared web UI for product speed, native/platform shell for platform feel.
- Apple Liquid Glass is a functional layer for controls, navigation, sidebars, tab bars, and toolbars. It should sit above content and bring focus to content; it should not turn the content layer into glass.
- Electron's `BrowserWindow.vibrancy` is window-level. DOM surfaces such as Radix popovers, RunCockpit, tooltips, and dropdowns cannot use per-surface Electron vibrancy unless we later move them into separate native overlay windows.

Sources:

- [Apple HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Apple Liquid Glass overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Apple Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass)
- [Apple Newsroom Liquid Glass announcement](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- [Electron BrowserWindow vibrancy](https://www.electronjs.org/docs/latest/api/browser-window)
- Local Raycast clipping: `/Users/op7418/Downloads/深入技术解析：全新 Raycast-A Technical Deep Dive Into the New Raycast.md`

## Current Baseline

| Layer | Current implementation | Phase 7b implication |
|-------|------------------------|----------------------|
| Electron chrome | `electron/main.ts` sets macOS `titleBarStyle: 'hiddenInset'`, `vibrancy: 'under-window'`, transparent backing, and synchronizes `nativeTheme.themeSource` from the app mode | Native material owns light/dark appearance; renderer chrome must not cover it with an opaque fallback tint. |
| Platform detection | `electron/preload.ts` exposes `versions.platform`; `useClientPlatform()` derives `isMac/isWindows/isLinux` | Enough for Phase 1 to stamp `data-platform` / platform style attributes. |
| Theme family | `ThemeFamilyProvider` writes `data-theme-family`; `globals.css` owns design tokens | Product theme and platform profile are currently mixed. Phase 1 needs separate `--platform-*` tokens. |
| Radius | `docs/design.md` says card radius is 8px; `globals.css` sets `--radius: 1rem` | Confirms the need to separate product card tokens from platform shell tokens. |
| Existing material-like surface | `ChatListPanel` and `SettingsSidebar` use `bg-sidebar/80 backdrop-blur-xl` | These are the safest first visual references for macOS sidebar treatment. |
| Existing opaque blockers | `UnifiedTopBar`, `WorkspaceSidebar`, `Popover`, `Dialog`, and content cards use opaque `bg-background` / `bg-popover` / `bg-card` | These currently hide most of Electron's vibrancy. Phase 2/4 should only soften chrome/floating surfaces, not content. |

## Surface Matrix

| Surface | Files | Layer | Current light | Current dark | Current border / hover | macOS candidate | Risk |
|---------|-------|-------|---------------|--------------|-------------------------|------------------|------|
| Main Electron window | `electron/main.ts`, `electron/preload.ts`, `ThemeProvider.tsx`, `src/app/globals.css` | chrome_layer | `BrowserWindow` uses `hiddenInset` + `vibrancy: 'under-window'`; app mode is sent to `nativeTheme.themeSource`; renderer window surface is transparent | Same contract; native material itself switches dark, renderer window surface remains transparent | Native material is window-level; sidebar adds only a 40% theme-derived tint | Keep native theme and app mode synchronized; use the `ELECTRON_VIBRANCY` matrix for material comparisons; never reintroduce the rejected 82%/88% renderer masks | Whole-window material choice affects every transparent gap. Do not bind content cards to the platform tint. |
| Root page / content background | `src/app/globals.css` | content_layer | Web / non-macOS Electron keeps the opaque `bg-background`; macOS Electron makes only the outer `body` transparent | Same contract in dark mode; native material supplies the outer appearance | Global text and border tokens | Keep reading surfaces and content cards opaque while leaving the macOS Electron outer shell transparent. | Making the content cards translucent harms readability; making the outer shell opaque hides native vibrancy. |
| Unified top bar | `src/components/layout/UnifiedTopBar.tsx` | chrome_layer | `h-12 bg-background px-4`; non-chat route `h-8` drag strip | Same token in dark | Icon buttons use `hover:text-foreground`; no bar material token | CSS `--platform-surface-bar`, transparent-ish background, subtle bottom edge, traffic-light-safe spacing | Must preserve drag region and nested button `no-drag` areas. |
| Left chat sidebar | `src/components/layout/ChatListPanel.tsx` | navigation_layer | `bg-sidebar/80 backdrop-blur-xl`; selected rows use `bg-sidebar-accent` / `bg-primary/[0.12]` | Same structure with dark sidebar tokens | Many `hover:bg-sidebar-accent` / `cursor-pointer` rows | First-class macOS sidebar surface. Keep blur, introduce `--platform-surface-sidebar`, weaken hover fill under macOS profile | Heavy session-list hover can still read webby. Must preserve selected/streaming/pending states. |
| Settings sidebar | `src/components/layout/SettingsSidebar.tsx` | navigation_layer | `bg-sidebar/80 backdrop-blur-xl`; active link `bg-sidebar-accent` | Same | Back/nav buttons use rounded-xl and hover fills | Reuse left sidebar treatment; align active/hover with ChatListPanel | Settings nav is a key long-session surface; do not change route structure. |
| Right workspace sidebar | `src/components/layout/WorkspaceSidebar/index.tsx`, `TabBar.tsx`, `PanelZone.tsx` | navigation_layer | `bg-background`, `border-l border-border/40`; tab strip `bg-background` | Same | Tabs use `hover:bg-muted/50`, active `bg-muted`; panel zone border only | CSS simulated sidebar material over whole-window vibrancy; subtle border and tab fills | Contains file tree / terminal / widgets; avoid lowering content contrast inside panels. |
| Composer shell | `src/components/chat/MessageInput.tsx` | chrome_layer | wrapper `bg-background/80 backdrop-blur-lg`; input group uses diffuse shadow | Same with dark shadow token | Input shell already has shadow; tool controls inherit web-style hover | Promote to platform composer token; keep text input itself clear; preserve RunCockpit and model controls | Overdoing blur near text input harms typing focus. |
| RunCockpit | `src/components/chat/RunCockpit.tsx` | floating_control_layer | Trigger button `text-muted-foreground`; content uses existing Popover stack | Same | Mini context bar and aux rows are dense; no native HUD token | Use CSS `--platform-surface-hud` for content only; keep dot matrix/readout layout unchanged | Must not change context accounting semantics or footer math. |
| Generic popover / dropdown | `src/components/ui/popover.tsx`, dropdown/menu consumers | floating_control_layer | `rounded-3xl bg-popover p-4 shadow-lg ring-1` | Dark `bg-popover` opaque card | Animate/zoom; no platform material token | CSS `--platform-surface-popover` + `backdrop-filter` fallback + stronger separation from content | DOM popovers clip inside the webview; do not claim native popover behavior. |
| Tooltip | `src/components/ui/tooltip.tsx` | floating_control_layer | `bg-foreground text-background`, rounded-md | Inverts with theme | Arrow uses same solid foreground | CSS `--platform-surface-tooltip`, but keep high contrast and small footprint | Tooltip readability beats material aesthetics. |
| Dialog / modal | `src/components/ui/dialog.tsx` | content_layer / modal_layer | Overlay `bg-black/50`; content `bg-background border shadow-lg rounded-lg` | Same | Close button hover opacity/background | Leave mostly unchanged in Phase 7b. Maybe only adjust overlay/material later after popover POC. | Dialogs hold forms and destructive actions; translucent content is risky. |
| Settings cards / catalog cards | `docs/design.md`, Settings components | content_layer | `rounded-lg bg-card border border-border/50 p-5` | Dark `bg-card` | Catalogue cards use `hover:bg-muted/40` | Keep shared CodePilot product language. No macOS-only card geometry in this plan. | Diverging Settings content would violate user's product-language boundary. |
| Chat messages / code / artifacts | message, markdown, widget renderers | content_layer | Content-specific backgrounds | Same | Tool/message states are semantic | Explicit no-op for Phase 7b | Glass here would damage readability and artifact fidelity. |

## Baseline Screenshot Matrix

Captured from the worktree dev server at `http://127.0.0.1:3001` with a 1440 x 900 browser viewport. These screenshots baseline renderer surfaces and light/dark composition. They do **not** show Electron native vibrancy; Phase 2 must add Electron-window screenshots for the material POC.

| Page | Light | Dark |
|------|-------|------|
| Chat | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/chat-light.png` | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/chat-dark.png` |
| Settings / Runtime | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/settings-runtime-light.png` | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/settings-runtime-dark.png` |
| Settings / Assistant | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/settings-assistant-light.png` | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/settings-assistant-dark.png` |
| Plugins | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/plugins-light.png` | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/plugins-dark.png` |

Console result: light and dark capture runs both produced no `console.error` or `console.warn` messages.

## Phase 1/2 Recommendations

1. Add `data-platform` and `data-platform-style` first, with neutral defaults that produce minimal screenshot diff.
2. Add a documented `--platform-*` token layer before changing surfaces.
3. Start Phase 2 with the shell that already has partial material treatment: left sidebar + Settings sidebar + top bar.
4. Keep content cards and dialogs opaque until the chrome profile proves stable.
5. Compare whole-window vibrancy candidates in Electron, not browser: `sidebar`, `under-window`, `content`.
6. Treat DOM popovers as CSS material simulation only. Native overlay windows are a future separate POC.

## Known Baseline Observations

- The current web renderer already has a "Mac-ish" rounded baseline (`--radius: 1rem`) but the design doc still treats 8px as the card norm. Phase 1 should make that distinction explicit instead of silently changing more radii.
- The left/settings sidebars are more platform-ready than the top/right shell.
- RunCockpit and popovers are visually modern but not platform-aware; they are good Phase 4 candidates after token infrastructure exists.
- Settings / Runtime currently shows capability/status-heavy content; this is useful as a baseline because it catches text contrast regressions quickly.

## Phase 7c — Floating Card Layout Primitive (2026-05-24)

> 执行计划见 [docs/exec-plans/completed/phase-7c-card-primitive.md](../exec-plans/completed/phase-7c-card-primitive.md)（已归档）

### 抽象边界

四张浮动卡片现在统一走三个共享 primitive，结构由 `src/components/layout/card-primitives.tsx` 定义：

| primitive | 职责 | 不允许 |
|---|---|---|
| `CardFrame` | shadow + radius + isolation + layout slot；`kind="main"` 单独吃 `flex-1 min-w-0` 其他 `shrink-0 + width` | overflow:hidden / clip-path（必须 visible 让 shadow 完整 paint） |
| `CardSurface` | bg + clip-path + backdrop-filter + content slot；`kind` prop 自己映射 data attribute 名 | 外层 box-shadow（属于 frame） |
| `ResizeGutter` | 8px 宽 row-level 兄弟，自身 `justify-center` 让 2px line 永远在 gap 几何中心 | 出现在 CardFrame 内部 |

约束被 `src/__tests__/unit/card-primitives.test.ts` 的 10 个 source pin 锁住。

### 四张卡片接入点

| card | frame 渲染位置 | width state 来源 |
|---|---|---|
| sidebar | `AppShell.tsx`（content-row 第一个 child，**row-level CardFrame**；2026-05-26 起已删除旧 `<div className="flex h-full shrink-0">` wrapper，见下方"已知问题"中的 wrapper removal 说明） | AppShell 本地 `useState(240)` + localStorage `codepilot_chatlist_width` |
| main | `ChatContentRow`（Fragment 直接 child） | `CardFrame kind="main"` 自动 flex-1，无 width prop |
| workspace | `ChatContentRow`（在 `ws.state.open` 守护下） | `useWorkspaceSidebar` context |
| fileTree | `PanelZone`（在 `fileTreeOpen` 守护下） | PanelZone 本地 `useState(280)` |

panel 业务组件（`ChatListPanel` / `SettingsSidebar` / `WorkspaceSidebar` / `FileTreePanel`）现在只暴露内层内容，不再 wrap 自己的 aside / data-attribute / bg / clip。

### Phase G 验收数据（2026-05-24 Browser Use, 1440×900 viewport, /chat/[id] route, 四个面板全开）

DOM 结构（`[data-platform-card-frame]` 数量 + 顺序）：

```
sidebar     left=16    right=256    width=240
main        left=264   right=648    width=384
workspace   left=656   right=1136   width=480
fileTree    left=1144  right=1424   width=280
```

Surface attributes（各一个，kind→attribute 映射来自 `CardSurface`）：

```
[data-platform-sidebar="chat-list"]
[data-platform-main-content]
[data-workspace-sidebar]
[data-platform-file-tree]
```

Gutter 几何（3 个 `[data-resize-gutter]`）：

| gutter | centerX | leftCard | rightCard | gapMidline | offsetFromMidline |
|---|---|---|---|---|---|
| 1 | 260 | sidebar | main | 260 | **0px** |
| 2 | 652 | main | workspace | 652 | **0px** |
| 3 | 1140 | workspace | fileTree | 1140 | **0px** |

`ResizeGutter` 的 8px 宽度 + 内部 `justify-center` 的 2px line 在三个 gap 中心都完全对齐，没有任何偏移。

Shell padding：`8px 16px 16px`（top 8, sides 16, bottom 16） — topbar items center y = 8 + h-10/2 = 28，与窗口 bottom 的 16px inset 形成 12px 视觉差（原来的 20px 不对称问题消除）。

Content-row gap：`0`（visible gap 全部由 ResizeGutter 自己的 8px 宽度提供，hidden card 旁边不会留多余 8px gap）。

Console clean：reload 后 0 个 error / warn 消息。

Electron 截图：见 `docs/exec-plans/active/_smoke-evidence/phase-7c-light.png` / `phase-7c-dark.png`（browser 模拟 darwin profile + 手动注入 `.dark` class 渲染）。

### 待办

- ~~**wrapper removal regression**~~（已解决 2026-05-26）：曾以为删除 AppShell 左侧 sidebar 的 `<div className="flex h-full shrink-0">` wrapper 会让 anti-FOUC script 失效（`dataPlatform=null`）。复核确认是**误判**——`data-platform` 由 `<head>` 里的 anti-FOUC `<script>` 在 hydration 前盖在 `<html>` 上，与 `<body>` 内的 layout wrapper 无因果关系；真凶是组件树中任意 hydration mismatch / render error 触发的 full client re-render 把 `<html>` 重渲染掉。Phase 7c 收口已删除该 wrapper，sidebar 回到 row-level card；Electron diag 实测 `dataPlatform=darwin` / `opaqueElementCount=0`。详见 tech-debt #29（已解决）。
- **trafficLightPosition 微调**：当前公式给的 `y=21` 是按 dot cluster ~14px 高度 + 半高 7 计算。Electron 在 macOS 26 上 AppKit 偏移可能 ±1-2px，由 user 在 Electron 中目视确认后再微调（D-3）。
