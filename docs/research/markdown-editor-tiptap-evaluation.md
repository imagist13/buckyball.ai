# Markdown 渲染与编辑体系调研 — Tiptap 评估与方案分层

> 调研日期：2026-04-16
> 触发问题：用户反馈消息预览在 Markdown 字符数超过约 10 万时不显示；文件树无"新建 Markdown 文件"入口；当前编辑体验（技能 `.md` 编辑）过于原始。
> 本文三层结构：**[外部事实]** 钉住来源与访问日期；**[仓库事实]** 带 `file:line`；**[推断]** 标注。

---

## 1. 问题陈述

两个独立子问题合并调研：

1. **(a) 新建 Markdown 文件**：希望在文件树节点上右键直接新建 `.md`，不必切到 Obsidian 等外部软件；同时需兼容已存在的 Obsidian vault 文件（frontmatter、wikilinks、callouts）。
2. **(b) 长文档渲染卡死**：10 万字符左右的消息预览不显示。用户倾向引入 Tiptap（<https://github.com/ueberdosis/tiptap>）替换当前渲染/编辑栈。

本文不做实现，只回答三个问题：
- 根因是 Streamdown 吗，还是上层使用方式？
- Tiptap 是否适合做 CodePilot 的 Markdown 渲染/编辑？
- 如果不是 Tiptap，替代路径是什么？

---

## 2. 仓库现状（repo facts）

### 2.1 当前 Markdown 栈并存三套

| 场景 | 库 | 入口 |
|------|----|------|
| 聊天消息渲染（流式） | **streamdown 2.1.0** | `src/components/ai-elements/message.tsx:338-350`（`MessageResponse`） |
| IM 桥接（Telegram / Discord / 飞书） | **markdown-it 14.1.1** | `src/lib/bridge/markdown/ir.ts:1-110` |
| 技能详情 / Release Notes | **react-markdown 10.1.0 + remark-gfm 4.0.1** | `src/components/skills/SkillEditor.tsx:103` |
| 技能文件编辑 | 原生 `<textarea>` | `src/components/skills/SkillEditor.tsx:65-89`（Tab 缩进 + Cmd/Ctrl+S） |

版本核对（`package.json`）：`react: 19.2.3`、`react-dom: 19.2.3`、`next: 16.2.1`、`ai: ^6.0.73`、`streamdown: ^2.1.0`、`tailwindcss: ^4`。

### 2.2 `MessageResponse` 的流式使用方式（关键）

`src/components/ai-elements/message.tsx:338-350`：

```ts
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
);
```

- 每条消息一个 `<Streamdown>` 实例，**整段 Markdown 字符串**作为 `children` 传入。
- `memo` 的相等性函数只看 `children` 引用是否变；流式追加时每个 chunk 都会产生新字符串，等于每 chunk 整棵 Markdown AST 重新 parse + 重新 diff。

### 2.3 文件树"新建 Markdown 文件"入口缺失

- `src/components/ai-elements/file-tree.tsx` 只暴露 `onAdd` 回调，**没有**用于创建 `.md` 的右键菜单项。
- `.md` 的创建目前散落在 `/api/skills`、`/api/workspace` 路由中，并非通用文件新建流程。
- Obsidian 兼容现状：
  - YAML frontmatter 解析已在 `skill-parser.ts:43-59`。
  - Wikilinks `[[ ]]` 仅在 memory 检索（`memory-search-mcp.ts:9,36`）做字符串匹配，**未在渲染器中被转换为链接**。
  - Callouts `> [!note]`、dataview 等：无处理。

### 2.4 长文档渲染可复现的瓶颈

[推断] 结合 2.2 的实现方式，长文档不显示的候选根因按概率排序：

1. **流式整串重渲**：每次 `setState` 都触发 Streamdown 重新从零 parse 整串 Markdown；10 万字符级别会累计到秒级主线程阻塞，用户观察到"不显示"。
2. **单个超大 code fence**：Shiki 高亮在极长代码块上会触发 worker 超时，Streamdown 捕获后可能整块降级或静默失败。
3. **React commit 阶段 DOM 过大**：10 万字符按 Markdown 结构展开后通常对应数千个 DOM 节点，Chromium layout/paint 本身就已超过 1 帧预算。

[推断] 未在本次调研中做复现实验，根因排序需 CDP 实测确认（`npm run dev` + devtools Performance 面板 + 长 Markdown fixture）。

---

## 3. 外部事实（external facts）

### 3.1 Tiptap 定位

- **来源**：<https://tiptap.dev/docs/editor/getting-started/overview>、<https://tiptap.dev/docs/editor/core-concepts/introduction>（访问日期 2026-04-16）。
- Tiptap 是 **headless 富文本编辑器框架**，基于 ProseMirror，内部文档模型是结构化 JSON（Nodes + Marks + Text），**不是纯 Markdown 编辑器**。Markdown 是 I/O 格式之一。
- 在 v3.7.0 发布了 `@tiptap/markdown` 扩展（仍标 beta），底层用 marked.js 解析，提供 `editor.getMarkdown()` / `editor.markdown.parse()` 做 JSON ↔ Markdown 往返。社区老包 `aguingand/tiptap-markdown` 作者已声明停更，官方建议迁移至 `@tiptap/markdown`。

### 3.2 Markdown 往返已知限制

- **来源（官方明示）**：<https://tiptap.dev/docs/editor/markdown>（访问日期 2026-04-16）。官方页面当前明确列出的限制：
  - **表格单元格只支持单一子节点**（Markdown 语法限制）。
  - **HTML 注释会在 parse 时丢失**。
- [推断 / 社区反馈] 以下非官方明示，来自社区讨论与前代 `aguingand/tiptap-markdown` 文档遗留，迁移到 `@tiptap/markdown` 后部分可能已改善，需 POC 验证：
  - 空段落可能需 `&nbsp;` 占位。
  - 重叠 bold/italic 边界需 `htmlReopen` 选项兜底。
  - 脚注、数学块、自定义 directive 等扩展语法往返需自行写 tokenizer + serializer。

### 3.3 长文档性能

- **来源**：<https://discuss.prosemirror.net/t/performance-issues-with-prosemirror-and-chrome/2498>、<https://discuss.prosemirror.net/t/large-documents-with-virtualized-rendering/5864>（访问日期 2026-04-16）。
- **ProseMirror 本身不做虚拟化**，同步渲染整棵 DOM。
- 社区多次报告 10 万字符以上出现明显卡顿，瓶颈主要在浏览器 layout/paint，不在 JS。
- 官方**没有内置虚拟滚动**；viewport-based decoration 或分片渲染需要开发者自建。

### 3.4 流式 AI 场景

- **来源**：<https://tiptap.dev/docs/content-ai/capabilities/generation/text-generation/stream>（访问日期 2026-04-16）。
- `editor.commands.streamContent(range, cb)` **目前归属 Content AI 付费能力**，文档标 "Available in Start plan"，需通过 private registry 安装；**不是开源核心 API**。
- 更高级的 `AiCaret`、`streamTool`、schema-aware 生成同样在 **Content AI Toolkit（付费）** 中。
- **商业影响**：若要在 CodePilot 做 Tiptap + 流式 AI 写入，需订阅 Start plan。此前表述"streamContent 是开源核心"低估了商业风险，在此更正。

### 3.5 商业化与协议

- **来源**：<https://tiptap.dev/pricing>（访问日期 2026-04-16）。
- 核心编辑器 + 大量扩展为 **MIT**，可自托管。
- **付费部分**：Cloud Documents、Collaboration、Comments、Version History、**AI Toolkit（含 `streamContent` / `AiCaret` / `streamTool`）**、Conversion（DOCX/ODT/PDF/EPUB 导入导出）。
- `@tiptap/markdown` 本身开源免费；DOCX 级别转换与 AI 流式写入均走付费 SaaS。

### 3.6 Obsidian 扩展语法对接

- Wikilinks：有社区包 `aarkue/tiptap-wikilink-extension`（来源：<https://github.com/aarkue/tiptap-wikilink-extension>，访问日期 2026-04-16）。
- YAML Frontmatter：**无现成扩展**，需自写 node + serializer。
- Callouts（`> [!note]`）、dataview：**无现成扩展**，全部自建。

### 3.7 Next.js / SSR 注意事项

- **来源**：<https://tiptap.dev/docs/editor/getting-started/install/nextjs>（访问日期 2026-04-16）。
- 必须在 `useEditor` 配置中设 `immediatelyRender: false`，否则 SSR hydration mismatch。
- [推断] 在 Electron 渲染进程场景下 SSR 问题影响较小，但仍建议遵循官方指引。

---

## 4. 对比矩阵

| 维度 | 现状 Streamdown（渲染）+ textarea（编辑） | Tiptap 全量替换 | 折中方案：Streamdown（渲染）+ CodeMirror 6（编辑） |
|------|------------------------------------------|----------------|-------------------------------------------------|
| 编辑体验 | 原始 textarea，无高亮、无自动补全 | **WYSIWYG**，富文本所见即所得 | **源码 + 语法高亮**，Obsidian / VS Code 风格 |
| Markdown 保真度 | 零转换，完全无损 | 需经 JSON 中转，有已知往返损失 | 零转换，完全无损 |
| 长文档性能 | 当前有瓶颈（2.2 节问题） | ProseMirror 同步渲染 DOM，**10 万字符一样卡**且无官方虚拟化 | CodeMirror 原生 viewport 虚拟化，百万行可用 |
| 流式追加（消息渲染） | Streamdown 为此场景设计 | 有 `streamContent` API，但 **付费 Start plan** 且重开销 | 渲染仍用 Streamdown，编辑器不参与流式 |
| Obsidian 扩展语法 | frontmatter 已有；wikilinks/callouts 需补渲染器 | 全部需自建扩展 | remark / markdown-it 插件生态丰富 |
| 引入成本 | 低（修复现有实现） | 高（新范式 + 自建 Obsidian 扩展 + 虚拟化） | 中（只引 CodeMirror，渲染不动） |
| Bundle 体积 | 现状无增量 | StarterKit 估算 **150–250KB gzipped** | CodeMirror 按需 ~80–120KB gzipped |
| 付费模块风险 | 无 | Conversion / Collaboration / AI Toolkit 付费 | 无 |

---

## 5. 结论与建议

### 5.1 Tiptap 是否采用

**不推荐作为 Markdown 渲染/编辑主栈**，理由三点：

1. **不能解决长文档问题**：ProseMirror 同样无虚拟化，Tiptap 在 10 万字符级别同样卡。引入 Tiptap 反而新增 JSON ↔ Markdown 转换开销。
2. **与"忠实展示 CLI / Obsidian 内容"的定位冲突**：Markdown 往返已知有损（frontmatter、callouts、嵌套、HTML 注释），CodePilot 作为面向开发者和创作者的客户端，不应在文件层引入 lossy 转换。
3. **Obsidian 生态全部要自建**：wikilinks、callouts、dataview、双链图等扩展都得自己写 Node + Serializer，工作量远超收益。

**仅在未来做"Canvas / 协作文档 / AI 可视化拼装 landing page"时才值得引入 Tiptap**，那是 WYSIWYG + 协作的独立场景。

### 5.2 长文档不显示的处置路径

优先级按"先定位、再优化、最后换栈"：

1. **P0 — CDP 复现 + Performance 采样**：构造 10 万 / 30 万字符三份 fixture，`npm run dev` 在 chrome-devtools MCP 下实测，确认瓶颈落在 parse、layout 还是 paint。
2. **P1 — 改 `MessageResponse` memo 策略**：流式期间按"追加量"而非"引用"做细粒度比较，或在消息底部拆分"稳定前缀 + 流式尾部"两段 Streamdown 实例，让长前缀不再被重复 parse。
3. **P1 — 单条消息长度阈值**：超阈值的消息改为分段虚拟化列表渲染（每段独立 Streamdown 实例），参考 `react-virtuoso` / `@tanstack/react-virtual`。
4. **P2 — 超大 code fence 保护**：Shiki 高亮在 code block 长度 > N 时降级为无高亮纯 `<pre>`。

### 5.3 新建 Markdown 文件入口

属于小颗粒度独立功能，与 Tiptap/AI Elements 讨论解耦：

- `file-tree.tsx` 增加右键菜单 "New Markdown File" → 调用 `/api/workspace` 新增写文件接口（若不存在则新建）。
- 默认文件名 `untitled.md`，在同目录下自增后缀避免冲突。
- 创建成功后自动进入编辑态，使用下一节的编辑器。

### 5.4 编辑器选型：推荐 **CodeMirror 6**

- 与 Obsidian / VS Code / Cursor 的编辑体验一致（源码模式 + 语法高亮），符合非码农创作者用户群中对 "Markdown 源码" 的预期。
- 原生 viewport 虚拟化，百万行无压力。
- 零转换：文件落盘仍是纯 Markdown 文本，与 Obsidian vault 完全兼容。
- 有成熟 markdown mode、vim/emacs 绑定、搜索替换、折叠等模块。
- [推断] bundle 增量约 80–120KB gzipped，可接受。

**不推荐**：Monaco（太重、Electron 打包膨胀明显）、Lexical（生态偏 WYSIWYG）。

### 5.5 最终分层方案

| 层 | 方案 | 理由 |
|----|------|------|
| 消息流式渲染 | **保留 Streamdown**，修根因（5.2） | 专为流式场景设计，不换库 |
| 技能详情 / Release Notes | 保留 react-markdown | 非流式、稳定、无需动 |
| IM 桥接 | 保留 markdown-it | 跨平台转换已稳定 |
| **新增：文件新建 + 通用 `.md` 编辑器** | **CodeMirror 6** + Obsidian 兼容插件（wikilinks、frontmatter 高亮） | 源码模式、无损、虚拟化 |
| Tiptap | **暂不引入**，未来 Canvas 场景再评估 | 不是当前问题的解法 |

---

## 6. 未决事项（需要后续执行计划覆盖）

1. 长文档瓶颈的 CDP 实测数据（瓶颈定位），需落到 `docs/exec-plans/active/`。
2. CodeMirror 6 在 Electron + Next.js 16 环境的集成 POC（SSR 兼容性、Tailwind v4 样式隔离）。
3. `file-tree.tsx` 右键菜单通用化（新建文件、新建目录、重命名、删除）作为统一改造，非仅为 `.md`。
4. Obsidian wikilinks 在 Streamdown 侧的渲染转换（`remark` 插件链），与编辑器侧的语法高亮分别落地。

---

## 7. 参考资料（快照锚定）

- <https://tiptap.dev/docs/editor/getting-started/overview>（2026-04-16）
- <https://tiptap.dev/docs/editor/core-concepts/introduction>（2026-04-16）
- <https://tiptap.dev/docs/editor/markdown>（2026-04-16）
- <https://tiptap.dev/docs/editor/getting-started/install/nextjs>（2026-04-16）
- <https://tiptap.dev/docs/content-ai/capabilities/generation/text-generation/stream>（2026-04-16）
- <https://tiptap.dev/pricing>（2026-04-16）
- <https://discuss.prosemirror.net/t/performance-issues-with-prosemirror-and-chrome/2498>（2026-04-16）
- <https://github.com/aarkue/tiptap-wikilink-extension>（2026-04-16）
- <https://codemirror.net/>（2026-04-16，选型依据）
