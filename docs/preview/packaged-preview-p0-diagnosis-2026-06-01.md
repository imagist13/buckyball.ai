# Packaged Preview P0 Diagnosis — 2026-06-01

> 分支：`worktree-product-refactor-research`  
> 版本现象：`0.55.0-preview.4` 安装到另一台 Mac 后仍出现 P0  
> 状态：诊断文档；本文件不包含代码改动  
> 目标读者：Claude Code / Codex reviewer

## 用户反馈

用户在另一台电脑安装新版 preview 后，反馈三个明显问题：

1. Settings 里的概览、执行引擎、健康检查等页面长时间处于加载中。
2. 新聊天输入框长期显示“正在准备运行环境…”，模型一直像在加载。
3. Mac 顶部看不到 CodePilot 图标。

重要校正：

- 这不是当前开发机的问题。不要用当前机器 `/Applications` 或当前机器日志推断另一台电脑。
- 顶部图标在当前 worktree 的 dev 环境里可见，所以“React 顶栏没渲染图标”不是主因。

## 当前判断

### 日志实锤

用户补充的另一台电脑日志：

```text
/Users/op7418/Downloads/codepilot-main_副本 3.log
```

关键事实：

- `2026-06-01T05:33:43.083Z`：版本从 `0.55.0-preview.3` 升到 `0.55.0-preview.4`，说明用户测试的是新版包，不是旧包残留。
- `better_sqlite3.node ABI is compatible`：native module ABI 已修，不是本轮 P0。
- `2026-06-01T05:33:45.911Z`：CodePilot spawn 的 Codex 是 `/opt/homebrew/bin/codex`。
- 该 binary 立即输出：

```text
Failed to deserialize overridden config: unknown variant `xhigh`,
expected one of `minimal`, `low`, `medium`, `high`
in `model_reasoning_effort`
```

- 但它不是立刻让 CodePilot 侧完成失败：同一次 spawn 约 30 秒后才出现 `exited { code: 1 }`。因此“transport close 时 fast-fail”不足以解决用户体感卡顿，因为旧 Codex 会先把 fatal error 写到 stderr，然后拖到 RPC timeout/退出。
- 日志还出现多次：

```text
Claude Code compat API error: 503 Service Unavailable
分组 auto 下模型 sonnet 无可用渠道
```

这表示 preview.4 仍有一条链路会把裸 `sonnet` 发给某个 Claude Code compat / New API provider。它和 Codex app-server 失败是两条问题：前者影响 Claude Code 可发送性，后者拖住 Codex / Settings / model feed。

### 用户机器现场命令结果

用户在出问题的另一台 Mac 上执行定位命令，结果确认：

```text
== CodePilot version ==
0.55.0-preview.4

== codex on PATH ==
/opt/homebrew/bin/codex
/opt/homebrew/bin/codex

== codex versions ==
codex-cli 0.45.0
codex-cli 0.45.0
codex-cli 0.135.0-alpha.1

== codex config effort ==
2:model_reasoning_effort = "xhigh"
```

对应路径：

- PATH 第一命中：`/opt/homebrew/bin/codex` → `codex-cli 0.45.0`
- Codex.app binary：`/Applications/Codex.app/Contents/Resources/codex` → `codex-cli 0.135.0-alpha.1`

结论：

- 不是 preview 包版本问题。
- 不是 ABI 问题。
- 用户机器上确实存在旧 Homebrew Codex 抢优先级。
- 用户的 `xhigh` 配置对 Codex.app 新版本可接受，但对旧 `0.45.0` fatal。
- CodePilot 当前 discovery 策略把旧 PATH binary 放在 Codex.app fallback 前，因此稳定复现 P0。

临时绕过：

```bash
mv /opt/homebrew/bin/codex /opt/homebrew/bin/codex.old
```

然后完全退出并重启 CodePilot，让它 fallback 到 Codex.app binary。

备选绕过：

```bash
perl -pi -e 's/model_reasoning_effort = "xhigh"/model_reasoning_effort = "high"/' ~/.codex/config.toml
```

但这会降级用户自己的 Codex 配置，不是推荐产品路径。

### P0.1 Runtime / Settings 加载卡住

根因不是 `--listen` 旧 bug，也不是版本号没打进去，而是 **Codex 模型发现仍然会阻塞全局模型目录接口**，并且另一台机器上还触发了错误 binary 优先级：

1. CodePilot 优先选择了 PATH 里的旧 `/opt/homebrew/bin/codex`。
2. macOS app bundle 里的新 Codex 可能可用，但因为 PATH 优先，它没有被选中。
3. 旧 binary 对用户 `~/.codex/config.toml` 中的 `model_reasoning_effort = "xhigh"` 直接 fatal。
4. 旧 binary 写出 fatal stderr 后约 30 秒才退出，导致 UI 等待窗口仍然很长。

代码链路：

- `src/app/api/providers/models/route.ts`
  - 无 `runtime` 参数时会尝试 `await buildCodexProviderModelGroup()`。
  - `runtime=auto` 如果解析到 `codex_runtime`，也会进入同一条 Codex 模型发现路径。
- `src/lib/codex/models.ts`
  - `buildCodexProviderModelGroup()` → `listCodexModels()`。
  - `listCodexModels()` → `getCodexAppServer()` → JSON-RPC `model/list`。
- `src/lib/codex/app-server-client.ts`
  - 之前修过“子进程退出时 fast-fail”，但如果 app-server 进程活着、`initialize` 或 `model/list` 慢/卡住，仍会等默认 30s RPC timeout。
- `src/hooks/useProviderModels.ts`
  - `MessageInput` 使用它，并固定 fetch `/api/providers/models`。
  - 因此 full catalog 还没返回时，`fetchState === 'idle'`，输入框显示 `messageInput.placeholderLoading`。
- `src/components/settings/useOverviewData.ts`
  - Overview 用一个 `Promise.all` 同时等 `/api/providers/models?runtime=auto` 和 `/api/providers/models`。
  - 任意一个被 Codex 模型发现拖住，整个 Overview 都会显示 loading。
- `src/components/settings/RuntimePanel.tsx`
  - Codex status 自己走 `/api/codex/status`，这个接口不 spawn；但 RuntimePanel 同时还读取模型 feed 解释默认模型，所以仍可能被 `/api/providers/models` 间接拖慢。

因此新的修复标准应该是：

> Codex Account 模型发现是可选增强，不能阻塞 Chat / Settings 的基础可用性。Codex 坏了只能让 Codex 那一格 degraded，不能拖死整个 app。

### P0.1b Claude Code / New API 裸 `sonnet`

日志里的 `分组 auto 下模型 sonnet 无可用渠道` 是另一个 P0 级兼容问题。

需要排查：

- 用户 DB 里是否存在 legacy provider model row：`model_id = "sonnet"`，但 `upstream_model_id` 为空或仍为 `"sonnet"`。
- `resolveProvider()` / `toClaudeCodeEnv()` / Claude Code compat request path 是否只修了 env/default catalog，而没有修 DB legacy row。
- `/api/providers/models` 是否仍把裸 alias 当作可发送模型暴露给 Claude Code compat provider。

修复原则：

- 裸 `sonnet` / `opus` / `haiku` 在 Claude-family compat provider 上必须在 send 前规范化为真实 upstream id。
- 如果某个 provider 不支持 alias，picker 不能把 alias 当作可发送行。
- 要加 DB integration pin：legacy row `sonnet -> sonnet/null` 在 Claude compat provider 下 resolves to `claude-sonnet-4-6`，或被标记不可发送。

### P0.2 Mac 顶部图标

用户补充：当前 dev 环境能看到顶部图标。

所以不要优先改 `UnifiedTopBar` 的 React 渲染。更可能的 packaged 差异是菜单栏 / Tray 图标资源：

- Dev 路径：`getIconPath()` → `build/icon.png`
- Packaged macOS 路径：`getIconPath()` → `process.resourcesPath/icon.icns`
- `ensureTray()` 用 `nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })`

macOS Dock/app 图标可以用 `.icns`，但菜单栏小图标不应该直接用 `.icns` resize。应使用专门的 PNG/template image，并在 darwin 下 `setTemplateImage(true)`，保证深浅模式、透明菜单栏下可见。

## 修复要求

### P0 — 解耦 Codex 模型发现与全局可用性

1. Codex binary discovery 需要避免旧 PATH binary 压过新 Codex.app。
   - 保留 `CODEX_BIN` 最高优先级作为显式 override。
   - macOS packaged app 下，应优先考虑 `/Applications/Codex.app/Contents/Resources/codex`，或至少对 PATH candidate 做版本/能力探测；旧 `/opt/homebrew/bin/codex` 不能在已安装 Codex.app 时静默获胜。
   - 如果仍选择 PATH candidate，需要在日志里说明“selected binary + reason”，便于诊断。

2. 旧 Codex fatal stderr 要快速失败。
   - 仅靠 `proc.once('exit')` 不够；日志证明旧 binary 会先输出 fatal config error，再拖约 30 秒才退出。
   - 在 stderr 观察到 `Failed to deserialize overridden config` / `error loading config` / `unknown variant` 这类 fatal config error 时，应立即 reject pending initialize/model/list，并最好 kill 子进程。

3. `/api/providers/models` 不允许被 Codex Account 模型发现阻塞。
   - `runtimeFilter !== codex_runtime`：跳过 Codex。
   - 无 `runtime` 参数的 full catalog：不要隐式 spawn Codex。最多使用已有 cache；没有 cache 就跳过 `codex_account` group。
   - `runtimeFilter === codex_runtime`：可以尝试 Codex，但必须短超时，例如 1500-2500ms。超时返回无 Codex group + 记录 degraded reason，不拖住响应。

4. 给 Codex 模型 helper 增加显式选项。
   - 建议形态：`buildCodexProviderModelGroup({ allowSpawn, timeoutMs, cacheOnly })` 或等价 API。
   - 默认必须保守，避免 full catalog 无意 spawn app-server。

5. Settings Overview 不应一个 `Promise.all` 绑死全部卡片。
   - `/api/settings/app`、workspace、基础 runtime 信息先落地并结束主体 loading。
   - 模型库存 / manual counts 独立加载，失败或超时只影响模型卡片。

6. MessageInput 的“正在准备运行环境…”不应由 full catalog 背景加载独占驱动。
   - 如果当前 sendable provider/model 已解析，full catalog 还在后台加载时不要显示 placeholderLoading。
   - 或拆成 sendable feed 与 full catalog feed，输入框只依赖 sendable feed。

7. 修 Claude Code compat 裸 `sonnet`。
   - 复现日志里的 `分组 auto 下模型 sonnet 无可用渠道`。
   - 修 DB legacy model row / resolver / send path 的 alias normalization。
   - 回归测试必须覆盖 legacy DB row，不只覆盖 catalog default。

### P1 — Mac packaged Tray 图标

1. 不要用 `icon.icns` 作为 macOS Tray / menu bar 图标。
2. 新增或复用明确的 tray PNG/template asset，例如 `build/trayTemplate.png`。
3. darwin packaged 下 Tray 图标使用 PNG，并调用 `nativeImage.setTemplateImage(true)`。
4. Dock/app icon 继续使用 `build/icon.icns`，不要改 `mac.icon`。
5. `electron-builder.yml` 的 `extraResources` 需确认会把 tray asset 放入 `process.resourcesPath`。
6. 加 source pin：darwin Tray path 不得指向 `icon.icns`。

## 验证要求

### 自动测试

新增回归测试覆盖：

- Codex `model/list` 永不返回时，`/api/providers/models` 仍能在短时间内返回 Claude/env/DB providers。
- PATH 里存在旧 `/opt/homebrew/bin/codex`、同时 `/Applications/Codex.app/.../codex` 存在时，packaged darwin 不应静默选旧 binary。
- Codex stderr 出现 fatal config parse error 时，initialize/model/list pending request 必须快速失败，不等 30s。
- full catalog pending 时，如果当前可发送模型已解析，`MessageInput` 不显示“正在准备运行环境…”。
- Overview 的核心卡片不被 modelsAll 慢请求阻塞。
- Legacy DB row `sonnet` 在 Claude Code compat / New API provider 下不能原样发出导致 `model_not_found`。
- darwin packaged Tray 图标不使用 `icon.icns`。

### Packaged smoke

下一包必须在另一台机器或干净用户数据下验证：

| 场景 | 预期 |
|------|------|
| 打开 app | Settings / Chat 不因 Codex 慢启动而整体卡死 |
| Codex 未就绪或模型列表慢 | Codex 卡片显示 degraded/待启动；其他引擎可用 |
| 新聊天页 | 输入框不长期停在“正在准备运行环境…” |
| Claude Code 引擎 | 能看到模型并发送一条普通消息 |
| Codex 引擎 | 若 Codex 正常，模型列表出现；若异常，快速显示原因 |
| macOS 菜单栏 | CodePilot 图标在浅色/深色模式下均可见 |

## 需要从用户另一台电脑收集的证据

如果修复前继续诊断，优先让用户提供另一台电脑上的：

```bash
~/Library/Logs/codepilot/codepilot-main.log
```

重点搜索：

```text
codex.app-server
model/list
Codex RPC timeout
/api/providers/models
spawn_failed
initialize failed
```

可选命令：

```bash
defaults read /Applications/CodePilot.app/Contents/Info CFBundleShortVersionString
/Applications/Codex.app/Contents/Resources/codex --version
command -v codex
grep -n "model_reasoning_effort\|model" ~/.codex/config.toml
```

注意：这些命令必须在出现问题的另一台电脑上执行，本机结果不具备证明力。

## 不要做

- 不要把问题再次归因到当前开发机环境。
- 不要只改 Codex app-server `--listen` 或版本号；这些已有回归 pin，不解释当前 packaged 卡住。
- 不要通过 spawn 参数强行覆盖用户 `~/.codex/config.toml` 作为第一解。
- 不要把 Codex 模型发现失败升级成全 app 不可用。
- 不要用浏览器 Dev 环境证明 packaged Tray 图标没问题。

## 决策日志

- 2026-06-01: 用户澄清问题发生在另一台电脑；当前机器检查不能作为复现证据。
- 2026-06-01: 用户确认 dev 环境顶部图标可见，因此 P1 图标方向从 React 顶栏渲染改为 packaged Tray 资源路径差异。
- 2026-06-01: Codex 代码审查判断 `/api/providers/models` 仍可能被 Codex `model/list` 慢请求拖住，这是 Settings 和 MessageInput 长时间 loading 的共同入口。
- 2026-06-01: 用户提供另一台电脑日志。日志确认 `0.55.0-preview.4` 包仍选择旧 `/opt/homebrew/bin/codex`，该 binary 因 `xhigh` 配置 fatal，并且约 30 秒后才退出；同时暴露裸 `sonnet` 仍会打到 Claude Code compat provider 的独立问题。
- 2026-06-01: 用户在另一台 Mac 实跑定位命令，确认 PATH 只有 `/opt/homebrew/bin/codex` (`0.45.0`)，Codex.app 内置 binary 为 `0.135.0-alpha.1`，且配置含 `model_reasoning_effort = "xhigh"`。产品侧必须避免旧 PATH binary 抢过新 Codex.app。

## ✅ 实现状态（2026-06-01，本分支已提交）

| 项 | 修法 | commit | 验证 |
|----|------|--------|------|
| **P0.1** binary 发现 | 多候选 probe `codex --version` 选最高版本（`selectBestCodexCandidate`），旧 PATH 0.45 不再压过 .app 0.135；单候选不 probe；结果 memoize（带 test reset）；日志打印 selected binary + reason；CODEX_BIN 仍最高 | `0106b07` | 纯函数单测（旧 PATH + .app → 选 .app）+ source pin；真实 transport smoke |
| **P0.2** fatal stderr 快速失败 | stderr 命中致命配置错误即 `fireClose`（reject pending）+ SIGKILL，不等旧 codex 拖 ~30s 退出 | `0106b07`（P2 收窄 `2935340`） | `isFatalCodexConfigStderr` 正/反例（收窄后裸 `unknown variant` 无 config 上下文不致命）+ source pin；真实 smoke 386ms |
| **P0.3** 模型发现解耦 | `buildCodexProviderModelGroup/listCodexModels` 加 `cacheOnly/timeoutMs`；route：full-catalog `cacheOnly`（不 spawn）、`codex_runtime` 短超时降级、其它 runtime 跳过 | `d594fb0` | DI seam 单测（cacheOnly 0 spawn、hang→timeout reject）+ route source pin |
| **P0.4** 输入框/概览 loading | 输入框"准备运行环境"判据改 `idle && 无已解析模型`（`isComposerProviderLoading`）；概览 per-provider `?all=1` 移出阻塞阶段 | `9e85e5f`（顺带清 MessageInput #35 on-touch 债） | 纯函数真值表 + useOverviewData/prefill source pin |
| **P0.5** 裸 sonnet 规范化 | `canonicalAnthropicAliasUpstream`（固定映射）在 toClaudeCodeEnv + toAiSdkConfig 两条 send 路径；gate 收窄到"别名确在 availableModels（物化行）"以不违反旧多模型契约 | `75fdcc2` | DB 集成（物化 sonnet 行 → claude-sonnet-4-6）+ 纯函数 + 两路径 source pin |
| **P1** macOS Tray 图标 | 新增单色 template `build/trayTemplate.png(+@2x)`（`scripts/gen-tray-icon.mjs` 从品牌图标生成）；`getTrayIconPath` + darwin `setTemplateImage(true)`；electron-builder extraResources 带上；mac.icon 仍 .icns | `dad0197` | source/asset pin（Tray 不指 .icns、必 setTemplateImage、extraResources 含资产、Win/Linux 不变、资产存在）；minimatch 打包检查 |

- 全程 pre-commit 全套单测通过、无 `--no-verify`；typecheck 干净；累计 3154 单测全过。
- **待真机视觉验收（下一版 packaged 包，另一台 Mac）**：菜单栏图标明暗模式可见；Settings/Chat 不再整体卡死、Codex 异常仅 degraded；Claude Code 能发普通消息；（验收清单见上方「Packaged smoke」表）。
- Codex review（2026-06-01）：P0.1–P0.5 主线无阻塞；唯一 P2（fatal stderr 正则过宽）已在 `2935340` 收窄。
