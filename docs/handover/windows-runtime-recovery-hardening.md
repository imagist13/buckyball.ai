# Windows Runtime 诊断、恢复与凭据加固交接

> 产品取舍见 [同名产品思考](../insights/windows-runtime-recovery-hardening.md)。
> 竞品证据见 [Windows 竞品适配可借鉴矩阵](../research/windows-competitor-adaptation-reuse-2026-08-06.md)。
> 前序路径/CLI 修复见 [Windows Runtime / 路径兼容性修复交接](./windows-runtime-path-compatibility-review.md)。

## 结论

本轮实现了竞品调研中的两个 P0 和三个 P1：统一 Path Identity、三 Runtime 分层 Doctor、Codex Windows sandbox 独立状态、Provider secret 加密迁移，以及 `desktop_only/not_installed` 的安全恢复入口。

这不是“Windows 已全部验证通过”。当前机器只有 Microsoft Store/ChatGPT Desktop 管理的 Codex bundle，没有通过 CodePilot `--version` 探测的 standalone Codex CLI，因此 app-server、Windows sandbox helper/runner 和首个受限 child command 仍必须保留为未验证。代码与构建通过不替代另一台装有 standalone CLI 的真机 smoke。

## 为什么 macOS App 能启动，Windows Desktop bundle 却不能直接复用

macOS `.app` 常把可执行 CLI 放在可定位、可直接 spawn 的应用资源目录中；CodePilot 仍会用 `--version` 验证，而不是仅看文件存在。

Windows Store/MSIX 的桌面应用由 AppX 包、WindowsApps ACL、执行别名和包身份共同管理。包内 `codex.exe` 能被扫描到，不代表普通第三方 Electron 进程有权把它当 standalone CLI 启动。复制 bundle、修改 WindowsApps ACL 或读取桌面应用私有 token 都会破坏系统/凭据边界，因此本项目把这种情况诚实标为 `desktop_only`，并引导安装官方 standalone CLI。

## 数据流与关键落点

### 1. Path Identity

`src/lib/path-identity.ts` 将一条路径拆为：

- `displayPath`：保留用户输入，给 UI/诊断使用；
- `absolutePath`：按显式 host/dialect 解析后的绝对路径；
- `nativeRealPath`：存在对象的 OS canonical path；
- `comparisonKey`：仅用于 lookup/cache；Windows 做大小写与分隔符归一；
- `dialect/exists/kind/volume`：drive、UNC、WSL、file URL 等来源事实。

`working-directory.ts` 和 Bridge validator 已复用该合同。安全授权仍必须基于真实 filesystem object、native realpath 与 containment，禁止把 lowercase comparison key 直接当授权依据。

Windows 输入或真实 WSL 环境中的 drive mount（例如 `/mnt/c/项目`）会映射为对应的 `C:\项目` identity；普通 macOS/Linux 上同一字符串保持 POSIX。macOS/Linux 的 `//var/...` 同样保持 POSIX，不再被 forward-slash UNC 规则改写；`\\wsl.localhost\...` 仍保留 WSL UNC 语义。该映射有跨方言单测，但真实 WSL reparse/junction 仍列入跨机 smoke。

### 2. Runtime Doctor

`src/lib/runtime-probe.ts` 为 Native、Claude Code、Codex 输出同构 snapshot：候选来源、安装渠道、binary probe、CWD identity、shell、app-server、sandbox 与最后失败阶段。日志路径只有存在真实来源时才返回；Next server 不再虚构 `~/.codepilot/logs`。Native 是 in-process Runtime，因此 `appServer.probe=passed`，未实际运行的独立 binary probe 保持 `not_run`。

`/api/codex/status` 返回 `{ availability, probe }`；Provider Doctor 新增 `runtime` probe。Runtime 设置页展示 Codex candidate source、诊断 CWD 与 sandbox 状态。以下推导被明确禁止：

- 文件存在 ⇒ binary probe 通过；
- installer/复制成功 ⇒ CLI 可用；
- app-server initialized ⇒ Windows sandbox ready。

### 3. Sandbox readiness

`src/lib/codex/sandbox-readiness.ts` 只消费带明确 sandbox breadcrumb 的 app-server 通知/错误：`setup_helper`、`command_runner`、`child_spawn`、`filesystem`、`network`。普通工具的 `ENOENT`/CWD 错误不再误报 Sandbox Error；`windowsSandbox/setupCompleted` 只证明 setup 阶段完成，状态为 `setup`。当前没有受支持的 restricted-command success 信号，因此删除不可达的 `ready` UI；没有上游信号时显示 `unknown/not_run`，刷新会清掉旧观察窗口再等待新事实。

### 4. “复制并打开 PowerShell”恢复入口

入口位于 Settings → Runtime → Codex 卡片，仅 Windows Electron 且状态为 `desktop_only/not_installed` 时出现。

安全合同：

- renderer 只能调用无参数 `codex.prepareWindowsRecovery()`；
- Main 只接受当前 `127.0.0.1:<serverPort>` renderer；
- 官方 Codex 仓库同时支持 standalone script 与 npm 安装；检测到真实 `npm.cmd` 时固定复制 `npm.cmd install -g @openai/codex`，否则固定复制 `irm https://chatgpt.com/codex/install.ps1 | iex`；
- Main 写系统剪贴板，再用固定 `cmd.exe /d /s /c start` 命令行创建独立 PowerShell；临时 cmd 隐藏、PowerShell 可见，并以 launcher 退出码判断是否成功；
- 安装命令不进入 argv，不自动粘贴、不自动回车、不自动执行；
- UI 明确提示“已复制；粘贴后按 Enter”，PowerShell 打不开时仍区分 `copied_only`。

2026-08-07 用户反例证明原来的 `spawn(powershell.exe, detached)` 只收到进程创建事件，不能证明控制台窗口可见；官方 `install.ps1` 当时还在其 Windows PowerShell 环境触发 `OSArchitecture` 属性错误。因此恢复动作不能把 child `spawn` 当作 UI 成功，也不能只有单一脚本通道。npm 回退来自 [OpenAI Codex 官方仓库 Quickstart](https://github.com/openai/codex#installing-and-running-codex-cli)。

执行安装后用户需回到 Runtime 页面点击刷新；刷新重新跑 candidate discovery/`--version`，不会因为复制动作显示成功。

### 5. Provider secret envelope encryption

生产路径：

1. Electron Main 启动后调用 `safeStorage`，生成或解包随机 32-byte 数据密钥；
2. 磁盘文件 `userData/provider-secret-key.v1.json` 只保存 `safeStorage` 包裹后的 key；
3. packaged Next utility child 启动时通过环境接收一次，instrumentation 立即把数据密钥移入进程内全局状态并删除三个环境变量，后续 Agent/工具子进程无法继承；preload/renderer 不暴露密钥；
4. SQLite `api_providers` 新增 `api_key_ciphertext` 与 `api_key_storage`；密文为绑定 provider id AAD 的 AES-256-GCM `cpsec:v1` envelope；
5. CRUD 统一在 DB accessor 边界解密。Provider resolver、Harness SecretStore 与 image provider 都走 accessor，不直接依赖旧明文列。

Legacy 迁移逐行执行“以非空明文为当前真源 → 生成 fresh envelope → 认证解密并逐字验证 → 写密文并清空明文”。回滚旧版、换机数据库等形成“当前明文 + 旧密文”时不得复活旧 key；单行加密/验证/UPDATE 失败保留该行明文、记录脱敏错误并继续其它行，不能穿透 `getDb()` 阻断启动。只有明文为空时，materialize 才尝试密文；密文损坏仍 fail closed，不回显 ciphertext。

开发模式的 Next server 不由 Electron fork，默认不会自动获得数据密钥；如需验证加密路径，必须显式设置临时 `CODEPILOT_PROVIDER_SECRET_KEY/BACKEND/LEVEL`。单元测试 preload 已使用隔离、确定性的 test key。

数据密钥文件损坏后的显式恢复、以及 packaged DB 与独立 `npm run dev` 共用时的 owner/隔离策略尚未产品化，见 tech-debt #78。不得把本轮启动容错描述成“密钥可自动再生且旧密文可恢复”。

## 验证记录

- `npm run typecheck`：通过。
- 新增/相关定向测试：23 项通过；`working-directory.test.ts` 5 项通过；最后一轮 recovery/secret/instrumentation 安全边界回归 16/16 通过。
- 最终完整 `npm run test`：通过（typecheck + harness boundary + 全量 unit）。中途发现的旧断言未接受新增 `identity` 字段已修正并纳入最终结果。
- `npm run electron:build`：通过；Next 136 个页面生成、Electron bundle 完成。保留仓库已有 NFT dynamic-trace warning，不是本轮新增失败。
- 最新 Windows Electron DEV：`/api/health` 返回 `ok`，`/api/codex/status` 返回真实 `desktop_only`、`candidateSource=desktop_bundle`、`binary.probe=failed`、`sandbox=not_applicable/not_run`。2026-08-07 用户在修复版 DEV 中复点恢复按钮后反馈“好了”，本机 UI 验收关闭；DEV 随后按用户要求停止。
- 恢复补丁：`npm run typecheck` 与 recovery 定向测试 4/4 通过；固定 `cmd/start` 真机 launcher 返回 0，独立 PowerShell 进程保持存活；用户复点结果通过。
- 恢复补丁后的 381 个 unit test 文件按 96 + 96 + 96 + 93 四段复跑，四段全部退出 0；分段只为绕开 Windows 工具单命令 180 秒上限，不缩减测试范围。

## 提交与复查交接

- `2a6427bc feat(windows): harden runtime recovery and secret storage`：Path Identity、Runtime Doctor、sandbox readiness、secret storage 与首版恢复入口。
- `9ef45dc0 fix(windows): make Codex recovery visible and compatible`：可见 PowerShell 启动链与 npm 兼容安装命令。
- 2026-08-07 文档收口提交：记录用户验收、归档执行计划并供另一台 Windows 电脑复查；当前分支只 push，不打 tag、不构建发布包、不创建 GitHub Release。

## 跨机复查清单

在另一台 Windows 机器上按顺序检查：

1. 中文、空格、`()`、`&`、另一盘符项目各创建会话，Native/Claude/Codex 分别读取真实文件。
2. 仅安装 Store Desktop 时必须显示 `desktop_only`，不能显示 Codex ready。
3. 点击恢复按钮后，剪贴板是固定官方命令、PowerShell 可见且命令尚未执行。
4. 粘贴并执行后刷新，必须经过 standalone binary `--version`，再验证 account/models/app-server。
5. 跑一条真实受限文件读取命令；在此之前 sandbox 必须是 `unknown/setup`，不能是 `ready`。
6. 用含旧明文 provider 的数据库副本启动 packaged app：确认明文列清空、密文可解、Provider 调用仍工作；不要在报告中记录任何凭据。
7. 检查 Doctor export：只允许 backend/security level/count/error code，不允许 data key、API key 或 ciphertext。

## 已知边界

- 未在本机完成 standalone Codex + Windows sandbox 首个 child smoke。
- 未覆盖真实 UNC server、WSL reparse/junction、OneDrive Files On-Demand 的在线/离线矩阵。
- safeStorage 系统保护级别需分别在 Windows DPAPI、macOS Keychain、Linux keyring/basic_text 环境复核；Linux `basic_text` 必须保持 degraded。
- 三个旧 live-smoke 脚本仍只会读取 legacy `api_key` 列；迁移后的真实凭据不能再由任意 shell 脚本直接取出，应改用显式 smoke credential 或受控 app runtime，不能复制解密实现。
