# Codex 会话存储隔离

> 状态：✅ Code complete + Tests pass + Smoke passed（Claude 修复轮复审待用户发起）
> 创建 / 完成：2026-08-03
> 触发：用户发现 CodePilot Codex Runtime 新建的任务也出现在官方 Codex Desktop。
> 约束：直接在 `main` 修复并提交；不启动 loop、不建 worktree、不随本任务 push / 发版。
> Guardrail：[`docs/guardrails/Runtime.md` §2.6](../../guardrails/Runtime.md#26-codex-会话存储隔离)

## Signal → Triage → Fix

### Signal

CodePilot 与官方 Codex Desktop 都使用默认 `~/.codex`：rollout、SQLite thread index 与账号 / Harness 输入没有所有权分层，导致 CodePilot thread 出现在官方任务列表，两个客户端也可能续写同一历史。

### Triage

目标不是把用户的 Codex Harness 整体复制成私有孤岛。需要分成两类：

- CodePilot-owned runtime state：`sessions`、`archived_sessions`、SQLite、日志与缓存，必须隔离。
- User-owned Harness inputs：配置、profiles、Skills、Plugins、rules、themes、memories 与账号引导，优先 live mirror；降级时必须诚实披露其为 snapshot / 独立凭据。

### Fix

- app-server 同时设置 `CODEX_HOME`、`CODEX_SQLITE_HOME`，并通过 CLI `-c sqlite_home=...` 覆盖镜像 `config.toml` 中可能存在的同名配置。
- 首次迁移只复制首行 `session_meta.originator === 'codex_codepilot'` 的 rollout；`COPYFILE_EXCL` 保证幂等，不移动源文件。
- Harness 输入优先 symlink / junction；Windows 文件可降级 hardlink，最终 copy fallback 记入启动告警且不自动覆盖分叉内容。
- 凭据初始化模式为 `symlink` / `hardlink` / `copy`；marker 记录初始模式，每次启动按当前 inode / realpath 重分类。`copy` / `target_only` 明确提示可能需要分别登录。
- marker 存在后不再重新播种已删除凭据，避免 CodePilot logout 后重启又静默恢复。
- 无法解析或首行超过 256 KiB 的旧 rollout 计数并告警，不再静默跳过。

## 验证

### 自动化

- `npm run typecheck`：通过。
- 定向 Runtime 测试：52 / 52 通过，覆盖 originator 过滤、copy-not-link、凭据 logout、symlink / hardlink / copy 三形态、Harness snapshot 降级、同 home fail-closed 与 spawn 参数。
- 全量 `npm run test`：4995 / 4995 通过，0 failed / 0 skipped。

### Smoke Ledger

| 日期 | Runtime / binary | 环境与输入 | 验证动作 | 结果 |
|---|---|---|---|---|
| 2026-08-03 | Codex app-server / `codex-cli 0.146.0-alpha.9.2` | 完全隔离的临时 source / target；source 仅放入一条真实 `codex_codepilot` rollout；无凭据、无模型请求 | 以 `app-server -c sqlite_home="<target>"` 启动，调用 `thread/resume` 恢复 `019e69a6…`；检查 source / target 文件树 | ✅ resume 返回同一 thread id；source 产生 0 个 SQLite 文件；target 产生 `state_5.sqlite*`、`goals_1.sqlite*`、`logs_2.sqlite*`、`memories_1.sqlite*`。证明当前 binary 识别 CLI `sqlite_home` 且会从迁入 rollout 重建 / 消费隔离索引 |

smoke 没有向模型发请求，不消耗 API 配额；临时目录在证据回写后删除。

## 已知残留

- copy-not-move 会让升级前的旧 CodePilot 条目继续留在官方历史；这是数据安全取舍，后续用户确认清理见 tech debt #77。
- Windows `.cmd` shim 的普通路径 shape 已覆盖，但含 `%` / `&` 的极端 home 路径缺真实 Windows smoke，见 tech debt #76。
- snapshot fallback 不会自动合并官方与 CodePilot 两份配置 / Harness 目录，以避免无 provenance 的覆盖丢数据；启动日志会列出需要人工处理的 entry。

## 决策日志

- **2026-08-03 — 隔离 runtime state，不隔离用户 Harness 所有权。** 会话 / 索引属于具体客户端，配置与扩展资产属于用户。
- **2026-08-03 — 旧 rollout 只复制、不移动。** 无官方索引协调协议时，自动删除源历史的风险高于短期残留。
- **2026-08-03 — fallback 选择可观察、保守、不伪同步。** Windows 或受限文件系统无法建立 live mirror 时，记录实际模式并告警；不把 copy 宣称为共享，也不自动覆盖可能已分叉的内容。
