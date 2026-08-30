# Grok 4.6、Grok Build OAuth 与 DeepSeek V4 Pro 0813 适配核验

> 日期：2026-08-13；复审：2026-08-14；修复复核：2026-08-15
> 结论：DeepSeek Pro 0813 的稳定 ID 与 Responses 适配成立；Grok 4.6 的 SDK 能力错配已在产品边界收口：当前 UI 只展示 Low/Medium/High，历史或外部 `xhigh/max` 在生产 builder 中折叠为 High，并通过锁定 SDK 的真实 wire 矩阵。Grok Build proxy headers 已在用户真实 HTTP 426 复现后修复；真实账号复验前仍不能记 Smoke passed。

主体注记：2026-08 当前 Grok Build 官方仓库与文档使用 **SpaceXAI** 作为组织主体名称；API 品牌、开发者域名与产品入口仍使用 xAI / `x.ai`。仓库代码继续以 `xai` 命名协议和 API brand，不代表否认主体变更。

## 官方事实

### Grok 4.6

- xAI 2026-08-12 发布 Grok 4.6，并明确可用于 Grok Build、API 与合作渠道：<https://x.ai/news/grok-4-6>。
- 官方模型页给出 API slug `grok-4.6`、500K context、text+image、function calling、structured output 与 reasoning：<https://docs.x.ai/developers/models/grok-4.6>。
- Reasoning 合同为默认 High、不可关闭，支持 Low/Medium/High；4.6 起增加 XHigh。Responses/AI SDK 使用 xAI namespace 的 `reasoningEffort`：<https://docs.x.ai/developers/model-capabilities/text/reasoning>。

模型能力事实不等于当前 SDK transport 能力。锁定且截至 2026-08-14 仍为 npm latest 的 `@ai-sdk/xai@4.0.18`，chat / Responses 两处 provider-options schema 只接受 `none/low/medium/high`。带阳性对照的真实 builder → SDK 探针证明：未经适配的 `xhigh` 会在发网前报 `invalid xai provider options`、请求数为 0。2026-08-15 的适配因此让 4.6 UI 只承诺 Low/Medium/High，并在生产 builder 边界把外部 `xhigh/max` 折叠成 `high`；minimal/low/medium/high/xhigh/max 已逐档穿过锁定 SDK 到 fetch，确保没有非法 token 抵达序列化层。升级到支持 XHigh 的 SDK 前，不向用户宣告 CodePilot 的 XHigh transport 可用。

### Grok Build 授权

- xAI 官方开源 Grok Build：<https://github.com/xai-org/grok-build>。本次核对源码 commit `e5fd4816d43260c15ba785f103990c1ed6cea230`（2026-08-13）。
- 公开 OAuth client ID 仍为 `b1a00492-073a-47ea-816f-4c329264a828`；issuer 是 `https://auth.x.ai`。
- 个人 OAuth scopes 包含 `openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write`。
- 生产 browser flow 绑定 `127.0.0.1:0`，由 OS 分配端口；authorize 与 token exchange 原样复用同一 redirect URI，`referrer=grok-build`。
- Grok Build 企业部署文档区分订阅 session inference host `cli-chat-proxy.grok.com` 与 API Key inference host `api.x.ai`：<https://docs.x.ai/build/enterprise>。
- 同一官方源码 commit 的 inference 组装把 `x-grok-client-version` 明确标为 proxy version gate 必需，并对 production proxy 同时注入 `X-XAI-Token-Auth: xai-grok-cli`、`x-authenticateresponse: authenticate-response`、`x-grok-client-mode` 与客户端 identifier。2026-08-14 用户真实请求以 HTTP 426 证实缺少 version 会被拒绝；CodePilot 已锁定该上游 crate 版本 `1.0.3` 作为兼容 profile 并补齐整组 headers，真实账号重试仍待完成。
- proxy 使用 `x-grok-model-override` 而不是 JSON body 选择实际后端；除默认 `grok-build` 外该 header 属于必要路由合同。CodePilot 现已把 picker 的实际 model id 传给 OAuth fetch，并用真实 AI SDK Responses wire 断言 header 与 body model 同为 `grok-4.6`；caller 不能覆盖该 header。
- OAuth 登录的 Grok Build 会使用 session bearer + Build headers 调用 `GET https://cli-chat-proxy.grok.com/v1/models`，服务端返回当前账号可选的文本/agent 模型；这比 CodePilot 静态 OAuth catalog 更接近 entitlement 真源。没有真实账号响应前，不能推断具体还包含哪些聊天模型。

适配边界：CodePilot 复用的是公开 Grok Build client，不代表与 xAI 的官方合作；不读取 Grok Build `auth.json`。API Key 与 Build OAuth 在 UI、resolver、host gate、注销和计费语义上保持独立。

### Grok Build 图像与视频能力（2026-08-14 补充）

- 官方 Grok Build 命令文档公开 `/imagine` 与 `/imagine-video`：<https://docs.x.ai/build/modes-and-commands>。当前开源源码进一步注册 `image_gen`、`image_edit`、`image_to_video`、`reference_to_video` 四类工具；它们是会话工具/媒体能力，不是聊天模型 picker 项。
- 官方当前外部目录展示为 **Grok Imagine Image 2.0**（API model `grok-imagine-image-2.0`）与 **Grok Imagine Video 1.5**（`grok-imagine-video-1.5`）。本次锁定的 Grok Build 源码内部仍把图片请求默认路由到 `grok-imagine-image-quality`，并允许远端覆盖为 `grok-imagine-image`；这些属于 Build wire alias，不应作为 CodePilot 外部展示名。API 可用也不自动证明订阅 entitlement：<https://docs.x.ai/developers/model-capabilities/images/generation>、<https://docs.x.ai/developers/models/grok-imagine-video-1.5>。
- 与文本 inference 不同，Grok Build 对 image/video 会把 fresh OAuth session bearer 直接发往 `https://api.x.ai/v1/images/*` / `videos/*`，同时携带有 provenance 的 client version/identifier；不会附 proxy-only token-auth/authenticate-response headers。官方源码注释明确 session 与 API Key 两类用户都走该 public API host，由服务端按用户计量。
- free / X Basic 会在客户端短路并提示升级；SuperGrok 付费计划才解锁图像/视频，实际额度来自统一 weekly allowance，不能由 CodePilot 伪造：<https://docs.x.ai/grok/overview>。

CodePilot 已在 2026-08-14 接入 xAI OAuth Imagine client：现有 `codepilot_generate_image` 支持 Grok Imagine Image 2.0 生成/编辑，新增 `codepilot_generate_video` 支持文本、首帧图片和多 reference 三种 Video 1.5 输入；两者在三 Runtime 共用现有 `image_generation` capability package，输出进入 `MediaBlock` / Gallery，不把 Imagine slug 塞进聊天模型选择器。媒体使用 purpose-specific fetch，proxy 文本与 public API media 各自保持精确 host+path allowlist。

### DeepSeek V4 Pro 0813

- DeepSeek 官方模型与价格页显示 API ID 仍为 `deepseek-v4-pro`，当前版本为 `DeepSeek-V4-Pro-0813`；上下文 1M、最大输出 384K，并支持 JSON、tool calls、Responses API 与 Anthropic API：<https://api-docs.deepseek.com/quick_start/pricing/>。
- 官方 Thinking Mode 页声明 Responses effort 使用 `none/low/high/max`；CodePilot 的产品菜单继续用 Auto（不显式下发）+ Low/High/Max，`xhigh` 按既有 DeepSeek 合同映射到 High：<https://api-docs.deepseek.com/guides/thinking_mode/>。
- Anthropic 兼容入口仍为 `https://api.deepseek.com/anthropic`，模型名保持 `deepseek-v4-pro`：<https://api-docs.deepseek.com/guides/anthropic_api/>。

因此不创建 `deepseek-v4-pro-0813` 伪 ID。Codex Runtime 只对第一方、非 suffix 的稳定 ID 启用 `/responses`；Claude Code 的 `deepseek-v4-pro[1m]` 是协议侧 convention，不能误发给 Responses。

## 原实施决策与复审修正

1. xAI API Key catalog 默认 `grok-4.6`，Build virtual provider 同步；4.5 只作 legacy。
2. Grok 4.6 的上游能力为 500K、vision、always reasoning 与 Low/Medium/High/XHigh；默认 High。CodePilot 在当前 SDK 兼容期只可承诺 Low/Medium/High；不得把 UI XHigh 与 helper 自测当成 wire 证据。
3. Grok Build OAuth 使用动态 loopback、当前 scopes/referrer、Build proxy 与完整 proxy client headers；每次文本请求必须按当前选择发送 `x-grok-model-override`，OAuth 模型目录来自带 session auth 的 proxy `/v1/models`。host gate 必须在 refresh 前，版本 header 必须有可维护的上游 provenance，不能伪造任意版本。
4. DeepSeek Pro 对外保持官方稳定产品名 `DeepSeek V4 Pro`，0813 只作为当前服务端版本与适配证据记录；wire ID 保持 `deepseek-v4-pro`，补 1M/Low，并与 Flash 一样开放第一方 Codex Responses。
5. ClinePass/OpenCode Go 不继承第一方 DeepSeek wire capability；没有 aggregator API 证据时仍 tool-use-only。
6. Grok Build 图像/视频属于媒体工具而非聊天模型；OAuth media 直连 public xAI API 的精确生成/轮询路径，按套餐 entitlement 与 weekly allowance 计量，必须独立于 proxy inference fetch 实现和验收。

## 验证边界

2026-08-13 的 108/108 与全量 5195 pass / 0 fail / 1 skipped 只证明既有断言通过，不再作为 Grok 4.6 review pass：XHigh fixture 手写 `high`，没有调用真实 builder。2026-08-14 的 426 修复新增完整 proxy headers（含 model override）、exact route gate 与真实 SDK Responses wire 测试；随后 Imagine 自动化补齐 image/edit/video path 正反例、fresh bearer、401 refresh 单次重试、proxy-only header 缺席、异步轮询、受控下载与 `MediaBlock`/Gallery provenance，最终全量为 5207 pass / 0 fail / 1 skipped。没有在自动化中使用真实凭据或产生上游费用；authenticated `/models`、4.6 文本重试、Imagine entitlement/真实资产、device/browser 登录和 DeepSeek Pro 0813 最小 turn 仍在 Smoke Ledger 待跑。
