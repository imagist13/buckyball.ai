# Harness Home 技术交接

> 对应产品思考：[../insights/harness-home.md](../insights/harness-home.md)
> 执行计划入口：[../exec-plans/active/harness-home-user-owned-core.md](../exec-plans/active/harness-home-user-owned-core.md)
> 当前 Program C：[../exec-plans/active/harness-home-context-capability-routing.md](../exec-plans/active/harness-home-context-capability-routing.md)
> 代码审查修复基线：`1dea192d`

## 定位

Harness Home 是用户所有 Harness 的领域聚合根，不是一个必须存在的页面。当前产品定义收敛为 Assistant files/services、统一 Capability Package（Skill/MCP/CLI/builtin/renderer/model adapter）、scope/provenance/SecretRef、Runtime projection 与 durable AssetRef；Settings、Plugins、Assistant Workspace 和素材库只是不同入口。

2026-08-04 用户纠正了“隔离”的边界：项目若主动使用助理目录，`AGENTS.md`、`CLAUDE.md`、`memory.md` 和其他文件仍应自然可读；Program C 只用 persisted assistant binding 取代 cwd equality 对 identity/Memory 自动服务与 Heartbeat 的激活判断，不能把 binding 做成文件 ACL。独立 Design Method/Taste/Creative Orchestration 产品计划已移入 `superseded/`：已落地 schema/API/tests 保留兼容与安全修复；新的工作流、设计和媒体能力进入一个 Capability Package，由 Skill 描述、Broker 让 MCP/CLI/内置/renderer/model actions 相互调用，再由 Asset materialization 保存结果。

Canonical 数据不依赖 Claude Code、Codex 或某个模型。外部框架通过两类 adapter 接入：

- `HarnessAdapter`：L0 发现、L1 导入/导出和冲突处理；
- `RuntimeAdapter`：L2 基础执行、L3 session/stream/tool/permission/artifact/interrupt。

首轮 Full Reference 仍由 CodePilot Runtime 承担。稳定 canonical capability 必须可执行并通过 conformance；draft capability 可以处于 `referenceStatus=pending`，但不能进入用户承诺。

## 目录与职责

| 入口 | 职责 |
|------|------|
| `src/lib/harness-home/contracts.ts` | 框架中立的 manifest、scope、provenance、SecretRef、AssetRef、Method/Taste 类型 |
| `src/lib/harness-home/repository/` | 文件事实源、lease、staging journal、原子提交、恢复、hash consistency |
| `src/lib/harness-home/adapters/` | L0/L1 source adapter 与 registry |
| `src/lib/harness-home/runtime/` | L2/L3 descriptor、projection 与产品 Runtime binding |
| `src/app/api/harness-home/**` | metadata diagnostics 与受校验的 canonical write boundary |
| `src/lib/assets/` | producer registry、Asset typed index、lineage、HTML materializer 与永久删除 |
| `src/app/api/media/gallery/route.ts` | Asset + legacy media 的兼容读取、搜索与渐进 backfill |
| `src/lib/codex/media-import.ts` | Codex durable Asset 与 preview-only media 的去重、物化 |
| `electron/html-thumbnail-security.ts` | HTML 静态缩略图的同源 scope 与串行超时策略 |

## Canonical Repository 写模型

文件是 definition、identity、memory 和 method 的事实源；SQLite 只承担 Asset、索引、关联和迁移状态。

写入顺序固定为：

1. 校验 root、scope、schema、Secret 和引用；
2. 取得单写者 lease；自动恢复先要求 opaque machine identity 相同，再由本机 OS 证明原 owner PID 已死亡；异机或旧版无 identity 的 lease 始终保留冲突；
3. 在同一 root 下建立 staged transaction 和 prepared journal；
4. 校验 expected hash，写临时文件并 durable flush；prepared/committed journal 自身也先 fsync 再原子替换，并在平台支持时同步父目录；
5. manifest-last 原子替换；
6. journal 收口，刷新 consistency generation。

路径校验必须同时覆盖 lexical containment、realpath containment 和 symlink 拒绝。journal 中记录的 staged path 也要重新验证，不能把 journal 当可信输入。启动扫描按 transaction 目录独立容错：缺 journal 的不可恢复 staging 会被清理，但不能遮住同级有效事务；损坏 journal 仍 fail closed，且失败打开必定释放刚取得的 writer lease。

只读打开会进行 consistency scan。扫描用 1 MiB 流式 hash，并按 `dev/ino/size/mtimeNs/ctimeNs` 缓存最多 32 个 generation；未变化文件不会在每轮重复读完整内容。能改变这组 stat identity 的外部编辑会触发重新 hash；同时保持全部五项完全不变的底层替换不在该缓存机制的可观察范围内，不能笼统宣称“任何外部编辑”都必然被缓存键发现。

Taste Memory 读取按记录隔离。合法记录继续进入 Runtime projection；JSON/schema/scope/evidence 结构损坏的历史记录保留在文件事实源中，并以 `id/path/contentHash/reason` 返回诊断，不再让整个 GET 或投影失败。L1 import 在写入前执行同一 evidence 校验；对同一损坏 identity 的更新/撤销保持 fail closed，必须先显式修复。

Creative Method 的 trigger/non-trigger 在写入、导入与历史读取时共用逐项校验：trim 后不能为空、长度不超过 240、不能含 C0/C1 控制字符。confirmed 状态仍不能绕过该门禁，因此空 trigger 不会意外注入每轮上下文，空 non-trigger 也不会全局压制方法。

## Secret 与中立边界

- manifest、export、diagnostics 永远只含 `secretRef` 和 availability metadata；
- Secret value 解析仍委托现有产品 secret stores；当前不是 OS keychain；
- canonical contract 不得出现 `codepilot` provenance、产品 MIME、Claude/Codex 私有路径或 Runtime 私有 import；
- `npm run test:harness-boundary` 会递归扫描 canonical 文件；`.husky/pre-commit` 对代码改动强制执行；
- adapter changed-files 检查仍要求显式 base，只允许 adapter 自身、registry 和 conformance 预算内改动。

产品集成文件可以知道 CodePilot、Claude Code、Codex；这种 binding 不属于 canonical schema。

## Asset Library 与兼容读取

`asset_records` 是 `media_generations` 上的 typed index，不替换旧表。Gallery 每次最多 backfill 100 条 terminal media：

- 成功行建立 producer-backed Asset；
- missing/modified 明确记录 integrity；
- 某一 poison row 失败时写 `asset_backfill_failures(source_table, source_id, failure_revision)` 并分类；permanent 同 revision 跳过，transient 冷却后重试；
- Gallery 在线 backfill 限制 100 行、32 MiB 累计/单文件与 75ms 调度预算；超预算行记为 deferred 让后续行继续，显式无界迁移仍会恢复；
- 修改永久失败的迁移逻辑时必须 bump failure revision，旧 permanent 失败才会重试；
- tag 回填逐项 salvage，坏标签不会让整行永久卡住。

未完成、失败、外部路径或无法 materialize 的 legacy row 仍以 `legacyOnly` 卡片展示，可搜索、收藏、加标签和删除 DB 记录。删除只移除 Asset Library 明确拥有的 canonical media 路径；外部文件永远不删。

永久删除有两层门禁：活跃 consumer 阻断；共享 content bytes 保留。旧 `trashed` 行的 restore route 只作数据兼容，不是产品入口。

## Codex 图片持久化规则

Codex `MediaBlock` 必须显式携带 persistence：

- `imageGeneration` → `durable_asset`：物化一次、写一个 Asset；
- `imageView` → `preview_only`：仅供聊天预览，不新增 Asset DB 行；
- 同一 session 内先 generation 后 view，按原始路径和内容 hash 复用；
- preview-only 外部内容只复制进受管 `.previews`，不删除外部源。

这条规则解决了“同一张 Codex 图片在素材库出现三份，其中两份只有 ID 且无法删除”的问题。历史残留行不会被自动删除；现在可以通过 legacy 兼容路径管理，是否清理仍由用户决定。

## HTML Bundle 安全模型

HTML archive 只复制入口及其真实本地依赖闭包。扫描器是 quote-aware 的线性状态机：

- anchor `href` 不作为归档依赖；
- `link[href]` 的 stylesheet/icon/apple-touch-icon/manifest/preload/modulepreload 进入本地依赖闭包；preconnect/dns-prefetch 不复制文件，但外部地址进入 metadata 披露；
- script、iframe、object、embed、form、base、meta refresh、危险 scheme、scope escape 和 symlink fail closed；
- 外部资源只记录到 metadata，不在截图时加载。

Electron 缩略图使用独立无缓存 partition、拒绝全部权限和新窗口/导航，通过 `webRequest` 只允许当前 strict preview 的精确同源 scope。请求串行，单次 12 秒 deadline；超时会停止并销毁隐藏窗口，再释放队列。Gallery 和详情只渲染持久化 PNG，不嵌入归档网页。

缩略图 IPC 在创建窗口前解析首个路径段：它必须完整匹配 canonical `ws.<base64url absolute path>`，不能靠字符串前缀、包含性 token 或编码分隔符蒙混。HTML `<title>` 在写入 metadata 和旧 metadata 读取两侧都经过统一 display-text sanitizer，移除 bidi override/isolate 与不可见控制符；原始归档 bytes/hash 不改。

## 构建与开发并发

`scripts/assert-next-build-safe.mjs` 在 `.next/dev/lock` 存在时 fail closed。`prebuild` 和 Electron build cleanup 都先执行该 guard，避免开发服务器运行时清理 `.next`，造成聊天/任务 API 随机 500。

正确顺序是：停止 dev → `npm run build` → 再启动 dev。不要为了通过 build 自动删除 lock。

## 验证

本轮审查闭环证据：

- `npm run test`：4917/4917；
- `npm run build`：通过；保留既有 Turbopack NFT tracing warning；
- 本轮 Method/lease/Asset/API/HTML/Electron 六个定向文件：76/76；Harness boundary gate 通过；
- 真实 Codex Runtime：session `73f5f1ddb44410f3c406aa3a733a86d3` 只调用一次 generation、一次同图 image view；两条事件共用 media ID，唯一标记查询 Asset 从 0 变为 1（`a163f37ae4ec60e489ee92afef1d9c18`）；测试素材按用户授权保留；
- dev 运行中 `/api/chat/sessions` 与 `/api/tasks/notify` 均返回 200；
- Browser：1024/1280/1600 宽分别呈现 2/3/5 列，无横向溢出；
- 搜索命中真实 prompt，详情在 600px 高窗口内独立滚动；
- HTML 安全提示、外部资源清单、右键菜单均可见；
- Gallery 控制台 0 warning / 0 error。

关键回归测试：

- `harness-home-repository.test.ts`
- `harness-home-runtime-conformance.test.ts`
- `harness-home-boundary-guard.test.ts`
- `asset-library-conformance.test.ts`
- `asset-library-api.test.ts`
- `codex-media-import.test.ts`
- `html-bundle-conformance.test.ts`
- `electron-main-security.test.ts`
- `electron-packaging-hygiene.test.ts`

## 仍未关闭

- L0/L1 adapter 目前主要是 code/API/conformance surface，尚无正式导入/导出 UI；
- 第四个 Full Runtime 仍需要少量产品 binding touchpoints，未达到“只注册 descriptor”；
- A4 三 Runtime 真实凭据/permission/resume/interrupt packaged smoke 未执行；
- packaged app 的 Asset Library human gate 未执行。
- Program C P0：Assistant service binding 尚未落地，现有 identity/Memory 自动服务与 Heartbeat 仍主要依赖 cwd equality；实现必须同时证明项目使用助理目录时普通文件仍可读；
- Program C P1：canonical Skill/MCP 多为 perception-only，CLI/renderer/model adapter 尚未进入统一 Package，Capability Broker 与三 Runtime bridges 未落地；
- Program C P2：`creative` 尚未验证模板化可视化质量、policy resolution、media model descriptor/adapter 与完整 Artifact→Asset lineage，tech debt #56 仍需真实 CodePilot Runtime smoke；
- 推荐/安装/来源页面按用户决定 deferred，不属于当前关闭门禁。
