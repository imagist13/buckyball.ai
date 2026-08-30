# 千问 Token Plan 与 xAI Grok 接入交接

> 产品思考见 [docs/insights/qwen-token-plan-grok-access.md](../insights/qwen-token-plan-grok-access.md)
> 执行计划见 [docs/exec-plans/active/qwen-token-plan-and-grok-access.md](../exec-plans/active/qwen-token-plan-and-grok-access.md)

## 交付边界

本轮新增三类千问套餐 identity，以及两条互相独立的 xAI 渠道：

- 阿里云百炼 Coding Plan、Qwen Token Plan Personal、Qwen Token Plan Team。
- xAI 官方 API Key，通过 `@ai-sdk/xai` Responses 调用当前默认 `grok-4.6`（保留 `grok-4.5` legacy 入口）。
- Grok Build-compatible OAuth，支持浏览器 PKCE 和 RFC 8628 device flow。

xAI 只在 CodePilot Runtime 与 Codex Runtime 暴露。OAuth 复用公开 Grok Build client，不代表 CodePilot 与 xAI 存在官方合作。

> **2026-08-15 当前边界**：HTTP 426 所需的完整 Build proxy headers、`x-grok-model-override` 与 Imagine 图片/视频工具已完成代码和自动化验证；锁定 SDK 不接受 `xhigh`，因此 UI 只暴露 Low/Medium/High。compiler 的工具提示现只描述当前 request 实际挂载的 bridge surface，媒体 AbortSignal 已覆盖 Native、Claude MCP、Codex bridge 与确认 API 四个入口。authenticated `/v1/models` 仍未接入，4.6 文本与 Imagine 的真实订阅 entitlement/计费 smoke 仍待用户账号验证。2026-07 的 `grok-4.5` OAuth/X Search smoke 不能外推为这些新增路径已通过。

## 套餐 identity

`api_providers.preset_key` 是套餐身份真源。个人版和团队版共享 endpoint，不能再用 URL、数组顺序或 hostname 猜套餐。

身份解析统一经过 `resolveProviderPresetIdentity()`：

1. 显式 `preset_key`。
2. 可证明的 legacy fingerprint。
3. 唯一 endpoint/protocol 匹配。
4. 多候选时返回 ambiguous，要求用户选择。

Provider CRUD、模型目录、Doctor、Runtime picker、请求 resolver 和迁移都消费同一结果。普通编辑只采纳身份；只有 UI 显式发送 `reconcile_catalog: true` 才会按当前 catalog 整理系统管理的模型。

## DB 与迁移

- `src/lib/db.ts` 为 `api_providers` 增加 nullable `preset_key`。
- additive migration 只回填可证明的旧记录，并保持幂等。
- managed identity 与 endpoint/protocol 不一致时拒绝保存，防止改 URL 绕过套餐策略。
- 用户手动启用、隐藏或补充的模型继续由 `enable_source` / `user_edited` 保护。

## 调用策略

千问三套餐标记为 `interactive_only`。所有持有凭据的生成入口必须传入封闭联合 `callScene`，并在创建模型或发起 fetch 前调用统一策略 gate。

允许当前用户回合、工具续轮和同会话压缩；自动标题、定时任务、heartbeat、后台记忆、自动建议等隐藏调用 fail closed 或走无套餐凭据的确定性 fallback。新增 LLM 调用点时，不能用自由字符串或默认值绕过场景枚举。

## xAI API Key 路径

- Catalog identity：`xai`。
- 当前默认模型：`grok-4.6`；`grok-4.5` 仅作 legacy 兼容。
- SDK：`@ai-sdk/xai` 的 Responses model。
- 请求选项：xAI effort 放入 `providerOptions.xai`，并固定 `store: false`。能力目录必须以“生产 builder → 锁定 SDK → wire”测试为准；当前锁定 SDK 只接受 none/low/medium/high，因此 UI 只展示 Low/Medium/High，历史或外部传入的 `xhigh/max` 在 builder 边界折叠为 High，绝不把 SDK 不接受的值送入序列化层。
- 发送 bearer 前校验官方 `https://api.x.ai` origin；自定义 gateway 不得接收 xAI 凭据。

## xAI OAuth 路径

核心文件：

- `src/lib/xai-oauth.ts`：PKCE、token exchange、refresh、device protocol 与错误分类。
- `src/lib/xai-oauth-manager.ts`：callback server、原子 bundle、refresh single-flight、取消和状态。
- `src/lib/xai-imagine.ts`：Grok Imagine Image 2.0 / Video 1.5 的生成、编辑、轮询、受控下载与 Gallery 持久化。
- `src/lib/image-gen-mcp.ts`、`src/lib/builtin-tools/media.ts`、`src/lib/codex/proxy/builtin-bridge.ts`：Claude Code、CodePilot、Codex 三条 Runtime 的媒体工具入口与 `MediaBlock` 回显。
- `src/lib/env-proxy-fetch.ts`：让 packaged server 的 xAI 外部请求显式遵循 Electron 注入的 HTTP(S) system proxy 与 `NO_PROXY`。
- `src/app/api/xai-oauth/*`：start/status/cancel 路由。
- `src/components/settings/ProviderManager.tsx`：登录方式选择、轮询、注销和状态 UI。

浏览器流按 Grok Build 当前生产合同监听 `127.0.0.1` 的 OS 动态端口，校验 state、nonce 与 PKCE，并在 token exchange 原样复用该 redirect URI。允许的 `auth.x.ai` / `accounts.x.ai` origin 在 OPTIONS 和 GET callback 上获得一致 CORS/PNA 响应；其他 origin fail closed。设备流尊重服务端 interval、`slow_down` 和 `expires_in`。

授权 scope 与 Grok Build 当前公开源码一致，包含 `grok-cli:access`、`api:access` 及 conversation/workspace read/write。文本推理与 authenticated `/v1/models` 的订阅 bearer 发往 `https://cli-chat-proxy.grok.com`；上游生产请求的完整客户端识别合同包含有 provenance 的 `x-grok-client-version`、`X-XAI-Token-Auth: xai-grok-cli`、`x-grok-client-identifier`、`x-authenticateresponse` 与 `x-grok-client-mode`，推理请求还必须用 `x-grok-model-override` 传递用户实际选择的模型。漏掉 override 时，proxy 会走默认 `grok-build` 路由，不能声称 UI 中的 4.6 已实际命中。

### Grok Build 模型发现与 Imagine

上游 Grok Build 对 session auth 提供 authenticated `GET /v1/models`。返回目录受账号 entitlement 与上游策略影响，CodePilot 应做专用 parser/cache，并在失败时明确退回静态目录；静态 `grok-4.6` / `grok-4.5` 只能是产品 fallback，不能冒充当前账号的完整可用列表。

Grok Build 还注册了 `image_gen`、`image_edit`、`image_to_video`、`reference_to_video`。CodePilot 将其收敛为现有 `codepilot_generate_image`（有 reference 时自动编辑）和新增 `codepilot_generate_video`（文本、首帧图片或多 reference）两项用户工具。这些是会产出媒体的工具能力，不是聊天模型 picker 的额外文本模型：

- 外部工具文案和 Gallery provenance 使用官方产品名 **Grok Imagine Image 2.0** / **Grok Imagine Video 1.5**，公共 API wire 分别使用 `grok-imagine-image-2.0` / `grok-imagine-video-1.5`。当前 Build 源码的内部图片 alias 不作为 CodePilot 外部名称或公共 API model id。
- 视频 wire 使用 `grok-imagine-video-1.5`，提交到 `/videos/generations` 后轮询 `/videos/{request_id}`。
- OAuth session 的媒体调用会携带 fresh bearer 直接访问 `https://api.x.ai/v1`，而不是 Build proxy；媒体请求携带版本/identifier，不携带 proxy-only token-auth/authenticate-response headers。

媒体适配通过 `createXaiOAuthMediaFetch()` 实现 purpose-specific allowlist，只允许图片生成/编辑、视频生成/轮询的精确 endpoint，文本 `createXaiOAuthFetch()` 仍只接受 Build proxy `/v1/responses`。媒体 wrapper 每次取 fresh bearer，401 时强制 refresh 后最多重试一次，并剥离 token-auth、authenticate-response、client-mode、model-override 等 proxy-only headers。视频完成 URL 还要经过 HTTPS + xAI CDN allowlist、媒体类型和 250 MiB 流式上限，再以 `xai-imagine-video` producer 写入 Gallery；图片沿用 `image-generator` producer。Free/X Basic 等级限制与实际额度仍必须由真实 entitlement/smoke 裁决，不能从登录成功或 mock 成功推断。

图片生成的服务商真源是“工具显式选择 → 图片模型所属 family → Settings 当前 active image provider”；聊天 session 的文本服务商不参与媒体计费与确认文案裁决。Grok 的 20 MiB reference 限制也只在实际选择 xAI family 时执行，不能误伤 Gemini/OpenAI 等其他图片服务。三条 Runtime 都只在 Grok Build OAuth 当前可用时挂载视频工具；context compiler 的提示必须再与当前 bridge 的实际 `toolNames` 求交，未登录、权限 gate 或 Runtime 未挂载时不得向模型宣称视频工具可用。Native 图片/视频失败抛出真实 tool error，事件层标记 `is_error: true`；Native、Claude MCP、Codex bridge 与 `/api/media/generate` 都把调用方 AbortSignal 传入生成、轮询和下载。取消发生在轮询或下载完成前时停止后续请求且不新增 Gallery 行；若上游已经完成并且下载字节已返回，则保留并登记可能已计费的资产，不把本地 Stop 冒充远端撤销或退款。

OAuth 登录流程的取消语义另有多层保护：sleep 可中断、fetch 接收 signal、响应后复查、token 持久化前再次 fail closed。浏览器 token exchange 和设备轮询都不能在取消后写入迟到 token；这条 token 合同不要误写成 Imagine 资产的落盘策略。

OAuth token bundle 以单个 JSON setting 原子写入；并发 refresh 合并为 single-flight，rotation 后同时替换 access/refresh pair。只有明确的 `invalid_grant` 等永久错误清除凭据；网络、429、5xx 保留旧 bundle。

浏览器授权页由系统浏览器打开，会自然使用系统代理；Node/Next 的全局 `fetch` 默认不会仅因存在 `HTTP_PROXY/HTTPS_PROXY` 就使用代理。xAI 的 code exchange、device、refresh 与后续 bearer 请求因此统一走局部 `envProxyFetch`：HTTP(S) proxy 使用 Undici `ProxyAgent`，`NO_PROXY`、相对 URL 与非支持代理协议保持 direct。该 dispatcher 不设为全局，避免本地 callback 或其他 Provider 被意外代理。网络错误只附加稳定的 socket/DNS/TLS code，不记录 proxy URL、认证信息或 token。

## Runtime 数据流

- CodePilot Runtime：resolver 选择 xAI API/OAuth → `@ai-sdk/xai` Responses → native agent loop；交互场景由共享 `xai-hosted-search.ts` 注入 provider-executed `x_search`。
- Codex Runtime：virtual provider 进入 provider proxy → adapter 注入 xAI options、OAuth fetch override 与相同 `x_search` → Responses 上游；hosted call 不回显给 Codex 执行，而是通过现有 canonical event bus 回到聊天。
- Claude Code Runtime：xAI 不暴露；千问套餐按各自 Anthropic-compatible 目录和角色映射暴露。

## X Search 合同

- 只在 xAI 的 `interactive_chat` / `delegated_interactive` 请求中挂载；非 xAI、标题/记忆/定时等辅助或后台场景不获得该工具。
- API Key 与 OAuth 共用同一 tool assembly。凭据类型只改变认证注入，不改变 `tools[].type === 'x_search'` 的请求形状。
- 安装版本已经用真实 SDK request capture 证明：客户端 function tool 与 hosted `x_search` 可以存在于同一 Responses 请求。工具名碰撞直接报错，不覆盖用户/MCP 工具。
- provider-executed tool call/result 使用普通 `tool_use` / `tool_result` UI 合同；URL citation 附着在同一个 result，进入流式 checkpoint 和最终消息，刷新后不丢。
- 来源统一标记 `trust: external`。系统提示明确把帖子和链接当证据而非指令；没有 X Search 时不得用训练知识冒充实时搜索。
- CodePilot 不猜测单次搜索费用。401、403、429、网络与 5xx 分开呈现；403 只能诚实描述为 access denied，并提示检查 scope 或 entitlement，不能从状态码单独断言套餐原因。

## 安全与日志

- API/status/错误响应不得返回 access token、refresh token、auth code 或 device code。
- caller headers 先 clone，再只替换 Authorization；不得原地修改或转发到非官方 origin。
- logout 清理本地 xAI OAuth bundle。xAI 未公开 OAuth revoke endpoint，账户端撤销仍通过 `accounts.x.ai` 手动完成。
- 本轮沿用现有 settings 存储边界，尚未迁移 OS keyring；统一凭据加密由 tech-debt #40 跟踪。

## 验证与剩余风险

关键回归文件包括 `provider-preset-identity-migration.test.ts`、`provider-call-policy.test.ts`、`qwen-token-plan-catalog.test.ts`、`xai-provider.test.ts`、`provider-request-shape.test.ts`、`xai-oauth.test.ts`、`xai-oauth-manager.test.ts`、`xai-imagine.test.ts`、`native-media-block-side-channel.test.ts`、`env-proxy-fetch.test.ts` 和 `xai-oauth-ui.test.ts`。Imagine 自动化已覆盖精确媒体 allowlist、proxy-only header 缺席、401 refresh 单次重试、官方 image/edit/video wire、异步轮询、受控下载、媒体 provider 真源、失败语义、取消后轮询冻结/不落库/listener 清理、完成下载后保留资产，以及 MediaBlock/Gallery provenance。4.6 effort 自动化已覆盖生产 builder → 锁定 SDK → wire 的 minimal/low/medium/high/xhigh/max 矩阵；4.6 文本仍需 authenticated model-list parser/cache 与真实账号 smoke。

用户已在 Electron dev 验证历史 xAI browser OAuth 与 Qwen Personal 可在 CodePilot/Codex Runtime 连接并回复，2026-07 的 `grok-4.5` OAuth × CodePilot/Codex X Search 也有独立 smoke 记录。Grok 4.6 文本重试、Imagine image/edit/video、device、refresh/tool/logout、Qwen Team/Coding Plan 真实凭据，以及 packaged macOS/Windows OAuth 仍记录在执行计划 Smoke Ledger。不得从 mock、历史 4.5 文本回复或单一路径推断 4.6/Imagine entitlement 已验证。
