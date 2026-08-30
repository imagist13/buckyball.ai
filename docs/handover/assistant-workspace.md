# 助理工作区 — 交接文档

## 概述

助理工作区让用户指定一个目录存放 AI 人格/记忆文件（soul.md、user.md、memory.md、claude.md），在助理项目会话中自动注入系统提示词。附带对话式引导问卷（13 题）和每日轻量问询（3 题）。V2 新增索引/检索/分类/组织能力。

## 目录结构

```
workspace/
├── claude.md              # 执行规则
├── soul.md                # 人格风格
├── user.md                # 用户画像
├── memory.md              # 长期记忆（append-only，去重保护）
├── README.ai.md           # 自动生成的目录概览
├── PATH.ai.md             # 自动生成的路径索引
├── Inbox/                 # 默认捕获目录
├── memory/
│   └── daily/             # 每日记忆（episodic，按日期命名）
│       ├── 2026-03-05.md
│       └── archive.md     # 过期日记的摘要归档
└── .assistant/
    ├── state.json         # 状态持久化（schemaVersion: 2）
    ├── config.json        # 工作区配置（组织方式、归档策略、索引参数）
    ├── taxonomy.json      # 分类体系（目录角色推断 + 演化建议）
    └── index/
        ├── manifest.jsonl # 文件级元数据索引
        ├── chunks.jsonl   # Markdown 分块索引
        └── hotset.json    # 高频访问文件（pinned + frequent）
```

## 核心模块

### `src/lib/assistant-workspace.ts`（V1 + V2）

| 函数 | 职责 |
|------|------|
| `validateWorkspace(dir)` | 检查目录和文件状态 |
| `initializeWorkspace(dir)` | 补建缺失模板 + state.json + V2 目录 |
| `loadWorkspaceFiles(dir)` | 读核心文件 + 每日记忆 + 根文档 |
| `assembleWorkspacePrompt(files, retrievalResults?)` | XML 标签拼接，按预算分配（总上限 40000 chars） |
| `loadState(dir)` / `saveState(dir, state)` | 读写 `.assistant/state.json` |
| `needsDailyCheckIn(state)` | 判断是否需要每日问询 |
| `generateDirectoryDocs(dir)` | 扫描子目录生成 README.ai.md + PATH.ai.md |
| `generateRootDocs(dir)` | 生成根级 README.ai.md + PATH.ai.md |
| `ensureDailyDir(dir)` | 确保 `memory/daily/` 目录存在 |
| `writeDailyMemory(dir, date, content)` | 写每日记忆文件 |
| `loadDailyMemories(dir, count)` | 加载最近 N 天的每日记忆 |
| `migrateStateV1ToV2(dir)` | V1→V2 自动迁移 |

### `src/lib/workspace-config.ts`（V2 新增）

工作区配置管理。`loadConfig()` 读取 `.assistant/config.json`，与 `DEFAULT_CONFIG` 深合并。配置项包括：

- `organizationStyle`：project / time / topic / mixed
- `captureDefault`：新信息默认存放目录
- `archivePolicy`：归档天数、是否自动归档
- `ignore`：索引忽略的 glob 模式
- `index`：分块大小、最大深度、文件大小上限

### `src/lib/workspace-taxonomy.ts`（V2 新增）

分类体系推断。从目录名映射已知角色（notes/project/journal/archive/inbox 等），按 confidence 评分。`classifyPath()` 按最长路径前缀匹配分类。

### `src/lib/workspace-indexer.ts`（V2 新增）

Markdown 索引引擎。

| 函数 | 职责 |
|------|------|
| `indexWorkspace(dir, { force? })` | **增量**索引：比较 mtime 跳过未变文件，仅重索引 stale 文件 |
| `indexFile(dir, filePath)` | 单文件索引：frontmatter 解析 + 分块 + 分类 |
| `chunkMarkdown(content, size, overlap)` | 按 heading 切 section，大 section 滑窗分块 |
| `extractMarkdownMeta(content)` | 提取 title/tags/headings/aliases |
| `loadManifest(dir)` / `loadChunks(dir)` | 读取 JSONL 索引文件 |
| `getIndexStats(dir)` | 统计文件数/分块数/stale 数 |

**增量索引机制**：每次聊天开始时自动调用（在检索之前），对未变文件复用已有 manifest/chunks 条目，仅写入有变化时才更新文件。UI "重新索引"按钮走 `force: true` 全量模式。

### `src/lib/workspace-retrieval.ts`（V2 新增）

关键词检索引擎。

| 函数 | 职责 |
|------|------|
| `parseQuery(query)` | 分词：英文按空白/标点 + 停用词过滤；**CJK 文本按 bigram + unigram** |
| `scoreManifest(entry, keywords)` | 标题 10 / 标签 8 / 别名 7 / 标题 5 / 路径 3 |
| `scoreChunk(chunk, keywords)` | 正文出现次数 + heading 2x |
| `searchWorkspace(dir, query, { limit })` | 综合评分 + **hotset 加权**（pinned +5，frequent +log2(count)） |
| `loadHotset(dir)` / `updateHotset(dir, paths)` | 高频文件管理 |

**CJK 支持**：`parseQuery()` 检测 CJK 字符范围（U+4E00–U+9FFF 等），CJK 连续 run 生成 unigram + bigram，英文 run 按空白切分 + 停用词过滤。确保中文查询能命中标题/标签/正文中的中文内容。

### `src/lib/workspace-organizer.ts`（V2 新增）

| 函数 | 职责 |
|------|------|
| `assertContained(dir, relativePath)` | 路径边界校验：拒绝绝对路径、`~`、`../` 穿越、符号链接逃逸 |
| `captureNote(dir, title, content)` | 将笔记写入默认捕获目录（经 `assertContained` 校验） |
| `classifyAndSuggest(dir, filePath)` | 基于 taxonomy 建议分类和目标路径 |
| `moveFile(dir, from, to)` | 移动文件（经 `assertContained` 校验） |
| `archiveDailyMemories(dir)` | 超过 retention 天数的日记摘要归档 + 删除原文件 |
| `promoteDailyToLongTerm(dir, date)` | 提取 "Candidate Long-Term Memory" 追加到 memory.md（**幂等**） |
| `suggestTaxonomyEvolution(dir)` | 分析文件分布，建议新建/归档分类 |

**memory.md 去重保护**：
- `promoteDailyToLongTerm()` 检查日记文件的 `<!-- promoted -->` 标记 + memory.md 的 `## Promoted from {date}` 标题，双重防重复
- check-in 路由的 inline promotion 也检查 memory.md 中是否已存在同日标题

### Prompt 注入（`src/app/api/chat/route.ts`）

仅当 `session.working_directory === getSetting('assistant_workspace_path')` 时注入：
1. **增量索引**（在检索前执行，确保当前轮拿到最新内容）
2. **检索**：对用户消息调用 `searchWorkspace()` 取相关上下文 + 更新 hotset
3. **工作区文件内容**（`<assistant-workspace>` XML，含核心文件 + 每日记忆 + 检索结果）
4. **引导/问询指令**（`<assistant-project-task>`）

普通项目聊天完全不受影响。

### 自动触发链路

1. **Mount 触发**：`ChatView` mount 时 500ms 延迟检测，使用 `startStream()` 直接发送（非 `sendMessage`）
2. **Focus 兜底**：`MessageInput` onFocus 首次触发，防 mount 未生效
3. **防重复**：`assistantTriggerFiredRef`（组件级 ref）防止同一 mount 周期内重复触发；`state.hookTriggeredSessionId` 按 session 粒度防止跨页面重复（但若 session 无消息则视为上次失败，允许重试）
4. **autoTrigger 标志**：触发时携带 `autoTrigger: true`，后端跳过保存用户消息和标题更新，实现"AI 先说话"体验
5. **hookTriggeredSessionId 清理**：引导/问询完成后前端调用 `POST /api/workspace/hook-triggered` 发送 `{ sessionId: '__clear__' }` 清除标记，确保下次进入可再次触发
6. **最新会话校验**：每日问询仅在该工作区最新会话中触发，旧会话打开不会劫持问询（通过 `GET /api/workspace/latest-session` 校验）

### 确定性落盘

AI 在对话中输出 `onboarding-complete` / `checkin-complete` 代码块 → 前端 `detectAssistantCompletion()` 解析 → 调 POST 对应端点 → 后端 AI 生成文件内容（失败回退原始答案）→ 清除 `hookTriggeredSessionId`。

**安全绑定**：`detectAssistantCompletion()` 在处理 fence 前先校验 `workingDirectory === assistant_workspace_path`，确保普通项目聊天或旧助理会话即使输出同样的 fence 也不会写入工作区文件。前端同时把 `sessionId` 传给后端，后端再次校验 `session.working_directory === workspacePath`（双重校验）。

**注意**：`onboarding-complete` / `checkin-complete` 是自定义 fence 语言标记，不是真正的编程语言。Shiki / Streamdown 渲染时会降级为纯文本（已通过 `supportsLanguage()` 前置检查静默处理）。

### 每日 check-in 数据流（V2 改进）

1. 用户回答 3 个问题 → 前端解析 `checkin-complete` JSON
2. 后端并行调 AI 生成：每日记忆条目 + 长期记忆提升候选 + user.md 更新
3. 每日记忆写入 `memory/daily/{date}.md`（episodic，不破坏长期记忆）
4. 长期记忆提升：仅追加新的稳定事实到 memory.md（日期去重）
5. 自动归档：过期日记摘要 → `archive.md`，7 天前的日记尝试 promote（幂等）

## API 端点

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/settings/workspace` | GET | 返回路径 + 文件状态 + state + **taxonomy**；路径无效时返回 `valid: false` + `reason`（path_not_found / not_a_directory / not_readable / not_writable） |
| `/api/settings/workspace` | PUT | 原子保存路径：先执行 initialize / resetOnboarding 副作用，全部成功后才 `setSetting()`；支持 `{ path, initialize?, resetOnboarding? }` |
| `/api/workspace/inspect` | GET | 切换前预检：`?path=xxx` → 返回 exists / isDirectory / readable / writable / hasAssistantData / workspaceStatus（empty / normal_directory / existing_workspace / partial_workspace / invalid）+ summary |
| `/api/workspace/session` | POST | 创建或复用助理会话（onboarding 新建，checkin 复用）；创建前校验路径存在性 + R_OK + W_OK |
| `/api/workspace/onboarding` | POST | 接收 13 题答案 + sessionId → AI 生成 soul.md + user.md + claude.md + memory.md + config.json + taxonomy.json；校验 session 归属 |
| `/api/workspace/checkin` | POST | 接收答案 + sessionId → 写每日记忆 + 增量更新 memory.md + user.md；校验 session 归属 |
| `/api/workspace/hook-triggered` | POST | 设置/清除 hookTriggeredSessionId |
| `/api/workspace/latest-session` | GET | 返回指定 workingDirectory 的最新会话 ID |
| `/api/workspace/docs` | POST | 刷新根目录 + 子目录文档（`generateRootDocs` + `generateDirectoryDocs`） |
| `/api/workspace/index` | GET | 返回索引统计（文件数/分块数/stale 数） |
| `/api/workspace/index` | POST | **强制全量重建索引** |
| `/api/workspace/search` | GET | 关键词检索（`?q=xxx&limit=5`） |
| `/api/workspace/organize` | POST | 组织操作：capture / classify / move / archive / suggest-evolution；路径参数强制相对路径 + containment 校验 |

## 状态字段（`.assistant/state.json`）

```typescript
interface AssistantWorkspaceState {
  onboardingComplete: boolean;
  lastCheckInDate: string | null;    // "YYYY-MM-DD"
  schemaVersion: number;             // 当前 2
  hookTriggeredSessionId?: string;   // 防重复触发
}
```

## 工作区切换流程

切换助理工作区路径是一个多步流程，确保数据安全和用户确认：

### 1. 路径输入与实时校验

- 输入框 debounce 500ms 后触发路径格式校验（绿 ✓ / 红 ✕ / 加载 spinner）
- 不存在的路径视为"可创建"，不阻断保存

### 2. Inspect 预检

点击保存时，前端先调 `GET /api/workspace/inspect?path=xxx`，获取目标路径的 `workspaceStatus`：

| 状态 | 含义 | 确认弹窗行为 |
|------|------|-------------|
| `not_found` | 路径不存在 | 提示"将创建目录并初始化"→ `executeSave(initialize=true)` |
| `empty` | 空目录 | 提示"将初始化为工作区"→ `executeSave(initialize=true)` |
| `normal_directory` | 非空普通目录 | 提示"将在此初始化工作区"→ `executeSave(initialize=true)` |
| `existing_workspace` | 已有完整工作区 | 提供"继续接管"（reuse 模式）或"重新引导"（reset onboarding） |
| `partial_workspace` | 有 .assistant 但缺文件 | 提供"继续接管"或"重新初始化" |

### 3. 原子保存

`PUT /api/settings/workspace` 先执行所有副作用（`initializeWorkspace()` / `saveState(onboardingComplete: false)`），全部成功后才调 `setSetting()` 持久化路径。任一步骤失败则路径设置不变。

### 4. 自动导航

保存成功后：
- 前端根据 `navigateMode` 创建会话（`'new'` → onboarding 模式新建，`'reuse'` → checkin 模式复用最新会话）
- 派发 `assistant-workspace-switched` 自定义事件
- 自动跳转到新会话

### 5. 切换横幅

`ChatView` 监听 `assistant-workspace-switched` 事件，并检测当前会话的 `workingDirectory` 是否与 `assistant_workspace_path` 一致。不一致时显示黄色横幅，提供"打开新助理项目"按钮。

### 无效路径兜底

GET settings 返回 `valid: false` + `reason` 时，设置页面隐藏引导/问询/tab 面板，显示红色警告横幅。用户需修改路径后才能继续。

## 设置 UI（`AssistantWorkspaceSection.tsx`）

底部 tab 面板（仅当 `workspace.valid !== false` 时显示）：

| Tab | 内容 |
|-----|------|
| 文件状态 | 4 个核心文件存在/大小 + 刷新目录文档按钮 |
| 分类体系 | 从 taxonomy.json 读取的分类列表 |
| 文件索引 | 索引统计（文件数/分块数/过期数/上次索引时间）+ 重新索引按钮 |
| 组织管理 | 归档旧记忆按钮 |

## 关键约束

- 引导与问询互斥：onboarding 完成当天不触发 daily check-in
- 每日问询复用最后一条会话，不新建
- `hookTriggeredSessionId` 按 session 粒度防重复，换 session 可重新触发；完成后自动清除；若 session 无消息（上次触发失败）则允许重试
- `autoTrigger` 贯穿 ChatView → stream-session-manager → chat/route.ts，跳过用户消息保存和标题更新
- 每日问询不受 `messages.length > 0` 限制，可在有历史消息的复用会话中触发
- 文件截断策略：每文件 8000 chars（head 6000 + truncated marker + tail 1800）
- **索引在检索前执行**：确保当前轮对话能看到最新文件内容
- **增量索引**：聊天入口的索引调用仅处理 stale 文件，大文库不会拖慢首轮响应
- **memory.md 不可被覆写**：所有写入都是 append，promotion 有日期去重保护
- **hotset 影响排序**：pinned 文件 +5 分，frequent 文件 +log2(count) 分（上限 +4）
- **路径校验 R_OK + W_OK**：GET settings、session 创建均要求读写权限，只读目录返回 `not_writable` 错误
- **切换原子性**：PUT settings 先执行副作用再持久化，失败不留脏状态
- **切换横幅**：`ChatView` 通过 `assistant-workspace-switched` 事件 + workingDirectory 比对检测不匹配；仅对旧助理会话显示（普通项目聊天不受影响）；事件监听器匹配 `oldPath`，挂载时通过 inspect 检查 `hasAssistantData`
- **Completion fence 安全绑定**：前端校验 `workingDirectory === assistant_workspace_path` + 后端校验 `session.working_directory === workspacePath`，双重防止非助理会话写入工作区
- **Organize 路径边界**：`assertContained()` 拒绝绝对路径 / `~` / `../` / 符号链接逃逸；API 入口 `validateRelativePath()` 预检；`captureDefault` 写入 config 时强制相对路径
- **每日问询入口**：设置页中仅当 `onboardingComplete === true` 时显示每日问询卡片
- **刷新文档**：`/api/workspace/docs` 同时调用 `generateRootDocs()` + `generateDirectoryDocs()`

## V1 → V2 变更摘要

| 维度 | V1 | V2 |
|------|----|----|
| Schema | `schemaVersion: 1` | `schemaVersion: 2`，自动迁移 |
| 引导问卷 | 10 题 | 13 题（新增组织方式、默认收件箱、归档策略） |
| 引导产物 | soul.md + user.md | + claude.md + memory.md + config.json + taxonomy.json |
| 记忆模型 | 每日 check-in 覆写 memory.md | 每日记忆写入 `memory/daily/` + memory.md 仅追加 |
| 索引 | 无 | Markdown 分块索引（manifest + chunks JSONL） |
| 检索 | 无 | 关键词检索 + CJK bigram + hotset 加权 |
| 分类 | 无 | 目录角色推断 + 演化建议 |
| 组织 | 无 | 捕获/分类/移动/归档/长期记忆晋升 |
| 设置 UI | 文件状态 | + 分类体系 / 文件索引 / 组织管理 tab |
