# 跨 Runtime 提示词优化

> 创建时间：2026-09-06
> 最后更新：2026-09-06
> 状态：🚧 进行中

## 产品思考

> 产品思考见 [docs/insights/prompt-optimization-2026-09.md](../../insights/prompt-optimization-2026-09.md)

## 状态总览

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 提示词来源、重复注入与 Runtime 差异审计 | ✅ 已完成 | 已确认 Native/Claude/Codex 的入口和首轮上下文重复 |
| Phase 1 | 统一提示词层级、消除首轮系统提示复制、补齐 BB 注入合同 | 🚧 进行中 | 先做低风险纯函数与调用点改造 |
| Phase 2 | 定向测试、全量测试与开发环境验证 | 📋 待开始 | 需覆盖普通路径与 BB/Skill 触发路径 |
| Phase 3 | 真实 Runtime smoke 与后续 drift guardrail | 📋 待开始 | 真实凭据 smoke 不伪造 |

## 决策日志

- 2026-09-06：采用“基线 → 项目规则 → 能力合同 → 本轮任务”顺序；能力和协议说明尽量由单一来源生成，避免三 Runtime 各自改写。
- 2026-09-06：移除首轮把完整 system prompt 复制进 user-role context 的默认行为；系统规则应保留在 system/developer 承载位，首轮只保留必要的非重复运行时标记。
- 2026-09-06：BB 专用提示词继续保持条件注入，缺少真实 chip/repoRoot 时隐藏，不显示占位数据。

## 详细设计

### 用户可见结果

- 普通聊天继续按当前 Runtime 工作，但模型收到更少的重复上下文。
- BB 开发场景下三种 Runtime 收到相同的 BB 工作流规则；未配置 BB 上下文时不出现假 chip 或假工具声明。
- 已选 Skill 仍在调用前解析失败，不能静默退化为普通聊天。

### 本阶段做

- 把提示词层级和边界固化为可测试的纯函数。
- 首轮上下文只携带必要元数据，禁止复制完整 system prompt。
- 把 BB prompt fragment 接入 Claude/Codex 的既有 developer/system 承载位。
- 增加针对重复注入、顺序和普通/触发路径差异的单元测试。

### 本阶段不做

- 不重写 Agent Loop、Provider、MCP 工具 schema 或权限系统。
- 不改变用户已有 session system prompt 的持久化格式。
- 不宣称真实三 Runtime 计费 smoke 已通过；真实凭据验证留到 Phase 3。

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _待执行_ | - | - | - | - | - | - | - |
