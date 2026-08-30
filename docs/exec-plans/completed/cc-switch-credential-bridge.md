# cc-switch 凭据桥接：自动模式无法识别 `~/.claude/settings.json`

> 创建时间：2026-04-15
> 关联：`issue-tracker.md` B-001、Sentry `No provider credentials available`（1,462 events / 14d，Top 2）
> Issues：[#461](https://github.com/op7418/CodePilot/issues/461)、[#478](https://github.com/op7418/CodePilot/issues/478)、[#476](https://github.com/op7418/CodePilot/issues/476)、[#457](https://github.com/op7418/CodePilot/issues/457)、[#470](https://github.com/op7418/CodePilot/issues/470)

## 一、用户报告摘要

| # | 用户 | 平台 | 关键陈述 |
|---|---|---|---|
| 461 | patgdut | macOS | "0.46.0 以后的版本都无法使用最新的 Claude Code"，回退到 0.45 正常 |
| 461 | Theo-jobs | macOS | "本地通过 cc-switch 配置的，之前是可以的；走 API 可以，CLI 不行" |
| 461 | patgdut | — | "这个检测是不准的，你实际发一句 Who are you 是可以通的" |
| 478 | patgdut | — | "使用 cc-switch 后一直报错无法使用" |
| 476 | — | Windows | "配置 openrouter 一直提示不通过，cc-switch 切换后本地 claude 可以使用" |
| 466 | patgdut | — | 根因分析："打包版每次启动随机端口 → localStorage 清空"——另一类已知问题 |

**共同特征：**
- 都用 cc-switch 作为 Claude Code CLI 的凭据管理器
- CodePilot 侧没有在 UI 里配 provider（或配了也不是 cc-switch 那一套）
- 终端直接跑 `claude` 可用
- 在 CodePilot 里发消息报 "No provider credentials available"

## 二、事实核查

### 2.1 cc-switch 的凭据注入机制

查 `/Users/op7418/Documents/code/资料/cc-switch-main`：

**写入点 A：`~/.claude/settings.json` 的 `env` 块**

`src-tauri/src/config.rs:73-86` → `get_claude_settings_path()` 返回 `~/.claude/settings.json`（legacy 兼容 `claude.json`）。

`src-tauri/src/provider.rs:493-502`：
```rust
let settings_config = serde_json::json!({
    "env": {
        "ANTHROPIC_BASE_URL": self.base_url,
        "ANTHROPIC_AUTH_TOKEN": self.api_key,
        "ANTHROPIC_MODEL": model,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": haiku,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": sonnet,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": opus,
    }
});
```

**写入点 B：`~/.claude/config.json` 的 `primaryApiKey: "any"`**

`src-tauri/src/claude_plugin.rs:51-88` → 写入 `{"primaryApiKey": "any"}` 作为托管模式标记。

**cc-switch 不设 shell env、不设 system env、不写 CodePilot DB。** 一切都走 Claude Code CLI 的原生配置通道。

### 2.2 Claude Agent SDK 0.2.62 对 `settings.json` 的处理

`node_modules/@anthropic-ai/claude-agent-sdk/cli.js` 实测：

**settings.env 合并逻辑（压缩代码还原）：**
```js
if (A.env && typeof A.env === "object") {
  for (let [z, w] of Object.entries(A.env))
    if (typeof w === "string" && w.length > 0) {
      if (!rG6.has(z.toUpperCase())) K[z] = w;
    }
}
```

**`rG6` 黑名单（67 项，完整列表在 `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` 内）关键断言：**
- ❌ `ANTHROPIC_API_KEY` — **不在黑名单**，会被应用
- ❌ `ANTHROPIC_AUTH_TOKEN` — **不在黑名单**，会被应用
- ❌ `ANTHROPIC_BASE_URL` — **不在黑名单**，会被应用
- ✅ `ANTHROPIC_MODEL` — 在黑名单（被剥）
- ✅ `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` — 在黑名单（被剥）
- ✅ `CLAUDE_CODE_SUBAGENT_MODEL` — 在黑名单（被剥）

**结论：只要 SDK 的 `settingSources` 包含 `'user'`，cc-switch 写的认证三项会被 SDK 应用到子进程 env；但模型名会被剥。**

### 2.3 CodePilot 的凭据检测链路（问题核心）

`src/lib/runtime/registry.ts:50-81` — **`hasCredentialsForRequest()`**（auto mode 的路由决策依据）：

```ts
function hasCredentialsForRequest(providerId?: string): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  if (getSetting('anthropic_auth_token')) return true;  // CodePilot 自己的 DB
  if (providerId === 'env') return false;
  if (providerId && providerId !== 'env') {
    const p = getProvider(providerId);
    if (p?.api_key) return true;
    // ...
  }
  for (const p of getAllProviders()) {
    if (p.api_key) return true;
    // ...
  }
  return false;
}
```

**检测源只有三个：**
1. `process.env.ANTHROPIC_*`
2. `getSetting()` 读 CodePilot 自己的 DB（`sdk_settings` 表）
3. CodePilot DB 的 `providers` 表

**完全没有读 `~/.claude/settings.json` 的 `env` 块。**

### 2.4 auto 模式路由到 native runtime → 死路

`src/lib/runtime/registry.ts:92-132` — **`resolveRuntime()`**：
```ts
// 3. Auto: prefer SDK only if CLI exists AND Anthropic credentials are available.
const sdk = getRuntime('claude-code-sdk');
if (sdk?.isAvailable() && hasCredentialsForRequest(providerId)) return sdk;

const native = getRuntime('native');
if (native?.isAvailable()) return native;
```

cc-switch 用户在 auto 模式下：
- `sdk.isAvailable()` = true（CLI 二进制存在）
- `hasCredentialsForRequest()` = **false**（看不到 settings.json）
- → 走 native runtime

Native runtime 调 `src/lib/ai-provider.ts:56` → `createModel()`：
```ts
export function createModel(opts: CreateModelOptions = {}): CreateModelResult {
  const resolved = resolveProvider({ ... });
  if (!resolved.hasCredentials && !resolved.provider) {
    throw new Error(
      'No provider credentials available. Please configure a provider in Settings or set ANTHROPIC_API_KEY.',
    );
  }
  ...
}
```

对应 Sentry Top 2 指纹：`No provider credentials available. Please configure a provider in Settings or set ANTHROPIC_API_KEY.` 1,462 events / 14d。

**Native runtime 用 Vercel AI SDK 直连 API，完全不走 `~/.claude/settings.json`。** 即便手动强制 native，也无法用 cc-switch 的配置。

### 2.5 手动切换到 "Claude Code SDK" runtime 是唯一现成 workaround

若用户在设置里把 `agent_runtime` 改成 `claude-code-sdk`（不是 auto）：
- `resolveRuntime()` line 110-112 显式分支 → 返回 SDK runtime
- 走 `claude-client.ts:498 streamClaudeSdk()` 路径
- `src/lib/provider-resolver.ts:653` env 模式 `settingSources: ['user', 'project', 'local']`
- SDK 子进程加载 `~/.claude/settings.json` → merge auth env → 实际可用

但绝大多数用户不会主动改这个设置，就看到"No provider credentials available"就走了。

### 2.6 dead code 确认：`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`

`src/lib/provider-resolver.ts:314-318`：
```ts
// Prevent ~/.claude/settings.json from overriding CodePilot's provider configuration.
// When set, Claude Code CLI's withoutHostManagedProviderVars() strips all provider-routing
// variables from the user's settings file (see upstream managedEnv.ts / managedEnvConstants.ts).
env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1';
```

`grep CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST node_modules/@anthropic-ai/claude-agent-sdk/cli.js` → **0 hits**。

SDK 0.2.62 里根本没有这个变量，也没有 `withoutHostManagedProviderVars` 函数。引用的 `managedEnv.ts / managedEnvConstants.ts` 也不存在于当前 SDK 版本。这是 **死代码**（可能来自更早的 SDK 版本或设计稿）。不主动引发 bug，但注释误导。

引入 commit：`6324490 feat: provider governance Phase 1+2 — schema validation, authStyle fixes, host takeover` （2026-04-04，v0.47.0 发布时）。

### 2.7 用户说 "0.46.0 就不行了" 的真实对应

| 版本 | 日期 | 关键变更 | 影响 |
|---|---|---|---|
| v0.46.0 | 2026-04-04 00:04 | `89d3e97` Ollama 支持等 | 未直接涉及凭据链 |
| v0.47.0 | 2026-04-05 00:27 | `6324490` host takeover（引入 MANAGED_BY_HOST 死代码） | 无功能影响 |
| v0.48.0 | 2026-04-09 13:47 | `fc61c69` auto mode checks Anthropic creds before preferring SDK (#456) | **引入** |
| v0.48.1-2 | 2026-04-11 | `a4c72e4` hasCredentialsForRequest + 3 轮修复 | **问题锁死** |

**真实转折点：v0.48.0。** 用户说"0.46 以后"可能是版本记忆误差，或者他们在 0.46 升级到 0.48 后才稳定报错。

### 2.8 #474 不是本 bug

抓 `#474` 附件 `codepilot-doctor-2026-04-13.json`：
- 用户 provider ID: `b00e9f73e2b99e8e5be017de37cc3926`，name: "Anthropic Third-party API"
- `hasCredentials: true`, authStyle: api_key
- `liveProbe: "Live probe timed out after 15s"`
- base URL: `http://model.mify.ai.srv/anthropic` — 内部 DNS，外部不可达

#474 的根因是第三方内部 API 不可达 + 模型名未指定（doctor warn "no-explicit-model"）。但 runtime logs 里 `[agent-loop] Error: No provider credentials available` 出现 3 次 —— **这说明 agent-loop 路径调用 `createModel({})` 时传了空 opts，没带 `providerId`**。是另一个独立 bug（runtime→createModel 的 providerId 透传丢失），不在本 issue 范围，单独跟进。

## 三、影响范围

### Sentry 定量信号（最近 14d）

- `No provider credentials available. Please configure a provider in Settings or set ANTHROPIC_API_KEY.` — **1,462 events**
- `Claude Code process exited with code 1` — 7,501 events（包含 cc-switch 用户被迫走 CLI 失败的部分）
- `AI_NoOutputGeneratedError` — 1,279 events（部分由 SDK 子进程被错路由到 native 导致）

### GitHub Issues 定性信号

- 5 个 open issue 明确提到 cc-switch（#461/#478/#476/#457/#470 含相关评论）
- 多位用户明确建议"回退到 0.45/0.46"
- 社区信任受损：#466 用户建议"加内测版"

## 四、修复方案

### 改动 1（核心）：凭据探测识别 `~/.claude/settings.json`

**新建** `src/lib/claude-settings.ts`：
```ts
/**
 * Read Anthropic credentials from ~/.claude/settings.json (or legacy claude.json).
 * This file is managed by external tools like cc-switch, which don't set shell env.
 * Returns null when the file is missing, unparseable, or has no credentials.
 */
export interface ClaudeSettingsCredentials {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
  model?: string;
}
export function readClaudeSettingsCredentials(): ClaudeSettingsCredentials | null;
```

**改动点：**
- `src/lib/runtime/registry.ts hasCredentialsForRequest()`：在现有检查开头加入 settings.json 读取
- `src/lib/provider-resolver.ts buildResolution()` env-mode 分支：`envHasCredentials` 加入 settings.json 作为来源，`settingSources` 保持 `['user','project','local']`

**效果：** auto 模式对 cc-switch 用户返回 SDK runtime → SDK 子进程加载 settings.json → 子进程得到 `ANTHROPIC_AUTH_TOKEN / BASE_URL` → 正常工作。

### 改动 2（清理）：移除死代码 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`

`src/lib/provider-resolver.ts:314-318` 直接删除。注释换成简短说明"SDK 自行负责加载 settings.json，黑名单由 SDK 内部维护"。

### 改动 3（UX）：改进错误消息

`src/lib/ai-provider.ts:66` 当 `~/.claude/settings.json` 存在凭据但 native runtime 被显式选择时，抛出更具体的错误：
```
"~/.claude/settings.json has credentials but Native runtime cannot read them.
Switch to Claude Code SDK runtime in Settings, or add the provider to CodePilot directly."
```

### 改动 4（回归测试）

`src/__tests__/unit/claude-settings-credentials.test.ts`：
- `settings.json` 含 `env.ANTHROPIC_AUTH_TOKEN` → `hasCredentialsForRequest()` 返回 true
- `settings.json` 不存在 → 返回 false（不抛错）
- `settings.json` 是 malformed JSON → 返回 false（不抛错）
- `settings.json` 有 `env` 但无 auth key → 返回 false
- env var 和 settings.json 都有 → 返回 true（不重复）
- legacy `claude.json` 兼容读取

## 五、验收方法

### 手动复现

**前置：** 清空 CodePilot 的所有 provider + 清空 shell env 的 `ANTHROPIC_*`。

**复现步骤（修复前应失败）：**
1. 安装 cc-switch，配一个第三方 Claude 中转（如 PackyCode / AICodeMirror）
2. cc-switch 切换到该 provider，确认 `~/.claude/settings.json` 写入
3. 终端跑 `claude`，确认能用（发一句 "who are you"）
4. 打开 CodePilot，启动新对话，发 "who are you"
5. **预期旧版：** "No provider credentials available..."
6. **预期修复版：** 正常返回回复

### 自动化回归

```bash
npm run test  # 覆盖新增单测
```

### Sentry 跟踪

修复发布后 72h 观察：
- `No provider credentials available` 指纹 daily count 应下降
- 不会出现新增的"cc-switch 相关"指纹

## 六、非目标 / 后续项

- **不做** 在 UI 里显式"检测到 cc-switch 托管"的 banner（改动 1 已足够让功能可用；UI 提示可以后续补）
- **不做** model 名从 settings.json 恢复（SDK 黑名单挡住，且 CodePilot 已有 model 选择器，不是痛点）
- **不做** `~/.claude/config.json` 的 `primaryApiKey: "any"` 检测（可选特性，后续可用于 UI 提示）
- **不做** 修复 `#474` 的 agent-loop providerId 丢失（单独跟进）

## 七、决策日志

- **2026-04-15** — 初次分析，确认根因在 `hasCredentialsForRequest` 不读 settings.json；确认 SDK 的 `rG6` 黑名单不包含 auth 键，因此改动 1 即可让 cc-switch 用户恢复
- **2026-04-15** — 放弃 "让 native runtime 也读 settings.json" 方案：native runtime 用 Vercel AI SDK，和 CLI 的 settings.json 语义不同（没有 MCP / hooks / skills 配置），硬读会引入不一致行为；改为在 native runtime 失败时给清晰错误引导用户切 runtime
- **2026-04-15** — 决定把 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` 设置删掉而非保留：当前 SDK 0.2.62 不识别此变量，未来 SDK 若真加入同名 flag 且语义一致，我们的代码逻辑已经改为信任 SDK 的黑名单机制，不需要再宣称"我们托管了"
- **2026-04-15 review 后跟进** — code review 指出删了 MANAGED_BY_HOST 之后没有任何机制阻止 SDK 把 `~/.claude/settings.json` 的 env 块应用到子进程：SDK 的 `qZq()` 在 `settingSources` 含 `'user'` 时会把 settings.env 写进 process.env，覆盖掉 CodePilot spawn 时注入的 provider auth。初次补丁：**DB-backed provider 的 `settingSources` 改为 `['project', 'local']`（不含 'user'）**
- **2026-04-15 第二轮 review 推翻首轮补丁** — reviewer 正确指出代价评估错误：我原以为只失去 `~/.claude/CLAUDE.md` 和 hooks，实际 SDK 的多个用户级能力都依赖 `settingSources: ['user']` 自动发现（user-level MCP、plugins、hooks、CLAUDE.md），dropping 'user' 会让显式配 DB provider 的所有用户都丢这些能力。回退 settingSources 改动。
- **2026-04-15 第三轮 review 提出"按 provider group 决定凭据归属"原则**：
  - env group（provider_id='env'）→ 完全尊重 Claude Code 自己的来源（settings.json + cc-switch）
  - DB provider 显式选中 → auth/baseURL/model 必须仅以 DB provider 的配置为准；settings.json 的 ANTHROPIC_* 不得覆盖
  - **但** 要保留 user-level 非认证配置（MCP/plugins/hooks/CLAUDE.md）
  - auto/SDK/native 只决定 runtime 选择，不改变凭据归属语义
- **最终方案（实施）：per-request shadow `~/.claude/`**
  - 新增 `src/lib/claude-home-shadow.ts` 提供 `createShadowClaudeHome({ stripAuth })`
  - DB provider 路径下：建立临时目录，`.claude/settings.json` 是剥离 `ANTHROPIC_*` keys 的副本（但保留 mcpServers / hooks / enabledPlugins / permissions / apiKeyHelper / 非认证 env entries 等所有非认证字段），其余 `~/.claude/<entry>` 通过 symlink（Unix）/ junction（Windows 目录）/ copy（Windows 文件 fallback）镜像
  - SDK 子进程的 HOME / USERPROFILE 指向 shadow root → SDK 的 `qZq()` 读到剥离版 settings.json → 不再覆盖 CodePilot 注入的 provider auth
  - env 模式 + 未指定 provider 模式：直接 pass-through 到真实 HOME（cc-switch 路径完全不变）
  - cleanup 在 stream 的 finally 块里做，best-effort
  - `runtime/registry.ts hasCredentialsForRequest()` 同步收紧：DB provider 路径只看 DB provider 自身的 api_key，不再用 settings.json 兜底（避免 "用户配错 Kimi 但被 cc-switch 静默救活" 的隐式 fallback）
- **验收回归测试：** `claude-home-shadow.test.ts`（12 个 case）+ `claude-settings-credentials.test.ts` 新增 3 个 provider-group ownership case，覆盖：env+settings.json / DB+settings.json 共存 / DB 配错 key 不被救活 / shadow 保留 mcpServers + hooks + enabledPlugins + apiKeyHelper / shadow 保留 user-level skills/agents/commands/plugins 子目录 / cleanup 真实删除
- **2026-04-15 第五轮 review：project/local 层 bleed**
  - reviewer 指出 shadow HOME 只覆盖 user 层；`<cwd>/.claude/settings.json` / `<cwd>/.claude/settings.local.json` 的 env 块仍可越权（SDK `qZq()` 对 user/project/local 三层都做 `process.env[K]=settings.env[K]`）
  - 评估了"shadow workspace（cwd 镜像）"：行不通——文件创建工具（Edit/Write）操作相对路径，新建文件会落在 shadow 而不是真实 cwd
  - 改用 reviewer 建议的另一条路："stop exposing those layers + 显式保留我们需要的非认证功能"
  - **DB provider settingSources 收紧为 `['user']`**（drop 'project' + 'local'）
  - 新增回归测试 `provider-resolver-fixes.test.ts`：DB provider settingSources === `['user']`，且断言不含 'project'/'local'
- **2026-04-15 第六轮 review：drop 'project' 把项目 `.mcp.json` 也搂走了**
  - reviewer 指出我先前对 mcp-loader contract 的理解有误：mcp-loader 用 `process.cwd()` 读 `.mcp.json`，而 Next.js server 的 cwd 不是用户项目目录，所以那条路径**根本不准**；真正生效的是 SDK 通过 'project' settingSource 自动加载 `<userCwd>/.mcp.json`
  - drop 'project' 后，团队 check-in 的 `.mcp.json` 项目级 MCP 也跟着丢了（这些是 auth-neutral 的，本不该被 trade-off 掉）
  - 修复：在 `mcp-loader.ts` 新增 `loadProjectMcpServers(cwd)` 显式从指定 cwd 读 `.mcp.json` 并解析 `${...}` 占位符；`claude-client.ts streamClaudeSdk` 在 DB provider 路径下调用并合并到 `queryOptions.mcpServers`，让 SDK 通过显式 Options 拿到这些 MCPs
  - 名字冲突时优先级：CodePilot UI 管理 / placeholder 解析后的 servers > 项目 `.mcp.json`（用户当前选择层 > 团队默认层）
  - 仅在 `streamClaudeSdk` 实施；`generateTextViaSdk`（cwd=os.homedir）和 `runLiveProbe`（cwd=os.tmpdir）的 cwd 不是用户项目目录，无相关 .mcp.json
  - 新增回归测试 `project-mcp-injection.test.ts`（9 个 case）：基本读取、无 .mcp.json 时返回 undefined、disabled servers 过滤、`${...}` 占位符解析、缺失占位符 → 空字符串、malformed JSON 不抛错、缺失 mcpServers 字段、空对象返回 undefined
- **2026-04-15 第七轮 review：`loadProjectMcpServers` 漏了 `mcpServerOverrides`**
  - reviewer 指出我新写的 helper 没有应用 `~/.claude/settings.json` 的 `mcpServerOverrides`——这是 CodePilot MCP Manager UI 持久化"我把这个 server 关了"或"我把这个 server 强制开"的位置（原始 `loadAndMerge` 是有这层处理的，见 `mcp-loader.ts:57-62`）
  - 后果：DB-provider 会话可能会**默默重新启用**用户在 UI 里关掉的项目 MCP，或反过来——UI 状态和 SDK 实际加载之间出现分裂
  - 修复：`loadProjectMcpServers` 也读 `~/.claude/settings.json` 的 `mcpServerOverrides`，UI override 的优先级**高于** `.mcp.json` 文件里的 `enabled` 字段（与 `loadAndMerge` 完全一致）
  - 新增 4 个回归 case：UI 关掉一个 → 真关；UI 开启一个 file 关的 → 真开；混合 override 只影响 named server；无 settings.json 不崩
- **2026-04-15 第四轮 review 三个收尾点全修：**
  - **[P1] shadow HOME 漏镜像 `~/.claude.json`**：之前只镜像 `~/.claude/` 子树，但 `~/.claude.json`（HOME 根级，存放用户级 MCP servers，见 `mcp-loader.ts:46`）当 HOME 指向 shadow 时 SDK 看不到了 → 显式 DB provider 用户会静默丢掉 `.claude.json` 里的 MCP。修复：`createShadowClaudeHome` 同步镜像 `~/.claude.json`（也走 `stripAuthEnv`），`settingsJsonHasAuthOverride()` 检测两个文件，shadow 触发条件改为"任意一个文件有 auth env"
  - **[P2] `generateTextViaSdk()` 之前没接入 shadow HOME**：被 `context-compressor`、`cli-tools/[id]/describe` 等辅助路径调用，绕过了 provider-group ownership → cc-switch 仍会污染辅助请求。修复：抽出共享 helper `prepareSdkSubprocessEnv()`（`src/lib/sdk-subprocess-env.ts`），`generateTextViaSdk` 改用 helper + try/catch/finally 里 cleanup
  - **[P2] Provider Doctor `runLiveProbe()` 之前也没接入**：诊断仍走真实 HOME，可能"诊断绿、聊天红"或反过来的分裂 → 同样改用 helper
  - **架构原则**：凡是会调 Claude SDK 的入口都共享同一套 `prepareSdkSubprocessEnv` 助手，避免逻辑分叉。当前 3 个调用点：`streamClaudeSdk` / `generateTextViaSdk` / `runLiveProbe`
  - **新回归测试**：`claude-home-shadow.test.ts` 新增 4 个（mirror `~/.claude.json` 的 mcpServers / 同时剥 `.claude.json` 的 auth env / `.claude.json` 不存在时不伪造 / settingsJsonHasAuthOverride 也检 `.claude.json`）；`sdk-subprocess-env.test.ts` 新增 3 个（env 模式 passthrough / DB provider 走 shadow / cleanup 幂等）
