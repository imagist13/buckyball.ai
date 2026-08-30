# Windows 无签名自动更新技术交接

> 产品思考见 [docs/insights/windows-unsigned-auto-update.md](../insights/windows-unsigned-auto-update.md)。
> 执行与真实 Smoke Ledger 见 [Windows 无签名原生自动更新与差分下载](../exec-plans/active/windows-unsigned-native-auto-update-2026-08-26.md)。

## 1. 目标与非目标

stable Windows x64 包使用 Electron Main-owned updater，从固定的 `op7418/CodePilot` GitHub Release 读取 `latest.yml`，下载 unsigned NSIS installer，并在活动任务门禁通过、用户确认重启后交给安装器。用户明确不申请 Microsoft/Azure Trusted Signing，也不配置 PFX。Linux updater 不在本轮，继续手动安装。

既有 `v0.67.7` 及更早 Windows 包编译时 official provenance 为 `0`，无法靠远端配置打开 updater。首个支持 Windows updater 的版本必须手动安装，之后才进入原生更新路径。

## 2. 数据流与信任边界

```text
stable Windows package
  └─ CODEPILOT_OFFICIAL_UPDATE_BUILD=1（仅官方仓库 CI 可编译为 1）
      └─ Electron Main / electron-updater
          └─ GitHub provider: op7418/CodePilot
              └─ latest.yml
                  ├─ CodePilot.Setup.<version>.exe
                  └─ CodePilot.Setup.<version>.exe.blockmap
```

Renderer 只能通过 preload 的窄 IPC 获取状态、请求检查/重试下载/安装；不能传 feed URL、channel、路径或 updater option。Main 在安装前查询 chat/bridge/task，无法证明 idle 时 fail closed。

Windows 当前没有独立 publisher identity。installer 与 metadata 的 SHA-512 一致性由 `electron-updater` 校验，但若 GitHub 仓库权限、workflow 与首次发布同时失守，攻击者可一起替换两者。因此以下发布保护属于功能合同，而不是可选加固：

- GitHub Immutable Releases 由管理员启用；仓库变量 `CODEPILOT_IMMUTABLE_RELEASES_CONFIRMED_AT=YYYY-MM-DD` 只在完成该次 UTC 日核对后设置，发布门禁只接受当天或前一 UTC 日的确认。
- `main` branch ruleset 必须 active、无 bypass、无 exclude，并包含 deletion/non-fast-forward；`stable-release-tags` tag ruleset 必须 active、无 bypass、无 exclude，并包含 deletion/update，阻止 tag 被删除或移动；同名 active ruleset 必须恰好一个。管理员用完整 API 响应运行 `verify-github-update-rulesets.mjs --emit-confirmed-state`，把输出写入 `CODEPILOT_RULESETS_CONFIRMED_STATE`。
- GitHub 按权限隐藏敏感的 `bypass_actors` 字段；Actions 的内置 token 不能把缺失字段当成空数组。发布 job 会实时验证非敏感 ruleset shape，并把 live `id` / `updated_at` 与管理员确认状态精确匹配；规则变更后不重新确认就会 fail closed。
- 所有 `.github/workflows/*` 的外部 `uses:` 固定完整 40 位 commit SHA。
- workflow 顶层 token 为 `contents: read`；只有最终 release job 获得发布/attestation 写权限。
- installer、metadata、blockmap、checksum 和 attestation 从同一 build graph 进入 draft，central audit 完成后一次公开。

GitHub 的 Immutable Releases 查询需要 repository Administration(read)，普通 Actions token不能替代管理员核对；GitHub 也明确说明只有具备 ruleset write access 的调用者才会收到 `bypass_actors`。规则与权限要求见 [GitHub REST repository docs](https://docs.github.com/en/rest/repos/repos#check-if-immutable-releases-are-enabled-for-a-repository) 与 [ruleset docs](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset)。

## 3. unsigned 配置

`electron-builder.yml` 保留可选 signer 的 fail-closed 基线；stable workflow 在 signer 三项全部缺失时同时覆盖：

```text
win.forceCodeSigning=false
win.verifyUpdateCodeSignature=false
CSC_IDENTITY_AUTO_DISCOVERY=false
```

CI 必须验证 installer 与 `win-unpacked/CodePilot.exe` 都是 `NotSigned`，且 `resources/app-update.yml` 不含 `publisherName`。这使运行时不会冒充 Authenticode publisher verification。若 signer 三项只配置一部分，package job失败；全部配置时仍可走既有签名 verifier，但当前产品决策不要求申请证书。

Electron Main 读取实际打包的 `resources/app-update.yml`，把 `publisherName` 归一成 native snapshot 的 `publisherVerification=authenticode|none`；配置缺失或畸形时标记 `unknown` 并关闭 native updater，回退浏览器路径。`UpdateDialog` 只在 `packageType=nsis` 且 `publisherVerification=none` 时显示双语 unsigned 风险说明，不能再从 Windows 平台常量推导签名事实。Release Notes 还需在首个 updater 版本说明手动 bootstrap 与 SmartScreen。

## 4. 差分更新

builder 显式配置 `nsis.differentialPackage=true`，客户端显式设置 `disableDifferentialDownload=false`。标准 NSIS 安装会把当前 installer 缓存为 updater cache 的 `installer.exe`；新版本下载时，updater 使用旧/新 blockmap 请求差异区间。

差分是优化而非正确性前提：旧 installer、任一 blockmap、HTTP Range 或差分重建失败时，exact-pinned `electron-updater@6.8.3` 回退下载完整 installer。产品层不显示固定节省百分比；只有对两个真实 Release 资产/请求做测量后才能记录实际值。

## 5. 关键文件

| 文件 | 责任 |
|------|------|
| `electron/updater.ts` | Main updater 状态机、差分/完整回退配置、活动任务与安装 handoff |
| `src/lib/updater-contract.ts` | packaged/official/channel/platform 支持合同 |
| `src/hooks/useUpdateChecker.ts` | native snapshot → UI model，保留 `packageType` breadcrumb |
| `src/components/layout/UpdateDialog.tsx` | Windows unsigned trust notice 与更新操作 |
| `electron-builder.yml` | NSIS、可选 signer 基线、differential package |
| `.github/workflows/build.yml` | Windows official build、unsigned verifier、资产上传、trust prerequisites、draft→public |
| `scripts/verify-update-assets.mjs` | Mac+Windows updater / Linux manual distribution graph 审计 |
| `scripts/verify-github-update-rulesets.mjs` | 管理员 no-bypass 确认状态生成；Actions live shape 与 `id` / `updated_at` 防漂移审计 |
| `scripts/verify-immutable-release-ack.mjs` | 管理员 Immutable Releases 确认日期的新鲜度门禁 |

## 6. 资产合同

stable Release 必须包含：

- macOS：`latest-mac.yml`、同版本 universal ZIP、ZIP blockmap，以及手动 DMG/其他 ZIP。
- Windows：`latest.yml`、`CodePilot.Setup.<version>.exe`、对应 EXE blockmap。
- Linux：x64/arm64 AppImage/deb/rpm，但没有 `latest-linux*.yml`。
- 全部平台：`SHA256SUMS.txt` 与 build provenance attestations。

`latest.yml` 必须以裸 basename 精确引用当前版本完整 NSIS installer；`latest-mac.yml` 同样精确引用当前版本 universal ZIP。central verifier 拒绝绝对/带路径 URL、旧版本或额外 release payload，并按解析后的 checksum 文件名集合核对 version、SHA-512、size、外置 blockmap 存在性与 coverage，不能用字符串前缀关系蒙混。builder 的 `blockMapSize` 是嵌入式 blockmap 字段，Mac ZIP/完整 NSIS 的原生 metadata 不包含它，不能把它误当外置 sidecar 大小。禁止手写/覆盖 metadata、复用版本或移动 tag。

## 7. 验证矩阵

本地门禁：

- `updater-contract.test.ts`：Windows support、Main-owned config、差分开关、unsigned UI breadcrumb。
- `release-trust-update-assets.test.ts`：Windows graph 正反例、Action SHA、ruleset shape、unsigned workflow source contract。
- `electron-packaging-hygiene.test.ts`：Linux provenance=0、三平台 packaged health合同。
- `npm run test`、production Next build、Electron bundle、workflow YAML parse。

真实 Windows RC 必须覆盖：

1. clean VM 手动安装 RC-A，包含默认/自定义安装目录。
2. RC-A → RC-B 正常差分；记录真实 transferred/installer size，不用理论值冒充实测。
3. 删除/破坏旧 blockmap 或阻断 Range，确认自动回退完整 installer。
4. active chat/bridge/task 阻止重启；idle 后用户确认，安装 handoff 和新版本启动成功。
5. 用户数据库、workspace、Provider secret 与安装目录保持；卸载路径不误删父目录。
6. 记录 SmartScreen/UAC 的真实表现。未完成这组证据只能报 Tests pass，不能报 Smoke passed/Release ready。

## 8. 剩余风险

- GitHub 是单一信任根；attestation 目前不由客户端强制验证。
- `CODEPILOT_IMMUTABLE_RELEASES_CONFIRMED_AT` 与 `CODEPILOT_RULESETS_CONFIRMED_STATE` 是短时管理员 acknowledgement，不是 Actions 持有管理员凭据；live `id` / `updated_at` 防漂移会拦截确认后的 ruleset 修改，但管理员仍需在每次规则调整后重新核对。
- 首次 unsigned installer 与后续 unsigned updater 都可能被 SmartScreen/企业策略拦截。
- Windows 实机 RC 通过前，代码完成不等于功能已交付。
