# 深度调研：Skills 系统脱离 Claude Code 独立实现

> 调研日期：2026-04-06
> 关联任务：脱离 Claude Code SDK 独立实现 Skills 系统

## 一、Claude Code 的 Skills 完整实现

### 1.1 存储格式与目录结构

Claude Code 的 Skills 有两种存在形式：

**文件型 Skills（SKILL.md）**
```
~/.claude/skills/{skill-name}/SKILL.md      # 用户全局
.claude/skills/{skill-name}/SKILL.md         # 项目级
~/.claude/plugins/marketplaces/{mkt}/plugins/{plugin}/commands/  # 插件
```

**旧格式（commands，即将废弃）**
```
~/.claude/commands/{name}.md                 # 用户全局
.claude/commands/{name}.md                   # 项目级
```

**SKILL.md 文件格式** — Markdown with YAML frontmatter：

```yaml
---
name: skill-name
description: "一行描述"
allowed-tools:
  - Read
  - Write
  - Bash(gh:*)
when_to_use: "Use when the user wants to..."
argument-hint: "[arg1] [arg2]"
arguments:
  - arg1
  - arg2
context: fork          # inline（默认）或 fork（子 Agent 执行）
agent: coder           # 指定使用哪个 agent profile
model: inherit         # 模型覆盖
effort: high           # 思考力度
user-invocable: true   # 用户是否可直接调用
disable-model-invocation: false  # 是否禁止模型自动调用
hooks:                 # 生命周期钩子
  PreToolUse:
    - matcher: Bash
      hooks:
        - command: "echo pre"
shell:                 # shell 配置
  type: bash
paths:                 # 路径匹配模式
  - src/**
  - tests/**
version: "1.0"
---

# Skill Title

Markdown body with instructions...

## Inputs
- `$arg1`: Description
- `$arg2`: Description

## Steps
### 1. Step Name
Instructions...

**Success criteria**: ...
```

**关键 frontmatter 字段解析** (`loadSkillsDir.ts` → `parseSkillFrontmatterFields()`):
- `allowed-tools`: 解析为工具权限白名单，支持模式匹配如 `Bash(gh:*)`
- `when_to_use`: 写入 SkillTool 的提示中，帮助模型判断何时自动调用
- `context: fork`: 以子 Agent 方式执行（独立 token 预算、独立消息流）
- `arguments`: 支持 `$arg_name` 模板变量替换
- `${CLAUDE_SKILL_DIR}`: 内置变量，替换为 skill 所在目录
- `${CLAUDE_SESSION_ID}`: 内置变量，替换为当前会话 ID
- `!`backtick`...`backtick`!`: 内联 shell 命令执行（仅本地 skill，MCP skill 禁用）

### 1.2 内置 Skills（Bundled Skills）

通过 `registerBundledSkill()` 在启动时注册，编译进二进制：

| Skill | 功能 | 执行方式 |
|-------|------|----------|
| simplify | 代码审查：复用性 + 质量 + 效率 | inline，启动 3 个并行 Agent |
| skillify | 把当前会话提炼为可复用 skill | inline，多轮交互 |
| remember | 审查 auto-memory 条目 | inline |
| verify | 验证代码改动 | inline |
| debug | 调试辅助 | inline |
| stuck | 解除卡死 | inline |
| update-config | 修改配置 | inline |
| keybindings | 键绑定帮助 | inline |
| batch | 批量操作 | fork |
| loop | 循环执行 | fork |
| claude-api | Claude API 辅助 | inline |

`BundledSkillDefinition` 接口：
```typescript
type BundledSkillDefinition = {
  name: string;
  description: string;
  aliases?: string[];
  whenToUse?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  isEnabled?: () => boolean;
  hooks?: HooksSettings;
  context?: 'inline' | 'fork';
  agent?: string;
  files?: Record<string, string>;  // 随附资源文件
  getPromptForCommand: (args: string, context: ToolUseContext) => Promise<ContentBlockParam[]>;
}
```

### 1.3 发现与加载机制

**loadSkillsDir.ts** — 核心加载器：

1. **扫描顺序**（后者覆盖前者）：
   - `~/.claude/commands/` — 全局旧格式
   - `~/.claude/skills/` — 全局新格式
   - `.claude/commands/` — 项目旧格式
   - `.claude/skills/` — 项目新格式
   - Plugin commands 目录
   - MCP 提供的 skills
   - Bundled skills（代码内注册）

2. **去重机制**：使用 `realpath()` 解析符号链接后比较路径，避免同一文件通过不同路径被加载两次

3. **缓存策略**：`memoize` 缓存加载结果，通过 `clearSkillCaches()` + `clearCommandsCache()` 失效

4. **热重载** (`skillChangeDetector.ts`)：
   - 使用 `chokidar` 监控 skills/commands 目录
   - 文件变更 → 300ms 去抖 → 清理缓存 → 重新加载 → 通知 UI
   - Bun 环境下使用 polling 模式避免死锁

### 1.4 SkillTool — 模型调用入口

**SkillTool.ts** 是一个标准的 Tool，注册为 `Skill`，模型可以直接调用：

```
Tool name: "Skill"
Parameters: { skill: string, args?: string }
```

**执行流程**：
1. 模型看到系统提示中的 skill 列表（name + description + whenToUse）
2. 模型决定调用某个 skill → 调用 `Skill` tool
3. SkillTool 查找对应的 Command 对象
4. 如果 `context === 'fork'`：
   - 创建子 Agent（独立 agentId、独立消息流）
   - 通过 `runAgent()` 执行
   - 收集结果返回给主对话
5. 如果 `context === 'inline'`（默认）：
   - 调用 `getPromptForCommand(args, context)` 获取提示内容
   - 将提示内容注入当前对话作为 tool_result

**Skill 列表预算管理** (`prompt.ts`)：
- 默认使用上下文窗口的 1%（按字符计）
- 200k 上下文 → 约 8000 字符预算
- 超出预算时截断非 bundled skill 的描述
- Bundled skills 永远保持完整描述

### 1.5 用户调用方式

用户通过 `/skill-name [args]` 的 slash command 语法调用，处理流程：
1. 输入 `/` → 弹出 skill 列表
2. 选择 skill → 显示为 badge
3. 用户输入参数 → 发送
4. `processSlashCommand()` 解析命令名和参数
5. 找到对应 Command → 执行 `getPromptForCommand()`
6. 将 skill 内容注入到用户消息中

---

## 二、CodePilot 当前的 Skills 实现

### 2.1 现有架构

CodePilot 有完整的 Skills 管理系统，但**大量依赖 SDK**：

**API 路由**：
- `GET /api/skills` — 扫描本地文件 + 合并 SDK 报告的 commands/skills
- `POST /api/skills` — 创建新 skill（写入 `.claude/commands/`）
- `GET /api/skills/search` — 搜索
- `GET /api/skills/marketplace/search` — Marketplace 浏览

**扫描范围**：
- `~/.claude/commands/` — 全局 commands
- `.claude/commands/` — 项目 commands
- `.claude/skills/*/SKILL.md` — 项目级 agent skills
- `~/.agents/skills/*/SKILL.md` — 已安装 skills
- `~/.claude/skills/*/SKILL.md` — Claude 安装的 skills
- `~/.claude/plugins/` — 插件 commands

**SDK 依赖点**：
1. `getCachedCommands(providerId)` — 从 SDK init meta 获取可用 slash commands
2. `getCachedPlugins(providerId)` — 获取已加载的 plugin 路径
3. SDK `settingSources` — 告诉 SDK 去哪里加载 skills/commands
4. SDK SkillTool — 实际的 skill 执行（模型调用 `Skill` tool → SDK 处理）

### 2.2 UI 组件

- `SkillsManager.tsx` — 完整的 skill 管理界面（列表、搜索、编辑、创建）
- `SkillEditor.tsx` — skill 内容编辑器
- `SkillListItem.tsx` — 列表项组件
- `CreateSkillDialog.tsx` — 创建对话框
- `MarketplaceBrowser.tsx` — Marketplace 浏览器
- `MarketplaceSkillCard/Detail.tsx` — Marketplace 展示组件
- `InstallProgressDialog.tsx` — 安装进度
- `SlashCommandPopover.tsx` — 输入框弹出的 slash command 选择器

### 2.3 Slash Command 交互流程

`useSlashCommands.ts`:
1. 用户输入 `/` → 触发 popover
2. `fetchSkills()` 调用 `/api/skills` 获取列表
3. 如果有 SDK init meta → 用 SDK 报告的 commands/skills 过滤和补充
4. 用户选择 skill → 设置 badge → 用户继续输入参数
5. 发送时 skill name + args 一起发送给 SDK

### 2.4 Skills Lock 文件

`skills-lock.ts` 读取 `~/.agents/.skill-lock.json`，用于追踪已安装 skills 的版本。

---

## 三、OpenCode 的 Skills 实现

### 3.1 核心设计

OpenCode 的 Skills 系统独立于任何 SDK，完全自建：

**存储格式** — 与 Claude Code 兼容的 `SKILL.md`：

```yaml
---
name: cloudflare
description: "Comprehensive Cloudflare platform skill..."
references:
  - workers
  - pages
---

# Skill Content...
```

Frontmatter 字段比 Claude Code 更简洁：`name`、`description`，额外支持 `references`。

### 3.2 发现机制 (`skill.ts`)

**四层扫描**（优先级从低到高）：

1. **外部兼容目录（全局）**: `~/.claude/skills/**/SKILL.md`、`~/.agents/skills/**/SKILL.md`
2. **外部兼容目录（项目）**: `.claude/skills/**/SKILL.md`、`.agents/skills/**/SKILL.md`
3. **OpenCode 自有目录**: `.opencode/{skill,skills}/**/SKILL.md`（支持多 config 目录）
4. **配置额外路径**: `config.skills.paths` 中指定的目录
5. **远程 URL**: `config.skills.urls` — 从网络下载 skill 包

**远程 Skill 加载** (`discovery.ts`)：
- URL 指向一个 `index.json` 索引文件
- 索引格式：`{ skills: [{ name, description, files: ["SKILL.md", ..."] }] }`
- 下载后缓存到本地 `~/.cache/opencode/skills/`
- 支持随附资源文件（references、scripts 等）

### 3.3 SkillTool (`tool/skill.ts`)

OpenCode 的 SkillTool 与 Claude Code 概念相同，但实现更简洁：

```typescript
export const SkillTool = Tool.define("skill", async (ctx) => {
  const skills = await Skill.all();
  // ... 构建 description 列表（XML 格式）
  return {
    description,
    parameters: z.object({ name: z.string() }),
    async execute(params, ctx) {
      const skill = await Skill.get(params.name);
      // ... 权限检查
      // ... 列出 skill 目录下的文件（最多 10 个）
      return {
        title: `Loaded skill: ${skill.name}`,
        output: `<skill_content name="...">...\n<skill_files>...</skill_files></skill_content>`,
      };
    },
  };
});
```

**关键差异**：
- 没有 fork/inline 区分 — 所有 skill 都是 inline 注入
- 权限通过 `PermissionNext.evaluate("skill", skill.name, agent.permission)` 控制
- 自动列出 skill 目录下的资源文件供模型按需读取
- 没有模板变量替换、没有 shell 命令执行

### 3.4 配置

```yaml
# .opencode/config.yaml
skills:
  paths:
    - ~/my-skills
    - ./local-skills
  urls:
    - https://example.com/skills/
```

---

## 四、Craft Agent 的 Skills 实现

### 4.1 核心设计

Craft 也是完全自建的 Skills 系统，与 Claude Code SKILL.md 格式兼容：

**存储结构**：
```
~/.craft-agent/workspaces/{workspaceId}/skills/{slug}/
├── SKILL.md          # 必须
├── icon.svg          # 推荐：UI 图标
└── (other files)     # 可选资源
```

**三层优先级**：
1. `~/.agents/skills/` — 全局（最低）
2. `~/.craft-agent/workspaces/{id}/skills/` — Workspace（中）
3. `{project}/.agents/skills/` — 项目级（最高）

### 4.2 类型定义 (`types.ts`)

```typescript
interface SkillMetadata {
  name: string;
  description: string;
  globs?: string[];           // 文件模式触发
  alwaysAllow?: string[];     // 工具自动批准
  icon?: string;              // emoji 或 URL
  requiredSources?: string[]; // 自动启用的 sources
}

interface LoadedSkill {
  slug: string;               // 目录名
  metadata: SkillMetadata;
  content: string;            // 去掉 frontmatter 的正文
  iconPath?: string;
  path: string;
  source: 'global' | 'workspace' | 'project';
}
```

### 4.3 存储操作 (`storage.ts`)

- 使用 `gray-matter` 库解析 frontmatter
- 内存缓存，5 分钟 TTL
- 支持按 slug 精确查找（O(1)）或全量加载
- CRUD 操作：`loadSkill`、`loadAllSkills`、`deleteSkill`、`skillExists`
- 图标下载：支持 URL → 本地文件

### 4.4 特色功能

- **Icon 系统**：每个 skill 有可视化图标（SVG/PNG/emoji）
- **requiredSources**：调用 skill 时自动启用相关数据源（如 Linear、GitHub）
- **globs 触发**：当操作的文件匹配 globs 模式时自动建议/激活 skill
- **Workspace 级隔离**：不同 workspace 的 skills 互不干扰

---

## 五、对比总结

| 维度 | Claude Code | OpenCode | Craft Agent | CodePilot 现状 |
|------|------------|----------|-------------|---------------|
| **格式** | SKILL.md + commands .md | SKILL.md | SKILL.md | 两种都支持 |
| **解析** | 自建 frontmatter parser | gray-matter + 自建回退 | gray-matter | 手写正则 |
| **存储层级** | global → project → plugin → bundled | global → project → config → URL | global → workspace → project | global → project → installed → plugin |
| **执行方式** | inline 或 fork（子 Agent） | 仅 inline | inline | 委托 SDK |
| **模型调用** | SkillTool（注册为标准工具） | SkillTool（同上） | 通过 SDK | 委托 SDK |
| **变量替换** | `$arg`、`${CLAUDE_SKILL_DIR}`、`${CLAUDE_SESSION_ID}` | 无 | 无 | 无 |
| **Shell 执行** | `` !`command` `` 内联执行 | 无 | 无 | 无 |
| **热重载** | chokidar 监控 + 300ms 去抖 | 无 | 5min TTL 缓存 | 无 |
| **远程加载** | 无（marketplace 通过 plugin） | index.json URL | 无 | Marketplace API |
| **图标** | 无 | 无 | SVG/PNG/emoji | 无 |
| **权限** | allowed-tools 白名单 | agent permission 评估 | alwaysAllow | 无（SDK 处理） |
| **预算控制** | 1% 上下文窗口 | 无 | 无 | 无（SDK 处理） |

---

## 六、自建 Skills 系统设计方案

### 6.1 存储格式设计

保持与 Claude Code 兼容的 `SKILL.md` 格式，增加 CodePilot 特有扩展：

```yaml
---
name: "skill-name"
description: "Brief description"
when_to_use: "Use when..."
allowed-tools:
  - Read
  - Write
  - Bash(git:*)
argument-hint: "[branch-name]"
arguments:
  - branch_name
context: inline          # inline | fork
model: inherit           # 模型覆盖
effort: auto             # 思考力度
user-invocable: true
disable-model-invocation: false
icon: "🔧"              # CodePilot 扩展：图标
category: "git"          # CodePilot 扩展：分类
---

# Skill Body
...
```

### 6.2 目录结构

```
~/.claude/skills/{name}/SKILL.md       # 全局（兼容 Claude Code）
~/.claude/commands/{name}.md           # 全局旧格式（兼容）
~/.agents/skills/{name}/SKILL.md       # 全局（兼容 .agents 体系）
{project}/.claude/skills/{name}/SKILL.md  # 项目级
{project}/.claude/commands/{name}.md      # 项目旧格式
```

### 6.3 核心模块设计

#### 6.3.1 Skill Parser (`src/lib/skills/skill-parser.ts`)

```typescript
interface SkillMetadata {
  name: string;
  description: string;
  whenToUse?: string;
  allowedTools: string[];
  argumentHint?: string;
  arguments: string[];
  context: 'inline' | 'fork';
  model?: string;
  effort?: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  icon?: string;
  category?: string;
  paths?: string[];
}

interface ParsedSkill {
  metadata: SkillMetadata;
  content: string;          // 去掉 frontmatter 的正文
  rawContent: string;       // 原始完整内容
  filePath: string;
  source: 'global' | 'project' | 'installed' | 'bundled';
}
```

用 `gray-matter` 解析 frontmatter。对 Claude Code 的不规范 YAML（如值含冒号未加引号），需像 OpenCode 一样做 fallback sanitization。

#### 6.3.2 Skill Discovery (`src/lib/skills/skill-discovery.ts`)

扫描器，按优先级从低到高加载：

```typescript
async function discoverSkills(cwd: string): Promise<ParsedSkill[]> {
  // 1. 全局 skills: ~/.claude/skills/, ~/.agents/skills/
  // 2. 全局 commands: ~/.claude/commands/
  // 3. 项目 skills: {cwd}/.claude/skills/
  // 4. 项目 commands: {cwd}/.claude/commands/
  // 5. Bundled skills（代码注册）
  // 同名后者覆盖前者
}
```

缓存策略：
- 内存缓存 + TTL（5 分钟，参考 Craft）
- `invalidateSkillsCache()` 供文件变更时调用
- 未来可加 chokidar 监控

#### 6.3.3 Skill Executor (`src/lib/skills/skill-executor.ts`)

执行 skill 的核心逻辑：

```typescript
async function executeSkill(
  skill: ParsedSkill,
  args: string,
  sessionContext: SessionContext
): Promise<SkillResult> {
  let content = skill.content;

  // 1. 变量替换
  content = substituteArguments(content, args, skill.metadata.arguments);
  content = content.replace(/\$\{SKILL_DIR\}/g, path.dirname(skill.filePath));

  // 2. 如果 context === 'fork'
  if (skill.metadata.context === 'fork') {
    return executeForkSkill(content, skill, sessionContext);
  }

  // 3. inline: 将 skill 内容注入到系统提示
  return { type: 'inline', content, allowedTools: skill.metadata.allowedTools };
}
```

#### 6.3.4 Skill Tool（Agent Loop 集成）

自建 Agent Loop 中注册的 `Skill` tool：

```typescript
const skillTool = {
  name: 'Skill',
  description: buildSkillListPrompt(skills),  // 动态生成
  parameters: {
    skill: { type: 'string', description: 'skill name' },
    args: { type: 'string', description: 'optional arguments' },
  },
  execute: async (params) => {
    const skill = await getSkill(params.skill);
    const result = await executeSkill(skill, params.args, context);
    return result;
  },
};
```

**Skill 列表注入系统提示**（参考 Claude Code prompt.ts）：
- 在 system prompt 的 `<system-reminder>` 块中列出可用 skills
- 按预算截断描述（上下文窗口的 1%）
- bundled skills 不被截断

#### 6.3.5 Bundled Skills (`src/lib/skills/bundled/`)

CodePilot 专属的内置 skills：

```typescript
// src/lib/skills/bundled/index.ts
const bundledSkills: BundledSkillDef[] = [
  commitSkill,      // 智能提交
  reviewSkill,      // 代码审查
  // ... 根据需要添加
];
```

每个 bundled skill 是一个对象，有 `getPromptForCommand(args, context)` 方法动态生成提示。

### 6.4 API 路由改造

现有路由大部分可复用，需移除 SDK 依赖：

| 路由 | 当前 | 改造 |
|------|------|------|
| `GET /api/skills` | 文件扫描 + SDK commands 合并 | 文件扫描 + bundled skills 合并（移除 SDK） |
| `POST /api/skills` | 写入 commands 目录 | 保持不变 |
| `GET /api/skills/search` | 搜索 | 保持不变 |

### 6.5 Chat 流程集成

**系统提示注入**（改造 `context-assembler.ts`）：
```
系统提示 = 基础指令 + workspace prompt + memory + assistant instructions
         + skill 列表（作为 <system-reminder> 注入）
```

**用户 slash command 处理**：
1. 用户输入 `/skill-name args`
2. 前端识别 → 设置 badge
3. 发送到后端时附带 `{ skill: 'skill-name', args: '...' }`
4. 后端在 Agent Loop 首轮加载 skill 内容，注入为系统消息或 tool_result

**模型自动调用**：
1. 模型看到系统提示中的 skill 列表
2. 模型调用 `Skill` tool → Agent Loop 拦截
3. 执行 skill → 返回 tool_result
4. 模型根据 skill 指令继续执行

### 6.6 与 Agent Loop 的集成点

| 集成点 | 说明 |
|--------|------|
| Tool 注册 | Skill tool 注册到 Agent Loop 的 tool 列表 |
| 系统提示 | Skill 列表注入到 system-reminder |
| 权限 | Skill 的 allowed-tools 影响子工具的权限判断 |
| Fork 执行 | context=fork 的 skill 需要 Agent Loop 支持子 Agent |
| 预算管理 | Skill 列表描述需要根据上下文窗口大小做截断 |

---

## 七、需要的改动点清单

### 7.1 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/skills/skill-parser.ts` | SKILL.md 解析器（gray-matter + fallback） |
| `src/lib/skills/skill-discovery.ts` | 多层目录扫描 + 缓存 |
| `src/lib/skills/skill-executor.ts` | Skill 执行引擎（inline + fork） |
| `src/lib/skills/skill-tool.ts` | Agent Loop 的 Skill tool 定义 |
| `src/lib/skills/skill-prompt.ts` | Skill 列表格式化 + 预算管理 |
| `src/lib/skills/variable-substitution.ts` | 模板变量替换（`$arg`、`${SKILL_DIR}`） |
| `src/lib/skills/bundled/index.ts` | 内置 skills 注册 |

### 7.2 改造文件

| 文件 | 改动 |
|------|------|
| `src/app/api/skills/route.ts` | 移除 `getCachedCommands`、`getCachedPlugins` 依赖，改用自建 discovery |
| `src/hooks/useSlashCommands.ts` | 移除 sdkInitMeta 依赖，纯用 `/api/skills` 返回值 |
| `src/lib/context-assembler.ts` | 新增 skill 列表注入层 |
| `src/lib/claude-client.ts`（或替代的 Agent Loop） | 注册 Skill tool，处理 skill tool_use |
| `src/components/chat/ChatView.tsx` | 适配新的 skill 执行结果展示 |

### 7.3 可删除的 SDK 依赖

| 依赖 | 说明 |
|------|------|
| `getCachedCommands(providerId)` | 改用自建 discovery |
| `getCachedPlugins(providerId)` | 改用自建 plugin 管理 |
| SDK `settingSources` | 不再需要告诉 SDK 去哪加载 skills |
| SDK SkillTool | 由自建的 skill-tool.ts 替代 |

### 7.4 依赖库

| 库 | 用途 | 现有? |
|----|------|-------|
| `gray-matter` | YAML frontmatter 解析 | 需新增 |
| `ignore`（可选） | gitignore 风格的路径匹配 | 已有 |
| `chokidar`（可选，Phase 2） | 文件变更监控 | 需新增 |

### 7.5 实现优先级

**Phase 1（必须，脱离 SDK 的最小可行集）**：
1. skill-parser.ts — frontmatter 解析
2. skill-discovery.ts — 文件扫描（不含 plugin、远程）
3. skill-executor.ts — inline 执行（不含 fork）
4. skill-tool.ts — Agent Loop 集成
5. skill-prompt.ts — 系统提示列表生成
6. 改造 `/api/skills` 路由

**Phase 2（增强功能）**：
7. variable-substitution.ts — 模板变量替换
8. fork 执行支持（依赖子 Agent 系统）
9. bundled skills 框架
10. 热重载监控

**Phase 3（体验优化）**：
11. 预算管理
12. Marketplace 集成
13. Skill 创建向导（类似 skillify）
14. 图标系统（参考 Craft）
