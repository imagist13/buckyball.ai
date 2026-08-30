# Windows Runtime 诊断、恢复与凭据加固

> 创建时间：2026-08-06
> 最后更新：2026-08-07
> 总状态：✅ 已完成（本机可验证范围；跨机真实凭据与 standalone sandbox 矩阵保留在交接清单）
> 触发信号：Windows 中文/特殊字符工作区曾无法读取；Microsoft Store Codex 只能发现桌面 bundle、不能作为 CLI 执行；Runtime 页面缺少可操作的恢复入口；Provider API key 仍以明文存入 SQLite。
> 调研依据：[Windows 竞品适配可借鉴矩阵](../../research/windows-competitor-adaptation-reuse-2026-08-06.md)
> 前序修复：[Windows Runtime / 路径兼容性](./windows-runtime-path-compatibility.md)

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 事实契约、边界与回归基线 | ✅ 已完成 | 已确认不能把 Desktop bundle、文件存在或 app-server ready 冒充完整可用 |
| Phase 1 | Windows Path Identity + Runtime Doctor | ✅ 已完成 | 显示路径、比较身份、安全 realpath 分轴；三 Runtime 分层诊断 |
| Phase 2 | Codex sandbox readiness + 安装恢复入口 | ✅ 已完成 | desktop_only 固定复制 npm 兼容命令并打开 PowerShell，不自动执行；用户已在 Windows DEV 验收 |
| Phase 3 | Provider secret 系统安全存储迁移 | ✅ 已完成 | Electron safeStorage 保护数据密钥；SQLite 只保留版本化密文；跨 OS backend 真机矩阵交由后续复查 |
| Phase 4 | Windows DEV、测试、文档与复审交接 | ✅ 已完成 | targeted/full/build、Windows DEV 与恢复入口用户验收均完成；DEV 已按用户要求关闭 |

## 用户问题与根因

- Windows 工作目录可能包含中文、空格、特殊字符、盘符或 UNC；过去各模块各自解释字符串路径，显示、缓存比较与安全授权语义混在一起。
- Microsoft Store/ChatGPT Desktop 内的 Codex bundle 可以被发现，却不一定能从第三方客户端直接执行。只显示“已安装”会让用户误以为 CodePilot 已经可用。
- 当前 Codex availability 主要覆盖 binary/app-server；Windows sandbox setup/helper/runner/首个 child command 没有独立事实状态，不能从 app-server ready 推导为绿色。
- Runtime 页面告诉用户安装 standalone CLI，但恢复步骤仍需手动理解、手动复制；缺少一个安全且可发现的桌面操作。
- `api_providers.api_key` 当前是明文 SQLite。Harness `SecretStore` 只是 facade，并未改变底层事实。

## 决策日志

- 2026-08-06：用户明确要求实现调研中的 P0/P1，并新增“复制安装命令 + 打开 PowerShell”入口。
- 2026-08-06：安装命令固定为官方 `irm https://chatgpt.com/codex/install.ps1 | iex`；Electron 只复制并打开可见 PowerShell，不把命令作为 argv 传入，也不自动执行。
- 2026-08-07：用户真机发现旧启动链只收到 child `spawn` 事件却没有可见 PowerShell；同时官方 `install.ps1` 在 Windows PowerShell 中读取 `OSArchitecture` 失败。恢复入口改用固定 `cmd.exe /c start` 独立控制台，并等待 launcher 退出码；检测到 `npm.cmd` 时优先复制官方支持的 `npm.cmd install -g @openai/codex`，没有 npm 才回退 standalone 脚本。renderer 仍无权传入命令。
- 2026-08-07：修复版 Windows DEV 经用户复点后反馈“好了”，据此关闭恢复入口的本机 UI 验收；用户要求补齐文档、关闭 DEV、push 当前改动但不发版，跨机 standalone/sandbox/safeStorage 真凭据矩阵留给另一台电脑上的模型复查。
- 2026-08-06：Path Identity 的 `comparisonKey` 只用于 lookup/cache；安全授权继续依赖存在对象的 native realpath + containment，不做全局 lowercase 授权。
- 2026-08-06：sandbox 没有上游真实信号时必须显示 `unknown/not_run`；不通过启发式推断 ready。
- 2026-08-06：Provider 密钥采用 envelope encryption：Electron `safeStorage` 保护随机数据密钥，Next 运行进程只在内存/子进程环境持有数据密钥，SQLite 保存 AES-256-GCM 版本化密文。Linux `basic_text` 或无系统 backend 明确降级，不能称为系统安全存储。
- 2026-08-06：本计划不接管 `codex-cli-discovery-refresh.md` 的 macOS 双安装终验，也不接管 `windows-codex-loopback-proxy.md` 的真实 Clash packaged smoke；只复用其已验证 resolver/proxy 事实。

## 详细设计与执行清单

### Phase 0 — 事实契约、边界与回归基线

用户会看到什么：本阶段无新 UI；它保证后续页面不会用假绿色、假安全或自动执行命令误导用户。

验收入口：执行计划、现有 Windows availability API、Provider DB schema 与 Electron 启动链路。

明确不做：不复制 WindowsApps 私有 bundle、不修改 ACL、不关闭 sandbox、不读取第一方私有凭据、不自动运行安装脚本。

- [x] 阅读 Runtime / DatabaseSchema / ElectronMain / Onboarding / i18n / HarnessHome / ProviderManagement guardrail 与 Settings 设计规范
- [x] 固化 Runtime probe、Path Identity、sandbox、secret storage 的 typed 语义与 source breadcrumb
- [x] 记录本轮 targeted/full 测试与真实 DEV availability；改动前全量基线未单独保留，Windows 资源型失败在分段矩阵中复核

### Phase 1 — Windows Path Identity + Runtime Doctor

用户会看到什么：Runtime 页能区分候选来源、安装渠道、binary probe、CWD、app-server 与 sandbox；失败时知道卡在哪一层。

验收入口：Settings → Runtime；Runtime status/doctor API；中文、空格、特殊字符、另一盘符和条件性 UNC fixtures。

明确不做：不把字符串 comparison key 用作文件授权；不进行全仓路径重构；不伪造不存在的 shell/sandbox probe。

- [x] 新增纯 `PathIdentity` contract，分别返回 display/absolute/nativeRealPath/comparisonKey/dialect/exists/kind/volume
- [x] 工作目录 resolver、Bridge validator 与 Runtime Doctor 复用同一 identity helper
- [x] 新增 Native / Claude / Codex 的分层 Runtime probe snapshot 与脱敏 API
- [x] Runtime UI 展示真实 source breadcrumb，未运行的 probe 显示 unknown/not_run
- [x] 覆盖 drive/UNC/file URL/中文/空格/特殊字符/case；真实 UNC 与 junction 保留在跨机 smoke

### Phase 2 — Codex sandbox readiness + 安装恢复入口

用户会看到什么：Codex 卡片不再把 app-server ready 等同于 sandbox ready；`desktop_only` 时可点击按钮，应用复制官方安装命令、提示“已复制”，并打开 PowerShell，用户只需粘贴后回车。

验收入口：Settings → Runtime → Codex Runtime 卡片；Microsoft Store desktop_only 状态；Windows Electron DEV。

明确不做：不自动粘贴、不自动回车、不执行安装、不传 renderer 可控命令、不修改 PowerShell Execution Policy。

- [x] 建立 sandbox state/stage typed contract，只有上游事件/错误/真实 probe 才更新
- [x] availability/status API 返回 binary → app-server → sandbox 的分层事实
- [x] 新增 Windows-only、无参数、固定命令的 Electron IPC：写系统剪贴板并打开可见 PowerShell
- [x] preload/type/UI/i18n 成对接线；按钮完成后显示已复制和下一步说明
- [x] 刷新重新执行 candidate discovery / binary `--version`；app-server 只在真实 Runtime 启动时 initialize，不以 installer/复制动作当成功
- [x] Electron security/source-contract 单测覆盖固定命令、无 renderer 参数、非 Windows fail closed

### Phase 3 — Provider secret 系统安全存储迁移

用户会看到什么：Provider 连接流程不变；Runtime Doctor 只显示 storage kind/security level/是否已配置，绝不返回密钥或密文。系统安全存储不可用时明确显示 degraded/unsupported。

验收入口：Settings → Providers 添加/编辑；Settings → Runtime/Diagnostics；升级含旧明文 provider 的隔离数据库。

明确不做：不把随机 key 与密文同目录当作“安全”；不静默删除无法验证的旧密钥；不迁移外部 Claude/Codex 自有凭据文件。

- [x] Electron 启动时用 safeStorage 创建/解包随机数据密钥，并向 packaged Next child 只传内存态 key + backend metadata
- [x] 新增版本化 AES-256-GCM envelope，绑定 provider id 作为 AAD，严格拒绝篡改/错 key/未知版本
- [x] additive schema + revision + CRUD/type/API 同步；新写入只落密文，legacy 明文列进入可回滚迁移
- [x] 旧明文逐行“加密 → 解密验证 → 同事务落密文并清空明文”；失败保留旧值并记录无 secret 的错误码
- [x] dev/test 仅允许显式临时 key；没有 Electron/system backend 时不自动产生同目录明文 key
- [x] Harness SecretStore、Provider resolver、image provider、Doctor/export 全部通过统一解密边界
- [x] migration/roundtrip/tamper/no-key/masked-boundary/Electron source-contract tests

### Phase 4 — Windows DEV、测试、文档与复审交接

用户会看到什么：Windows DEV 客户端可实际打开 Runtime 页并执行恢复交互；另一台电脑上的模型可按文档逐项复查事实来源与剩余 smoke。

验收入口：Windows Electron DEV、unit/full test、Electron build；交接/产品文档。

明确不做：没有 standalone Codex 与真实 Provider 凭据时，不把 sandbox child、真实计费请求或 safeStorage 升级 smoke 写成通过；本轮按用户指令只 push，不打 tag、不构建发布包、不创建 Release。

- [x] targeted tests + `npm run test`（最终结果见验证记录）
- [x] `npm run electron:build`，Next 136 pages + Electron bundle 完成
- [x] Windows Electron DEV 已启动；`/api/health` 为 `ok`，Codex Runtime 为真实 `desktop_only`
- [x] 固定 `cmd/start` 启动链真机返回 0 且独立 PowerShell 进程保持存活；安装命令未进入 argv
- [x] 用户在重启后的 Windows DEV 中复点恢复按钮，并反馈修复结果“好了”
- [x] 更新 Windows 技术交接与竞品调研结论
- [x] 新增互相反链的技术交接文档与产品思考文档
- [x] 回写状态/清单/决策日志；完成后移入 `completed/`

## 验收语义与反例

| 字段 | 用户语义 | 真实来源 | 反例 |
|------|----------|----------|------|
| Binary probe | 指定 executable 是否实际响应版本探测 | `spawn --version` | 文件存在但 Store bundle 不可执行时必须 failed/desktop_only |
| App-server | Codex app-server initialize 是否成功 | app-server protocol response | binary probe 通过但 initialize 失败时不能显示 ready |
| Sandbox | Windows sandbox 已知到哪个阶段 | 上游通知/结构化错误/真实 child smoke | 没跑首个 child 时必须 unknown/not_run |
| CWD identity | 请求目录与实际 canonical 对象 | workspace/session source + native realpath | 中文/空格/另一盘符不能被 shell 拆分；不存在时不伪造 realpath |
| Secret storage | provider key 的静态存储安全级别 | safeStorage availability/backend + ciphertext format | Linux basic_text/no keyring 必须 degraded；DB 密文不能冒充 OS backend |

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| 2026-08-06 | codex_runtime | Codex Account | — | Microsoft Store Desktop bundle | availability probe | ⚠️ desktop_only（真实反例） | `/api/codex/status` 返回 WindowsApps binary + `desktop_bundle_not_executable` |
| 2026-08-06 | codepilot_runtime | — | — | Windows Electron DEV | app/server 启动 | ✅ 通过 | Electron 进程存活；`/api/health` 返回 `{"status":"ok"}`；诊断 CWD realpath 为 `E:\\code\\codepilot` |
| 2026-08-06 | test_runtime | — | — | 隔离测试密钥 | full + targeted + build | ✅ 通过 | `npm run test`；最终安全边界定向测试 16/16；`npm run electron:build` |
| 2026-08-07 | codex_recovery | — | — | 官方 standalone script | 用户真实恢复 | ❌ 反例 | 原启动器未显示窗口；脚本报 `OSArchitecture` PropertyNotFoundStrict |
| 2026-08-07 | codex_recovery | — | — | npm fallback + fixed cmd/start | 启动器真机 | ✅ 通过 | launcher 约 2.4 秒返回 0；独立 `powershell.exe` 继续存活；命令未进入 argv |
| 2026-08-07 | codex_recovery | — | — | Windows Electron DEV | 用户复点恢复按钮 | ✅ 用户验收 | 用户反馈修复结果“好了”，随后要求关闭 DEV 并 push 交由另一台电脑复查 |
| 2026-08-07 | test_runtime | — | — | recovery follow-up | 381 个 unit 文件四段复跑 | ✅ 通过 | 96 + 96 + 96 + 93 个文件全部退出 0；typecheck 与 recovery 定向测试 4/4 通过 |
| _待执行_ | codex_runtime | Codex Account | — | standalone CLI | sandbox setup/helper/first child | 待执行 | 当前机器没有可执行 standalone CLI，不冒充通过 |
| _待执行_ | codepilot_runtime | configured provider | configured model | safeStorage-migrated API key | 两轮 chat | 待执行 | 需要用户真实凭据且不得写入文档 |
