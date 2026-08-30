# Windows Runtime / 路径兼容性修复交接与复查手册

> 对应执行记录：[Windows Runtime / 路径兼容性收口](../exec-plans/completed/windows-runtime-path-compatibility.md)
>
> 目标读者：另一台 Windows 电脑上的开发者或独立审查模型。本文记录事实、实现边界、参考项目证据和可重复的复查步骤；不能把本文的“测试通过”替换成目标机器上的真实 smoke。

## 1. 用户问题与本轮结论

用户在 Windows 的游戏项目目录中通过 CodePilot 执行分析任务时，Agent 无法读取文件；已知目录可能包含中文、空格和合法特殊字符。与此同时，本机已安装 ChatGPT/Codex 桌面应用，但 CodePilot 的 Codex Runtime 长期不可用。用户要求同时审计 Native、Claude Code、Codex 三条 Runtime 以及 Windows 沙盒、安装路径和开发脚本。

本轮定位到的主要根因不是单一“中文路径 bug”，而是五类边界叠加：

1. Native Runtime 的 Bash 工具固定启动 `bash`，Glob/Grep 在无 `rg` 时固定回退 Unix `find/grep`，与 Windows 原生环境不匹配。
2. 命令、CWD 和用户路径经过多层 shell 解析；中文、引号、空格及 `()`、`&`、`$` 被编码损坏或被过度判为注入。
3. 会话、Bridge、后台任务各自解析工作目录，失败时可能静默回退到 HOME，造成“打开的是游戏项目，Agent 读的却是别处”。
4. Codex discovery 把 Microsoft Store/MSIX 应用受保护目录内的 `codex.exe` 当作普通独立 CLI；文件存在不代表 CodePilot 能启动 `app-server`。
5. npm scripts、测试辅助脚本和构建期 scheduler 含 POSIX 假设或会在受限 Windows 令牌下访问用户目录。

当前实现把这些问题拆成平台 Shell、无 shell 搜索回退、统一 CWD、真实 CLI 探测、原生 realpath 和 Windows 开发脚本六个边界处理。没有绕过 Windows ACL/沙盒，也没有把不可执行的 Codex 桌面 bundle 伪报为可用。

## 2. 当前仓库状态（跨电脑前必读）

- 审查基线：`ee38205dafc7c5f93838005451da546729d1e78f`。
- Windows 路径兼容与后续恢复加固已通过 `b70c0c10..fcea977d` 的 5 个提交进入并推送到 `origin/main`；另一台电脑拉取 `main` 后可以直接复查，不再寻找旧工作区中的“未提交改动”。
- 独立审查应先确认 `git rev-parse HEAD` 至少包含 `fcea977d`，再用 `git diff ee38205d..fcea977d` 查看原始 Windows 批次；若主分支已有后续 review remediation，则以实际提交范围和本计划/交接的最新记录为准。
- Windows 受限令牌下可能出现 Git `dubious ownership`。审查时先确认真实登录用户、仓库 owner SID 与执行令牌；不要为消除提示而无条件写全局 `safe.directory=*`。

相对上述基线新增的文件包括：

- `.gitattributes`
- `scripts/node-user-info-compat.cjs`
- `scripts/run-node-tests.mjs`
- `scripts/start-electron-dev.mjs`
- `scripts/lint-colors.mjs`
- `src/lib/tools/search-fallback.ts`
- `src/__tests__/unit/bridge-working-directory-validator.test.ts`
- `docs/exec-plans/completed/windows-runtime-path-compatibility.md`

本交接文档自身也需要随上述改动一起传到另一台电脑。

## 3. 实现地图

### 3.1 Native Shell 与文件搜索

| 边界 | 实现 | 复查重点 |
|------|------|----------|
| Shell 启动 | `src/lib/tools/bash.ts` 的 `buildShellLaunch()` | Windows 默认 PowerShell；固定使用 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` 的绝对路径，禁止由仓库 CWD shadow 裸 `powershell.exe`；命令通过 UTF-16LE `-EncodedCommand` 传入，CWD 仍是 `spawn` 的独立字段 |
| Glob/Grep | `src/lib/tools/glob.ts`、`grep.ts`、`search-fallback.ts` | 保留 `rg` 快速路径；无 `rg` 时使用 Node 文件 API，不可信正则在可 timeout/abort Worker 内执行；隐藏文件默认排除，文件/行长/结果/扫描量/时间上限 fail closed，不再依赖 `find/grep`。Nested `.gitignore` 完整语义仍见 tech-debt #79 |
| 系统提示 | `src/lib/agent-system-prompt.ts` | OS/Git 探测不再使用 `uname`、`2>/dev/null` 等 Unix shell 语法 |

这里最重要的契约是：路径作为数据传给 `cwd`/Node API，命令才进入 shell。不要把修复退化成不断给用户路径添加引号或反斜杠。

### 3.2 工作目录与路径安全

| 边界 | 实现 | 复查重点 |
|------|------|----------|
| 统一 CWD | `src/lib/working-directory.ts`、`src/lib/claude-client.ts`、`src/lib/bridge/conversation-engine.ts`、`bridge-manager.ts` | requested/session/default/HOME 的来源可解释；请求目录存在时不得静默换成 HOME |
| Bridge 校验 | `src/lib/bridge/security/validators.ts` | 仍要求绝对路径、目录存在、长度和控制字符安全；不再把 Windows 合法路径字符一律当 shell 注入 |
| 原生 canonical path | Asset、HTML、Harness Home、Codex MCP、Memory、workspace organizer 等路径边界 | Windows 使用 `fs.realpathSync.native`，避免 Node JS realpath 对父目录逐级 `lstat` 时被受限令牌拒绝 |
| 原子写 | `src/lib/harness-home/repository/transaction.ts` | Windows 文件 fsync 使用可刷盘的 `r+` 句柄；保留 fsync + rename，不降低持久性 |

### 3.3 Codex Runtime

关键文件：

- `src/lib/codex/app-server-manager.ts`
- `src/lib/codex/types.ts`
- `src/components/settings/RuntimePanel.tsx`
- `src/__tests__/unit/codex-binary-discovery.test.ts`

发现顺序现在区分：显式 `CODEX_BIN`、PATH、Windows 独立安装目录、桌面应用候选。Windows `.cmd/.bat` shim 通过命令解释器探测，普通 `.exe` 直接探测；桌面/MSIX bundle 必须通过实际版本/启动探测，不能仅以 `existsSync` 判定。

当前机器实测状态：

```json
{
  "kind": "desktop_only",
  "binary": "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.730.8199.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe",
  "reason": "desktop_bundle_not_executable"
}
```

这个结果表示“检测到桌面应用，但它不是 CodePilot 可启动的独立 CLI”，不是“Codex 已经可用”。设置页会给出恢复动作：在 PowerShell 运行官方独立安装命令，或把 `CODEX_BIN` 指向真正可执行的 CLI：

```powershell
irm https://chatgpt.com/codex/install.ps1 | iex
```

安装后必须新开终端或刷新环境，再检查 `where.exe codex`、`codex --version` 和 app-server 启动；不能只看开始菜单里是否有 Codex 图标。

#### 为什么 macOS Desktop bundle 能复用，Windows Store bundle 不能

差别主要在分发/操作系统安全边界，不在 Codex app-server 协议：

| 层次 | macOS `.app` | Windows Store/MSIX |
|------|--------------|--------------------|
| bundle 路径 | `/Applications/ChatGPT.app/Contents/Resources/codex` | `C:\Program Files\WindowsApps\OpenAI.Codex_*\app\resources\codex.exe` |
| 外部进程访问 | bundle 内 CLI 是当前用户可直接执行的普通 Mach-O 文件 | `WindowsApps` 由 package ACL/identity 管理；内部资源存在不代表普通 Electron child process 有权执行 |
| 公共入口 | CodePilot 可直接运行 `codex --version`，再启动 `codex app-server` | Store Desktop 没有为 CodePilot 提供已验证的公共 CLI 入口；本机对内部路径的 `--version` 探测失败 |
| 资源/沙盒 | CLI 从 `.app` 内的稳定资源布局运行 | Windows Codex 还依赖 sandbox setup/command-runner 等 sibling resources、ACL/UAC 初始化；绕开官方 launcher 可能让 helper resolution 再次失效 |
| CodePilot 判定 | 版本探测成功即可作为 candidate，并与 PATH 版本比较取较新者 | 仅标记 `desktop_only`；官方 standalone 或能通过探测的 app execution alias 才能进入 app-server 链路 |

因此，这不是“Windows 版没有 app-server”，而是“Store 安装没有向第三方客户端暴露一个当前可安全复用的 CLI process boundary”。官方 standalone 安装完成后，CodePilot 仍使用同一套 stdio JSON-RPC app-server、account/model 和 turn 协议。

#### 哪些能力可以利用

| 方向 | 结论 | 利用方式 |
|------|------|----------|
| Desktop 安装信号 | 可直接利用 | 显示已安装版本/路径和 `desktop_only` 诊断，引导安装 standalone；不能显示成 ready |
| `codex --version` 能力探测 | 可直接利用 | 不按目录名猜测。未来 Store 若注册了真正可执行的 app alias，现有 probe 会自动把它升级为可用 candidate |
| app-server 协议 | 可直接利用 | standalone 可用后复用现有 initialize、account、model/list、turn、MCP 与 provider proxy 实现，无需另写 Windows Runtime |
| 用户 `~/.codex` Harness 输入 | 有边界地利用 | `home-isolation.ts` 把 config、skills、rules 等镜像到 CodePilot-owned home；凭据仅走明确的 symlink/hardlink/copy fallback，并输出诊断 |
| 官方 standalone installer | 可利用 | 在 `desktop_only` 状态提供官方 PowerShell 命令；未来可做需要用户明确确认的一键安装/修复 |
| 运行中 Desktop 的进程/私有 IPC | 不应利用 | 没有稳定公开契约，生命周期、pipe/stdio ownership 和版本均由第一方应用控制 |
| 直接读取 Desktop token/数据库 | 不应利用 | 破坏凭据与线程所有权边界；继续只通过 CodePilot 启动的 app-server 调 account API |
| 复制 `WindowsApps` 内 exe/resources | 不应利用 | 会绕过包更新/签名/ACL，且 sandbox helper 的相对路径和版本可能不一致 |
| 修改 `WindowsApps` ACL/管理员夺权 | 禁止 | 这是系统安全边界，不属于兼容性修复，也可能破坏 Store 更新和 Codex 沙盒 |

最值得做的后续小 POC 是：在不同 Windows 分发渠道上枚举 `where.exe codex`、App Execution Alias 和官方 standalone 路径，对每个 candidate 依次验证 `--version`、`app-server` initialize、sandbox helper/resource resolution。只有通过完整能力探测的入口才进入 ready；目录存在始终只作为线索。

### 3.4 Claude Code Runtime

当前机器探测到：

```text
C:\Users\op741\.local\bin\claude.exe
2.1.74 (Claude Code)
```

`src/lib/platform.ts` 与 `src/lib/claude-client.ts` 保留 npm `.cmd/.bat` wrapper 解析，同时补原生 `.exe` 安装路径。后续复查必须至少覆盖原生安装与 npm 安装两种形态；Windows 缺 Git for Windows 时 Claude Code 仍可能因 Git Bash 不可用而整体失败，这属于运行前置条件，不应伪装成 provider 错误。

### 3.5 开发、测试与构建脚本

- `package.json` 的环境变量与 Electron DEV 启动不再依赖 POSIX inline assignment/`${PORT:-3000}`。
- `scripts/start-electron-dev.mjs` 负责等待 Next dev server 后启动 Electron。
- Node 测试使用 `scripts/run-node-tests.mjs` 与 user-info compatibility preload，避免 Windows 受限环境中测试框架初始化即失败。
- production build 阶段不启动 task scheduler，避免构建过程访问 `~/.codepilot` 用户数据库。
- `.gitattributes` 固定脚本行尾策略，降低 Windows checkout 后 shell 脚本被 CRLF 破坏的风险。

## 4. 项目记录过的参考项目：Windows 专项结论

> 更细的“已吸收 / 可立项 / 不应照搬”矩阵见 [Windows 竞品适配可借鉴矩阵](../research/windows-competitor-adaptation-reuse-2026-08-06.md)。

### 4.1 本仓库当前可直接读取的参考源码

`资料/feishu-openclaw-plugin/` 有两项与本轮高度相关的 Windows 专项实现：

1. `package/src/core/token-store.js` 放弃 DPAPI-via-PowerShell，理由明确包括 PowerShell 冷启动、Execution Policy、`cmd.exe` 命令行长度和容器不可用；改用 Node crypto，并写入 `%LOCALAPPDATA%`，账号名先做白名单文件名转换。
2. `package/src/messaging/outbound/media-url-utils.js` 显式识别盘符路径和 UNC 路径，并用 `path.win32.basename()` 解析 Windows 路径，即使宿主当前不是 Windows 也不会错误按 POSIX basename 处理。

可迁移原则：高频核心 I/O 尽量使用 Node/系统 API；shell 只作为真正的用户命令执行边界。路径语义按输入格式识别，不只按当前 `process.platform` 猜测。

### 4.2 Craft Agents

官方仓库提供独立 PowerShell 安装器、Windows `.exe` debug 启动命令和 `%APPDATA%` 日志位置。可借鉴的是“安装渠道、实际 executable、日志位置”作为一组平台诊断信息展示，而不是只显示一个 connected 布尔值。

- 仓库：https://github.com/craft-ai-agents/craft-agents-oss
- Windows installer：`irm https://agents.craft.do/install-app.ps1 | iex`
- Windows log：`%APPDATA%\@craft-agent\electron\logs\main.log`

### 4.3 OpenCode

官方仓库同时列出 Scoop、Chocolatey 和独立 Windows Desktop x64 安装包。这说明 Windows Runtime discovery 不能只写死一种 npm/global PATH 形态；应保留显式 override，并把“分发渠道”和“实际二进制”分别记录。

- 仓库：https://github.com/anomalyco/opencode
- Windows CLI：Scoop / Chocolatey
- Windows Desktop：`opencode-desktop-windows-x64.exe`

### 4.4 OpenAI Codex

Codex 源码对 Windows project trust key 同时处理 canonical path、UNC 表示与大小写归一化；这验证了本轮“不以原始字符串直接比较 Windows 路径”的方向。官方 Windows sandbox 又把 setup helper、command runner 和实际 child process 拆成不同边界，并单独处理受限令牌、ACL、UAC 与网络身份。

- 路径归一化源码：https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs
- Windows sandbox 设计：https://openai.com/index/building-codex-windows-sandbox/

对 CodePilot 的直接约束是：

- WindowsApps/MSIX 内的文件存在性不能代替可执行性探测。
- 路径授权、ACL stamping、进程启动和 shell 编码是四个不同故障层，诊断信息必须分层。
- UNC、映射盘、WSL、云盘和普通 NTFS 本地目录不能用一条 happy-path smoke 代表。

### 4.5 既有 CodePilot 文档已经记录但本轮仍需持续关注的 Windows 风险

- `docs/handover/onboarding-setup-center.md`：Git for Windows 前置、`.cmd`/路径分隔符、Windows title-bar safe zone。
- `docs/handover/cli-upgrade-proxy.md`：WinGet、系统代理透传、Git Bash 缺失会让 Claude Code 所有命令失败。
- `docs/research/issue-analysis-2026-04-02.md`：`.cmd` discovery、Windows 10 GPU process crash、GBK/UTF-8 乱码。
- `docs/research/permission-system-decoupling.md`：Windows 路径进入 bash parser 前要做专门规范化。

### 4.6 参考资料的可复现性缺口

旧调研多次引用 `/Users/op7418/Documents/code/资料/codex-main`、`craft-agents-oss-main`、`opencode-dev` 等 macOS 绝对路径，但当前 Windows checkout 的 `资料/` 只包含飞书/微信 OpenClaw 相关快照。另一台电脑无法仅凭这些路径复核旧结论。

后续调研文档应至少记录 `repository URL + commit/tag + repo-relative path`；本地绝对路径只能作为可选缓存位置，不能作为唯一证据。若重新同步参考仓库，不要把大体积源码快照误提交进产品仓库。

## 5. 已完成验证与不能宣称的部分

已完成：

- `npm run test:unit`：5,082 tests；5,080 passed，0 failed，2 skipped；随后新增 build-phase scheduler guard 的定向测试也通过。
- `npm run typecheck`
- `npm run lint:hooks`
- `npm run lint:docs-drift`
- `npm run test:harness-boundary`
- `npm run electron:build`：Next 与 Electron production build 通过，构建期不再启动 scheduler/访问用户数据库。
- Windows 实机启动 PowerShell，并在含中文、空格及合法特殊字符的目录中覆盖 Read/Glob/Grep/Shell。
- Claude Code 只完成 binary/version probe。
- Codex 完成 desktop-only 诚实降级探测。
- 2026-08-06 Windows Electron DEV smoke：`npm run electron:dev` 成功启动可见窗口，`http://127.0.0.1:3000/` 返回 200，`/settings/runtime` 编译/加载成功；`GET /api/claude-status` 返回 native `claude.exe` connected，`GET /api/codex/status` 返回 `desktop_only / desktop_bundle_not_executable`，stderr 为空。

不能宣称：

- 没有执行真实 Claude/Codex 计费请求，所以还不是两个 Runtime 的端到端模型 smoke。
- 当前机器尚无 CodePilot 可启动的独立 Codex CLI，所以 Codex 渠道还不能完成 `app-server → 登录 → model/list → turn` 全链路。
- 尚未在 UNC、网络映射盘、WSL workspace、OneDrive/Google Drive、Windows 10 GPU 异常机器上验证。
- 全仓 ESLint 仍有历史债务；本轮改动文件做到 0 error，但不能表述为“全仓 lint clean”。

## 6. 另一台 Windows 电脑的独立复查清单

先读 `AGENTS.md`、`CLAUDE.md`、本文件和对应执行计划。不要只审 diff 形状，按用户可见语义验证 CWD 与 Runtime 状态。

### 6.1 静态与自动化门禁

```powershell
git status --short
git diff --check
npm ci
npm run typecheck
npm run test:unit
npm run lint:hooks
npm run lint:docs-drift
npm run test:harness-boundary
npm run electron:build
```

### 6.2 路径矩阵

在同一台机器创建并分别打开这些真实目录，不要用 mock 字符串替代：

```text
C:\work\ascii-project
C:\work\中文 游戏
C:\work\Game (Demo) & Tools
D:\another-drive\中文项目
\\server\share\project        # 有条件才测
```

对每个目录验证：UI 显示路径、session persisted CWD、Native Read/Glob/Grep/Shell、Claude/Codex child cwd、Bridge `/cwd`、后台任务 CWD 都指向同一个 canonical directory。输入一个不存在目录时，应得到明确错误或可见 fallback 原因，不能静默读 HOME。

### 6.3 Runtime 安装矩阵

| Runtime | 必测安装形态 | 预期 |
|---------|--------------|------|
| Native | 无 Git Bash、无 `rg` | 仍可读文件、Glob/Grep、PowerShell 执行 |
| Claude Code | 原生 `claude.exe` | 能检测版本并启动；缺 Git Bash 时给出正确前置错误 |
| Claude Code | npm `claude.cmd` | wrapper 能解析/启动，不报 EINVAL |
| Codex | 只装 Store/MSIX Desktop | 显示 `desktop_only`，不伪报可用 |
| Codex | 官方 standalone | `where.exe codex`、版本探测、app-server、account/model、首轮 turn 全部通过 |
| Codex | `CODEX_BIN` 自定义路径 | override 优先且错误可解释 |

### 6.4 Codex sandbox 专项

独立 CLI 可用后，分别记录：

1. `codex --version` 与 `where.exe codex`。
2. `codex doctor --summary --ascii`（若当前版本支持）。
3. PowerShell 安装来源是 MSI 还是受保护的 MSIX/WindowsApps。
4. sandbox mode、workspace filesystem/ACL、是否映射盘/WSL/云盘。
5. `Get-Location`、读取中文文件、创建临时文件、原子 rename、Node child process 五类最小 smoke。
6. 失败时区分 setup helper、command runner、ACL、CWD、shell encoding、Runtime app-server 六层日志，不要直接归因“中文路径”。

## 7. 建议给独立审查模型的任务文案

> 用户反馈 CodePilot 在 Windows 项目目录中无法读取文件，且只安装 ChatGPT/Codex Desktop 时 Codex 渠道不可用。请先阅读 `AGENTS.md`、`CLAUDE.md`、`docs/handover/windows-runtime-path-compatibility-review.md` 和完成态执行计划。以 `ee38205d..fcea977d` 为原始 Windows 批次，并叠加主分支后续 review remediation，重点质疑：路径是否作为 `cwd` 数据而非 shell 文本传递、中文/空格/`()`/`&`、UNC/盘符/大小写 canonicalization、Native 无 bash/rg fallback、Claude `.exe/.cmd`、Codex Desktop vs standalone 的诚实状态、WindowsApps/MSIX 可执行性、沙盒 ACL/原子 rename、构建期用户目录访问。运行文档中的门禁和真实路径矩阵；没有真实 Codex standalone/凭据时必须写“未验证”，不得把 unit test 或 Desktop 安装存在当作端到端通过。发现 P1/P2 时给出 file:line、复现、用户影响和建议测试。

## 8. 后续收口条件

只有在至少一台装有官方 standalone Codex 的 Windows 机器完成 `binary discovery → app-server initialize → account/model → 中文项目首轮文件任务`，并由独立模型复查无 P1/P2 blocker 后，才能把 Codex 部分从 `Tests pass / honest degradation` 提升为 `Smoke passed / Review passed`。当前状态仍不是 Release ready。
