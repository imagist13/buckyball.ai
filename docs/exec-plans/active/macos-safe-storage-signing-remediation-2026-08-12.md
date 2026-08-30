# macOS Safe Storage Signing Remediation

> 创建时间：2026-08-12
> 最后更新：2026-08-25

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| Phase 0 | 第二台机器取证、历史包与 CI 签名链核对 | ✅ 已完成 | 正式、preview workflow 均会落到 ad-hoc；不是测试机独有 |
| Phase 1 | Developer ID + Team ID fail-closed 发布门禁 | ✅ Code complete | stable/preview 都要求证书，最终 `.app` 再做 deep/strict 校验 |
| Phase 2 | 本地 recovery smoke 的 Safe Storage 隔离 | ✅ Code complete | 仅 exact env + packaged + canonical temp userData 可跳过，flag 不下传 child |
| Phase 3 | 自动回归、构建与本地 packaged smoke | ✅ 已完成 | 5192/0/1；build/package/签名/0-map/health；single/budget/blocked 全通过 |
| Phase 4 | official-signed CI / 旧 ad-hoc 用户升级验收 | 🟡 CI 已完成 / 用户迁移待验 | v0.66.2 official-signed gate、Release 与 12 assets 已通过；旧钥匙串 ACL 首次迁移可能仍需一次授权 |
| Phase 5 | v0.67.7 不可读 Provider secret 热修 | ✅ Shipped；Code complete + Tests pass + Build pass + official CI pass | session/SDK/Native 三层 fail closed；同一个真实 GLM Key 删除旧服务商并重加后已恢复；完整三模型 smoke 未冒充通过 |

## 用户结果

- 新的正式版和 preview macOS 包不再静默使用每次构建都会变化的 ad-hoc 身份；缺证书、Team ID 不一致或最终签名被修改都会直接阻断产物上传。
- 本地 ad-hoc 包只允许显式生成，packaged recovery 自动化只在一次性临时 userData 中跳过 Safe Storage，不访问开发者真实 `codepilot Safe Storage` 条目。
- 不删除、不重建用户钥匙串条目或 provider 数据密钥。已经由旧 ad-hoc 包创建过条目的机器，第一次切换到稳定 Developer ID 身份时仍可能出现一次系统授权；之后同一 Team ID 的升级应保持稳定身份。
- 若升级后旧 Provider 密文确实无法读取，发送会在本地被阻断并明确提示删除旧服务商、用同一个 API Key 重新添加并重选；不会再继承 Claude OAuth、把 401 冒充成 GLM 模型故障，也不会自动删除旧密文。删除前会披露该服务商的自定义模型设置不会迁移。

## Signal → Triage → Fix → Verify → Guardrail

### Signal

2026-08-12 第二台 Mac 出现“CodePilot 想要使用你储存在钥匙串的 `codepilot Safe Storage` 中的机密信息”。本机 40.10.6 recovery smoke 同时在 `SecItemCopyMatching` 阻塞。两者都发生在 default keychain 存在的机器，不属于 B-018 原来覆盖的“默认钥匙串缺失/未配置”。

### Triage

1. 原始 `.github/workflows/build.yml`、`preview-build.yml`、`preview-release.yml` 都没有向 electron-builder 提供 Developer ID 证书，并关闭 identity auto discovery。
2. `scripts/after-sign.js` 在无证书时无条件 inside-out ad-hoc 签名且校验失败不阻断。ad-hoc bundle 没有 Team ID，designated requirement 绑定当前 CDHash；重新构建后身份变化，访问旧 Safe Storage item 时 macOS 会重新要求授权。
3. 因而正式包和测试包都会命中，不是单台测试机配置问题。B-018 的 default-keychain guard 不能解决“钥匙串健康、但 app 签名身份变化”的 ACL 问题。
4. 2026-08-13 的 v0.66.1 official CI 又暴露第二层配置错误：虽然已接入 `CSC_LINK`，同一证书打包 step 仍设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`。当前 electron-builder 中 `CSC_LINK` 负责导入证书，但该开关会在没有显式 identity/`CSC_NAME` 时直接跳过身份选择，最终触发 afterSign 的 Developer ID fail-closed。该次运行没有创建 Release，证明发布门禁有效，也证明“有 `CSC_LINK` 就不受 auto discovery 影响”的旧假设不成立。

### Fix

- stable 与两条 preview workflow 把既有 `MAC_CERT_P12_BASE64` / `MAC_CERT_PASSWORD` / `APPLE_TEAM_ID` secrets 映射为 electron-builder 的 `CSC_LINK` / `CSC_KEY_PASSWORD` 与 Team ID，并设置 `CODEPILOT_REQUIRE_DEVELOPER_ID=1`。
- certificate-backed package step 允许 electron-builder 从导入的临时 keychain 发现 Developer ID 身份；只有无证书、显式 ad-hoc 的本地构建继续设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`。workflow source contract 逐个锁定所有含 `CSC_LINK` 的 step，禁止再次组合这两个互斥配置。
- afterSign 以实际 `codesign -d --verbose=4` 输出判断，不信任“环境变量存在”这一间接信号；distributable 要求 Developer ID Application + 精确 Team ID，任何签名或 deep/strict 失败都抛错。
- artifact 生成后再次扫描全部 `CodePilot.app`，校验数量、Developer ID、Team ID 与 deep/strict，关闭“hook 内通过、最终产物被后续修改”的 tech-debt #57。
- ad-hoc 仅在显式 `CODEPILOT_ALLOW_ADHOC_SIGNING=1` 时允许。recovery smoke 另用窄 flag 跳过 provider Safe Storage，但同时要求 packaged、canonical realpath 位于 `os.tmpdir()/codepilot-packaged-recovery-*`；symlink、真实 userData、dev mode、近似 flag 全部拒绝。

### Verify

- policy / workflow / provider startup / B-018 / packaging / recovery 定向测试。
- `npm run test`、`npm run electron:build`。
- 显式 local ad-hoc directory package 后验证 deep/strict、0 source map、packaged `/api/health`，并执行 recovery single / budget / blocked 三场 GUI smoke。
- official-signed CI 仍必须验证证书 secrets、最终 bundle Team ID，以及旧 ad-hoc 安装升级后的首次访问行为；本地无证书不能把 ad-hoc smoke 冒充这条发布证据。

### Guardrail

- `ElectronMain.md` 增加 distributable 签名和 isolated Safe Storage smoke 不变量。
- `release.md` 明确 macOS stable/preview 必须 Developer ID + exact Team ID，禁止 ad-hoc 上传。
- B-018 增补健康钥匙串 + 签名 ACL 分支；数据密钥损坏/恢复继续留在 tech-debt #78，不以删钥匙串规避系统授权。
- `ProviderManagement.md` 增加显式 DB Provider 的 credential ownership：缺失/不可读时 session route、Claude SDK 与 Native transport 都 fail closed，并提供 Settings 恢复入口。

## Phase 5：v0.67.7 Provider secret 热修

### 用户会看到什么

- 选择 GLM 等 DB Provider 后，如果升级导致旧 API Key 无法解密，发送前即显示“凭据缺失或无法解密”，并可直接打开“设置 → 服务商设置”。
- 提示会说明 Key 本身可能仍有效，并给出“记录自定义模型 → 删除旧服务商 → 用同一个 Key 重新添加 → 回到会话重新选择”的完整恢复路径；失败消息不会写入会话，也不会出现 Claude OAuth 401 的误导性 assistant error。

### 本阶段明确不做什么

- 不删除 `CodePilot Safe Storage`、`provider-secret-key.v1.json` 或旧 Provider 密文，不尝试绕过 macOS 钥匙串 ACL。
- 自动化只验证 credential ownership、三模型 wire 与恢复接线；没有真实用户 GLM Key，不把 fixture 测试冒充 production smoke。

### Signal → Triage → Fix → Verify → Guardrail

- **Signal**：v0.67.6 用户日志先出现 `[provider-secret] ... safe_storage_unavailable`，随后 GLM 会话记录 `No API key found`、provider=`env`，最后请求 Claude OAuth 并返回 401；三款 GLM 模型均失败。
- **Triage**：GLM catalog/endpoint 没有参与失败。`materializeProvider()` 解密失败后按设计返回空 `api_key`，但 resolver 仍保留 DB Provider 且允许 SDK 继续；`toClaudeCodeEnv()` 的无凭据分支既不注入 GLM，也不清理 ambient Anthropic/OAuth，造成跨 Provider 串线。
- **Fix**：保留密文并导出低基数解密错误；`resolveProviderForSession()` 区分 `credentials-unreadable`/`credentials-missing`；Chat route 对最终 resolved DB Provider（含 legacy 会话的 default/active 回退）在任何副作用前 409；SDK env 与 Native model factory 再各加一道 fail-closed；现有/新会话提供双语 Settings 恢复入口；用户显式写入 Key 后清除旧 secret error，但普通读取不抹掉迁移诊断。
- **Verify**：不可读 AES envelope、缺失 Key、legacy default/active 回退、stale secret error 行为 fixture；ambient process token + `~/.claude` token 反例；Native transport 反例；GLM-5.3、GLM-5-Turbo、GLM-4.7 逐一验证 auth token、CN endpoint 与 exact upstream model。用户已用同一个真实 Key 完成删除重加恢复；没有逐一发送三模型请求，因此不冒充完整 production smoke。
- **Guardrail**：`ProviderManagement.md` §3.5 + 三份行为测试，禁止恢复 `provider && !hasCredentials` 的 ambient fallback。

## Smoke Ledger

| Date | Runtime | Package identity | 场景 | Result | Evidence |
|---|---|---|---|---|---|
| 2026-08-12 | Node | n/a | signing/startup policy + workflow source contract | ✅ targeted | 43/43；symlink hardening 追加 4/4 |
| 2026-08-12 | local Electron 40.10.6 arm64 | ad-hoc（显式、隔离） | build/package/deep-strict/0-map/health + recovery single/budget/blocked | ✅ 本地 smoke | health 200；single `66660→66668`；budget 第四次停止；blocked 拒绝 relaunch、plain quit 成功；无 Keychain modal。正式 gate 对该 ad-hoc 包按预期退出 1 |
| 2026-08-13 | GitHub Actions macOS | 证书已导入、身份发现被关闭 | v0.66.1 stable final artifact gate | ✅ 按预期阻断 | run `31615349470`：electron-builder 跳过签名，afterSign 拒绝 ad-hoc；未创建 Release |
| 2026-08-13 | GitHub Actions macOS | Developer ID + configured Team ID | v0.66.2 stable final artifact gate | ✅ official-signed CI | run [`31616811316`](https://github.com/op7418/CodePilot/actions/runs/31616811316)：arm64+x64 package、exact Team ID/deep-strict、native ABI、packaged server、checksums 全通过；[Release v0.66.2](https://github.com/op7418/CodePilot/releases/tag/v0.66.2) 非 draft/非 prerelease，12 assets uploaded |
| _待执行_ | affected Mac | 旧 ad-hoc → Developer ID | 首次授权与后续升级 | ⏳ | 允许首次迁移授权，不允许每版重复 |
| 2026-08-25 | local Node + Next production | v0.67.6 production-log fixture / v0.67.7 candidate | 不可读/缺失 GLM secret → session/SDK/Native；legacy default/active 回退 | ✅ Tests + Build pass | 58/58 targeted；完整 1222 suites / 5315 tests / 5314 pass / 0 fail / 1 skip；Next production 136 routes。fixture 不算 Provider smoke |
| 2026-08-25 | affected Mac | v0.67.6 / GLM (CN) | 删除不可读旧服务商 → 同一个真实 Key 重加 | ✅ 恢复路径通过 | 用户确认原 Key 有效且重加后恢复；Key 未进入日志/fixture；未逐一验证三个 GLM 模型 |
| 2026-08-25 | GitHub Actions macOS + Intel + Windows + Linux | v0.67.7 stable / tag `04fd9655` | 正式签名、公证、universal updater、Intel ABI 与 mixed-distribution Release | ✅ Shipped | run [`32812166154`](https://github.com/op7418/CodePilot/actions/runs/32812166154) 全绿；[Release v0.67.7](https://github.com/op7418/CodePilot/releases/tag/v0.67.7) 为 Latest，18 资产且 `latest-mac.yml` 唯一指向 universal ZIP。该 CI 不替代下方真实三模型请求 |
| _待执行_ | affected Mac | v0.67.7 / GLM (CN) | GLM-5.3、GLM-5-Turbo、GLM-4.7 各一次最小请求 | ⏳ accepted release risk | 不阻塞本次发版，不冒充 Smoke passed |

## 决策日志

- 2026-08-12：不再把 ad-hoc 定义为“仅本地测试包”；取证确认 stable 与 preview CI 都走同一路径，正式包同样受影响。
- 2026-08-12：不通过删除 `codepilot Safe Storage` 或 `provider-secret-key.v1.json` 消除弹窗；它会切断旧密文且没有用户确认/备份。
- 2026-08-12：不在本轮重构 provider DEK 生命周期。真实产品路径保持 safeStorage，自动化只在可证明的一次性 temp userData 上跳过。
- 2026-08-12：Developer ID 成功必须以最终 bundle 为准；afterSign 的中间态校验只是一层，不再作为上传依据。
- 2026-08-12：隔离 recovery smoke 三场通过，只证明 recovery 与 Safe Storage 隔离合同；它不替代 official-signed 包访问真实 userData/旧钥匙串 ACL 的发布验收。
- 2026-08-12：只读 `gh secret list` 确认仓库已存在 `MAC_CERT_P12_BASE64`、`MAC_CERT_PASSWORD`、`APPLE_TEAM_ID`；workflow 必须映射现有名称，不能假设另有 `CSC_LINK` / `CSC_KEY_PASSWORD` secrets。
- 2026-08-13：v0.66.1 official CI 证明导入 `CSC_LINK` 后仍需允许身份选择；保留失败 tag、不移动或重建，修正 workflow 后使用 v0.66.2 重发。
- 2026-08-13：v0.66.2 stable CI 的 Developer ID 双架构签名与最终 bundle gate 全绿，Release 已发布。该证据关闭发布签名链门禁，但不替代旧 ad-hoc 用户机器首次升级和后续同 Team ID 版本不再弹窗的真实 ACL 验收。
- 2026-08-25：v0.67.6 真实日志证明跳过旧 ad-hoc → Developer ID 数据迁移 smoke 留下了产品缺口：Safe Storage 不可用时旧 Provider 密文会 fail closed 到空 Key，但调用链却串到 Claude OAuth。热修不破坏或猜测恢复旧密文；以“阻断 + 重新填写 Key”作为可验证恢复路径，并把真实 GLM 三模型请求保留为 human gate。
- 2026-08-25：用户确认原 GLM Key 本身有效，删除旧服务商并用同一个 Key 重加后恢复。终审 P2 要求 legacy 空 provider pin 经 default/active 回退也必须在消息落库前阻断，已一并修复；最终 58/58 定向、完整 5314/0/1 与 Next production 136 routes 通过。选择 `v0.67.7` 发布该热修，用户接受不补跑完整三模型线上 smoke，但状态不得写成 Smoke passed。
- 2026-08-25：不可变 `v0.67.7` tag `04fd9655` 的正式 run `32812166154` 全绿并公开 18 资产 Latest Release；Mac Developer ID、公证/staple、universal updater、packaged health 与 Intel ABI 均通过，公开 `latest-mac.yml` 只指向 0.67.7 universal ZIP。Phase 5 因此更新为 `Shipped`；完整三模型在线请求仍是已接受风险，不回写成 Smoke passed。
