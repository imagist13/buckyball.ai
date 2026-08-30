# Phase 2D — Extensions / 插件页面整合

## 状态: 🟢 Phase 2D.0 + 2D.1 + 2D.2 + 2D.4 完成（2026-05-01）— Skills picker 1:1 闭环；2D.3 推迟（按用户决策）；Phase 2D.5（Settings 4 features 事实核准）独立任务

> 本计划目标：**把 Skills / MCP / CLI Tools 三个旧入口收敛到单一"扩展能力"页**，三个固定 Tab。同时收口几个长期债务：管理页 vs 输入框 Skills 来源不一致、内置 MCP 用户不可见、Design Agent 触发器是 ghost feature、CLI Tools 长期未更新没有诚实暴露。
>
> 不属于本计划：合并 Skills / MCP / CLI 数据模型、新增统一启用开关、把内置 MCP 做成可编辑 server、CLI update endpoint、Settings 内 Assistant/Memory/Heartbeat/Tasks 面板的 UI 重做。
>
> 上游：Round 2 完成 + Chat 稳定化收口（见 [chat-run-checkpoint.md](../deferred/chat-run-checkpoint.md)）。
> 下游：Phase 2E 待定。

## 概览

**顶层结构**：
- 主导航 `插件`（替代当前 `Skills` / `MCP` / `CLI 工具` 三个独立项）
- 页面 URL：`/plugins`（复用现有路径），标题：**扩展能力**
- 三个固定 Tab：**Skills** / **MCP** / **CLI**
- Tab 间不共享数据模型，独立加载、独立管理

**5 个 sub-phase（按实施顺序）**：

| Phase | 主题 | 用户痛点 | 价值形式 |
|---|---|---|---|
| **2D.0** | Design Agent 触发器清理（先做） | imageAgentMode ghost feature 让后续 Tab 整合工作误以为 image-gen 还有特殊路径 | C — 基础设施 + 防误导 |
| **2D.1** | Skills Tab 改造（来源归属一致 + 适应 Tab 容器） | 输入框搜得到、管理页找不到（API 5 类 source，管理页只显示 3 类） | A — 可见 UI |
| **2D.2** | MCP Tab 改造（内置能力只读区 + 外部 MCP 仍可编辑） | 用户不知道 7 个内置 MCP 何时启用 | A — 可见 UI |
| **2D.3** | CLI Tab 改造（现有页迁移 + catalog/version freshness audit） | CLI 长期未更新；catalog 是否真实仍可用、update 缺口未明示 | A 可见 UI + B 静默核准 |
| **2D.4** | 导航整合（旧入口收掉，指向 `/plugins`） | 三个独立入口太碎 | A 可见 UI |

**外加（不动 UI 的事实核准任务，单独执行）**：
- **2D.5（事实核准）** — Settings 内 Assistant / Memory / Heartbeat / Scheduled Tasks 真实状态盘点，输出 audit 报告 + 更新 plan docs + tech-debt tracker。**本期不打稳定性徽章、不动 Settings UI**——徽章工作等核准结论后再决定（可能合并到 Phase 2E）

**实施顺序**：2D.0 → 2D.1 → 2D.2 → 2D.3 → 2D.4 → 2D.5（事实核准并行可做，但与 UI Tab 整合解耦）。每个 Phase 独立 PR / 独立验收。

---

## Phase 2D.0 — Design Agent 触发器清理 ✅ 完成（2026-04-30）

### 交付摘要

**删除范围**（grep 全 repo 后确认）：
- `src/hooks/useImageGen.ts` 整个文件删除（含 ImageGenContext / useImageGen / useImageGenState）
- `src/lib/constants/image-agent-prompt.ts` 整个文件删除（IMAGE_AGENT_SYSTEM_PROMPT 常量）
- `src/components/layout/AppShell.tsx`：删 `ImageGenContext.Provider` 包裹 + `useImageGenState` 调用 + import
- `src/components/chat/MessageInput.tsx`：删 `useImageGen()` hook + `imageGen.state.enabled` 注入分支（line 469-501，整段 `IMAGE_AGENT_SYSTEM_PROMPT` 注入逻辑）+ FileAwareSubmitButton 的 `isImageAgentOn` prop 透传 + useCallback 依赖
- `src/components/chat/MessageInputParts.tsx`：删 `FileAwareSubmitButton.isImageAgentOn` prop + canQueue 判定中的 `&& !isImageAgentOn`
- `src/types/index.ts`：删 `ClaudeStreamOptions.imageAgentMode`
- `src/lib/context-assembler.ts`：删 `ContextAssemblyConfig.imageAgentMode` + 解构
- `src/lib/runtime/types.ts` + `src/lib/runtime/sdk-runtime.ts`：删 imageAgentMode passthrough
- `src/lib/claude-client.ts`：
  - 删 propagation（line 504、line 535 解构）
  - 删 widget MCP gating 中的 `if (imageAgentMode) return true`
  - 删 Media MCP gating 中的 `if (imageAgentMode) return false`（含老注释「Design Agent uses its own flow」）
  - 删 file refs gating 中的 `imageAgentMode ? textPrompt : (...)` 三元，永远走 fallback（带路径）路径
- `src/app/api/chat/route.ts`：删 `isImageAgentMode` 检测 + 传给 assembleContext + 传给 stream options
- `src/i18n/{zh,en}.ts`：删 `composer.designAgent` + `composer.designAgentTooltip` 各 1 条（共 4 keys）

**保留**（历史兼容渲染层）：
- `src/components/chat/ImageGenConfirmation.tsx`：渲染 image-gen-request 块的 UI 不删（不依赖删除的 hook，直接 fetch `/api/media/generate`）。`ImageGenResult` 类型从 useImageGen.ts 内联到此文件，加注释解释来源。
- `src/components/chat/MessageItem.tsx` 的 `parseImageGenResult` 等：保留（解析历史消息里的 image-gen-result 块）

**文档同步**：
- `ARCHITECTURE.md:42` hooks 列表更新（删 useImageGen，加 usePanel 占位）
- `docs/research/harness-and-ux-refactor.md:90` 删 imageAgentMode 字段引用
- `docs/handover/media-pipeline.md:204-205` 改写为「历史说明（2026-04-30 起失效）」段落，解释 Phase 2D.0 移除原因 + 当前关键词门控为唯一路径

**验证**：
- typecheck + 1354/1354 unit pass（duration 4.5s）
- 全 repo grep `imageAgentMode | ImageGenContext | useImageGen | composer.designAgent | IMAGE_AGENT_SYSTEM_PROMPT` 后只剩：
  - 本计划文档自身（meta-reference）
  - `media-pipeline.md` 历史说明段落（故意保留作为考古）
  - `BatchImageGenContext` / `useBatchImageGen` —— 是另一个独立功能（批量图片生成），grep 模糊匹配命中，跟 Design Agent 无关
- **真实 chat smoke**（dev server PORT=3001 + GLM-5 Turbo）：
  - 输入「帮我画一张极简风格的 logo」 → POST /api/chat 200 in 16.2s
  - 助手响应包含图片生成意图话术：「想了解一下，这个 logo 是给什么用的？...给点方向我就能开始画 🐋」
  - 助手列出「品牌名/项目名 / 行业 / 图形方向 / 色调」需求收集——典型的 Media MCP capability injection 引导模式
  - 1 tool group / 0 actions：模型选择先收集 requirements 再调用 `codepilot_generate_image`（产品上合理）
  - **结论**：keyword `画一` → Media MCP 注册 → capability 通过 system prompt 注入 → 模型识别图片生成能力。流程未受 Design Agent 删除影响
  - reload 后 console 0 errors / 0 warns（HMR 中间过渡状态有过 transient errors，已被 preserved 收集；最终代码 reload 后干净）
- 截图存档：`docs/exec-plans/screenshots/phase-2d-0-design-agent-cleanup-smoke.png`

---

## Phase 2D.0 — Design Agent 触发器清理（原计划）

### 用户痛点

Design Agent 是历史包袱——i18n keys（`composer.designAgent` / `composer.designAgentTooltip`）还在但**未被任何组件引用**；`ImageGenContext` provider 包着整个 AppShell；`imageAgentMode` flag 在 `ClaudeStreamOptions` 里 + `claude-client.ts` 里走 3 条特殊分支（widget MCP / Media MCP / file refs）。但**用户看不到任何 toggle**——状态永远 `false`。

放在 2D 最前是因为：image-gen MCP 在 2D.2（MCP Tab）的内置能力 catalog 里要展示。如果 imageAgentMode 还在，catalog 描述就要解释「在 Design Agent 模式下行为不同」——但 Design Agent 模式实际上不存在。先清掉再做 catalog，2D.2 描述就干净了。

### 现状（survey）

- `src/types/index.ts:1204` `imageAgentMode?: boolean` in `ClaudeStreamOptions`
- `src/i18n/en.ts:1200-1201` + `src/i18n/zh.ts:1197-1198` 4 个 orphaned keys
- `src/components/layout/AppShell.tsx:577` `<ImageGenContext.Provider>` 包裹整个 app
- `src/components/chat/MessageInput.tsx:148` `useImageGen()` 消费；`:469` `if (imageGen.state.enabled && badges.length === 0)` 注入 `IMAGE_AGENT_SYSTEM_PROMPT`
- `src/lib/claude-client.ts:742-754 / 761-769 / 1068-1073` 3 条 imageAgentMode 分支
- `src/app/api/chat/route.ts:365` 通过 `systemPromptAppend?.includes('image-gen-request')` 反推 mode（污染检查）
- 0 测试覆盖；`useImageGenState` initial value 永远 `false`，无 UI 调用 `setEnabled(true)`

**关键观察**：image generation 功能并不会丢——`codepilot-image-gen` MCP 已经是 keyword-gated（detect `生成图片|画一|图像|...`），用户表达"画个 logo"就会触发。Design Agent flag 是更老的实现，已被 keyword-gated MCP 替代。

### 改动范围

**做**：
- 删 4 个 i18n keys（en + zh）
- 删 `ImageGenContext` + `useImageGen` + `useImageGenState`（整个文件 / hooks）
- 删 AppShell 里的 Provider 包裹
- 删 MessageInput 里 `imageGen.state.enabled` 分支（line 469）
- 删 `imageAgentMode` from `ClaudeStreamOptions` type
- 删 claude-client.ts 里 3 条 imageAgentMode 分支（直接走 keyword-gated 路径）
- 删 `/api/chat/route.ts:365` 的 mode 反推

**不做**：
- 不改 image-gen MCP 行为（保留 keyword-gated）
- 不引入新的"显眼开关"
- 不做"在 base system prompt 里 always-advertise capability"——会让每次请求都 register 全部 MCP，token 成本上去 + 模型决策面变大。**保持 keyword-gated 是对的**

### 拆分

- **A.** grep 确认 `IMAGE_AGENT_SYSTEM_PROMPT` 是否仍被引用；不被引用则一并删
- **B.** 删 i18n（en + zh 同步）
- **C.** 删 ImageGenContext + hook 文件
- **D.** 删 AppShell Provider
- **E.** 删 MessageInput 分支
- **F.** 删 ClaudeStreamOptions.imageAgentMode + claude-client.ts 三条分支 + route.ts 反推
- **G.** typecheck + 单测全过

### 验收

- `grep -r "imageAgentMode\|ImageGenContext\|useImageGen\|composer.designAgent" src/` 应返回 0 行（除非有合理引用，需另行解释）
- 用户在对话里说"画个 logo" → 流程未变（仍触发 image-gen MCP）
- `npm run test` 通过

### 风险

- `IMAGE_AGENT_SYSTEM_PROMPT` 如果还被代码用到，删之前必须 grep 验证
- ImageGenContext 可能有兄弟 component 间 state 共享是必需的——grep 全部 useImageGen 调用点，确认每一处都不依赖 enabled state
- 类型删除会触发 cascade，所有 `if (imageAgentMode)` 分支体里的 fallback 路径要保留

---

## Phase 2D.1 — Skills 来源归属统一 🟡 API/UI 基础完成；picker 1:1 待 2D.4 闭环（2026-04-30）

> **不要把这个 Phase 当成"用户痛点已解"。** API 端 + 类型 + 5 类分组渲染 + read-only chrome 都就绪，但 `/skills` 顶级路由没有稳定的 `cwd` / `sessionId` context，浏览器实测页面仍只显示「已安装」+「插件」两组——project / sdk 仍不可见。这个核心痛点要等 Phase 2D.4 整合 ExtensionsPage 时把 `cwd` + `sessionId` 显式传给 `<SkillsManager>` 才会闭环。

### 交付摘要

**改动**（Tab 容器适配推迟到 Phase 2D.4 一并做，本期只改 SkillsManager 内部 + API）：

- `src/lib/skills-editability.ts` 新建：纯函数 `deriveSkillEditability(skill, cwd?)` 输出 `{ editable, readOnlyReason? }`，封装 SDK / cwd 子树 / fs.access W_OK 三层判定
- `src/app/api/skills/route.ts`：
  - SkillFile interface 加 `editable?: boolean` + `readOnlyReason?: 'sdk' | 'file_not_writable' | 'out_of_cwd'`
  - GET 返回前对 `all` 数组 map 一遍 deriveSkillEditability（用 query 里的 cwd），把字段拍到每条上
  - 老的内联判定函数已删除，改 import 自 lib
- `src/components/skills/SkillListItem.tsx`：
  - SkillItem 类型 union 扩到 5 类（加 `'sdk'`）+ 加 `editable` / `readOnlyReason` / `loaded`
  - 行内渲染：`!editable` 时 delete 按钮不渲染、改显示 Lock 图标 + tooltip 显示原因（i18n 驱动）
- `src/components/skills/SkillsManager.tsx`：
  - 删 line 36 的 `s.source !== "project"` filter
  - 替换 3 个硬编码 group block 为 5 group 数组（global / project / installed / plugin / sdk），每组 i18n label + 计数 + 空组不渲染
  - **新增 `cwd?` + `sessionId?` props**，默认 fallback 到 `usePanel().workingDirectory`（向后兼容老的 `/skills` 顶级路由）。Phase 2D.4 整合时由 ExtensionsPage 显式传入，届时项目 / SDK skills 才会出现
  - fetchSkills / handleCreate / buildSkillUrl 都改用 resolved `cwd`，sessionId 现已注入 `/api/skills?sessionId=...` query
- `src/components/skills/SkillEditor.tsx`（**P2 修复**，2026-04-30 review 后补）：
  - 检测 `skill.editable === false` 判定 read-only
  - 强制 `viewMode = 'preview'`（mount 与 skill 切换时都重置），用户无法进入可编辑 MarkdownEditor
  - 隐藏 view mode toggles + Save + Delete 按钮；改成顶部一个 Lock badge + tooltip 显示 readOnlyReason 文案（i18n 驱动）
  - `handleSave` / `handleDelete` 加 `if (readOnly) return` 防御（即使后续有 keymap 绕过 UI button 也保底）
- `src/i18n/{zh,en}.ts` 各加 8 keys：5 个 source 标签 + 3 个 readOnlyReason 文案

**测试**：
- `src/__tests__/unit/skills-editability.test.ts` 新建，19 test cases 覆盖：
  - SDK 永远 read-only（含 SDK + writable filePath 这种 edge）
  - Project + writable + 在 cwd 内 → editable
  - Project + 在 cwd 外 / 无 cwd context → out_of_cwd
  - Project + 在 cwd 内 + 文件 chmod 0o400 → file_not_writable
  - Global / installed / plugin × {writable, read-only, missing, empty path} 共 12 个用例
  - cwd 参数对非 project source 不生效
- 用真实 `os.tmpdir()` + `fs.chmodSync(0o400)` 做 W_OK 验证（非 mock）
- 全量 `npm run test`：typecheck + 1373/1373 unit pass（duration 4.5s）

**CDP 验证**（dev server PORT=3001）：
- 访问 `/skills` → 「已安装 4」+「插件 31」两组渲染，每组前缀 i18n label + 计数
- API 返回的每条 skill 都带 `editable: true` 字段（当前测试环境无 read-only / 无 SDK / 无 project 数据）
- Console 0 errors / 0 warns
- 截图：`docs/exec-plans/screenshots/phase-2d-1-skills-grouped.png`

**已知限制（picker 1:1 闭环要等 Phase 2D.4）**：
- `/skills` 顶级路由**没有稳定的 session/cwd/provider context**。SkillsManager 现在接受显式 `cwd` + `sessionId` props，但当前没人传——所以浏览器实测仍然只显示「已安装」+「插件」两组，project / sdk 仍不可见
- 这是用户最初的核心痛点（"输入框搜得到、管理页找不到"）—— **本期没解**。本期只交付了让 2D.4 可以一行 prop 注入就闭环的基础设施
- Phase 2D.4 整合 ExtensionsPage 时必须把当前 chat session 的 `cwd` + `sessionId` 显式 props 传给 `<SkillsManager cwd={...} sessionId={...} />`，否则用户痛点继续存在

---

## Phase 2D.1 — Skills Tab 改造（原计划）

### 用户痛点

输入框 `/` picker 能搜到 5 类 skill：global / project / installed / plugin / sdk。但 Skills 管理页只显示三类（global / installed / plugin）——**项目级 skill 和 SDK skill 在管理页完全不可见**。用户找不到它们的来源、内容、能否管理。

### 现状（survey）

- `src/app/api/skills/route.ts:8-16` 定义 `SkillFile.source: "global" | "project" | "plugin" | "installed" | "sdk"` + `SkillFile.kind: SkillKind`
- `src/types/index.ts:68` `SkillKind = 'agent_skill' | 'slash_command' | 'sdk_command' | 'codepilot_command'`
- `src/components/skills/SkillsManager.tsx:36` 显式过滤 `s.source !== "project"`
- `src/components/skills/SkillListItem.tsx:14-20` SkillItem 类型 union 不含 `"sdk"`
- `src/hooks/useSlashCommands.ts:104-107` Picker 只过滤 unloaded plugin

### 改动范围

**做**：
- 把当前 `SkillsManager` 适配进 ExtensionsPage 的 Skills Tab（移除/复用顶层 page chrome，由 ExtensionsPage 提供 outer container）
- 扩 SkillItem TS 类型 union 到 5 类 source
- 删 line 36 的 `s.source !== "project"` 过滤
- 加分组：5 组（本地 / 项目 / 已安装 / 插件 / SDK），每组带计数 + 可折叠
- 行级管理能力（**P2-1 反馈采纳，v2 修正**）：
  - **服务端判断 + 显式语义字段**。`/api/skills/route.ts` 在返回每条 SkillFile 时附加：
    - `editable: boolean` —— 是否允许 UI 编辑/删除
    - `readOnlyReason?: 'sdk' | 'file_not_writable' | 'out_of_cwd'` —— 仅当 `editable: false` 时给出
  - 服务端判定逻辑：
    - SDK 来源（`source: 'sdk'`）→ `editable: false, readOnlyReason: 'sdk'`（CodePilot 不拥有，由 Agent SDK 注入）
    - Project / Global / Installed / Plugin 来源 → 检查文件路径：
      - 路径不在当前 cwd 子树（project skills 才检 cwd，global/installed/plugin 不检）→ `editable: false, readOnlyReason: 'out_of_cwd'`
      - 文件无写权限（`fs.access(path, fs.constants.W_OK)` 抛错）→ `editable: false, readOnlyReason: 'file_not_writable'`
      - 否则 → `editable: true`
  - 前端只读不猜路径归属：直接渲染 `editable` 决定 affordance、`readOnlyReason` 决定 tooltip 文案
- 加 i18n keys：`skills.source.{global,project,installed,plugin,sdk}` + `skills.readOnlyReason.{sdk,fileNotWritable,outOfCwd}`

**不做**：
- 不改 `/api/skills` 的 source / kind 枚举
- 不改 picker 行为
- 不引入 marketplace 改造

### 拆分

- **A.** 新建 `src/app/plugins/page.tsx` 作为 ExtensionsPage 容器（如果 `/plugins` 当前已被使用，调整路径——see 2D.4 nav 整合）
- **B.** SkillsManager 适配为 Tab content：去掉顶层 page header，保留管理逻辑
- **C.** 扩 SkillItem 类型 union；删 project filter
- **D.** API 加 `editable` + `readOnlyReason` 字段（服务端做归属 + 权限判断；fs.access W_OK + cwd 子树归属检查）；前端只读 `editable` 决定 affordance、`readOnlyReason` 决定 tooltip
- **E.** 5 组分组渲染 + 计数 + 折叠
- **F.** i18n（en + zh 同步）
- **G.** 单测：
  - API 5 类 source 都能 group 正确
  - SDK 行 → `editable=false`, reason='sdk', delete 按钮不渲染
  - Project 行：cwd 内 + writable → `editable=true`；out-of-cwd → `editable=false`, reason='out_of_cwd'；no-W_OK → `editable=false`, reason='file_not_writable'

### 验收

- 输入框 picker 搜得到的 skill，Skills Tab **全部**找得到（1:1）
- 五类来源各显其一组，名字 + 计数清楚
- 每条 skill 在 UI 上的可管理状态由 API 返回的 `editable` + `readOnlyReason` 单一驱动；前端不复算路径
- SDK skill：`editable=false`，tooltip 显示「由 SDK 提供，CodePilot 不可管理」
- Project skill writable：可编辑/删除
- Project skill non-writable：tooltip 区分「文件只读」/「不在当前工作目录」两种原因
- `npm run test` 通过

### 风险

- API 同步 fs.access 检查会增加 GET /api/skills 延迟——大 skill 集（>100）时可能慢；本期接受，后续如有性能问题再加缓存
- "writable"判定 macOS / Windows 行为差异——单测用临时目录覆盖两条路径

---

## Phase 2D.2 — MCP Tab 内置能力只读区 ✅ 完成（2026-04-30）

### 交付摘要

**改动**（page chrome 推迟到 2D.4 整合时一起改）：

- **`src/lib/builtin-mcp-catalog.ts`** 新建：7 条静态记录，每条含 name / descriptionKey / toolNames / triggerCondition / triggerHintKey。`BUILTIN_MCP_NAMES` Set 给 reconnect API 防御用
- **`src/components/plugins/BuiltInMcpSection.tsx`** 新建：read-only section，每行可折叠展开看完整 tools；三色徽章区分 always / workspace / keyword 触发；section header 含明确的「不保证当前消息已启用」免责说明
- **`src/components/plugins/McpManager.tsx`**：list tab 顶部嵌入 `<BuiltInMcpSection />`，外部 server 列表保留所有现有交互
- **`src/components/plugins/McpServerList.tsx`**：reconnect 按钮加 preview 视觉信号（角标 dot + tooltip 文案改成「实验性，失败无明确错误时建议删除并重新添加」）
- **`src/app/api/plugins/mcp/reconnect/route.ts`** 加防御：
  - 内置 MCP 名（命中 `BUILTIN_MCP_NAMES`）→ 400「built-in cannot be reconnected」
  - serverName 不在配置（loadAllMcpServers）→ 404「not found in config」
  - 上述都通过才 delegate 给 mcp-connection-manager
- **`src/i18n/{zh,en}.ts`** 各加 22 keys：section title / description / tool count / 3 trigger labels / 7 描述 + 6 触发提示 / reconnect preview tooltip / common.preview

**测试**：
- `src/__tests__/unit/builtin-mcp-catalog.test.ts` 新建，10 用例：
  - 每个 catalog 条目都有 SOURCE_FILES 映射
  - 7 个 MCP 文件的 `tool('codepilot_xxx', ...)` 实际调用名 vs catalog 声明的 toolNames 双向匹配（drift 检测）
  - `BUILTIN_MCP_NAMES` set 与 catalog 一致（无重复 / 无 typo）
  - 所有 tool 名遵循 `codepilot_*` 前缀约定
- 全量 `npm run test`：typecheck + 1383/1383 unit pass（duration 4.8s）

**CDP 验证**（dev server PORT=3001 重启清 i18n HMR 残留后）：
- `/mcp` 顶部「内置能力 (7)」只读 section 渲染正确
- 7 个 MCP 各显其行 + 三色徽章 + tool 计数 + 描述 + 触发提示
- 「不保证当前消息已启用某个能力」免责说明在 section header 下
- 外部 server `chrome-devtools` 保留正常交互（toggle / edit / delete / runtime status badge）
- Console 0 errors / 0 warns
- 截图：`docs/exec-plans/screenshots/phase-2d-2-mcp-builtin-section.png`

**踩坑记录（写入决策日志）**：
- 第一次 reload 报 hydration mismatch — server-rendered 文本是 raw i18n key，client 渲染为翻译值。根因是 dev server i18n module HMR 残留（新 keys 在 client bundle 但 SSR module cache 还是旧的）。重启 dev server 后清掉。提醒：以后 i18n 加 key 后建议主动重启 dev server 而不是依赖 HMR

---

## Phase 2D.2 — MCP Tab 改造（原计划）

### 用户痛点

MCP 管理页当前只显示用户配置的外部 MCP server。但 CodePilot 还有 7 个内置 MCP，用户看不到列表 / 触发条件 / 能不能用。结果用户对"image-gen 为什么有时候 work 有时候不"产生迷信解释。

### 现状（survey）

- 7 个内置 MCP：codepilot-memory / notify / cli-tools / dashboard / media / image-gen / widget
- 注册逻辑 `src/lib/claude-client.ts:700-823`，3 种条件：always-on（notify）/ workspace-gated（memory）/ keyword-gated（其他）
- 内置 MCP in-process（`createSdkMcpServer`），**不在 `/api/plugins/mcp/status` 的 SDK runtime status 里**
- McpManager 当前是平的列表

### 改动范围

**目标修正（P2-2 反馈采纳）**：本 Phase 只展示**静态能力说明 + 触发条件描述**，**不保证当前消息已注入**。"实时注入状态"作为 follow-up 单独列入"不在范围"，避免实现者补一个不准的假状态。

**做**：
- McpManager 适配进 MCP Tab：移除独立顶层 page chrome
- Tab 顶部加"内置能力"只读区（在外部 MCP server 列表之上）
- 一张静态描述表（数据来自代码内 const，不来自 SDK runtime）：
  - 名字（codepilot-memory 等）
  - 描述（一句话，i18n）
  - 暴露的 tools（数组）
  - 触发条件（i18n 解释：「始终启用」/「需要配置工作区」/「在对话提到关键词时启用」）
  - **明确文案**：「以下能力的实际启用取决于对话内容、工作区配置和关键词匹配；本页面不保证当前消息已注入。」
- 内置能力 read-only——不能删 / 不能编辑 / 不能 toggle
- 外部 MCP 区域不变（保留所有现有交互）
- 给 reconnect 按钮加 `preview` 徽章 + tooltip（合并 P2-3 老 2D.4 内容到这个 phase 里——MCP 部分） + reconnect API 加 server-not-found 防御

**不做**：
- 不实时检测"内置 MCP 是否在当前 session 注册"——本期 scope 排除
- 不允许用户禁用内置能力
- 不让用户编辑触发条件（关键词列表写死在代码里）
- 不新做 MCP update endpoint（CLI Tab 部分讨论）

### 拆分

- **A.** 新建 `src/lib/builtin-mcp-catalog.ts` 静态表：每条记录 name / descriptionKey / toolNames / triggerCondition（'always' / 'workspace' / 'keyword'）/ keywordHintKey
- **B.** 在 McpManager 顶部新加 BuiltInMcpSection 组件
- **C.** McpManager 适配进 MCP Tab content
- **D.** reconnect preview 徽章 + tooltip + reconnect route 加 serverName 存在性校验（404 if not in config）
- **E.** i18n：每个内置 MCP 一组 key（约 30+ keys）+ `common.preview` + 触发条件解释 + 「不保证实时注入」说明
- **F.** 单测：catalog 表跟实际 MCP 文件 export 的工具名对得上（漂移检测）；reconnect 找不到 server 返 404

### 验收

- MCP Tab 第一屏看到 7 个内置能力，每个能展开看 tools
- 触发条件用户能看懂；「不保证实时注入」明示
- 外部 MCP 区域行为不变
- reconnect 旁有 preview 徽章
- catalog 漂移检测：单测红灯防止以后新加 tool 但忘了更新 catalog
- `npm run test` 通过

### 风险

- catalog 跟代码漂移：靠单测兜底
- i18n key 数量大（~30+）

---

## Phase 2D.3 — CLI Tab 改造（迁移 + catalog/version freshness audit）

### 用户痛点（**P2-3 反馈采纳**）

用户明确提到 CLI 已经很久没有更新。survey 发现：
- 主路径（catalog / detect / install / describe / add custom / delete custom）实现完整、有单测、commit 历史活跃（last commit 35fe9a4 加 AI agent compatibility scoring）
- **但**：`CLI_TOOLS_CATALOG` 是硬编码常量；catalog 里的工具版本号是不是仍可用、install 命令是不是还正确、homepage 是不是仍存活——**没有自动机制保证**
- MCP update endpoint 不存在（只有 cli-tools-mcp 内部能在对话中跑命令）

### 现状（survey）

- `src/app/cli-tools/page.tsx` 一个页面，CliToolsManager 主组件
- 主路径 production-ready：catalog / status / install (SSE) / auto-describe / add custom / delete custom 都有真实实现 + 单测
- `git log --oneline -5` 显示活跃维护（最近改动是 AI 能力增强，不是 catalog 数据更新）
- catalog 数据更新机制：人工——没有 CI / 定时检查

### 改动范围

**做**：
- CliToolsManager 适配进 CLI Tab：移除独立顶层 page chrome
- **加 catalog/version freshness audit**（**P2-3 反馈采纳**）：
  - 在 CLI Tab 顶部加 inline notice：「catalog 版本号和安装命令最后人工核对：YYYY-MM-DD；如发现工具升级请提 issue」（日期写在 catalog 文件里，作为常量 `CATALOG_VERIFIED_AT`）
  - 写入本期 freshness audit 结果（**作为本期交付**）：跑 `which` / `--version` 对每个 catalog 工具，对比 catalog 标的版本号 + install 命令；产出 `docs/research/cli-tools-catalog-audit-2026-04-30.md`，列出哪些 catalog 项过期、哪些 install 命令在当前发行版下可能失败
  - audit 报告的 P1 项（直接 broken）记入 tech-debt tracker；P2/P3 项作为 follow-up
- 在 CLI Tab 加 update 缺口的诚实文案：「CodePilot 不内建独立 update 按钮；如需升级，对话里说『更新 X』，AI 会通过 cli-tools MCP 跑对应命令（brew upgrade / npm update -g 等）」

**不做**：
- 不改 CLI 主路径行为（已经稳定）
- 不新做 update endpoint
- 不做 catalog 自动校验 CI（产品扩张，超出 cleanup scope）

### 拆分

- **A.** 跑 freshness audit：脚本扫 catalog → 对每个工具 detect 实际版本 + 验证 install command 可执行（可用 `which` + `--help` 探测）→ 写报告
- **B.** 报告产出后，根据结论决定 P1 修哪些 catalog 项（**这一步可能产生小数量 catalog 修订 commit**）
- **C.** 加 `CATALOG_VERIFIED_AT` 常量 + Tab 顶部 inline notice
- **D.** 加 update 缺口说明文案
- **E.** CliToolsManager 适配进 Tab content
- **F.** i18n：notice 文案 + update 说明文案
- **G.** tech-debt tracker 加条目（catalog 自动校验是长期债务）

### 验收

- CLI Tab 第一屏看到 catalog 验证日期 + update 缺口说明
- audit 报告交付到 `docs/research/cli-tools-catalog-audit-2026-04-30.md`
- P1 broken 项已修或已记入 tech-debt
- 主路径行为不变
- `npm run test` 通过

### 风险

- audit 跑起来可能发现一堆问题——本期只修 P1，剩下进 tracker；不在 cleanup scope 里把 catalog 整个重写
- 用户机器上有些 catalog 工具未必装着，audit 只能跑能跑的部分；audit 报告需要标注「该工具未在测试环境检测到」

---

## Phase 2D.4 — ExtensionsPage 整合 ✅ 完成（2026-05-01）

### 交付摘要

**改动**：
- **`src/app/plugins/page.tsx`** 从 `redirect → /skills` 升级为真正的 `<ExtensionsPage>` 容器：标题「扩展能力」+ 描述 + 三 fixed Tab（Skills / MCP / CLI 工具）
- **`src/hooks/useTabFromHash.ts`** 新建：纯 client 的 hash sync hook，mount 读 `window.location.hash`、监听 `hashchange`（覆盖浏览器前进/后退）、切 Tab 用 `history.replaceState`（不污染历史栈）
- **`<SkillsManager cwd={cwd} sessionId={activeSessionId} />`**：ExtensionsPage 从 `usePanel()` 拿 `workingDirectory + sessionId` 显式注入。这是 Phase 2D.1 picker 1:1 痛点的最终修复——在带 chat session 上下文的访问下，project / sdk skills 真正能扫到
- **旧路由 reverse redirect**（保留一版兼容，下次清）：
  - `src/app/skills/page.tsx` → `redirect('/plugins#skills')`
  - `src/app/mcp/page.tsx` → `redirect('/plugins#mcp')`
  - `src/app/cli-tools/page.tsx` → `redirect('/plugins#cli')`
  - `src/app/plugins/mcp/page.tsx` → `redirect('/plugins#mcp')`（兼容老 helpers）
- **主导航整合**：
  - `NavRail.tsx` 删 `/skills` `/mcp` `/cli-tools` 三 nav item，加单个 `/plugins`（Plug 图标，label `nav.plugins`）
  - `ChatListPanel.tsx` 同款收敛
  - 清理两个文件未用 icon import (Lightning / Terminal)
- **i18n** zh + en 各加 6 keys：`nav.plugins` + `plugins.pageTitle` + `plugins.pageDescription` + 3 个 tab label

**测试**：
- `src/__tests__/unit/use-tab-from-hash.test.ts` 新建，6 用例：
  - readHashTab 覆盖空 hash / 有效 hash / 未知 hash / 带空格的 hash
  - history.replaceState 契约：切 Tab 调 replaceState 不调 pushState；hash 已匹配则 no-op
- 全量 `npm run test`：typecheck + 1389/1389 unit pass

**CDP 闭环验证**（dev server PORT=3001）：
- 直接访问 `/plugins#mcp` → MCP Tab 选中、内容正确渲染、console 干净
- Hash 切换：`/plugins#skills` → Skills tab 自动激活，URL hash 同步
- 旧路由 redirect 全部 work：`/skills` → `/plugins#skills`、`/mcp` → `/plugins#mcp`、`/cli-tools` → `/plugins#cli`
- **核心 picker 1:1 闭环验证**：进 chat session（`/chat/{id}`）→ 通过 NavRail 点击 `插件` → 服务端 log 看到 `GET /api/skills?cwd=%2FUsers%2Fop7418%2FDocuments%2Ftest-workspace2&sessionId=f45aea03... 200`——SkillsManager 真的拿到了 chat session 的 cwd + sessionId。如果该 cwd 下有 `.claude/commands` 或 `.claude/skills`，project 分组就会显示；如果当前 provider 注入了 SDK plugins，sdk 分组就会显示
- 主导航现在只剩单个「插件」入口，跟 chat / 项目 / 助理 / 素材库 / 远程桥接 等同级展示

**已知行为（非 bug）**：
- 直接访问 `/plugins#mcp` 时，hydration 期间会先闪一下默认 Skills tab，client mount 后 useEffect 切到 mcp。原因：SSR 拿不到 hash（hash 是纯 client fragment）。可接受——tab 切换是轻量内容渲染
- 直接打开 `/plugins`（不经过 chat session）的话，PanelContext 还是空 state，project / sdk 分组依然为空。**这不是 bug**——picker 1:1 的预期前提是「在 chat session 内打开扩展能力」（如同 picker 本身只在 chat session 内才有 cwd 一样）。Phase 2E 如果要进一步优化，可以在 ExtensionsPage 顶部 fetch 最近 chat session 作 fallback——本期不做
- 旧 `/plugins/mcp` 路由 redirect 是 client useEffect → router.replace，第一次访问会延迟 200ms（等 useEffect 跑），之前的 nav timeout 看起来是 dev server 的偶发慢响应；普通访问下 work

**截图**：
- `phase-2d-4-extensions-page-mcp-tab.png` — 直接访问 `/plugins#mcp`
- `phase-2d-4-extensions-with-session-context.png` — 从 chat session 进入后 Skills tab + sidebar 单一插件入口

### P2 修复 round（2026-05-01）— 单页 chrome 化后的三个交互回归

第一轮 ExtensionsPage 在每个 Tab 下分别挂自己的 manager（每个 manager 自带标题/搜索/创建按钮），导致页面重叠竞争。改成"单一 page chrome（标题 / filter pills / 全局搜索 / Create dropdown / More 菜单）+ 三个 manager 跑 `variant="embedded"`"之后，UX 测出三个回归：

| ID | 回归 | 根因 | 修复 |
|---|---|---|---|
| **P2-1** | 在 Skills/CLI tab 点 Create → "添加 MCP 服务器" 静默失败 | `mcpRef.current?.addServer()` 调用时 `<McpManager>` 还没挂载（只挂当前 filter 的 manager），ref 是 null | ExtensionsPage 引入 `pendingAdd` state；非目标 tab 时先 `setFilter("mcp")` 再排队 add，`useEffect` 等 manager 挂上后 `setTimeout(0)` 触发 |
| **P2-2** | 在 Skills/CLI tab 打开"更多 → MCP JSON 配置"显示空 `{}` | 老的 `mcpRef.current?.getServers()` 返回 null（同上 ref 不存在） | `McpJsonConfigDialog` 改成 self-fetch：dialog open 时直接 `fetch("/api/plugins/mcp")`，独立于 ref |
| **P2-3** | 顶部全局搜索框只 filter Skills，MCP/CLI 完全无视 | `<McpManager>`/`<CliToolsManager>` 没接 `search` prop，本身又有内部 section（内置 / 已安装 / 推荐） | 现阶段先把搜索框 `{filter === "skills" && (…)}` 隐藏在 MCP/CLI tab 上；让搜索对所有三个 surface 生效是一个独立 refactor，记到 follow-up |

**新增（用户体验建议）**：filter pills 显示分类数量（Skills 35 / MCP 2 / CLI 11）。

**改动文件**：
- `src/app/plugins/page.tsx` — 加 `pendingAdd` state + cross-tab create flow；搜索框包 `{filter === "skills"}`；3 个 count state + 渲染 `count` 在 pill 末尾；`SkillsManager.onCountsChange` 求和、`McpManager.onCountChange` 接 user-installed 数、`CliToolsManager.onCountChange` 接 installed (catalog + extra + custom) 数。`undefined` 表示未上报，pill 不渲染数字（避免 first-paint 假 0）
- `src/components/plugins/McpJsonConfigDialog.tsx` — 完全重写为 self-fetch；保留 `_source` 元数据合并语义（settings.json vs claude.json）；`onSaved?` 回调让 host 可在保存后刷新
- `src/components/plugins/McpManager.tsx` — 加 `onCountChange` prop + `useEffect` 上报 `serverCount`；`McpManagerHandle` 删 `getServers` / `saveJson`（dialog 自治后没人调用，handle 保留 `addServer` 即可）。内部 `handleJsonSave` 函数保留——standalone 变体的 ConfigEditor 仍引用它
- `src/components/cli-tools/CliToolsManager.tsx` — 加 `onCountChange` prop + `useEffect` 上报 `installedCount = catalog 已安装 + 系统检测 + 自定义`

**测试**：
- `npm run test`：1389/1389 pass（typecheck + 单测，包含 useTabFromHash 6 用例和其他既有 SkillsManager 测试）

**CDP 闭环（PORT=3001 重启清掉 i18n module cache 后）**：
- Skills tab：搜索框可见，"Skills 35"
- MCP tab：搜索框隐藏，"MCP 2" + 内置 7 + 已安装 2 + runtime 状态全部渲染
- CLI tab：搜索框隐藏，"CLI 工具 11" + 已安装 11 + 推荐若干
- Create dropdown 在 CLI tab 点"添加 MCP 服务器"→ URL 自动 `#mcp`、`<McpServerEditor>` 直接打开（**P2-1 验证**）
- 更多菜单在 Skills tab 点"MCP JSON 配置"→ Dialog 打开显示真实 chrome-devtools 配置 JSON（**P2-2 验证**）
- Console 干净：之前的 i18n hydration mismatch 已消失（dev server 重启后），仅剩 Dialog `aria-describedby` 既有 a11y warning（pre-existing，非本期回归）

**已知 follow-up（不在本期）**：
- 直接访问 `/plugins#mcp`（不经过 Skills tab）时 `Skills` pill 暂无 count——SkillsManager 没挂载 → 没 callback。需要做的话在 host 单独 fetch `/api/skills?cwd=…&sessionId=…` 算数，但成本翻倍；现阶段保持 lazy 上报

### P2 round 2（2026-05-02）— 状态同步 + tab-scoped search 闭环

R1 修完三条交互回归后，新一轮 review 又发现两条 P2 状态同步尾巴 + 三条 P2/P3 体验回退：

| ID | 现象 | 根因 | 修复 |
|---|---|---|---|
| **R2-P2-1** | 用新浏览器 tab 直接打开 `/plugins#cli`，pill 显示 `Skills 0 / CLI 工具 11`；切到 Skills 后才变 35 | hash 同步前首屏先按 `defaultTab="skills"` 渲染了一瞬 SkillsManager，那时 `skills=[]` 还在 loading；`onCountsChange` 不挑时机就把 0 上报，host 把 0 缓存住直到 SkillsManager 真正再挂载一次 | `SkillsManager.tsx:159-171` `useEffect` 加 `if (loading) return`；同步给 McpManager / CliToolsManager 的 count effect 加同样 loading guard，避免冷挂载抢先报 0 |
| **R2-P2-2** | MCP JSON 配置保存成功后，已安装列表 + MCP count 都不刷新，只能切走再切回来才恢复 | `McpJsonConfigDialog.onSaved` 回调原本是可选的；ExtensionsPage 没传，`McpManagerHandle` 也没暴露 refresh | `McpManagerHandle` 加 `refresh: () => Promise<void>`（直接复用内部 `fetchServers`）；`/plugins/page.tsx` 的 dialog 传入 `onSaved={() => mcpRef.current?.refresh()}`。CDP 验证：保存触发 `PUT /api/plugins/mcp 200` → 立刻 `GET /api/plugins/mcp 200`，UI 同步 |
| **R2-P2-3** | 搜索框只在 Skills tab 渲染，MCP/CLI tab 隐藏（上一轮的"避免假交互"补丁） | 上一轮直接按 `{filter === "skills" && (…)}` 包了搜索框，没让 MCP/CLI manager 接收 search 实际过滤 | 改成 tab-scoped：搜索框始终展示，placeholder 按 tab 切换（`plugins.search.placeholder.skills/mcp/cli` 三 keys）。三 manager 全接 `search` prop 并自己过滤：`McpManager` 过滤 user-installed servers + 把 search 透传给 `<BuiltInMcpSection>`；`CliToolsManager` 过滤 catalog installed / extra / custom / recommended 四组；空结果走统一 `plugins.search.noResults` 文案 |
| **R2-P3-1** | "更多"菜单只放 MCP JSON 配置，但在 Skills/CLI tab 上点开会突然跳进 MCP 高级配置 | `MoreMenu` 永远渲染 | 用 `{filter === "mcp" && <MoreMenu …/>}` 守门，"更多"只在 MCP tab 出现。JSON config 仍保留在 More 菜单（这是真正的 MCP 高级动作）；如果未来 Skills/CLI 也长出高级动作，再做 tab-aware menu 的扩展 |
| **R2-P3-2** | Browser console 仍有 Radix `DialogContent` `aria-describedby` warning | `McpJsonConfigDialog` + `McpServerEditor` 都没写 `<DialogDescription>` | 两个 dialog 都加 `<DialogDescription>` + i18n 副标（`plugins.more.mcpJson.description` / `mcp.editorDescription`），保存后 console clean |

**改动文件**：
- `src/components/skills/SkillsManager.tsx` — count effect gated on `!loading`
- `src/components/plugins/McpManager.tsx` — count effect gated on `!loading`；新增 `search` prop + 内部 `filteredServers` + 把 search 透传给 `<BuiltInMcpSection>`；`McpManagerHandle` 加 `refresh()`；导入 `BUILTIN_MCP_CATALOG` 用于精确判断空结果（仅在 built-in + installed 都 0 时才显示空状态）
- `src/components/plugins/BuiltInMcpSection.tsx` — 新增 `search?: string` prop；filter 跑在 `entry.name` + i18n `t(descriptionKey)`；空结果时整个 section 不渲染（避免 7-cell 空网格）
- `src/components/plugins/McpJsonConfigDialog.tsx` — 加 `<DialogDescription>` 引入 `plugins.more.mcpJson.description`
- `src/components/plugins/McpServerEditor.tsx` — 加 `<DialogDescription>` 引入 `mcp.editorDescription`
- `src/components/cli-tools/CliToolsManager.tsx` — count effect gated on `!loading`；新增 `search` prop + 四个 filtered 列表；空结果走 `plugins.search.noResults`
- `src/app/plugins/page.tsx` — 解开 R1 的 `{filter === "skills" && …}` 搜索 wrapper；placeholder 按 tab 切换；`<MoreMenu>` 用 `{filter === "mcp" && …}` 守门；`<McpJsonConfigDialog>` 传 `onSaved={() => mcpRef.current?.refresh()}`
- `src/i18n/{zh,en}.ts` — 各加 6 keys：3 个 placeholder + `plugins.search.noResults` + 2 个 dialog description

**测试**：
- `npm run test`：1389/1389 pass（无新增单测；改动主要是 prop 透传和 effect guard，覆盖在既有 SkillsManager / McpManager 测试 + smoke E2E 中）

**CDP 闭环（PORT=3001 重启 + 硬刷新后）**：
- 直接访问 `/plugins#cli`：pills 显示 `Skills` / `MCP` / `CLI 工具 11`——Skills/MCP 都隐藏数字（undefined），不会再卡 `Skills 0`
- 切到 Skills tab → pill 立刻变 `Skills 35`；切到 MCP tab → pill `MCP 2` + 7 个内置 + 2 个已安装全显
- 搜索 `git` 在 CLI tab → 已安装组只剩 Git + GitHub CLI，推荐组隐藏（`(query ? filteredRecommended.length > 0 : true)` 守门）
- 搜索 `chrome` 在 MCP tab → 内置 section 整个隐藏（无匹配），已安装显示 `(1 / 2)` 只剩 chrome-devtools
- "更多"菜单：在 Skills / CLI tab 不显示，切到 MCP 才出来；click MCP JSON 配置 → dialog title 下方有 `<DialogDescription>` 副标
- Save MCP JSON → 服务端 log 看到 `PUT /api/plugins/mcp 200` → 紧跟 `GET /api/plugins/mcp 200`（来自 `mcpRef.current?.refresh()`）
- Console clean：无 hydration mismatch、无 `aria-describedby` warning

**已知 follow-up（不在本期）**：
- Skills cold-load count："直接访问 /plugins#mcp 时 Skills pill 没数字"还是存在——R2-P2-1 修了 0 缓存的 bug，但要让 pill 在不挂载 SkillsManager 的情况下也显示真实数字，需要 host 自己 lazy fetch `/api/skills?cwd=…&sessionId=…`。代价：两份 fetch 路径要保持一致；本期不做
- 顶部"创建"按钮还是 dropdown，没有按当前 tab 偏向（用户体验建议）。可在 Phase 2E 做 split-button：主按钮文案随 tab 变化（"+ 新建 Skill / 添加 MCP / 添加 CLI 工具"），caret 仍然展开全套
- 每行更细粒度的状态标签（内置 / 项目 / SDK / Preview / 需配置）：是 ID 级别的设计，需要 5 类来源 → 状态映射表 + 统一 status pill 组件，本期保留分组小标题作为粗粒度标识

### P2 round 3（2026-05-02）— 数量语义 + CLI a11y + Editor i18n

3 条 review finding（2 P2 + 1 P3）的小收口：

| ID | 现象 | 修复 |
|---|---|---|
| **R3-P2-1** | MCP pill 显示 `2`，但页面同时展示 内置 (7) + 已安装 (2)。"扩展能力"语义下用户会自然把内置算成 MCP；现在 pill 像在数"外部 MCP"，没说清 | `McpManager.tsx` 上报 count 改成 `BUILTIN_MCP_CATALOG.length + serverCount`，pill 现在显示 `MCP 9`——和 Skills 35（包括 read-only plugin/sdk）保持"页面可见即计入"的统一语义。CLI 11 仍只算已安装（catalog 安装 + 系统检测 + 自定义），因为推荐组在用户认知里不是"已拥有" |
| **R3-P2-2** | CLI tab 的工具卡片是 `<div onClick>`，鼠标能用但键盘 / 读屏识别不到；和 Skills/MCP 一致用 `<button>` 不一致 | `CliToolCard.tsx`、`CliToolsManager.tsx` 中的 catalog / 系统检测 / 自定义 三组卡片统一加 `role="button"` + `tabIndex={0}` + `onKeyDown`（Enter / Space）+ `aria-label`（name + 描述）+ `focus-visible:ring-2`。内嵌的 安装 / Trash 按钮已经 `e.stopPropagation()`，无需改动。CDP 验证：a11y tree 现在把每张卡片报告为 `button "FFmpeg — 音视频处理瑞士军刀..."` 而不是匿名 `div` |
| **R3-P3-1** | `McpServerEditor` + `McpJsonConfigDialog` 还有英文硬编码：`Edit Mode:` / `Server name is required` / `JSON must be an object` / `Command is required for stdio servers` 等 11 处 | i18n zh + en 各加 11 keys（`mcp.editor.editMode` / `serverConfig` + 9 个 `mcp.editor.error.*`），编辑器全部走 `t()`。CDP 验证：中文环境 dialog 显示 `编辑模式:`，name 必填错误显示 `服务器名称必填` |

**改动文件**：
- `src/components/plugins/McpManager.tsx` — `onCountChange` callback 上报 `BUILTIN_MCP_CATALOG.length + serverCount`；prop 注释从"counts only settings.json + claude.json"改成"sums built-in + installed"
- `src/components/cli-tools/CliToolCard.tsx` — `<div>` → `role="button" tabIndex={0} onKeyDown={Enter|Space} aria-label`
- `src/components/cli-tools/CliToolsManager.tsx` — extra-detected + custom 两组 div 同样改造；自定义工具的 click handler 抽成 `openCustomDetail` const 给 onClick / onKeyDown 共用
- `src/components/plugins/McpServerEditor.tsx` — 11 处 hardcoded → `t('mcp.editor.*')`
- `src/components/plugins/McpJsonConfigDialog.tsx` — `JSON 解析失败` 改用 `t('mcp.editor.error.jsonInvalid')` 共享
- `src/i18n/{zh,en}.ts` — 各 +11 keys

**测试**：`npm run test` 1389/1389 pass。

**CDP 验证（PORT=3001 reload + 硬刷新后）**：
- `/plugins#mcp` pill：`MCP 9`，body 仍显示 内置 (7) + 已安装 (2)
- `/plugins#cli` a11y tree：每张已安装/推荐卡片都报告为 `button "<name> — <description>"`
- 添加 MCP 服务器 dialog：`编辑模式:` 替代 `Edit Mode:`，空 name 直接保存触发 `服务器名称必填` 红字
- Console clean（无 hydration mismatch、无 a11y warning）

### P3 round 4（2026-05-02）— a11y 收尾（图标按钮 + Marketplace 描述）

3 条 P3 a11y polish：

| ID | 现象 | 修复 |
|---|---|---|
| **R4-P3-1** | CLI 推荐组的安装图标按钮（Plus / CaretDown）只有 `title`，读屏听到的就是个空 button | `CliToolCard.tsx` 安装按钮加 `aria-label={\`${t('cliTools.install')} ${tool.name}\`}` 同步 title。a11y tree 现在报告 `button "安装 ripgrep"` / `button "安装 yt-dlp"` 等 |
| **R4-P3-2** | 自定义 CLI 工具行右侧 Trash 图标按钮也只有 `title` | `CliToolsManager.tsx` 自定义 Trash 按钮加 `aria-label={\`${t('cliTools.removeCustomTool')} ${ct.name}\`}` 同步 title。已经 stopPropagation，无影响 |
| **R4-P3-3** | `MarketplaceDialog` 没有 `<DialogDescription>`，Radix 仍可能报 `aria-describedby` warning | 加 `<DialogDescription>` + 新 i18n key `skills.marketplaceDescription` ("浏览并安装可用的 Skill 扩展，安装后会立即出现在'已安装'分组中。") |

**改动文件**：
- `src/components/cli-tools/CliToolCard.tsx` — 安装按钮加 aria-label（与 title 同模板）
- `src/components/cli-tools/CliToolsManager.tsx` — 自定义 Trash 按钮加 aria-label（与 title 同模板）
- `src/app/plugins/page.tsx` — 引入 `DialogDescription`，`<MarketplaceDialog>` 加描述
- `src/i18n/{zh,en}.ts` — 各 +1 key (`skills.marketplaceDescription`)

**测试**：`npm run test` 1389/1389 pass。

**CDP 验证**：CLI tab a11y tree 显示 `button "安装 ripgrep"` 等所有安装按钮带 tool 名；Marketplace dialog `description=` 属性 + 描述文本可见；console clean

### P2 round 5（2026-05-02）— Skills 商店从隐藏入口恢复成 Skills tab 一等动作

**回归本身**：上一轮把 Skills 商店收进了全局「创建 → 从市场安装 Skill」下拉，旧的 `/skills` 页面里它原本是页面级显性按钮。结果是"代码功能在，用户层面丢了"——Skills tab 内部找不到商店入口，用户不会习惯性去点页面级 Create。这是产品决策错位，不是功能缺失。

**修复（按用户原话"Skills tab 下固定露出技能商店"）**：
- `src/app/plugins/page.tsx` 在搜索框右侧加一个 `{filter === "skills" && <Button>}` 守门的「技能市场」按钮（Storefront 图标 + outline variant + h-8 与搜索框对齐）。点击直接打开 `<MarketplaceDialog>`，和 Create 下拉的"从市场安装 Skill"走同一个 state
- 全局 Create 下拉里的 marketplace 项保留——既是兜底也是统一入口语义；只是不再把它当成 Skills 的主路径
- 不引入新 i18n key，复用已有的 `skills.marketplace`（"技能市场"/"Skill Marketplace"）

**验证**：
- 切到 Skills tab：搜索框右侧出现「技能市场」outline 按钮；切到 MCP/CLI tab：按钮消失（filter 守门）
- 点击按钮 → `<MarketplaceDialog>` 打开，title `技能市场` + description `浏览并安装可用的 Skill 扩展...`
- 全局 Create 下拉的"从市场安装 Skill"仍然 work（备用入口）

**改动文件**：仅 `src/app/plugins/page.tsx`（约 14 行，import `Storefront` 已经在；按钮 wrapper 加在 search div 之后）

**测试**：`npm run typecheck` pass。

**反思**（值得记 feedback）：合并多个旧管理页时，"原来在哪里、点几下能到"是用户记忆的入口；不能仅以"代码里还在/可达"为标准衡量入口是否丢失。下次类似收口先列出每个旧页面的"显性主动作 + 二级入口"，并保证至少主动作在统一壳里仍然显性可见，再合并。

### P2 round 6（2026-05-02）— 信息架构两层化（Tabs / 当前 Tab action bar 分层）

**决策**：插件页采用"两层结构"——第一层只放分类切换（Tabs），第二层放当前分类的操作（搜索 + 主动作 + 必要时的次级动作）。这取代了上一轮里"Tab + 全局 Create dropdown + 顶部标题"的拥挤布局。理由：

- `/plugins` 是 Settings 内页，左导航的"插件"标签已经告诉用户在哪儿；再加一行 `<h1>扩展能力</h1>` + 描述文案是噪声不是锚点
- 全局 `+ 创建` 下拉里的 4 个 entry 实际上一半属于 Skills、一半属于 MCP/CLI；用户在 Skills tab 里找不会想到"我得点页面级 Create 才能创建 Skill"
- 同一行同时挤 Tabs + 搜索 + 创建按钮 + 更多菜单，每加一个 tab-aware 控件就要再加一个 filter 守门，结构很快撑不住

**新布局**：
- **Row 1**：仅 Tabs。`Skills 35 | MCP 9 | CLI 工具 11`，每个 tab 自带 count 子节
- **Row 2**：`<CurrentTabToolbar>` 组件，按 filter 渲染：
  - **Skills**：`搜索 Skills...` + `+ 新建 Skill`（primary）+ `🛒 技能市场`（outline）
  - **MCP**：`搜索 MCP 服务器...` + `+ 添加 MCP 服务器`（primary）+ `</> MCP JSON 配置`（outline）
  - **CLI**：`搜索 CLI 工具...` + `+ 添加 CLI 工具`（primary）
- **Body**：仍然只渲染当前 manager 的列表

**删除的东西**：
- 顶部 `<h1>扩展能力</h1>` + 描述段落（页面已经够清晰）
- 全局 `<CreateDropdown>` + `<MoreMenu>` 两个 helper 组件（IA refactor 后没人用了，整体删除）
- `pendingAdd` cross-tab 排队 state + 它的 useEffect（不再有跨 tab 触发的场景：每个 tab 的主动作就在自己 toolbar 里）
- `DotsThree` 图标 import（More 菜单跟着没了）
- `DropdownMenu*` 全套 import

**改动文件**：仅 `src/app/plugins/page.tsx`。主要 diff：
- import 列瘦身（去掉 DropdownMenu 五件套 + DotsThree）
- ExtensionsPage 主组件去掉 title/description 整块 + CreateDropdown/MoreMenu 调用 + pendingAdd state + triggerAddMcp/triggerAddCli 包装函数
- header 改成 `space-y-3`，Row 1 是 inline-flex Tab 容器，Row 2 是新增的 `<CurrentTabToolbar>` 调用
- 新增 `<CurrentTabToolbar>` 子组件（约 70 行），按 filter 决定渲染哪几个按钮，搜索框 `flex-1 min-w-[180px] max-w-md`，按钮组 `ml-auto shrink-0`，整体 `flex-wrap` 让窄宽度可以换行
- 删除 `<CreateDropdown>` + `<MoreMenu>` 两个内部组件定义（约 60 行）
- `<MarketplaceDialog>` 内部组件保留，只是入口改成 toolbar 直接调用

**验收**（已 CDP 验证）：
- `/plugins#skills`：Row 1 仅 Tabs；Row 2 搜索 + 新建 Skill + 技能市场（pressed Skills 35）
- `/plugins#mcp`：Row 1 仅 Tabs；Row 2 搜索 + 添加 MCP 服务器 + MCP JSON 配置（pressed MCP 9）
- `/plugins#cli`：Row 1 仅 Tabs；Row 2 搜索 + 添加 CLI 工具（pressed CLI 工具 11）
- 「技能市场」不再藏在任何下拉里——它在 Skills toolbar 里就是一个普通按钮
- `npm run test`：1389/1389 pass
- Console clean（无 Radix / a11y warning）

**已知不在范围**：
- 行级状态 pill（内置 / 项目 / SDK / 外部 / Preview / 需配置）：跨 manager 的设计统一动作，需要 5 类来源 → 状态映射表 + 共用 status pill 组件
- 移动端 Tab 行的折叠（极窄宽度可能滚动）：现阶段保留默认 inline-flex 行为

### MCP 卡片统一 round（2026-05-02）— 内置 vs 已安装交互对齐

**问题**：MCP tab 上两类卡片以前互不一致——内置卡点击进只读详情，用户安装卡却把"编辑/删除"画在卡角小图标，pills 也分两行；用户在 8 张卡片之间扫一眼根本看不出他们是同一组东西。

**修复**：

| 维度 | 之前 | 之后 |
|---|---|---|
| 用户安装卡：点击行为 | 整卡不可点；只能点角落"笔/垃圾桶"图标 | 整卡 `role="button"`，键盘 / 读屏 / 鼠标都能进入详情 |
| 详情入口 | 没有，编辑/删除藏在卡角 | 点卡 → 新 `<McpServerDetailDialog>`，单一 dialog 内两 mode 切换：`detail`（信息 + 编辑/删除 footer）/ `edit`（form + 取消/保存 footer），跟之前 marketplace 同样的"原地切换不叠弹窗"模式 |
| 删除 | 卡角直接执行 | detail footer 「删除」→ `<AlertDialog>` 二次确认（"删除 X？" + 文案插值），避免误触 |
| 编辑 | 卡角点笔图标 → 单独的 `<McpServerEditor>` Dialog | detail dialog 「编辑」→ 同一个 dialog 切换到 edit mode（form 预填当前值，name 锁定）；保存后关 dialog；取消回 detail mode |
| 工具数量 | 内置卡显示 `7 个工具`，用户安装卡完全没有 | 用户安装卡读 `runtime.tools?.length`（来自 SDK `McpServerStatus.tools[]`），连接成功时显示 `N tools`；未连接则不显示 |
| 标签位置 | 内置卡 inline，用户安装卡换行 | 全部 inline：name 后跟 transport pill + status pill + tool count，两类卡片视觉读起来一致 |
| 开关 | 用户安装卡保留 | 保留，且 `onClick={(e) => e.stopPropagation()}` 防止切开关时不小心打开详情 |

**新文件**：
- `src/components/plugins/McpServerEditorForm.tsx`（约 280 行）— 编辑 form 抽出来的 headless 组件。fields + 内部状态 + 校验 + `submit()` ref。`McpServerEditor`（add Dialog）和 `McpServerDetailDialog`（edit mode）都用它，避免 ~250 行重复
- `src/components/plugins/McpServerDetailDialog.tsx`（约 220 行）— 新建的 detail/edit 两 mode dialog。复用 `<McpServerEditorForm>` 做 edit mode

**改动文件**：
- `src/components/plugins/McpServerEditor.tsx` — 从 ~390 行内联 form 缩成 ~75 行 Dialog 包装器，调用 `<McpServerEditorForm>`。Editor 现在只负责 add 流程的弹窗外壳
- `src/components/plugins/McpServerList.tsx` — props 从 `onEdit + onDelete` 改成 `onOpenDetail`；卡片整体加 `role="button" + tabIndex + onKeyDown + aria-label`；transport / status / tool count 全部 inline；导出 `McpRuntimeStatus` 类型（含 `tools?: { name; description? }[]`）供 manager + detail dialog 共享
- `src/components/plugins/McpManager.tsx` — 老 `handleSave` 拆成 `persistSave(originalName, name, server)` 纯逻辑函数 + `handleAddEditorSave` 桥接；新增 `detailOpen / detailName / detailServer` state + `handleOpenDetail`；两处 `<McpServerList>` 调用改用 `onOpenDetail={handleOpenDetail}`；mount `<McpServerDetailDialog>` 在 embedded + standalone 两条路径
- `src/i18n/{zh,en}.ts` — 新增 7 keys：`mcp.detail.commandHeading` / `toolsHeading` / `toolsUnavailable` / `disabled` / `deleteConfirm.title`（含 `{name}` 占位符）/ `deleteConfirm.description`（同样）/ `mcp.toolCount`

**测试**：`npm run test` 1389/1389 pass。

**CDP 验证**（PORT=3001 reload 后）：
- `/plugins#mcp` 已安装组：`button "chrome-devtools — stdio"` + `button "deepwiki — HTTP"` 两张整卡都是 button role，switch 嵌套但 click 隔离
- 点击 chrome-devtools → 单一 `dialog "chrome-devtools" description="命令 / URL"` 打开，header inline `chrome-devtools` + `stdio` pill；body 显示 `npx -y chrome-devtools-mcp@0.20.3 --headless` + 工具区 fallback 文案 "当前会话未连接到这个服务器，无法读取工具列表。"；footer 左 `删除`、右 `编辑`
- 点 `编辑` → 同一个 dialog 标题 `chrome-devtools` 不变，body 切换成 form（`服务器名称 disabled=chrome-devtools` + 表单/JSON toggle + stdio tablist + 命令 npx + 参数 `-y / chrome-devtools-mcp@0.20.3 / --headless`），footer 切成 `取消 / 保存更改`，dialog 描述也同步切到 editor description
- 点 `取消` → 同一 dialog 切回 detail mode，footer 切回 `删除 / 编辑`
- 点 `删除` → `<AlertDialog>` 弹出 `删除 chrome-devtools？` + 详细描述（name 已正确插值），`取消 / 删除` 二次确认
- Console clean

**关闭范围**（不在本期）：
- 内置卡的 `<BuiltInMcpDetailDialog>` 没改 — 已经是只读 detail 模式，跟新的 user-installed detail dialog 在视觉/交互上同构（都是 click → detail dialog → 关闭）
- standalone variant 的 `/mcp` 老页面继续 work（变体已少有人访问，redirect 到 `/plugins#mcp`），但保留兼容 — JSON tab 里的 `<ConfigEditor>` 仍然引用内部 `handleJsonSave`

---

## Phase 2D.4 — 导航整合（原计划）

### 用户痛点

主导航当前同时有 `Skills` / `MCP` / `CLI 工具` 三个独立入口。整合到一个"插件"入口下后，旧入口需要收掉，避免用户两条路径找同一个东西。

### 现状（survey + 现场核实）

- 主导航位置：含 link 到 `/skills` / `/mcp` / `/cli-tools`
- 各自独立 page：`src/app/skills/page.tsx` / `src/app/mcp/page.tsx` / `src/app/cli-tools/page.tsx`
- **历史兼容入口（v2 修正 P3）**：
  - `src/app/plugins/page.tsx` 当前是 client-side redirect → `/skills`
  - `src/app/plugins/mcp/page.tsx` 当前是 client-side redirect → `/mcp`
  - 也就是说 `/plugins` 路径**已被占用**（作为 redirect 站），本期把它升级成真页面，方向是反过来——旧的 `/skills` `/mcp` `/cli-tools` 反向 redirect 到 `/plugins#xxx`
- e2e helpers 已硬编码这些路径：
  - `src/__tests__/helpers.ts:51` `goToPlugins(page)` → `/plugins`
  - `src/__tests__/helpers.ts:58` `goToMCP(page)` → `/plugins/mcp`
  - `src/__tests__/smoke-test.ts:26-27` 测 `/plugins` 和 `/plugins/mcp`
  - `src/__tests__/targeted-test.ts:94 / :126` 同上

### 改动范围

**做**：
- 主导航：删 Skills / MCP / CLI 工具三个独立 nav item，新增"插件"item 指向 `/plugins`
- **`src/app/plugins/page.tsx`**：从 `redirect → /skills` 改成真页面（ExtensionsPage 容器，标题"扩展能力" + 三 Tab）
- **`src/app/plugins/mcp/page.tsx`（v2 修正 P3）**：从 `redirect → /mcp` 改成 `redirect → /plugins#mcp`，作为兼容入口保留一段时间。下个 release 直接删
- 三个旧顶层 page 反向 redirect：
  - `src/app/skills/page.tsx` → `redirect('/plugins#skills')`
  - `src/app/mcp/page.tsx` → `redirect('/plugins#mcp')`
  - `src/app/cli-tools/page.tsx` → `redirect('/plugins#cli')`
- **Tab state 走 URL hash（v2 修正 P2-2）**：
  - hash 是纯 client-side fragment，server / Next `useSearchParams` 拿不到
  - 实现：mount 后 `useEffect` 读 `window.location.hash` → 解析成 `'skills' | 'mcp' | 'cli'`（无效 / 缺失 → 默认 `'skills'`）
  - 切 Tab 时用 `history.replaceState(null, '', '#mcp')`，避免每次 push 一条历史栈
  - 监听 `hashchange` 事件以覆盖浏览器前进 / 后退（用户从 mcp Tab 后退到 skills Tab 时同步）
  - 注意：Next App Router hydration 期间 server-render 默认 Tab（`'skills'`），client mount 后才能读到 hash——所以直接访问 `/plugins#mcp` 会先闪 skills Tab → mount 后切到 mcp。这个 flicker 可接受（Tab 切换是轻量内容渲染）；如果嫌闪可加 `suppressHydrationWarning` + 默认 `<div />` 占位
- 更新 e2e helpers：
  - `goToMCP(page)` 改成 `await page.goto('/plugins#mcp'); await waitForPageReady(page)`
  - 保留 `goToPlugins`（仍 `/plugins`，行为变了但 helper 名字不变）
  - 旧的 smoke-test.ts / targeted-test.ts 引用 `/plugins/mcp` 的处保留（验证 redirect 仍 work）但新增 `/plugins#mcp` 直接访问的 case
- i18n：导航 label `nav.plugins`「插件」/「Plugins」；页面标题 `plugins.pageTitle`「扩展能力」/「Extensions」

**不做**：
- 不删除旧 `src/app/{skills,mcp,cli-tools}/page.tsx` 文件（保留 redirect；下个版本再清）
- 不删除 `src/app/plugins/mcp/page.tsx`（保留 redirect 一段时间；下个版本再清）
- 不改各 Tab 内容（前面 phase 已做）
- 不引入 cross-Tab 共享 state

### 拆分

- **A.** 升级 `src/app/plugins/page.tsx` 从 redirect 改成真页面（ExtensionsPage 容器）
- **B.** ExtensionsPage 组件：tab strip + Tab content area（用现有 `tabs.tsx` ui primitives）
- **C.** Tab state hook：`useTabFromHash()` 内部处理 mount-read-hash + hashchange listener + replaceState 切换
- **D.** 旧 route redirect：`src/app/skills/page.tsx` 等改为 `redirect('/plugins#skills')`；`src/app/plugins/mcp/page.tsx` 改为 `redirect('/plugins#mcp')`
- **E.** 主导航 nav item 替换
- **F.** 更新 e2e helpers + 新增 `/plugins#mcp` 直接访问的 hydration smoke case
- **G.** i18n
- **H.** 单测：
  - `useTabFromHash` 单测：mount 时读 `window.location.hash`、监听 hashchange、切 Tab 调 replaceState
  - 直接访问 `/plugins#mcp` 后页面选中 MCP Tab（hydration 后断言）

### 验收

- 主导航只剩"插件"一个入口
- `/plugins` 加载 ExtensionsPage，三 Tab 可切换
- 直接访问 `/plugins#mcp` hydration 完成后选中 MCP Tab（先短暂闪 skills 可接受）
- 浏览器前进 / 后退切换 hash → Tab 同步
- 旧 URL `/skills` / `/mcp` / `/cli-tools` redirect 到对应 `/plugins#xxx`
- 兼容入口 `/plugins/mcp` redirect 到 `/plugins#mcp`
- e2e helpers 都更新，旧 smoke 仍通过
- `npm run test` 通过；CDP smoke：三 Tab 切换 + 直接 hash 访问 + 浏览器后退

### 风险

- Hydration flicker 不可避免（hash 是 client-only）——如果用户感觉闪得难受可加 hydration suspense；本期接受默认行为
- ExtensionsPage 容器布局调整可能影响各 Tab 内子组件（高度 / 滚动行为）——CDP 验证三个 Tab 长内容时滚动正常
- "插件"这个词在中文里和"plugin"语义略有重叠（plugin 已经是 Skills 的一类 source）。如果后续发现混淆，本计划允许把 nav label 改为别的词（"扩展" / "工具箱"）；改文案不需要重做实现

---

## Phase 2D.5（事实核准任务）— Settings 4 features 真实状态盘点

> **本期不动 UI**——仅做事实核准。徽章 / 隐藏 等 UI 决策等核准结论后另议（可能合并到 Phase 2E）。

### 用户痛点

Survey 跟 plan doc 之间有冲突：
- `docs/exec-plans/superseded/scheduled-tasks-notifications.md` 顶部状态表 Phase 1-4 全部 "📋 待开始"
- 代码 survey 找到：`task-scheduler.ts` 实现 + 单测 + `notification-mcp.ts` exposes 4 tools + `AssistantWorkspaceSection.tsx:543-585` 有 list + delete UI

**真实情况不明**——直接给 Settings 打 stable 徽章会继续误导；先核准。

P2-4 反馈采纳：先核准事实再做 UI 决策。

### 改动范围

**做**：
- 核准 4 个 feature 的真实状态：Heartbeat / Scheduled Tasks / Buddy / Memory
- 每个 feature 跑核准清单：
  1. 持久化（DB schema 是否真在；migration 是否落了）
  2. 实际触发（scheduler 真的轮询？hatch 真写 state.json？heartbeat 真写 lastHeartbeatDate？）
  3. 失败状态（指数退避真的工作？退避后真能恢复？）
  4. 通知投递（Electron / Toast / Telegram 哪条真投递？）
  5. UI 管理（list / delete / toggle 真改 backend？）
- 用一次实际跑通的 smoke（chat 里调用 codepilot_schedule_task → 等触发 → 看通知 → 看日志）
- 把核准结论写入：
  - `docs/exec-plans/superseded/scheduled-tasks-notifications.md` 顶部状态表（如果实际已交付，状态表得更新）
  - `docs/research/settings-feature-stability-audit-2026-04-30.md` 新文件，含每个 feature 的清单结果 + 建议分类（stable / preview / hidden）
- 把 doc-vs-code 漂移记入 tech-debt tracker

**不做**：
- 不打稳定性徽章（UI 决策推迟）
- 不改 Settings 面板
- 不修 Memory 自动索引（infrastructure 缺口）
- 不改 Overview 文案（本期）

### 拆分

- **A.** Heartbeat 跑通：toggle on → 不 check-in → 验 system prompt 注入 → 反 toggle off → 验不注入
- **B.** Scheduled Tasks 跑通：在 chat 里 `codepilot_schedule_task` schedule 一个 1 分钟后的任务 → 等触发 → 看 task_run_logs → 看通知（Electron / Toast）→ 验失败退避（schedule 一个故意失败的任务）
- **C.** Buddy 跑通：fresh workspace → hatch → 验 state.json + soul.md mutation + 后续对话语气受影响
- **D.** Memory 跑通：尝试触发 memory-extractor → 确认是否真的从 chat 自动写 memory（**预期：不会**，只有 check-in 才写）→ 确认 codepilot_memory MCP search 能不能搜到这些（**预期：能**）
- **E.** 写 audit 报告
- **F.** 更新过期 plan docs
- **G.** tech-debt 加条目

### 验收

- Audit 报告交付到 `docs/research/settings-feature-stability-audit-2026-04-30.md`
- 4 个 feature 的真实分类有证据支撑（"它是 stable 因为 X 验证过 Y" 或 "它是 preview 因为 Z 缺失"）
- `scheduled-tasks-notifications.md` 状态表更新（如果代码已交付）
- tech-debt tracker 加 doc-drift 条目

### 风险

- 跑通可能耗时（Scheduled Tasks 等触发要分钟级）——audit 单独 phase 不阻塞 UI 整合
- 可能发现 Memory 的 MCP 在某些情况下不工作——本期只记录，不修

---

## 决策日志

- **2026-04-30 v2 顶层方向**：从"5 个独立 cleanup"改为"Extensions 整合 + 5 sub-phase"。理由：用户希望减少导航碎片，且 Skills / MCP / CLI 修复都涉及"页面 chrome 重复"问题——一次整合比多次小修更连贯。
- **2026-04-30 v2 Design Agent 清理放在 2D.0**：后续 phase 的内置 MCP catalog 描述会引到 image-gen——先把 imageAgentMode 死分支清掉，描述就不必兼容已经不存在的特殊路径。
- **2026-04-30 v2 Project skills 不一刀切 read-only（P2-1）**：用户原话——project 来源里包含 `.claude/commands` 和 `.claude/skills`，是用户项目资产；按文件 writability 决定可不可编辑。SDK skills 仍 read-only（不归 CodePilot 管）。
- **2026-04-30 v2 内置 MCP 不做实时注入状态（P2-2）**：keyword-gating 是消息级动态。要做实时 status 需在 `claude-client.ts:700-823` 注册时发事件给前端，超出 cleanup scope。本期只展示静态触发条件 + 明确"不保证已注入"。实时状态作为 follow-up 列入"不在范围"。
- **2026-04-30 v2 CLI Tab 加 freshness audit（P2-3）**：用户提到 CLI 长期未更新。本期跑一次 catalog audit + 标"最后人工核对日期" + 把 update 缺口诚实暴露——不假装 production-ready。catalog 自动校验 CI 作为长期债务记入 tracker。
- **2026-04-30 v2 Settings 分层降级为事实核准（P2-4）**：plan doc（scheduled-tasks-notifications.md）说"待开始"但代码已实现——doc-vs-code 漂移让 stable 判定不可信。先核准再决定徽章；本期不动 UI。
- **2026-04-30 v2 不在 base system prompt always-advertise capability**：用户原话「让模型知道存在设计/媒体生成能力」。当前 keyword-gated 实现已经是 capability injection 模式——keyword 命中时 append 对应 system prompt + register MCP。改成 always-advertise 会让每次请求都 register 全部 MCP，token 成本上去 + 模型决策面变大。**保持 keyword-gated 是对的**，删 ghost flag 就够。
- **2026-04-30 v2 Tab state 走 URL hash 而不是 search params**：hash 不会触发 server roundtrip；适合纯前端 tab 切换。redirect 旧 URL 时用 hash 形式（`/plugins#skills`）保留来源 context。
- **2026-04-30 v2 hash 实现走 window.location.hash 而非 useSearchParams（P2-2 修正）**：Next App Router 的 `useSearchParams` / `usePathname` 都不含 `#fragment`，server 也拿不到 hash。实现必须 client-only：mount 后 `useEffect` 读 `window.location.hash`、监听 `hashchange`、切 Tab 用 `history.replaceState`。直接访问 `/plugins#mcp` hydration 期间会先闪默认 Tab → mount 后切——可接受。
- **2026-04-30 v2 旧 /plugins/mcp 反向 redirect（P3 修正）**：`/plugins/mcp` 当前 client redirect → `/mcp`；本期把 `/plugins` 升级成真页面后，`/plugins/mcp` 改成 `redirect → /plugins#mcp`，配合 e2e helpers 一并更新。下个 release 再彻底删。
- **2026-04-30 v2 Skills 行级管理走显式语义字段（P2-1 修正）**：API 不返 `writable: boolean`（不够语义），返 `editable: boolean` + `readOnlyReason?: 'sdk' | 'file_not_writable' | 'out_of_cwd'`。服务端做归属 + 权限判断（fs.access W_OK + cwd 子树检测），前端只读不复算。

## 不在范围内（明确推迟）

- **统一启用开关**——不引入「插件总开关」，每个 Tab 内部各自管
- **数据模型合并**——Skills / MCP / CLI 仍各走各的 API + DB，不引入 unified registry
- **可编辑内置 MCP server**——内置能力是 CodePilot 核心交互，不下放编辑权
- **CLI update endpoint**——通过 cli-tools MCP 已能完成；新做 endpoint 是产品扩张
- **MCP reconnect 实现修复**——根因在 mcp-connection-manager，本期只标 preview + 加 server-not-found 防御
- **MCP 内置能力实时注入状态**——keyword-gating 动态，需要新事件机制；本期只静态描述
- **Memory 面板 / 自动索引**——infrastructure 待 follow-up
- **Buddy 交互扩展**——当前自动 evolve 工作正常，UI 不缺
- **Skills marketplace 改造**——本期只修管理页 vs picker 一致性
- **MCP catalog 配置化**（让用户编辑 keyword）—— 内置触发条件由代码决定，不下放
- **CLI catalog 自动校验 CI**——长期债务记入 tracker
- **Settings 稳定性徽章 UI**——等 2D.5 核准结论后再决定，可能合并到 Phase 2E

## 反向引用

- 上一阶段：[chat-run-checkpoint.md](../deferred/chat-run-checkpoint.md)（Round 1+2 完成，Round 3 暂缓）
- Settings IA 历史：见 `../completed/settings-ia.md`（Phase 2C.1-2C.6 已完成）
- Scheduled Tasks 老 plan：[scheduled-tasks-notifications.md](../superseded/scheduled-tasks-notifications.md)（状态表跟代码现实有漂移，本期 2D.5 核准）
- 内置 MCP 数据来源：`src/lib/{memory-search,notification,cli-tools,dashboard,media-import,image-gen}-mcp.ts` + `src/lib/widget-guidelines.ts`
- 注册逻辑入口：`src/lib/claude-client.ts:700-823`
