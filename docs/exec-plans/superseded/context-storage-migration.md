> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `superseded/`——被 refactor-closeout 接管，仅作历史参考。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [superseded/README.md](README.md)。

# 上下文共享与存储迁移

> ⚠️ **Superseded by [refactor-closeout.md](../completed/refactor-closeout.md)** — 不再单独推进，保留作历史参考。`message_parts` / `session_runtime_state` / 压缩摘要并入 refactor-closeout 的 **Phase 5（上下文可视化）**；session-level runtime 持久化并入 **Phase 2（Runtime 与会话执行）**。

> 原始调研：`docs/research/context-storage-migration-plan.md`
> 创建时间：2026-02-26
> 最后更新：2026-03-04

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | `sdk_cwd` 字段 + backfill | ✅ 部分完成 | `sdk_cwd` 已上线；`projects` 表和 `canUpdateSdkCwd` 逻辑未实现 |
| Phase 1 | `message_parts` 结构化消息 | 📋 待开始 | 暂用现有 `content` JSON 数组字段 |
| Phase 2 | `session_runtime_state` 运行态持久化 | 📋 待开始 | 当前依赖内存 Map |
| Phase 3 | 会话压缩摘要 + archive/fork | 📋 待开始 | |

## 决策日志

- **2026-02-26**: 完成调研文档，规划 Phase 0-3
- **2026-02-xx**: `sdk_cwd` 字段上线，backfill 逻辑确认工作正常（`db.ts` L320-323）
- **2026-03-04**: 迁移为执行文档。Phase 0 的 `projects` 表暂未创建——当前按 `working_directory` 隐式分组已满足需求；`canUpdateSdkCwd` 逻辑暂缺，但实际使用中会话创建时 `sdk_cwd = working_directory` 已固定

## Phase 0 剩余项

- [ ] 新建 `projects` 表，为历史 session 回填 `project_id`
- [ ] 在 `PATCH /api/chat/sessions/[id]` 中实现 `canUpdateSdkCwd` 逻辑

## Phase 1 前置条件

- 确认 Bridge 系统是否需要 `message_parts` 的结构化读取
- 评估当前 `content` JSON 数组方案的局限性

## 详细设计

完整的目标表结构、SQL 迁移草案、状态机设计、代码落点建议见原始调研文档：
`docs/research/context-storage-migration-plan.md`
