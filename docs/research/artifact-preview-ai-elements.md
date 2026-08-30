# Artifact 预览组件调研 — Vercel AI Elements 适配与 React 运行时方案

> 调研日期：2026-04-16
> 触发问题：HTML 预览只支持纯 HTML，缺 React/JSX 预览；AI 生成网页时只给外链，用户要在本地浏览器打开；用户记忆中"Vercel 出的 E 开头"组件库需确认身份并评估借鉴方式。
> 本文三层结构：**[外部事实]** 钉来源与访问日期；**[仓库事实]** 带 `file:line`；**[推断]** 标注。

---

## 1. 问题陈述

三个子问题：

1. **(a) 预览格式扩展**：当前 HTML 预览组件按理应支持 React / JSX / Vue 等框架，不应只限纯 HTML。
2. **(b) Artifact 自动拉起**：AI 生成网页内容时，应直接触发侧边栏 Artifact 预览，不再依赖"AI 给链接 → 用户手动复制 → 浏览器打开"。
3. **(c) E 开头的组件库**：用户记忆中 Vercel 出过一个专门给 AI 应用用的 React 组件库。本调研确认身份并评估借鉴策略。

---

## 2. 仓库现状（repo facts）

### 2.1 预览组件分布

| 职能 | 文件 | 关键行号 |
|------|------|---------|
| 侧边预览面板 | `src/components/layout/panels/PreviewPanel.tsx` | `88`（组件定义），`374-380`（HTML `<iframe srcDoc>`），`358-403`（Markdown 分支） |
| 预览内容 API | `src/app/api/files/preview/route.ts` | `7`（端点定义） |
| 消息内代码块 | `src/components/ai-elements/code-block.tsx` `CodeBlockDefaultHeader` | 定义 `659`，引用 `641`，`CodeBlockHeader`（通用版）`414`；当前仅 Copy / Copy as Markdown，无"预览"按钮 |
| Artifact UI 壳 | `src/components/ai-elements/artifact.tsx` | `18-149`（`Artifact`/`Header`/`Title`/`Actions`/`Action`/`Close`/`Content`） |
| 面板注册 | `src/components/layout/PanelZone.tsx` | 5 个面板：`AssistantPanel`、`PreviewPanel`、`GitPanel`、`FileTreePanel`、`DashboardPanel` |

### 2.2 当前支持的预览格式

`PreviewPanel.tsx` 内置：
- **HTML / HTM**：iframe + `srcDoc`，带 `sandbox=""`。
- **Markdown / MDX**：Streamdown 渲染（`358-403`）。
- **媒体**：`IMAGE_EXTENSIONS` / `VIDEO_EXTENSIONS` / `AUDIO_EXTENSIONS`（`50-52`）。
- **不支持**：JSX/TSX、React 组件、Vue 单文件、SVG 独立渲染、Mermaid 独立渲染。

### 2.3 代码块 → 预览的数据链路缺口

- 消息内代码块识别语言（`lang-html`、`lang-jsx` 等），但 `code-block.tsx:659` 的 `CodeBlockDefaultHeader` **没有暴露"在侧边打开"按钮**。
- `PreviewPanel` 目前**只接受文件路径作为数据源**，不接受 "inline content + 虚拟文件名" 形式，导致即使能识别 code fence 也无法直接注入。
- [推断] AI 返回 `https://...` 链接通过 Streamdown 直接渲染为 `<a target="_blank">`，未经过任何识别/劫持，因此不会被自动拉起预览。

### 2.4 `artifact.tsx` 的存在状态（重要）

- 文件已存在且内容与 AI Elements registry 原版一致（`Artifact`、`ArtifactHeader`、`ArtifactTitle`、`ArtifactDescription`、`ArtifactActions`、`ArtifactAction`、`ArtifactClose`、`ArtifactContent` 八件套）。
- **仅是纯 UI 外壳**：全部是 `flex + border + shadow + tooltip` 的布局原语，不承担任何内容渲染。
- **项目内无引用**：grep 未发现 `Artifact` 作为组件被消费的代码路径。[推断] 属于历史抄过来但尚未接入的基础设施。

### 2.5 依赖版本（关键）

`package.json` 核对：

| 依赖 | 当前版本 | AI Elements 要求（见 3.1） | 结论 |
|------|---------|---------------------------|------|
| react | `19.2.3` | `19.2.3` | **完全一致** |
| react-dom | `19.2.3` | `19.2.3` | **完全一致** |
| ai | `^6.0.73` | `^6` | **兼容** |
| next | `16.2.1` | shadcn 要求 ≥ 13 | 兼容 |
| tailwindcss | `^4` | 支持 | 兼容 |
| streamdown | `^2.1.0` | AI Elements 多处依赖 | 兼容 |

**没有 `@vercel/ai`、`ai-elements` npm 依赖**（AI Elements 不是 npm 包，见 3.1）。lint 脚本里提到 `ai-elements` 目录只是作为排除项（`package.json:28`）。

---

## 3. 外部事实（external facts）

### 3.1 Vercel AI Elements 身份确认

- **来源**：<https://ai-sdk.dev/elements/overview>、<https://github.com/vercel/ai-elements>（访问日期 2026-04-16）。
- **定位**：Vercel 出的 **shadcn 注册表风格** React 组件库，建立在 shadcn/ui 之上，面向 AI 原生应用场景。
- **分发方式**：**不是 npm 包**，通过 shadcn CLI 从 registry 把源码直接拷贝到项目的 `components/ai-elements/`：
  ```
  npx shadcn@latest add https://elements.ai-sdk.dev/<component>
  ```
  拷进来的是源码，项目拥有完整所有权，升级需手动重新 add。
- **与 `ai` SDK 关系**：不是 `ai` 包一部分，但深度集成 `ai@^6` 的 `ToolUIPart`、streaming 类型、`@ai-sdk/react` hook。
- **活跃度**：⭐ 1923 / fork 229 / open issues 22 / open PR 24；最近 commit `2026-04-07`、`2026-04-01`、`2026-03-23`，**每周有推进**。
- **协议**：仓库 License 标 Other，实为 Apache-2.0 变体；商用前建议扫一遍 `LICENSE` 原文。

### 3.2 AI Elements 组件清单（47 个）

**来源**：<https://ai-sdk.dev/elements/components>（访问日期 2026-04-16）。

```
agent, artifact, attachments, audio-player, canvas, chain-of-thought,
checkpoint, code-block, commit, confirmation, connection, context,
conversation, file-tree, image, inline-citation, jsx-preview, message,
model-selector, panel, persona, plan, prompt-input, reasoning, sandbox,
schema-display, snippet, sources, speech-input, stack-trace, suggestion,
task, terminal, test-results, tool, toolbar, transcription, web-preview, ...
```

与本调研强相关：**artifact**、**web-preview**、**jsx-preview**、**sandbox**、**code-block**。

### 3.3 `Artifact` 组件的真实能力

- **来源**：<https://ai-sdk.dev/elements/components/artifact>（访问日期 2026-04-16）。
- **结论**：`Artifact` 是**纯 UI 壳**，不渲染内容、不执行代码、不含 iframe。
- 暴露 `Artifact` / `ArtifactHeader` / `ArtifactTitle` / `ArtifactDescription` / `ArtifactActions` / `ArtifactAction` / `ArtifactClose` / `ArtifactContent`；`ArtifactContent` 内容完全由开发者填充。
- 官方示例里 `ArtifactContent` 塞的就是 `<pre><code>`，等价于 Claude 侧栏卡片的外观。

### 3.4 真正的预览能力在三个姐妹组件

- **来源**：<https://ai-sdk.dev/elements/components/web-preview>、<https://ai-sdk.dev/elements/components/jsx-preview>、<https://ai-sdk.dev/elements/components/sandbox>、<https://ai-sdk.dev/elements/components/code-block>（访问日期 2026-04-16）。

| 组件 | 能力 | 实现 |
|------|------|------|
| `WebPreview` | 预览 URL / 已部署页面 | `WebPreviewBody` = `<iframe>`，自带导航栏、URL 输入、Desktop/Tablet/Mobile 切换、Console 日志面板 |
| `JSXPreview` | 渲染流式 JSX 片段 | 基于 [`react-jsx-parser`](https://github.com/TroyAlford/react-jsx-parser)，**解释执行**（非编译），支持 `stripIncompleteTag` 边流边补全 |
| `Sandbox` | 代码 Tab 展示 | `Tabs` + `Collapsible`，**仅展示代码不执行** |
| `CodeBlock` | 代码高亮 | Shiki，`showLineNumbers`、Copy 按钮、dual theme |

### 3.5 React / JSX 预览能走多远

- **来源**：<https://github.com/TroyAlford/react-jsx-parser>（访问日期 2026-04-16）。
- `react-jsx-parser` 是**解释器**，只能渲染通过 `components` / `bindings` 白名单**显式注入**的组件。
- **不能** `import`、**不能**执行任意 hooks 业务逻辑、**不能**编译 TS/TSX。
- 能做的事：渲染 LLM 生成的 "用几个 shadcn 组件拼出的 landing page"。
- **要跑完整 React/Vite/多文件项目必须接 Sandpack 或 StackBlitz WebContainer**，AI Elements 没内置。

### 3.6 HTML / SVG / Mermaid / Math

- **来源**：AI Elements 仓库 `package.json`（访问日期 2026-04-16）。
- 依赖 `@streamdown/mermaid`、`@streamdown/math`、`katex`，通过 `streamdown` 生态自动支持 Mermaid / LaTeX。
- 纯 HTML 预览需自己写 iframe + `srcDoc`，AI Elements 未在 `WebPreview` 提供该糖（`WebPreview` 只接 URL）。

### 3.7 与 Claude 官方 Artifact 体验的差距

| 维度 | Claude Artifact | AI Elements |
|------|----------------|-------------|
| 侧栏外观 | ✅ | ✅ `<Artifact>` 全套原语 |
| HTML 预览 | ✅ iframe srcdoc | ⚠️ `<WebPreview>` 只吃 URL，inline HTML 需自建 |
| React 运行时预览 | ✅ 编译 + 执行 | ❌ 仅 `JSXPreview` 解释器（白名单） |
| Mermaid / SVG / Markdown | ✅ | ✅ 走 streamdown |
| 代码高亮 + 复制 | ✅ | ✅ `CodeBlock`（Shiki） |
| 多 artifact 版本切换 | ✅ | ❌ 自建 |
| Diff / Version History | ✅ | ❌ 自建 |

**一句话**：AI Elements 给了**外观 + 流式基建**，没给**运行时 + 版本管理**。

---

## 4. 对比矩阵：React 预览的三条路

| 方案 | 能力 | 体积 | 复杂度 | 安全性 | 对 CodePilot 适配度 |
|------|------|------|-------|-------|---------------------|
| `JSXPreview`（AI Elements 原生） | 白名单组件拼页面 | 低（~30KB） | 低 | 高（解释器，无执行） | **首选轻量档** |
| Sandpack | 完整 React/Vite 多文件 + hooks + import | 高（~500KB + 运行时） | 中 | 中（iframe 隔离） | **完整档备选** |
| StackBlitz WebContainer | 真 Node.js 沙箱 + npm install | 极高 | 高 | 高 | 超出预览定位，**不推荐** |

[推断] 初期只做 `JSXPreview` 即可覆盖 LLM 最常见生成场景（shadcn 风格 landing page、表单、营销页）。Sandpack 留给用户导入真实项目时再接。

---

## 5. 方案建议

### 5.1 组件借鉴策略：**只抄 UI 原语，运行时自建**

从 AI Elements registry 追加以下四件套到 `src/components/ai-elements/`（推荐走官方 CLI，shadcn 路径作为备用）：

```
# 官方 CLI（推荐）
npx ai-elements@latest add web-preview
npx ai-elements@latest add jsx-preview
npx ai-elements@latest add code-block   # 与现有 code-block.tsx 有冲突，需对比合并

# shadcn 路径（备用）
npx shadcn@latest add https://registry.ai-sdk.dev/api/registry/web-preview.json
```

`artifact.tsx` 已存在，不重复 add。[推断] 升级时手动重 add 会覆盖本地魔改，需先把 CodePilot 侧的定制化改动抽到包裹层组件里。

### 5.2 `PreviewPanel` 格式扩展

| 新增格式 | 渲染方式 | 数据来源 |
|---------|---------|---------|
| `jsx` / `tsx`（LLM 生成片段） | `JSXPreview` + 白名单组件（`Button`、`Card`、`Input`、`Dialog` 等 shadcn 子集） | inline content |
| React 项目（未来） | Sandpack | 文件树多文件 |
| URL（外部部署） | `WebPreview` | 链接劫持 |
| 纯 HTML（inline） | 保留现有 iframe + `srcDoc` | inline content 或文件 |
| SVG / Mermaid / Math | Streamdown 已支持 | 消息内直接渲染，无需单独面板 |

改造 `PreviewPanel` 接受 **{path? | inlineContent? + virtualFilename}** 两种输入，让 inline 内容也能作为数据源。

### 5.3 AI 生成网页自动拉起

三步改造：

1. **识别层**：在 `code-block.tsx:659` 的 `CodeBlockDefaultHeader` 为 `html` / `jsx` / `tsx` 语言新增"在侧边打开"按钮；识别 URL 时额外加"在 Artifact 中打开"动作。**默认不自动拉起**——只在代码块 header 暴露"Preview / Open"动作；**首个明确网页 artifact 可自动打开一次**，之后尊重用户显式意图。
2. **拉起层**：通过现有 `usePanel` hook 激活 `PreviewPanel`，传入 `{ inlineContent, kind: 'jsx' | 'html' | 'url' }`。
3. **外观层**：`PreviewPanel` 内用 `<Artifact>` 系列原语包一层 Header（标题 = AI 给的文件名或"Untitled artifact"、Actions = 复制 / 下载 / 刷新 / 在外部打开）。

### 5.4 硬约束与风险

- **版本完全兼容**：React 19.2.3 / ai ^6.0.73 / Tailwind v4 / Next 16 已就绪（见 2.5），**无升级负担**。
- **shadcn/ui 是否已就位**：需确认现有 `components/ui/` 是否为 shadcn 风格；若是则 add 即可，若否需补 shadcn 初始化。[推断] 从 `artifact.tsx` 已直接 `@/components/ui/button` / `tooltip` 推断 shadcn 基础已铺好。
- **升级纪律**：AI Elements 拷源码后升级需手动重 add，建议在 `docs/handover/` 记录每个组件的 registry 版本锚点。
- **License**：Apache-2.0 变体，商用前扫一遍 `LICENSE`。
- **JSXPreview 白名单安全性**：LLM 生成的 JSX 只能调用白名单组件，不能 `eval`、不能 `fetch`，天然隔离。相对安全但需审查白名单范围。

### 5.5 不采用的方案

- **完全自研 Artifact 外壳**：重复造轮子，且失去 AI Elements 后续迭代红利。
- **npm 形式引 AI Elements**：它不是 npm 包，唯一路径是 shadcn CLI。
- **WebContainer**：超出本次需求定位，安装负担过重。
- **让 AI Elements 的 `WebPreview` 直接吃 inline HTML**：上游不支持，应保留现有 iframe srcDoc 分支，两者并存。

---

## 6. 落地路线（只给顺序，不给时间）

1. **最小闭环**：`PreviewPanel` 支持 inline HTML 注入 + 消息内 `html` 代码块"在侧边打开"按钮 + 用 `<Artifact>` 原语包装头部。
2. **JSX 预览**：add `jsx-preview`，设计白名单组件集，覆盖 LLM 常见生成物。
3. **URL 劫持**：识别 AI 输出中的 `http(s)://` 链接，提供"在 Artifact 中打开"动作（使用 `WebPreview`）。
4. **多 Artifact 切换**：自建历史记录结构（该能力 AI Elements 未提供）。
5. **Sandpack 集成**：仅在用户主动要求"真跑 React 项目"时拉起，不影响默认体验。

---

## 7. 未决事项

1. shadcn/ui 初始化状态需 `ls src/components/ui/` + `components.json` 核对（本调研未查）。
2. `JSXPreview` 白名单组件的完整集合需产品维度讨论（shadcn 全部 vs. 精选子集）。
3. AI 输出中代码块识别的鲁棒性：部分模型不给 language tag，需额外启发式检测（`<!DOCTYPE html>` / `import React` / `<template>`）。
4. 多 Artifact 历史的持久化（内存 / DB `artifacts` 表）与回放机制。

---

## 8. 参考资料（快照锚定）

- <https://ai-sdk.dev/elements/overview>（2026-04-16）
- <https://ai-sdk.dev/elements/components>（2026-04-16）
- <https://ai-sdk.dev/elements/components/artifact>（2026-04-16）
- <https://ai-sdk.dev/elements/components/web-preview>（2026-04-16）
- <https://ai-sdk.dev/elements/components/jsx-preview>（2026-04-16）
- <https://ai-sdk.dev/elements/components/sandbox>（2026-04-16）
- <https://ai-sdk.dev/elements/components/code-block>（2026-04-16）
- <https://github.com/vercel/ai-elements>（2026-04-16）
- <https://github.com/TroyAlford/react-jsx-parser>（2026-04-16）
- <https://sandpack.codesandbox.io/>（2026-04-16，备选方案）
