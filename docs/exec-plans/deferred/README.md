# Deferred Plans / 暂缓计划

用户明确暂缓、未来可能重启的执行计划。

**这些不是当前任务入口** —— Claude Code / Codex 不应从这里领取工作，也不应自行判断是否该恢复。

- 每份文件顶部有 `Archive note`，记录为什么暂缓、重启条件、未来若重启从哪里开始。
- 索引见 [../README.md](../README.md) 的「Deferred（暂缓，未来可能重启）」表。
- 重启方式：由用户主动发起，确认暂缓条件解除后再 `git mv` 回 `active/`。
