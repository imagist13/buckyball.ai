# Harness Home — 统一能力与创作系统竞品调研

> 日期：2026-08-04
> 范围：CodePilot 的 Assistant Memory 激活边界、Skill/MCP/CLI 统一能力、跨 Runtime 调用，以及可视化/图像/视频能力的质量与模型扩展性
> 结论性质：外部产品事实与 CodePilot 取舍分开记录；推荐安装页本轮不进入实施优先级

## 1. Executive read

这轮调研支持三个结论：

1. **文件可见性不能等同于助理 Memory 自动激活。** 项目把助理目录作为 cwd 时，目录中的 `AGENTS.md`、`CLAUDE.md`、`memory.md` 和其他文件仍应像普通项目文件一样可读；需要单独门控的是 Memory 搜索、自动注入、自动写回和 Heartbeat 等助理服务。
2. **Skill、MCP、CLI 不应该是三个孤岛。** 产品层应呈现一个 Capability Package；Skill 提供意图与步骤，MCP/CLI/内置工具提供 action，renderer 与 model adapter 提供输出能力。Package 内及 Package 间通过受控 Broker 相互调用。
3. **创作能力的壁垒不是再做一个工作流系统，而是效果稳定与模型适配。** 可视化使用受控组件/模板保证下限；生成式媒体使用 capability descriptor 和 provider adapter 接更多图像/视频模型；所有结果保留输入、模型、参数和素材 lineage。

## 2. 竞品观察

### 2.1 goose：Extension、Recipe、MCP App 形成一个使用面

**观察到的事实**

- goose 同时提供 Desktop、CLI 与 API，使用 MCP Extensions 扩展工具，并用 Recipes 把 instructions、extensions、parameters 和 subrecipes 放进可移植配置；同一产品也支持 MCP Apps 在对话内渲染交互 UI。
- Auto Visualiser 不是让模型任意生成一块 UI，而是让模型在一组预生成可视化模板中选择，再把当前数据映射进去。

来源：[goose 产品与开放标准](https://block.github.io/goose/)、[Auto Visualiser with MCP-UI](https://block.github.io/goose/blog/2025/08/27/autovisualiser-with-mcp-ui/)

**对 CodePilot 的启发**

- 借鉴“一套能力、多个入口”，不让 Runtime 决定能力所有权；
- 借鉴模板化可视化来保证效果下限；
- 不照搬 Recipe 作为另一套 workflow 产品。CodePilot 的步骤仍由 Skill 表达，执行统一进入 Capability Broker。

### 2.2 Dify：Package manifest 与反向调用

**观察到的事实**

- Dify Plugin manifest 会声明 runtime、resource、permission、tools、models 与 endpoints；
- 插件可 reverse invoke 已安装工具、Workflow as Tool 和自定义 API tool；权限在 manifest 中声明。

来源：[Dify Plugin Manifest](https://docs.dify.ai/en/develop-plugin/features-and-specs/plugin-types/plugin-info-by-manifest)、[Reverse Invocation Tool](https://docs.dify.ai/en/develop-plugin/features-and-specs/advanced-development/reverse-invocation-tool)

**对 CodePilot 的启发**

- Package 要有稳定的 `provides`、`requires`、permissions、secrets 与 resource budget；
- “相互调用”应通过一个有身份、权限、深度上限和审计事件的 Broker，而不是让 Skill 拼 shell 或直接找某个 Runtime 的私有路径；
- 不把 model、tool、Skill 分成用户看到的多个安装对象。内部适配可以分层，但生命周期与诊断属于同一 Package。

### 2.3 Open WebUI：文件上下文、Memory 工具与执行策略是不同层

**观察到的事实**

- Open WebUI 把内置能力、Workspace Tools、MCP、OpenAPI 与隔离终端统一看作可供模型调用的 tools，但保留不同安全边界；
- 工具需要平台启用、模型/会话挂载和用户权限同时满足；
- 文件读取、Knowledge、Memory、图片生成等是不同工具类别，Memory 搜索/增删改具有独立开关与能力门禁；
- 其文档明确警告 Workspace Tools 可执行任意 Python，安装来源与权限必须受控。

来源：[Open WebUI Tools](https://docs.openwebui.com/features/extensibility/plugin/tools/)

**对 CodePilot 的启发**

- 普通文件可读与自动 Memory service 必须分开；
- Package 是一个整体，但调用前仍要在 Broker 内合并 session、Runtime、model、permission 和 secret policy；
- 这些内部门禁不应该被产品文案拆成“安装了但不是真的能执行”两套概念。用户只看到 `可用 / 需要授权 / 需要修复`，详细 adapter 证据进入诊断。

### 2.4 ComfyUI：多模型不是一个通用表单，而是能力描述

**观察到的事实**

- ComfyUI Workflow 用节点图表达图像、视频、音频等生成过程，Workflow 可以保存和复现；
- Partner Nodes 把闭源/API 模型作为节点接进同一执行面，并显式处理版本、账号/credits、网络与节点能力差异；
- 不同厂商和模型具有不同的输入类型、reference 数量、时长、分辨率与异步任务约束。

来源：[ComfyUI Workflow](https://docs.comfy.org/development/core-concepts/workflow)、[ComfyUI Partner Nodes](https://docs.comfy.org/tutorials/partner-nodes/overview)

**对 CodePilot 的启发**

- 不复制节点画布；借鉴的是 model capability descriptor、异步 job、依赖健康与 provenance；
- 图像/视频 UI 和工具 schema 应由模型 capability 驱动，不能为每个 Provider 写一套页面，也不能假设所有模型都支持同一种 image-to-video 输入；
- ComfyUI 可以成为一个 adapter，但不能成为唯一执行后端。直接 Provider API 与未来本地模型也应使用同一接口。

### 2.5 FLORA：统一创作面与可复用 reference

**观察到的事实**

- FLORA 把图像、视频、音频模型与编辑动作放在同一创作面；Elements 用于复用 subject/style/asset reference，Batch 用于同一设置的多版本生成，生成结果可继续编辑与导出。

来源：[FLORA Product Canvas](https://flora.ai/product-canvas)

**对 CodePilot 的启发**

- 借鉴“同一素材可继续生成、编辑和比较”，以及 reference 的稳定 ID；
- 不照搬无限画布。CodePilot 的主要交互仍是聊天 + Artifact + Asset Library，复杂流程由 Skill 和 Capability Broker 执行。

## 3. 对 CodePilot 的目标模型

```text
Capability Package
  ├─ Skills：何时用、怎样组合、质量规则
  ├─ Actions：MCP / CLI / builtin / model operations
  ├─ Renderers：Widget / HTML / media preview
  ├─ Model adapters：image / video / audio providers
  ├─ provides / requires / optional dependencies
  └─ permissions / secrets / policy / provenance

Capability Broker
  ├─ resolve policy and model capability
  ├─ expose the same package to each Runtime bridge
  ├─ invoke actions across packages
  ├─ prevent cycles, privilege escalation and fake success
  └─ normalize Artifact / AssetRef results
```

产品层只有一个 Package 身份与生命周期。`Skill → MCP → CLI → media model → renderer` 是一次可追溯调用图，不是五个彼此独立的“已安装项”。

## 4. 创作能力需要的最小合同

### 4.1 两条质量管线

1. **解释型可视化**：优先使用经过设计与可访问性校验的 chart/diagram/UI primitives；数据与模板动态绑定；验证 schema、overflow、主题、reduced motion 和 screenshot。
2. **生成式媒体**：使用 model-specific prompt compiler、reference assets、参数验证与输出检查；保留 prompt、negative prompt、seed、model、provider、尺寸/时长、引用素材与 job lineage。

两条管线不能共用一个“生成成功”指标。解释型可视化看正确性、可读性和布局；图像/视频看 reference 一致性、构图、技术质量与用户选择。

### 4.2 Policy resolution

这里的 policy 同时包含：

- Runtime 是否支持结构化 tool call、MCP、renderer 与异步 job；
- 当前模型的 tool-calling 可靠性与模态能力；
- permission profile、文件/网络/进程访问、Secret 与用户确认；
- Provider 的内容安全、区域、额度、价格、并发和数据处理约束；
- project/user scope 与 Asset 导出规则。

Skill 只请求 capability/action，不自己判断某个 Provider 的私有细节。Broker 选择符合 policy 的 adapter；没有可行路径时返回可解释的 `unsupported`，不偷偷换模型或伪造结果。

### 4.3 Media model descriptor

首版至少表达：

- `providerId`、`modelId`、版本与可用区域；
- operations：`text_to_image`、`image_edit`、`inpaint`、`outpaint`、`upscale`、`text_to_video`、`image_to_video`、`reference_to_video`、`video_edit`；
- input slots、reference 数量/类型、输出 mime、aspect ratio、resolution、duration、fps；
- sync/async、poll/cancel、并发、预计成本/耗时；
- safety/permission/secret requirements；
- normalized Artifact 与 Asset materialization contract。

## 5. 明确不采用

- 不把助理目录做成隐藏沙箱或禁止项目读取其中的普通文件；
- 不做第二套 workflow engine、无限画布或节点数据库；
- 不把推荐 Marketplace 提前到 Package/Broker 之前；
- 不让 Skill 直接拼 shell、读取 Secret 或绕过 Broker 调用另一个工具；
- 不把所有图像/视频模型压成一个最低公分母表单；
- 不自动把一次生成选择写成跨项目 Taste Memory。

## 6. 推荐优先级

1. **P0 — Assistant service activation**：保留目录文件自然可读，只把 Memory 自动服务从 cwd 推断改为显式助理会话激活。
2. **P1 — Capability Package + Broker**：统一 Skill/MCP/CLI/renderer/model adapter 的身份、依赖、相互调用与跨 Runtime bridge。
3. **P2 — Visual/Media reference package**：用一个真实 Package 验证模板化可视化、图像/视频 model descriptor、policy resolution 与 Asset lineage。
4. **Deferred — 推荐安装页**：Package/Broker 和安全合同稳定后再做，不让 Marketplace 反过来决定领域模型。
