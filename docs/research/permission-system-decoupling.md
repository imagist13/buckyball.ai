# 深度调研：权限系统脱离 Claude Code 独立实现

> 调研时间：2026-04-06
> 状态：完成

## 1. CodePilot 当前权限流程的完整链路

### 1.1 当前架构：完全依赖 SDK

CodePilot 当前的权限系统 **100% 依赖 Claude Code SDK**。自身不做任何权限判定，仅负责"转发审批请求 + 收集用户决策 + 回传结果"。

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code SDK (子进程)                                │
│                                                         │
│  1. Agent Loop 产生 tool_use                             │
│  2. SDK 内部权限引擎判定 → 需要用户审批                    │
│  3. 调用 canUseTool 回调 (阻塞等待)                       │
└────────────────┬────────────────────────────────────────┘
                 │ canUseTool(toolName, input, opts)
                 ▼
┌─────────────────────────────────────────────────────────┐
│  claude-client.ts (Server-side, SSE stream 内)           │
│                                                         │
│  4. 自动批准内部 MCP 工具 (codepilot_*)                   │
│  5. 生成 permissionRequestId                             │
│  6. 写入 DB (permission_requests 表, status=pending)      │
│  7. 发送 SSE 事件: type=permission_request               │
│  8. 调用 registerPendingPermission() — 返回 Promise      │
│  9. 阻塞等待 Promise resolve                             │
└────────────────┬────────────────────────────────────────┘
                 │ SSE event
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Frontend (useSSEStream.ts → ChatView.tsx)               │
│                                                         │
│  10. 解析 permission_request SSE 事件                     │
│  11. 显示审批 UI (工具名、输入、Allow/Deny 按钮)           │
│  12. 用户点击 → POST /api/chat/permission                │
└────────────────┬────────────────────────────────────────┘
                 │ POST { permissionRequestId, decision }
                 ▼
┌─────────────────────────────────────────────────────────┐
│  /api/chat/permission/route.ts                          │
│                                                         │
│  13. 验证 DB 记录存在且 status=pending                    │
│  14. 构造 PermissionResult (allow/deny)                  │
│  15. 调用 resolvePendingPermission()                     │
└────────────────┬────────────────────────────────────────┘
                 │ resolve Promise
                 ▼
┌─────────────────────────────────────────────────────────┐
│  permission-registry.ts (内存中的 Promise Map)            │
│                                                         │
│  16. clearTimeout (5分钟超时)                             │
│  17. 写入 DB (status=allow/deny, resolved_at)            │
│  18. resolve Promise → 值返回给 canUseTool 回调           │
└────────────────┬────────────────────────────────────────┘
                 │ PermissionResult
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Claude Code SDK                                        │
│                                                         │
│  19. 收到结果 → 执行或拒绝工具                            │
│  20. 如果 allow + updatedPermissions → 更新会话规则       │
└─────────────────────────────────────────────────────────┘
```

### 1.2 关键组件

| 组件 | 文件 | 职责 |
|------|------|------|
| Permission Registry | `src/lib/permission-registry.ts` | 内存中的 Promise Map，桥接 canUseTool 阻塞与 HTTP 响应 |
| Permission API | `src/app/api/chat/permission/route.ts` | 接收前端决策，验证 DB，resolve Promise |
| Permission Broker | `src/lib/bridge/permission-broker.ts` | IM 桥接场景：转发审批到 Telegram/QQ，处理回调 |
| DB Schema | `src/lib/db.ts` | `permission_requests` 表 + `channel_permission_links` 表 |
| SSE Handler | `src/hooks/useSSEStream.ts` | 解析 `permission_request` 事件类型 |
| Types | `src/types/index.ts` | `PermissionRequestEvent`, `PermissionResponseRequest` |

### 1.3 当前 SDK 参数传递

```typescript
// claude-client.ts 中传给 SDK 的 permissionMode
permissionMode: skipPermissions
  ? 'bypassPermissions'
  : (permissionMode || 'acceptEdits')

// canUseTool 回调签名 (SDK 定义)
canUseTool: async (toolName, input, opts) => {
  // opts 包含: suggestions, decisionReason, blockedPath, toolUseID, signal
  // 返回: { behavior: 'allow'|'deny', updatedInput?, updatedPermissions?, message? }
}
```

### 1.4 当前不做的事（脱离 SDK 后需要自建）

- **不做权限判定**：不判断哪些工具/命令需要审批，哪些可以自动放行
- **不做规则匹配**：不管理 allow/deny 规则列表
- **不做 Bash 命令安全分析**：不检查命令是否只读、是否有危险操作符
- **不做权限模式管理**：safe/ask/auto 模式的切换和语义全在 SDK 内部

---

## 2. 三家竞品的权限方案对比

### 2.1 Claude Code 的权限系统

**权限模式（6种）：**

| 模式 | 行为 | 场景 |
|------|------|------|
| `default` | 只读工具自动放行，写入工具需审批 | 默认交互模式 |
| `bypassPermissions` | 全部自动放行 | 无头/自动化场景 |
| `dontAsk` | 不审批，直接拒绝需审批的操作 | 只读探索 |
| `acceptEdits` | 工作目录内的文件编辑自动放行 | 信任编辑模式 |
| `plan` | 类似 dontAsk，但可触发 auto | 规划模式 |
| `auto` | AI 分类器判定是否安全 | 全自动模式 |

**规则系统：**
- 规则来源有 7 种优先级：`settings.json`(user/project/enterprise) + `cliArg` + `command` + `session`
- 规则格式：`ToolName` 或 `ToolName(prefix:pattern)` 或 `mcp__server__tool`
- 三种行为：`allow` / `deny` / `ask`
- 规则匹配按来源优先级 flatMap 后线性扫描

**判定流程（简化）：**
1. 检查 deny 规则 → 匹配则拒绝
2. 检查 allow 规则 → 匹配则放行
3. 检查 ask 规则 → 匹配则询问
4. 调用工具自身的 `checkPermissions()` → 工具根据模式和输入决定
5. 如果结果是 `ask`：
   - `dontAsk` 模式 → 转为 deny
   - `auto` 模式 → 先检查 acceptEdits 快速路径 → 再检查安全工具白名单 → 最后调用 AI 分类器
   - 其他模式 → 提示用户

**复杂度评估：** 极高。涉及 AI 分类器、deny tracking、hook 系统、多来源规则合并、MCP 工具名前缀处理等。CodePilot 不需要复刻全部。

### 2.2 OpenCode 的权限系统

**架构：双层设计**

**旧系统 (`permission/index.ts`)：** 基于 type + pattern 的内存审批
- `Permission.ask()` 检查已批准列表，未批准则创建 Promise 等待
- `Permission.respond()` 处理用户回复：`once` / `always` / `reject`
- `always` 会将 pattern 记入 approved map，后续相同 pattern 自动放行
- 支持 Plugin 钩子：`Plugin.trigger("permission.ask", ...)` 可拦截

**新系统 (`permission/next.ts` = `PermissionNext`)：** 基于规则集的判定
- 规则结构：`{ permission: string, pattern: string, action: 'allow'|'deny'|'ask' }`
- 从 Config 解析规则（支持 glob pattern + `~/` 展开）
- `evaluate()` 函数：对合并后的规则集做 `findLast` 匹配（后定义的规则优先）
- `ask()` 函数：遍历 patterns，逐个 evaluate → deny 抛异常、ask 创建 Promise、allow 继续
- `reply()` 函数：`once` 仅 resolve 当前、`always` 追加 allow 规则并自动 resolve 同 session 的其他匹配请求、`reject` 拒绝并级联拒绝同 session 所有 pending
- `disabled()` 函数：预计算哪些工具被 `deny *` 规则完全禁用（用于 UI 灰显）

**特点：**
- 规则使用 Wildcard glob 匹配（不是 regex）
- "后者优先"语义（findLast），配置可叠加覆盖
- `CorrectedError` 支持用户拒绝时附带修改建议（Agent 会重试）
- 尚未实现规则持久化到 DB（代码中 TODO 注释）

### 2.3 Craft Agents 的权限系统

**三级模式：**

| 模式 | 内部名 | 用户面名 | 行为 |
|------|--------|---------|------|
| safe | safe | Explore | 只读白名单，写入被拒绝，不弹审批 |
| ask | ask | Ask | 所有工具放行但危险操作弹审批 |
| allow-all | allow-all | Execute | 全部放行 |

**核心函数 `shouldAllowToolInMode()`：**
1. `allow-all` 模式 → 直接放行
2. `ask` 模式 → 直接放行（审批由上层处理）
3. `safe` 模式：
   - 白名单工具（Read, Glob, Grep 等）→ 放行
   - Bash 工具 → `getBashRejectionReason()` AST 分析
   - Write/Edit 工具 → 检查目标路径是否在 plans/data 文件夹内
   - 其他 → 拒绝并给出详细原因

**Bash 命令安全验证（`bash-validator.ts`）：**
- 使用 `bash-parser` 库将命令解析为 AST
- 递归验证 AST 节点：Script → Command → LogicalExpression → Pipeline → Subshell
- 对每个 Command 节点：
  - 检查是否有背景执行 (`&`)
  - 检查命名展开（`$(...)`, 反引号, 进程替换）
  - 检查重定向（只允许 `<`, `/dev/null`, `2>&1`）
  - 检查环境变量赋值（`PATH=...`）
  - 检查危险参数（`find -exec`, `awk system()`）
  - 最后用编译好的 regex 模式匹配完整命令字符串
- `mode-manager.ts` 额外的前置检查：
  - 控制字符检测（null byte）
  - 命令替换检测（`$()`, 反引号, `<()`）
  - Windows 路径规范化
  - 详细的拒绝原因格式化（包含 pattern mismatch 分析）

**MergedPermissionsConfig：** 支持从配置合并自定义：
- `allowedBashPatterns`: 额外的安全 bash 模式
- `allowedWritePaths`: 额外的可写路径（glob）
- `blockedCommandHints`: 被阻止命令的提示信息

### 2.4 对比总结

| 维度 | Claude Code | OpenCode | Craft Agents |
|------|------------|----------|--------------|
| **模式数量** | 6 | 3 (allow/deny/ask) | 3 (safe/ask/allow-all) |
| **规则格式** | `Tool(prefix:pattern)` | `{ permission, pattern, action }` | 编译后的 regex 模式列表 |
| **规则来源** | 7 层配置优先级 | Config 文件 + 运行时 | 内置 + 可合并配置 |
| **Bash 安全** | 工具自身 checkPermissions | 无专门处理 | AST 解析 + regex 白名单 |
| **AI 分类器** | 有（auto 模式） | 无 | 无 |
| **审批粒度** | allow/deny + updatedPermissions | once/always/reject | once/always/reject |
| **规则持久化** | settings.json 多层 | 未实现（TODO） | 内存 + DB (ModeState) |
| **复杂度** | 极高 | 中等 | 中高（Bash 验证复杂） |
| **CodePilot 适用性** | 过于复杂 | 规则引擎可借鉴 | 整体架构最适合 |

---

## 3. 推荐的自建权限方案

### 3.1 设计原则

1. **三级模式**：借鉴 Craft Agents 的 `explore / ask / auto-approve` 三级（用户面命名可调整）
2. **规则引擎**：借鉴 OpenCode 的 `{ permission, pattern, action }` 规则格式 + glob 匹配
3. **Bash AST 验证**：移植 Craft Agents 的 `bash-parser` + regex 白名单方案
4. **不搞 AI 分类器**：Claude Code 的 auto 模式分类器成本高、延迟大、对 CodePilot 场景价值有限

### 3.2 权限模式

```typescript
type PermissionMode = 'explore' | 'normal' | 'trust';

// explore: 只读模式，只允许白名单工具和安全 bash 命令
// normal:  默认模式，危险操作需要用户审批（当前行为）
// trust:   全部自动放行（当前的 full_access profile）
```

### 3.3 规则格式

```typescript
interface PermissionRule {
  /** 工具名或通配符。示例: "bash", "write", "mcp__*", "*" */
  tool: string;
  /** 匹配的内容/路径模式。示例: "git status*", "~/project/**" */
  pattern: string;
  /** 判定结果 */
  action: 'allow' | 'deny' | 'ask';
}

// 规则求值：后定义优先（findLast 语义，与 OpenCode 一致）
function evaluate(tool: string, content: string, rules: PermissionRule[]): 'allow' | 'deny' | 'ask' {
  const match = rules.findLast(rule =>
    globMatch(tool, rule.tool) && globMatch(content, rule.pattern)
  );
  return match?.action ?? 'ask'; // 默认需要审批
}
```

### 3.4 规则来源与合并

```typescript
// 三层配置，从低到高优先级
type RuleSource = 'builtin' | 'project' | 'session';

// builtin: 内置默认规则（只读工具白名单、安全 bash 模式）
// project: 项目级 .codepilot/permissions.json
// session: 用户在会话中通过 "Allow Session" 追加的规则

// 合并策略：flat concat，evaluate 时 findLast 自然实现优先级
const mergedRules = [...builtinRules, ...projectRules, ...sessionRules];
```

### 3.5 判定流程

```
工具调用 → permissionCheck(toolName, toolInput, mode, rules)
  │
  ├─ mode === 'trust' → 直接放行
  │
  ├─ 内部 MCP 工具 (codepilot_*) → 直接放行
  │
  ├─ evaluate(tool, content, rules)
  │    ├─ 'allow' → 放行
  │    ├─ 'deny'  → 拒绝 (返回错误信息给 Agent)
  │    └─ 'ask'   → 继续下一步
  │
  ├─ mode === 'explore'
  │    ├─ 白名单工具 (read, glob, grep, ...) → 放行
  │    ├─ bash → bashSafetyCheck(command)
  │    │    ├─ safe → 放行
  │    │    └─ unsafe → 拒绝 (附详细原因)
  │    └─ write/edit → 检查路径是否在允许范围 → 放行或拒绝
  │
  ├─ mode === 'normal'
  │    └─ 返回 'ask' → Agent Loop 暂停，发送审批请求给前端
  │
  └─ 用户决策
       ├─ Allow Once → 放行本次
       ├─ Allow Session → 放行 + 追加 session 规则
       └─ Deny → 拒绝 (可附带修改建议，借鉴 OpenCode CorrectedError)
```

### 3.6 与 Agent Loop 的集成点

自建 Agent Loop 中，权限检查发生在 **tool_use 执行前**：

```typescript
// agent-loop.ts 中的伪代码
for (const toolCall of assistantMessage.tool_uses) {
  const decision = await permissionCheck(
    toolCall.name,
    toolCall.input,
    sessionMode,
    mergedRules,
  );

  if (decision.action === 'deny') {
    // 返回 tool_result 告诉 Agent 被拒绝
    toolResults.push({
      tool_use_id: toolCall.id,
      content: `Permission denied: ${decision.reason}`,
      is_error: true,
    });
    continue;
  }

  if (decision.action === 'ask') {
    // 发送审批请求，暂停当前 tool 执行
    const userDecision = await requestPermission(toolCall, sessionId);
    if (userDecision.behavior === 'deny') {
      toolResults.push({
        tool_use_id: toolCall.id,
        content: `User denied: ${userDecision.message || 'Permission denied'}`,
        is_error: true,
      });
      if (userDecision.correction) {
        // 用户附带了修改建议，作为 guidance 返回
        toolResults.push({
          tool_use_id: toolCall.id,
          content: userDecision.correction,
          is_error: true,
        });
      }
      continue;
    }
    // allow — 可能有 updatedInput
    if (userDecision.updatedInput) {
      toolCall.input = userDecision.updatedInput;
    }
    // allow session — 追加规则
    if (userDecision.addRule) {
      sessionRules.push(userDecision.addRule);
    }
  }

  // 执行工具
  const result = await executeTool(toolCall);
  toolResults.push(result);
}
```

---

## 4. Bash 命令安全验证的实现方案

### 4.1 推荐方案：移植 Craft Agents 的 AST 验证

Craft Agents 的 `bash-validator.ts` 是目前开源方案中最完善的实现，建议直接移植。

**核心依赖：** `bash-parser` npm 包（POSIX bash AST 解析器）

**验证层次：**

```
输入命令字符串
  │
  ├─ 1. 控制字符检测 (null byte)
  │
  ├─ 2. bash-parser 解析为 AST
  │     失败 → 拒绝 (parse_error)
  │
  ├─ 3. 递归验证 AST 节点
  │     ├─ Command: 检查展开、重定向、env赋值、危险参数
  │     ├─ LogicalExpression (&&, ||): 两侧都必须安全
  │     ├─ Pipeline (|): 每个命令都必须安全
  │     ├─ Subshell: 内部命令都必须安全
  │     └─ 其他 (if/while/for/function): 拒绝
  │
  └─ 4. 对每个简单命令：regex 模式匹配
        ├─ 匹配白名单 → 安全
        └─ 不匹配 → 拒绝 (附详细原因)
```

**安全 bash 模式白名单（默认内置）：**

```typescript
const DEFAULT_SAFE_BASH_PATTERNS: BashPattern[] = [
  // Git 只读操作
  { pattern: /^git\s+(status|log|diff|show|branch|tag|remote|stash\s+list|rev-parse|ls-files|blame|shortlog|describe|config\s+--get)/, comment: 'Git read-only' },
  // 文件查看
  { pattern: /^(cat|head|tail|less|more|wc|file|stat|md5sum|sha256sum)\s/, comment: 'File viewing' },
  // 搜索
  { pattern: /^(grep|rg|ag|find|fd|locate|which|whereis|type)\s/, comment: 'Search' },
  // 目录浏览
  { pattern: /^(ls|tree|pwd|du|df)\b/, comment: 'Directory browsing' },
  // 环境信息
  { pattern: /^(echo|printf|date|whoami|uname|hostname|env|printenv)\b/, comment: 'Environment info' },
  // 包管理查询
  { pattern: /^(npm\s+(list|ls|info|view|outdated|audit)|pip\s+(list|show|freeze)|cargo\s+(tree|metadata))\b/, comment: 'Package queries' },
  // 进程查看
  { pattern: /^(ps|top|htop|pgrep|lsof)\b/, comment: 'Process viewing' },
];
```

**需要阻止的危险模式：**

| 类别 | 示例 | 检测方式 |
|------|------|---------|
| 命令替换 | `$(rm -rf /)` | AST: CommandExpansion 节点 |
| 进程替换 | `<(curl evil.com)` | AST: ProcessSubstitution 节点 |
| 参数展开 | `cat $HOME/.ssh/id_rsa` | AST: ParameterExpansion 节点 |
| 输出重定向 | `> file`, `>> file` | AST: Redirect 节点 (非 /dev/null) |
| 环境注入 | `PATH=/evil ls` | AST: prefix 中的 AssignmentWord |
| 后台执行 | `cmd &` | AST: Command.async === true |
| 危险子命令 | `find -exec`, `awk system()` | 命令参数黑名单 |

### 4.2 实现要点

1. **bash-parser 兼容性**：该库是纯 JS，可在 Node.js（Electron 主进程/Next.js server）中运行，无需 native 依赖
2. **Windows 支持**：需要移植 `normalizeWindowsPathsForBashParser()` 处理反斜杠路径
3. **自定义模式扩展**：允许项目级配置追加安全模式（如某些项目需要 `docker ps` 或 `kubectl get`）
4. **错误信息质量**：移植 `formatBashRejectionMessage()` 和 pattern mismatch 分析，让 Agent 理解为什么被拒绝、如何调整

---

## 5. 需要的改动点清单

### 5.1 新增文件

| 文件 | 职责 | 复杂度 | 优先级 |
|------|------|--------|--------|
| `src/lib/permissions/permission-engine.ts` | 权限判定引擎：模式管理 + 规则求值 | 中 | P0 |
| `src/lib/permissions/permission-rules.ts` | 规则格式定义、解析、合并、序列化 | 低 | P0 |
| `src/lib/permissions/bash-validator.ts` | Bash 命令 AST 安全验证（移植自 Craft Agents） | 高 | P0 |
| `src/lib/permissions/builtin-rules.ts` | 内置默认规则（安全工具白名单、bash 模式） | 低 | P0 |
| `src/lib/permissions/types.ts` | PermissionMode, PermissionRule, PermissionDecision 等类型 | 低 | P0 |

### 5.2 需修改的文件

| 文件 | 改动内容 | 说明 |
|------|---------|------|
| **Agent Loop（新建）** | 在 tool_use 执行前调用 `permissionEngine.check()` | 替代 SDK 的 canUseTool 回调 |
| `src/lib/permission-registry.ts` | 移除 SDK 类型依赖 `PermissionResult`，改用自定义类型 | 内存 Promise Map 逻辑可完全复用 |
| `src/app/api/chat/permission/route.ts` | 移除 SDK 类型导入，改用自定义 `PermissionDecision` | 接口逻辑不变 |
| `src/lib/bridge/permission-broker.ts` | 移除 SDK 类型导入 `PermissionUpdate` | 逻辑不变，仅类型替换 |
| `src/types/index.ts` | 新增 `PermissionMode`, `PermissionRule` 等类型 | — |
| `src/lib/db.ts` | 新增 `permission_rules` 表（存储 session 规则） | 可选：也可纯内存 |
| `src/hooks/useSSEStream.ts` | 不变（`permission_request` 事件格式保持兼容） | — |
| 前端审批 UI | 不变或微调（增加 mode 切换入口） | — |

### 5.3 可移除的 SDK 依赖

| 当前导入 | 来源 | 替代方案 |
|---------|------|---------|
| `PermissionResult` | `@anthropic-ai/claude-agent-sdk` | 自定义 `PermissionDecision` |
| `PermissionUpdate` | `@anthropic-ai/claude-agent-sdk` | 自定义 `PermissionRuleUpdate` |
| `canUseTool` 回调 | SDK Options | Agent Loop 内置权限检查点 |
| `permissionMode` | SDK Options | 自管理的 `PermissionMode` |

### 5.4 新增依赖

| 包名 | 用途 | 大小 |
|------|------|------|
| `bash-parser` | Bash 命令 AST 解析 | ~50KB |

### 5.5 实施顺序建议

```
Phase 1: 基础权限引擎 (与 Agent Loop 同步开发)
  ├─ 定义类型系统 (PermissionMode, PermissionRule, PermissionDecision)
  ├─ 实现规则求值引擎 (evaluate + glob match)
  ├─ 实现模式管理 (explore/normal/trust + 切换)
  └─ 在 Agent Loop 中集成权限检查点

Phase 2: Bash 安全验证
  ├─ 移植 bash-validator.ts (AST 解析 + 递归验证)
  ├─ 定义默认安全 bash 模式白名单
  ├─ 实现详细拒绝原因格式化
  └─ 支持项目级自定义模式扩展

Phase 3: 规则管理
  ├─ "Allow Session" 追加 session 规则
  ├─ 项目级 .codepilot/permissions.json 加载
  ├─ DB 持久化 session 规则 (可选)
  └─ 前端 mode 切换 UI

Phase 4: 高级特性 (可选)
  ├─ "Allow Always" 写入项目配置
  ├─ 用户拒绝时附带修改建议 (CorrectedError)
  ├─ disabled() 预计算 → 前端灰显不可用工具
  └─ Write/Edit 工具的路径范围检查
```

### 5.6 工作量估算

| Phase | 估算工时 | 依赖 |
|-------|---------|------|
| Phase 1 | 2-3 天 | Agent Loop 基础结构 |
| Phase 2 | 1-2 天 | Phase 1 |
| Phase 3 | 1 天 | Phase 1 |
| Phase 4 | 1-2 天 | Phase 2+3 |
| **总计** | **5-8 天** | — |

---

## 6. 风险与注意事项

1. **bash-parser 维护状态**：该库最后更新较早，需确认与当前 Node.js 版本兼容。Craft Agents 已在生产使用，风险可控。

2. **安全性降级风险**：自建系统初期可能遗漏某些危险模式。建议 Phase 1 默认使用 `normal` 模式（与当前行为一致），`explore` 模式作为 opt-in 特性逐步完善。

3. **IM Bridge 兼容性**：`permission-broker.ts` 和 `permission-registry.ts` 的核心逻辑（Promise Map + DB 审计 + IM 转发）完全不依赖权限判定逻辑，可直接复用。

4. **前端审批 UI 兼容性**：`permission_request` SSE 事件格式和 `/api/chat/permission` API 接口可保持完全兼容，前端改动量极小。

5. **Session 规则内存泄漏**：`allow session` 追加的规则需要随 session 清理。建议绑定到 session 生命周期管理中。
