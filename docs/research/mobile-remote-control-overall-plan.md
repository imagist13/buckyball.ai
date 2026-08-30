# 移动端远程控制整体方案报告（V2）

> 创建时间：2026-03-12
> 最后更新：2026-03-13
> 适用范围：CodePilot 桌面端 + Android Companion + 多设备控制 + Feishu 能力扩展

## 一、这次更新后的结论

在引入 OpenClaw 官方飞书插件和 `claude-to-im-skill` 作为参考后，CodePilot 的远程方案应从“桌面 Bridge + 移动端控制器”升级为三层结构：

- `Remote Core`
  负责 Host / Controller / Session / Lease、流式事件、审批、结果摘要、多设备接管。
- `Channel Plugin Layer`
  负责 Telegram / Discord / Feishu / QQ 的配对、策略、交互、状态、运维接口。
- `Platform Capability Layer`
  负责飞书文档、消息搜索、资源下载、任务、日历等平台深度能力。

这意味着：

- 现有远程 App 方向是对的，不需要推翻。
- 现有 Bridge 架构要升级，但不应该重写桌面 Chat 主链路。
- `claude-to-im-skill` 仍然有参考价值，但应定位为“轻量守护进程包装层”，不是未来总架构本身。
- OpenClaw 官方飞书插件值得重点借鉴，但要借的是接口模型、交互方案、权限编排和配置层，不是整套运行时。

## 二、更新背景

本次方案修订基于三条输入：

- 当前 CodePilot 已有桌面 Bridge、远程审批、流式输出、文件预览和多 IM 通道
- `claude-to-im-skill` 已经验证了“守护进程 + 配置映射 + 轻量桥接”的落地方式
- OpenClaw 官方飞书插件已经把 Feishu 从“消息桥接”提升成“完整渠道插件 + 平台能力工具集”

其中最重要的新信息是：飞书这次官方插件已经暴露出一套更完整的渠道抽象和能力模型，远超传统 bot 适配器。

## 三、现状与约束

### 3.1 当前项目已经有的能力

当前仓库里，远程与移动方案所需的底层能力已经具备不少基础：

- 聊天主链路：`src/app/api/chat/route.ts`
- 会话读写：`src/app/api/chat/sessions/[id]/route.ts`
- 权限审批：`src/app/api/chat/permission/route.ts`
- 文件预览：`src/app/api/files/preview/route.ts`
- 原始文件查看：`src/app/api/files/raw/route.ts`
- 前端切换会话后继续追流：`src/lib/stream-session-manager.ts`
- 现有多 IM Bridge：`src/lib/bridge/`

### 3.2 当前主要限制

当前限制仍然成立：

- 桌面服务默认只监听本地 `127.0.0.1`
- API 默认假设调用方是本地可信桌面 UI
- Bridge 现在更像“多 IM 远程会话层”，还不是“远程控制平台层”

### 3.3 当前 Bridge 的定位需要调整

当前 `docs/handover/bridge-system.md` 描述的是现状：多 IM 远程操控 Claude 会话。  
这套系统已经很好，但目标态不应只停留在“消息桥接”，而应把它视为未来 `Channel Plugin Layer` 的雏形。

## 四、参考输入的核心结论

### 4.1 OpenClaw 官方飞书插件给出的启发

OpenClaw 官方飞书插件最值得借的不是“功能数量”，而是能力组织方式。

它不是简单 bot，而是完整插件协议：

- pairing
- capabilities
- configSchema
- security
- setup / onboarding
- messaging / actions
- status / gateway
- 平台工具集

这说明飞书这条线在 CodePilot 中也不应继续停留在“一个 adapter 文件 + 几个设置项”的层级。

此外，它已经证明以下能力组合是合理且有用户价值的：

- 群聊 / 私聊策略分离
- 多账号与按群精细配置
- block streaming 卡片
- 交互式卡片与回调
- OAuth / Device Flow / App Scope 自动授权
- 状态探测、诊断、运维入口
- 消息读取、搜索、资源下载
- 文档 / 表格 / 日历 / 任务等平台工具

### 4.2 `claude-to-im-skill` 给出的启发

`claude-to-im-skill` 的价值不在“提供新架构”，而在于它展示了一个非常实际的落地方式：

- 它把桥接包装成一个本地守护进程
- 它用简单配置文件和脚本完成安装、启动、诊断
- 它用配置映射把自身配置转换成现有 bridge 设置
- 它已经验证了多通道、SSE 流、权限等待、消息持久化这些基础机制

这说明 CodePilot 后续在做远程能力升级时，应该把“桌面主产品”和“轻量守护进程/skill 包装层”视为两个不同交付面。

## 五、修订后的目标架构

## 5.1 三层结构

### Layer 1: Remote Core

这是 CodePilot 下一阶段应重点建设的核心层。

职责：

- Host / Controller / Session / Lease 建模
- 流式事件总线
- 权限审批统一协议
- 结果产物 / run summary / changed files 统一表示
- 多设备接管
- 多 Host 管理
- 远程 App 与 IM 渠道共享的会话控制协议

### Layer 2: Channel Plugin Layer

这一层吸收 OpenClaw 的渠道插件思路。

每个渠道应显式建模：

- pairing
- capabilities
- config schema
- access policy
- status / probe / doctor
- onboarding / setup
- messaging / actions
- gateway lifecycle

这样，飞书不再是 `feishu-adapter.ts` 的单文件逻辑，而是一个完整的渠道模块。

### Layer 3: Platform Capability Layer

这一层用于承载“飞书本身的能力”，而不是“远程控制能力”。

例如：

- IM 消息读取 / 搜索 / 资源下载
- Doc / Wiki / Drive
- Task / Calendar
- Bitable / Sheets

这层可以先对接飞书，未来也可对接 Slack / Notion / Google Workspace 等平台能力。

## 六、角色模型保持不变，但职责更清晰

定义四个核心对象：

- `Host`
  一台运行 CodePilot 的执行主机。负责工作目录、数据库、Claude CLI、Provider 凭证和会话运行。
- `Controller`
  一个远程控制端，可以是 Android App，也可以是另一台桌面设备或 IM 渠道。
- `Session`
  某个 Host 上的对话单元。
- `Lease`
  某个 Controller 对某个 Session 的临时写控制权。

与 V1 相比，这里最重要的变化是：

- IM 渠道现在被视作 Controller 的一种
- Android App 与 Feishu / Telegram / Discord 将共享同一套 Remote Core

## 七、控制模型仍然成立，但要和渠道层解耦

### 7.1 多读者、单写者

继续坚持：

- 多端可同时观察
- 单 session 单写者
- 写操作必须持有 lease
- 另一个端如需控制，必须 `take over`

### 7.2 为什么这个模型更重要了

因为一旦引入 Feishu 官方插件式能力，控制端不止手机：

- Android App
- 另一台桌面 Controller
- 飞书会话
- Telegram / Discord / QQ

只有把所有写操作统一收拢到 Lease 体系，后续 Feishu 深度能力接进来时才不会出现控制权失序。

## 八、Feishu 目标能力应拆成两组

### 8.1 第一组：远程控制增强能力

这组能力应纳入当前远程方案修订目标。

- pairing / onboarding
- 群聊 / 私聊策略
- allowlist / requireMention
- status / probe / diagnose
- 更完整的消息动作
- 更完整的卡片流式展示
- 审批卡片 / 回调机制
- app scope / user scope 自动授权编排

这组能力会直接影响：

- 现有 Bridge 抽象
- 远程 App 协议
- 控制权和审批模型

### 8.2 第二组：飞书平台深度能力

这组能力建议明确列为第二阶段或后续能力层目标，不要和远程 App MVP 绑死。

- 历史消息读取
- 消息搜索
- 资源下载
- 文档 / Wiki / Drive
- Task / Calendar
- Bitable / Sheets

这些能力非常有价值，但它们更接近“飞书集成产品线”，而不只是“远程会话控制”。

## 九、`claude-to-im-skill` 在新方案里的定位

### 9.1 应保留的借鉴点

推荐明确借鉴以下点：

- 守护进程入口结构
- 配置文件与脚本化运维
- 配置到桥接设置的映射方式
- 权限等待网关的简洁接口
- 本地 JSON store 的轻量交付模式

### 9.2 不应继承的假设

以下假设不适合作为 CodePilot 远程总架构：

- 单用户本地 daemon 是唯一运行模型
- 无入站监听就是最终安全边界
- 平台凭证 + allowlist 足以覆盖所有控制权问题
- 权限等待只需本地 Map 即可

原因很简单：一旦我们做远程 App、多 Controller、多 Host，这些前提都不再成立。

### 9.3 推荐定位

因此建议把 `claude-to-im-skill` 视为：

- `Remote Core` 的一种轻量封装与运维入口
- CLI / daemon 交付形态的参考实现
- CodePilot 桌面产品之外的配套分发层

而不是未来总架构的主导来源。

## 十、对现有项目方案的具体修订

### 10.1 从“Bridge 系统”升级成“Remote + Channel Plugin”

当前项目的描述应从：

- “多 IM 远程会话桥接系统”

升级成：

- “Remote Core + Channel Plugin + Platform Capability”

其中当前 `src/lib/bridge/` 的很多模块仍可保留，但语义要调整：

- `bridge-manager` 更接近 channel runtime / gateway coordinator
- `permission-broker` 应向统一 remote approval broker 靠拢
- `channel-adapter` 应逐步升级为 channel plugin contract

### 10.2 Feishu 模块不应继续只做适配器

飞书建议逐步拆出独立模块族，而不是把所有增长都继续堆在：

- `src/lib/bridge/adapters/feishu-adapter.ts`

建议目标结构：

- `src/lib/channels/feishu/`
  - plugin.ts
  - config-schema.ts
  - policy.ts
  - status.ts
  - onboarding.ts
  - gateway.ts
  - messaging/
  - cards/
  - auth/
  - tools/

### 10.3 远程 App 需要同步调整的点

远程 App 不只是“看聊天内容”，后续必须适配以下统一协议：

- Host 列表与在线状态
- Session 列表与 lease 状态
- 审批 inbox
- 结果产物摘要
- 渠道侧 pairing / onboarding 状态
- 平台授权状态

这意味着远程 App 要预留：

- Host dashboard
- approvals center
- run summary / artifacts feed
- multi-host routing
- controller identity

## 十一、桌面端改动边界（修订版）

### 11.1 可以新增的区域

建议优先新增而非重构：

- `src/lib/remote/`
  Remote Core
- `src/lib/channels/`
  渠道插件层
- `src/lib/capabilities/`
  平台能力层
- `src/app/api/remote/`
  远程专用 API
- `src/app/api/channels/`
  渠道状态 / 配置 / onboarding / pairing / probe

### 11.2 尽量不动的区域

继续保持以下主链路稳定：

- 本地桌面聊天入口
- 本地流式 UI 逻辑
- 本地权限执行链路
- 现有文件预览基础能力

### 11.3 兼容性原则不变

必须继续坚持：

- `remote disabled = current desktop behavior unchanged`

## 十二、远程 App 视角下的改动

### 12.1 App 不再只是 Chat 页面

在 V2 架构下，远程 App 的首页不应只是 session list，而应包括：

- Hosts
- Active sessions
- Pending approvals
- Channel / pairing health
- Recent runs / artifacts

### 12.2 App 需要适配更多状态

新增状态包括：

- 当前 Host 是否在线
- 当前 Session 是否被其他 Controller 接管
- 渠道是否配置完成
- Feishu app / user scope 是否缺失
- 是否需要重新配对或重新授权

### 12.3 App 的核心优势仍然是控制，不是重展示

即使 V2 引入更多能力，移动端仍然不应承担：

- 全功能文件树编辑
- 全量复杂卡片构造
- 平台工具配置与调试主入口

复杂展示和复杂运维仍然更适合桌面端。

## 十三、仓库组织建议（修订版）

仍然建议同仓 monorepo，不建议拆成两个仓库。

推荐结构：

- `apps/mobile`
  Android Companion
- `packages/remote-contract`
  Host / Controller / Session / Lease / events / approvals / artifacts 的共享协议
- `packages/channel-contract`
  pairing / capabilities / status / gateway / config schema 的共享接口
- `packages/remote-client`
  Controller 访问 SDK
- `src/lib/remote/`
  桌面端 Remote Core
- `src/lib/channels/`
  渠道插件层

这样最适合当前以 AI 协作为主的开发方式：

- 协议不漂移
- 上下文集中
- 变更边界清晰
- 可以分层逐步迁移

## 十四、数据模型建议（修订版）

在 V1 数据模型基础上，建议新增或明确以下对象：

- `hosts`
- `paired_devices`
- `controller_sessions`
- `session_leases`
- `remote_audit_logs`
- `host_presence`
- `channel_accounts`
- `channel_pairings`
- `channel_authorizations`
- `capability_credentials`

其中：

- `session_leases` 负责控制权
- `channel_accounts` 负责多账号渠道配置
- `channel_pairings` 负责 Feishu / Telegram 等 pairing 状态
- `channel_authorizations` 负责 app scope / user scope / device flow 状态

## 十五、实施顺序（修订版）

### Phase 0：方案与边界重构

- 明确三层结构
- 抽出 `remote-contract`
- 抽出 `channel-contract`
- 修订 Bridge 与远程方案文档

### Phase 1：Remote Core 落地

- Host / Controller / Session / Lease
- 远程专用 API
- 单 Host + 单移动端控制
- 审批 / 结果摘要 / 流式统一事件

### Phase 2：Feishu V2 渠道能力

- pairing / onboarding
- status / probe / diagnose
- 群聊 / 私聊策略
- 更完整卡片流式交互
- 自动授权编排

### Phase 3：多 Controller / 多 Host

- take over
- 审批中心
- 多 Host dashboard
- 渠道 / Host 健康总览

### Phase 4：飞书平台能力层

- 消息读取 / 搜索 / 资源下载
- 文档 / Drive / Wiki
- Task / Calendar

## 十六、明确不做的事情

本轮方案修订后，仍然不建议在第一阶段做：

- 运行中 Session 跨 Host 迁移
- 把飞书全部平台工具一次性塞进远程 App MVP
- 重写当前桌面 Chat 主链路
- 让 `claude-to-im-skill` 反向主导桌面产品架构

## 十七、关键风险与控制策略

### 风险一：把现有 Bridge 改坏

控制策略：

- 先抽象，再迁移
- 旧 Bridge 行为保持可回退
- 文档中区分“现状”和“目标态”

### 风险二：OpenClaw 参考范围过大，导致范围失控

控制策略：

- 区分渠道能力与平台能力
- 先借接口设计，再借高级工具
- 先完成 Feishu V2 控制面，再做平台工具面

### 风险三：`claude-to-im-skill` 的轻量假设和 CodePilot 主产品冲突

控制策略：

- 借守护进程包装，不借总架构假设
- 继续让桌面端作为权威状态源

### 风险四：远程 App 和 IM 渠道各做一套协议

控制策略：

- 统一沉到底层 `remote-contract`
- 所有 Controller 共享 Session / Lease / Approval / Artifact 协议

## 十八、推荐决策

建议当前确认以下决策：

- 远程方案升级为三层结构
- 现有 Bridge 作为 `Channel Plugin Layer` 前身继续演进
- 飞书本轮先做“控制面增强”，平台工具列入下一阶段
- `claude-to-im-skill` 继续作为轻量封装层参考，不作为总架构
- 远程 App 与 IM 渠道共享同一套 Remote Core

## 十九、下一步建议

如果继续推进，下一份文档最值得做的是：

- ~~`远程方案 V2 执行计划`~~ ✅ 已完成 → `docs/exec-plans/active/feishu-v2-channel-plugin.md`
- ~~`Remote Contract / Channel Contract 草案`~~ ✅ 已完成 → `src/lib/channels/types.ts` + `src/lib/remote/types.ts`
- ~~`Feishu V2 渠道模块拆分设计`~~ ✅ 已完成 → `src/lib/channels/feishu/`
- `Remote App 信息架构 + API 清单` — 待后续实施
