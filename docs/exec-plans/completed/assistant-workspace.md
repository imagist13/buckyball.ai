# 助理工作区（Assistant Workspace）

> 创建时间：2026-03-06
> 最后更新：2026-03-06

## 状态

| Phase | 内容 | 状态 |
|-------|------|------|
| 1 | 类型定义 + 核心工作区库 | ✅ 已完成 |
| 2 | 系统提示词注入 | ✅ 已完成 |
| 3 | API 端点（workspace / onboarding / checkin / session / hook-triggered） | ✅ 已完成 |
| 4 | i18n（~48 个翻译键） | ✅ 已完成 |
| 5 | Settings UI — 助理标签页 | ✅ 已完成 |
| 6 | 对话式引导 + 自动触发 + 兜底触发 | ✅ 已完成 |
| 7 | 目录文档生成（README.ai.md + PATH.ai.md） | ✅ 已完成 |
| 8 | 回归测试（16 case） | ✅ 已完成 |

## 功能概述

用户指定一个目录（如 Obsidian vault）作为助理工作区，存放 4 份 Markdown 文件定义 AI 人格和记忆：

| 文件 | 用途 |
|------|------|
| `claude.md` | 执行规则 |
| `soul.md` | 人格风格 |
| `user.md` | 用户画像 |
| `memory.md` | 长期记忆 |

状态持久化在 `.assistant/state.json`（与目录一起可移植）。

## 架构决策

### 对话式引导（非 Dialog UI）

最初实现用 Dialog 弹窗完成引导问卷，后改为通过自然对话完成：
- 点击"开始引导"→ 创建助理项目会话 → 自动发送触发消息 → AI 逐题提问
- 输入框 focus 作为兜底触发器（防止 mount 时因各种原因未触发）
- `hookTriggeredSessionId` 状态位防止同一会话重复触发

### 确定性落盘

AI 在对话中收集完答案后输出结构化完成信号（`onboarding-complete` / `checkin-complete` 代码块），前端检测到后调用后端 API 确定性写入文件，不依赖模型自行操作文件系统。

### Prompt 作用域隔离

工作区 prompt（soul/user/memory/claude.md）仅注入 `working_directory === assistant_workspace_path` 的会话，普通项目不受影响。

### 引导与问询互斥

- `needsDailyCheckIn()` 在 `onboardingComplete === false` 时返回 false
- onboarding 完成时同时设置 `lastCheckInDate = today`，当天不再触发每日问询

### 每日问询复用会话

每日问询优先打开该工作区最后一条会话继续提问（`getLatestSessionByWorkingDirectory`），不新建会话。仅引导问卷新建会话。

## 文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/assistant-workspace.ts` | 核心库：文件加载/截断/拼接/状态管理/目录文档生成 |
| `src/app/api/settings/workspace/route.ts` | 工作区路径 CRUD |
| `src/app/api/workspace/onboarding/route.ts` | 引导问卷 API |
| `src/app/api/workspace/checkin/route.ts` | 每日问询 API |
| `src/app/api/workspace/session/route.ts` | 会话创建/复用（onboarding 新建，checkin 复用） |
| `src/app/api/workspace/hook-triggered/route.ts` | 防重复触发状态 API |
| `src/app/api/workspace/docs/route.ts` | 目录文档生成 API |
| `src/components/settings/AssistantWorkspaceSection.tsx` | 设置面板主组件 |
| `src/hooks/useAssistantWorkspace.ts` | 工作区状态 Hook |
| `src/__tests__/unit/assistant-workspace.test.ts` | 16 个回归测试 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/types/index.ts` | `AssistantWorkspaceState`、`AssistantWorkspaceFiles` 接口，`SETTING_KEYS` |
| `src/app/api/chat/route.ts` | 工作区 prompt 加载（限助理项目）+ 引导/问询指令注入 |
| `src/lib/db.ts` | `getLatestSessionByWorkingDirectory()` |
| `src/components/chat/ChatView.tsx` | 自动触发 + 完成信号检测 |
| `src/components/chat/MessageInput.tsx` | focus 兜底触发 |
| `src/components/settings/SettingsLayout.tsx` | 助理标签 |
| `src/components/layout/ChatListPanel.tsx` | 助理项目徽标 |
| `src/i18n/en.ts` / `src/i18n/zh.ts` | ~48 个翻译键 |

## 数据流

```
用户点击"开始引导"
  → POST /api/workspace/session { mode: 'onboarding' }
  → 创建新会话，跳转 /chat/{id}
  → ChatView mount → checkAssistantTrigger()
    → 检测 workingDirectory === workspacePath && !onboardingComplete
    → POST /api/workspace/hook-triggered { sessionId }
    → sendMessage("请开始助理引导设置。")
  → chat/route.ts 检测 isAssistantProject + !state.onboardingComplete
    → 注入 onboarding 系统提示
  → AI 逐题提问，用户逐题回答
  → AI 输出 ```onboarding-complete {...}```
  → ChatView.detectAssistantCompletion() 解析 JSON
    → POST /api/workspace/onboarding { answers }
    → 后端 AI 生成 soul.md + user.md → 写入文件
    → state.onboardingComplete = true, lastCheckInDate = today
```

## 测试覆盖

| 测试 | 验证行为 |
|------|---------|
| initializeWorkspace creates state.json | 初始化写入 state.json + 4 个模板文件 |
| onboarding auto-trigger detection | 新工作区检测到需要引导 |
| hookTriggeredSessionId prevents repeat | 同一会话不重复触发 |
| daily check-in respects onboarding state | 未完成引导不触发问询；完成当天不触发 |
| workspace prompt scoping | 有内容时生成 prompt，空目录返回空 |
| session reuse for daily check-in | `getLatestSessionByWorkingDirectory` 正确查询 |
| generateDirectoryDocs | 同时生成 README.ai.md 和 PATH.ai.md |
