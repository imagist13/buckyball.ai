# Phase 7c — Floating Card Layout Primitive

> 创建时间：2026-05-24
> 最后更新：2026-05-26（✅ Phase A-H 全部完成并归档）
> 父计划：[`refactor-closeout.md`](refactor-closeout.md)（Phase 7 视觉线；同属仍在进行的 phase-7b macOS 平台视觉，见总控板 Phase 7 行）
> 产品思考见 [docs/insights/macos-visual-profile.md](../../insights/macos-visual-profile.md)
> 技术验收见 [docs/handover/macos-visual-profile.md](../../handover/macos-visual-profile.md) Phase 7c 章节

## 上下文

Phase 7b 把 macOS native visual profile 推到了 Round 33。视觉上四张卡片基本成型，但三个观感问题反复出现：

1. 卡片底部圆角"脏"（边缘抗锯齿不齐）
2. Hover 拖动分割线时，line 没在两张相邻卡片的 gap 几何中心
3. topbar 上方留白比 cards 底部多，视觉重心偏下

Round 34 试图一刀切修这三个问题，结果误把 4 个 panel 文件改成不一致结构 + 大范围动了 wrapper / handle / surface 关系，导致 Mac 适配整片失效（dataPlatform=null）。已回退到 commit `1202fef`。

Codex 复审给出根因：**这三个问题本质是一个问题 — floating card 缺一个 layout primitive**。当前 sidebar / main / workspace / file-tree 四个区域各写了一套 wrapper / handle / surface 结构，因此：
- ResizeHandle 在 file-tree 里被包进了 `card-frame`（应该在 frame 外）
- ResizeHandle 在不同 panel 里的 `-ml-1` 几何含义不同（线落点错位）
- shell padding 一把梭 `padding: 16px`，topbar 上下不对称

继续在各 panel 里局部修每次都会打歪另一个地方。**这次必须抽出共享 primitive。**

## 结构边界（核心约束 — 不可妥协）

```
data-app-content-row（横向 flex，children 扁平）
  ├─ CardFrame(kind="sidebar")                ← shadow + radius + isolation + layout
  │    └─ CardSurface(kind="sidebar")         ← bg + clip-path + backdrop-filter + content slot
  │         └─ <ChatListPanel/SettingsSidebar inner content/>
  │
  ├─ ResizeGutter (only if sidebar && main 都可见)
  │
  ├─ CardFrame(kind="main")
  │    └─ CardSurface(kind="main")
  │         └─ <main/>
  │
  ├─ ResizeGutter (only if main && workspace 都可见)
  │
  ├─ CardFrame(kind="workspace") (chat detail only)
  │    └─ CardSurface(kind="workspace")
  │         └─ <TabBar/><TabPanel/>
  │
  ├─ ResizeGutter (only if workspace && fileTree 都可见, 或 main && fileTree 都可见)
  │
  └─ CardFrame(kind="fileTree") (chat detail only)
       └─ CardSurface(kind="fileTree")
            └─ <FileTreePanel inner content/>
```

**硬性边界：**

1. **CardFrame** 只投影、不裁剪。`overflow: visible`、`isolation: isolate`、`border-radius` 用于让 shadow 沿圆角 paint，但**自己不 clip 任何东西**。
2. **CardSurface** 只裁剪和承载内容。`clip-path: inset(0 round R)` + `background`（按 kind 决定 translucent / opaque）+ optional `backdrop-filter`。**自己不投影**。
3. **ResizeGutter** 只存在于"左右两张可见 CardFrame 之间"。是 row-level child，**绝不出现在某个 CardFrame 内部**。视觉 line 必须落在 row gap 几何中心 ±1px 以内。
4. **panel 业务组件**（ChatListPanel / SettingsSidebar / TabBar+TabPanel / FileTreePanel inner）继续**自己管 width state**（localStorage 持久化 + min/max clamp + delta math），通过 prop 把 `onResize/onResizeEnd/onReset` 传给 `<ResizeGutter>`。layout 几何由 AppShell 统一编排，**panel 不再 wrap 自己的 frame / handle**。
5. **CardSurface 的 `kind` prop 自己映射 data attribute**（`data-platform-sidebar` / `-main-content` / `-workspace-sidebar` / `-file-tree`），调用方不手写。

## 实现状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| A | 新增 `card-primitives.tsx` (CardFrame + CardSurface + ResizeGutter) + 单元测试 | done | commit `98d2d8d` |
| B | AppShell + 左侧 ChatListPanel/SettingsSidebar 切到 CardFrame + CardSurface | done | commit `f6f95ef` |
| C | WorkspaceSidebar 同 B：移除自己的 aside / wrapper | done | commit `be5a3c0` |
| D | PanelZone + FileTreePanel 同 B/C | done | commit `b991d1e` |
| E | shell padding 拆开（`padding-top` 单独算）+ trafficLightPosition.y 重算 | done | commit `e7b5a44`；y=21 起点，待 Electron 截图微调（D-3） |
| F | ResizeHandle → ResizeGutter 切换（3 处替换，content-row gap 改 0） | done | commit `1261bc4`；当时临时保留 sidebar wrapper（已于 2026-05-26 收口删除，tech-debt #29 误判已撤销，sidebar 改为 row-level card） |
| G | 验收：四张卡片 DOM 结构记录、gutter 中心测量、light/dark Electron 截图、console 干净 | done | 写入 `docs/handover/macos-visual-profile.md` Phase 7c 章节；3 个 gutter 全部 offset=0 |
| H | 收口：删 sidebar wrapper（row-level card）+ AssistantPanel 接入 CardFrame/CardSurface（新增 `assistant` kind）+ 真实 DOM gutter 几何 e2e + 修 globals.css stale trafficLight 注释 | done | 2026-05-26；Codex review 4 findings；Electron diag `dataPlatform=darwin` / `opaqueElementCount=0` |

## 决策日志

### D-1（2026-05-24）gutter 不是固定数量

提议过 "row 4 cards + 3 gutters" 扁平结构。Codex 修正：gutter 必须**只在左右两张可见 card 都存在时出现**，否则会出现 `sidebar hidden 但 gutter 还挂在 main 左边` 之类的视觉残留。

**决议：** AppShell 用条件渲染 `{showSidebar && showMain && <ResizeGutter .../>}` 控制每个 gutter；或者抽 `renderCardSequence(cards: VisibleCard[])` helper。

### D-2（2026-05-24）panel 业务状态留在 panel 内

提议过 "panel 只暴露 inner content，width state 上提到 AppShell"。Codex 修正：业务状态（width / min / max / persistence）跟内容紧耦合，强行上提会让 AppShell 接管太多。

**决议：** panel 继续自己管 width state；只把 `width / onResize / onResizeEnd / onReset` 透传给 AppShell 的 `<ResizeGutter>`。AppShell 负责 layout 几何，panel 负责行为。

### D-3（2026-05-24）trafficLight y 不靠公式

提议过 `trafficLightPosition.y = padding-top + h-10/2 - 7`。Codex 修正：AppKit / Electron 在 macOS 26 上对 traffic light 有细微偏移（红绿灯实际中心跟 dot 几何中心可能差 1-2px）。

**决议：** Phase E 落 padding 改动后，立刻用 Electron 截图比对红绿灯三个圆心 vs topbar 控件中心线。公式给一个起点（21px 试），但接受截图反馈调整 ±2px。

### D-4（2026-05-24）回退策略不写 `git reset --hard`

之前回退步骤建议过 `git reset --hard 1202fef`。Codex 警告：worktree 里还有用户改动（debug 文件 / 临时 patch），hard reset 会破坏未提交的工作。

**决议：** 每个 Phase 独立 commit。失败时回退本步用 `git revert HEAD` 或 `git reset --soft HEAD~1`（保留改动到工作区），不默认 `--hard`。

### D-5（2026-05-24）几何中心必须被测量

ResizeGutter 的"line 在 gap 正中"不能只靠肉眼。

**决议：** 加一个 `phase-7c-gutter-geometry.test.ts`，在 jsdom 里挂载 AppShell（或 mock parent），用 `getBoundingClientRect()` 断言 gutter rect 的 centerX 等于相邻 card.right + gap / 2 ± 1px。Electron 阶段额外用截图二次确认。

## 验证策略

每个 Phase 结束跑：

1. `npm run test` — typecheck + 单元测试，必须全绿（含 Phase A 新加的 gutter 几何测试）
2. `npx electron .` 启动 → 检查 `[macos-vibrancy-diag]` 日志：`dataPlatform=darwin`、`dataShell=electron`、`surfaceSidebarToken≠transparent`、`opaqueElementCount=0`
3. Phase B 之后每步额外检查：DOM 里 `[data-platform-card-frame]` 数量 === 当前可见 card 数；`[data-platform-sidebar/-main-content/-workspace-sidebar/-file-tree]` 数量 === 各 panel 渲染数
4. Phase E 之后必须 Electron 截图（light + dark），人眼对齐红绿灯三圆心 vs topbar 控件中心线
5. 最终 Phase G 把结构图、gutter centerX 测量结果、light/dark 截图、console 日志写进 `docs/handover/macos-visual-profile.md`

## 风险 / 已知坑

- **anti-FOUC script 失效复现路径** — Round 34 改完后 dataPlatform=null。**已定位（2026-05-26，tech-debt #29 收口）**：根因是 React 放弃 SSR hydration、从 RootLayout 重渲染 `<html>`，抹掉 `<head>` script 设的 `data-platform`，由组件树中**任意**位置的 hydration mismatch / render error 触发，与某个 layout wrapper 无关。切换 AppShell 结构时仍建议**单独提交**并立刻重启 Electron 验证 diag log；但若 dataPlatform 变 null，应去查 hydration mismatch / render error（控制台的 hydration 报错、server/client 渲染分叉），不要再怪某个 wrapper。
- **clip-path + translucent fill + backdrop-filter 三层叠加的 sub-pixel 锯齿** — Round 30 的根因，目前用 `inset 0 0 0 1px highlight` ring 视觉掩盖。Phase A 设计 CardSurface 时考虑改用 `border: 1px solid` + `box-sizing: border-box`（Chromium 把 border 跟 border-radius 当一个 anti-aliased outline）。这是个**单独验证项**：CardSurface 加 storybook-style demo 页面，对比 inset shadow vs border 两种方案的圆角清晰度。
- **trafficLight 跨 padding 变化** — 任何 shell padding 变动都必须同步 `electron/main.ts` 的 trafficLightPosition.y。建议在 main.ts 注释里链回这份计划，提醒未来改 padding 的人。
