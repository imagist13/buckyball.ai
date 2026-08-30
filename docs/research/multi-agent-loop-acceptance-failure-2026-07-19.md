# 多 Agent loop 验收失效复盘（2026-07-19）

## 结论

本轮并非“没有产出代码”，而是把**局部实现完成**误报成了**用户需求完成**。目标区间内共有 53 个提交，其中 30 个文档提交、21 个产品代码提交、2 个测试提交；提交数量和局部测试持续增长，但用户按真实入口验收时，关键路径仍然失败。

这次 loop 的主要失效模式是：Claude Code 和 Codex 共用了一份存在遗漏的执行计划，又互相使用对方基于该计划产生的局部证据进行确认。两个模型因此形成了“共同自洽”，没有形成独立的用户路径审查。

本文只记录问题、根因和后续门禁，不构成任何功能已经完成的证据。

## 用户实际遇到的问题

| 用户操作 | 实际结果 | 局部实现为何没有发现 |
|---|---|---|
| 在 Codex 渠道选择 GPT-5.6 | 模型右侧没有推理强度选择 | 测试只验证 Codex `model/list` 解析和嵌套 `capabilities`，没有验证 `/api/providers/models` 最终响应的顶层字段，也没有验证输入框 |
| 选择 Kimi for Coding | 没有推理强度选择 | 测试覆盖目录种子行，却没有覆盖真实存量 `manual_enabled + user_edited` 行遮蔽目录能力的情况 |
| 设置 → 模型 → 添加模型 → 智谱 CodePlan | 模型列表获取失败 | 计划接受了不稳定的上游 `/models` 探测，没有把“内置套餐目录可用”作为失败回退和验收路径 |
| Claude 默认渠道选择 Sonnet / Fable | 推理强度组件字号、圆角、间距与模型选择不一致 | 仅验证菜单内容，没有 computed style、截图或共享组件结构断言 |
| Claude Code 选择“替我审批” | 最新 SDK 仍被提示版本不足 | 只直接调用源码 helper；没有请求 Next 编译后的 capability route，未发现打包后包路径解析失败 |
| Codex 选择“替我审批” | 不支持 | 原计划明确延期，loop 却没有把延期重新交给用户确认；本地 Codex 已有 reviewer 能力，产品尚未接线 |
| 自动聊天命名 | Codex 能力边界不清 | 把“Codex 支持设置线程名称”误读成“Codex 提供自动命名生成器”；当前只确认前者，自动生成仍需应用层实现或其他 Runtime 回退 |
| Claude Code 任意模型发送消息 | 回复时间过长，难以正常使用 | 没有记录首 token、总耗时和取消阶段，无法区分 SDK 启动、网络、上游排队或流式解析延迟 |

## 根因

### 1. 没有冻结不可变的用户验收合同

需求被拆成了模块任务，但没有为每一项保留“入口、操作、预期、证据”四元组。任务在多轮转述中逐渐从“用户选择后必须看见并可用”收缩为“某个对象带有 capability 字段”。后者为真，并不能证明前者为真。

### 2. Required checks 所在层级低于用户结果

本轮大量证据位于 helper / catalog / source grep 层。用户结果位于最终 API、数据库覆盖规则、Next 编译产物、输入框和 Runtime wire 层。验证层级不对等时，绿色测试会制造错误安全感。

### 3. 两个模型共享了同一个错误前提

Claude Code 按计划实现，Codex 又按同一计划审查。Codex 没有先盲测用户路径，而是先阅读实现和已有测试，因此容易沿用实现者的抽象边界。审查变成了“实现是否符合计划”，而不是“产品是否符合用户描述”。

### 4. “待 smoke”被当成可接受状态

UI、编译后路由和真实 Runtime 依赖 smoke，但 smoke 多次因环境或凭据被延后。loop 仍然继续推进后续阶段，导致“未验证”在汇报中逐步变成“已完成”。正确状态应是 `blocked / unverified`，不能是 `accepted`。

### 5. 局部阶段完成被汇总成整项完成

目录更新、schema 解析、权限 profile、标题 helper 等各自完成后，被上层汇总为“基础体验更新已完成”。父任务没有独立的总验收门，无法阻止子任务的局部完成冒充用户结果。

### 6. 延期和产品取舍没有回到用户

Codex auto-review、Native 权限能力、Codex 标题策略等被计划内部延期或降级，但这些变化会改变用户范围，必须由用户明确确认。模型无权仅凭实现成本替用户缩小需求。

### 7. 过程性工作挤占了真实验证

两天内出现大量计划、状态、轮次和测试数量更新。它们提升了可追踪性，却没有提高用户路径覆盖。loop 优化了“看起来在推进”的指标，而不是最终功能成功率。

## 防复发门禁

### A. 冻结 User Outcome ID

每个需求必须先生成不可被子任务改写的 `U1…Un`：

```text
U1
入口：聊天输入框，Runtime=Codex，Model=GPT-5.6
操作：选择模型
预期：模型选择器右侧出现推理强度；选中的值真实进入 turn/start
证据：最终 models API + UI 截图/DOM + wire capture
```

所有实现任务和测试都必须映射到至少一个 User Outcome ID。无法映射的工作不计入需求完成度。

### B. 证据阶梯

按风险至少覆盖到用户所在层：

1. unit：解析器、纯函数、目录数据。
2. route：真实 DB 覆盖规则和最终 API response。
3. wire：实际发给 SDK / app-server / provider 的参数。
4. production smoke：Next 编译后路由或打包应用中的页面操作。
5. live：需要真实账号、网络或凭据的最终请求。

如果用户问题在第 4 或第 5 层，只有第 1 层绿色不得关闭。

验收产物还必须可复核：截图、wire capture 和日志证据要归档到持久路径或仓库文档资产；`/tmp`、`/private/tmp` 等会被清理的路径不计作最终证据。

### C. 独立审查顺序

审查模型必须先根据原始用户描述执行一次盲测，再阅读实现计划和已有测试。顺序固定为：

```text
原始需求 → 用户路径复现 → 记录事实 → 阅读实现/测试 → 对照差异
```

禁止先由实现者摘要需求，再让审查者只审摘要。

### D. 父任务总门

子任务全部完成后，父任务仍必须逐条跑 User Outcome Matrix。只要有一项 `failed / unverified / human-gated`，父任务不得标记完成，也不得用后续阶段的提交数覆盖该状态。

### E. 未验证与延期规则

- 环境、网络或凭据不足：标记 `human-gated` 或 `blocked`，保留精确操作，不得标记 accepted。
- 需求延期、降级或替代实现：必须获得用户明确批准。
- 同一缺陷最多进行 3 轮无新增用户证据的修补；超过后停止堆 helper 测试，回到端到端根因。
- 测试框架和记账调整单列，不计入产品功能进度。

## 本轮恢复验收矩阵

| ID | 用户结果 | 最低自动证据 | 最终证据 | 当前状态 |
|---|---|---|---|---|
| U1 | Codex GPT-5.6 显示并发送推理强度 | 最终 `/api/providers/models` 顶层 capability + Codex turn wire test | 输入框操作 | UI passed（Default/Low/Medium/High/XHigh/Max）；live turn wire pending |
| U2 | Kimi for Coding 始终使用渠道名且显示 Auto / Low / High / Max | 真实 `manual_enabled + user_edited` DB 行经过最终 models API | 输入框操作 + 三档真实 wire | UI passed（Default/Low/High/Max，含 stale catalog cache）；三档 live wire pending |
| U3 | 智谱 CodePlan 添加模型即使上游列表失败仍可使用内置套餐目录 | search route 的网络失败回退测试 | 设置页操作 | passed：真实设置对话框回退显示 2 个内置模型 |
| U4 | 推理强度选择器与模型选择器视觉一致 | 共享结构测试 + computed style / screenshot | 输入框操作 | passed（正常/360×720）；[GPT-5.6](../exec-plans/active/_smoke-evidence/foundation-refresh-gpt56-normal-2026-07-20.jpg) / [模型菜单 360px](../exec-plans/active/_smoke-evidence/foundation-refresh-model-menu-360px-2026-07-20.jpg) / [Kimi effort 360px](../exec-plans/active/_smoke-evidence/foundation-refresh-kimi-effort-360px-2026-07-20.jpg) 已持久化归档 |
| U5 | Claude Code 最新 SDK 可正确识别“替我审批”能力 | Next 编译后 capability route smoke | 选择后真实审批请求 | code + compiled route passed；live approval unverified |
| U6 | Codex 支持“替我审批” | capability route + app-server reviewer wire test | 触发一次需要审批的操作 | capability + UI switch passed（含风险确认、版本门与 echo）；live approval matrix unverified |
| U7 | 自动聊天命名覆盖目标 Runtime，失败时不阻塞发送 | 标题触发、幂等和 fallback 测试 | 新会话首轮后观察标题 | partial / unverified |
| U8 | Claude Code 延迟可定位且恢复到可用 | TTFT / total / phase telemetry 测试 | 至少两种模型真实请求 | failed / environment-dependent |

## 本次恢复落地的红灯

新增测试不再复用原 loop 的内部 helper 证据，而是固定用户所在的最终边界：

- `src/__tests__/unit/foundation-refresh-user-path-contract.test.ts`
  - U1：最终 models API 中 GPT-5.6 `supportsEffort` 实际为 `undefined`。
  - U2：真实 Kimi 手动行最终 label 仍是 `kimi-for-coding`，目录展示名和能力没有合入。
  - U3：模拟 DNS / 上游目录失败后，智谱 CodePlan 添加模型实际返回 502，没有目录回退。
  - U4：推理强度组件没有复用模型选择器的字体、items padding、popover radius 和 motion contract。
- `src/__tests__/e2e/foundation-refresh-capability.spec.ts`
  - U5：通过正在运行的 Next/Turbopack dev route 请求 capability，实际仍返回 `sdk_version`；这条测试能捕获直接 import helper 无法发现的 bundle 路径问题。

2026-07-19 初始结果：上述 4 个 unit contract 全部按预期复现失败，compiled-route smoke 1/1 失败；`tsc --noEmit`、docs drift 和 `git diff --check` 通过。这些红灯是修复起点，不应被改成跳过或降级断言。

2026-07-20 恢复结果：最终 route、真实 DB 覆盖、编译后 capability、正常/窄屏输入框和设置页入口均重新验收；串行全量 4410/4410、生产构建通过。恢复期间实页又发现并修复两处原测试未覆盖的问题： untouched catalog 行的 stale Kimi capability 遮蔽当前目录，以及仅做 `max-width` 仍会让绝对定位菜单从触发器右侧溢出。真实 provider effort wire 与 approve/deny/timeout 矩阵仍按表中状态保留为未验证，未用 UI passed 冒充 live passed。

## 2026-07-19 直接恢复结果

本轮不再启动 loop，由 Codex 在用户临时授权下直接实现并按同一用户路径复测：

| ID | 修复 | 当前证据 |
|---|---|---|
| U1 | final provider-model serialization 统一 lift nested capability | GPT-5.6 route-contract 通过，composer 可读 top-level allowlist |
| U2 | manual exact-ID Kimi 行按 upstream identity 只读 enrichment；隐藏 legacy alias 不阻断默认能力来源 | 含 `manual_hidden sonnet` + `manual_enabled kimi-for-coding` 的真实 DB 形状测试通过；UI 只见 `Kimi for Coding` + Auto/Low/High/Max |
| U3 | catalog-only CodePlan 直接返回内置 SKU，不依赖可选 `/models` | 模拟 DNS failure 仍 200 且含 GLM-5.2 |
| U4 | effort menu 复用模型选择器 typography/items/geometry/motion | 视觉合同测试通过，待最终浏览器截图验收 |
| U5 | SDK manifest 解析锚定 app cwd，不再锚 bundle `__filename` | 正在运行的 Next/Turbopack capability route Playwright smoke 通过 |
| U6 | Codex `auto_review` 映射到 reviewer/approval/sandbox 三轴并进入 start/resume/turn；不再依赖 Claude SDK，旧版/回显不符 fail closed | mapping + Runtime 分流 + prerelease 版本门 + start/resume echo 定向回归通过 |
| U7 | CodePilot 本地标题保持 canonical，已有 Codex thread 后台 `thread/name/set` | sync/no-thread/reject 3 条行为测试通过；不冒充 Codex 内置生成 |
| U8 | 持久化 TTFT/API/SDK/墙钟/重试/resume/terminal；无 DNS 先做 hostname preflight | 当前无 DNS 的真实 GLM Claude Code route 从百秒空等收敛为 3188ms `NETWORK_UNREACHABLE`；真实成功 provider smoke 仍是环境依赖 |

这里保留“待真实 provider smoke”不等于未修：U8 的应用失效行为（长时间无反馈、无可观测数据）已经闭合；供应商成功返回必须等系统 DNS 恢复，不能用单测伪造。

## 恢复顺序

1. 先修 U1、U2、U4：同属模型能力到输入框的最终显示链。
2. 修 U5、U6：分别处理 Claude SDK 编译后探测和 Codex reviewer wire，禁止共用模糊的 `auto` 字符串推断。
3. 修 U3：内置 CodePlan 目录作为主路径或可靠回退，不让添加模型依赖单一上游探测。
4. 为 U8 增加阶段化延迟遥测，再按真实数据修复；不能用本机 DNS 故障代替根因结论。
5. 最后完成 U7 的跨 Runtime 策略，并跑一遍完整父任务验收矩阵。
