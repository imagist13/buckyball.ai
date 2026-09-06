# 提示词优化（2026-09）

> 技术实现见 [docs/exec-plans/active/prompt-optimization-2026-09.md](../exec-plans/active/prompt-optimization-2026-09.md)

## 解决的问题

项目同时支持 Native、Claude Code 和 Codex 三条 Runtime。此前通用 Agent 提示词、Buckyball.ai 身份、能力提示和用户项目规则分散在多个入口，部分内容在首轮又被完整复制到 user-role 上下文消息中。这会增加上下文消耗，并让同一条规则在不同 Runtime 中出现不同承载方式。

## 设计取舍

本轮采用四层语义：稳定基线、项目与用户规则、能力与工具合同、本轮任务。运行时协议仍由各自适配器负责，但 Buckyball.ai 的 BB 开发片段使用同一来源，避免 Native、Claude Code、Codex 分别维护相似文案。

首轮上下文消息只保留必要的运行时标记和已选 Skill 名称。完整系统提示词继续进入 system/developer 承载位，因此不会丢失规则，也不会发送两份完整内容。

缺少真实 chip 或仓库根目录时继续隐藏 BB 片段。这样模型不会看到占位上下文，也不会把未挂载工具当成可用工具。

## 已知局限

本轮是提示词组装和静态回归优化，尚未使用真实 Provider 凭据验证三条 Runtime 的模型行为一致性。Native、Claude Code、Codex 的底层协议仍然不同，提示词字节一致不代表模型输出完全一致；后续应通过真实工作流验证芯片开发普通路径、BB 工具触发路径和已选 Skill 路径。
