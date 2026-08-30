> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `deferred/`——用户明确暂缓，未来可能重启。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [deferred/README.md](README.md)。

# Weixin Bridge Channel Integration

> ⏸ **本轮重构暂缓**（见 [refactor-closeout.md](../completed/refactor-closeout.md) "暂缓清单"）— 更多 Bridge 渠道不在本轮 6 条主线内；保留作未来参考。

> 创建时间：2026-03-22
> 最后更新：2026-03-22

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| One Shot | 微信 Bridge 通道端到端实现 | 📋 待开始 | 按本文一次性交付，不拆分成多轮功能阶段 |

## 决策日志

- 2026-03-22: 不直接依赖 `@tencent-weixin/openclaw-weixin` 运行时；只把它当协议样本和参考实现，因为它深度绑定 `openclaw/plugin-sdk` 与 OpenClaw runtime。
- 2026-03-22: 微信通道按 CodePilot 现有 `BaseChannelAdapter` 原生实现，而不是走当前 CodePilot `ChannelPlugin` 接口；后者接口能力不足以承载微信的多账号登录、长轮询和 per-account 状态管理。
- 2026-03-22: 多账号路由不修改 `channel_bindings` schema，改用合成 `chatId` 解决隔离问题，格式固定为 `weixin::<accountId>::<peerUserId>`。
- 2026-03-22: `channel_offsets` 继续复用，但 offset key 不再等于单纯 channel name，而是 `weixin:<accountId>`，其 `offset_value` 保存 `get_updates_buf` 原文。
- 2026-03-22: `context_token` 不能照搬 OpenClaw 插件的内存 `Map`，必须持久化进 SQLite，否则 Bridge 自动启动、冷启动回复和多账号轮询都会不稳定。
- 2026-03-22: 本轮不做群聊、不做 OpenClaw 飞书插件里的平台工具集、不做 OpenClaw command/tool runtime 复刻；聚焦 CodePilot Bridge 通道能力本身。
- 2026-03-22: 权限审批走文本命令降级路径 `/perm allow|allow_session|deny <id>`，不做微信内联按钮。

## 目标

- 在 CodePilot 中新增可真实使用的微信 Bridge 通道。
- 支持二维码登录、多账号在线、私聊消息长轮询、文本收发、typing 指示、入站媒体解析。
- 让微信通道完整接入现有 `Bridge -> Router -> ConversationEngine -> Delivery` 主链路。
- 提供桌面设置页、账号列表、连接/断开和运行状态展示。
- 让 Claude Code 可以基于本计划和本地参考代码，一次性完成可交付实现，而不是先做半成品 POC。

## 非目标

- 不直接把 OpenClaw 微信 npm 包作为 CodePilot 运行时依赖。
- 不实现群聊、群策略、线程会话、@mention 触发。
- 不移植 OpenClaw 飞书插件的 doc/wiki/drive/task/calendar 工具族。
- 不在本轮做 AI 主动发送媒体的完整产品交互；若实现者顺手补齐底层能力可以接受，但不能因此拖慢主链路交付。

## 先读这些上下文

Claude Code 在开工前，必须先通读以下本地资料，再写代码：

### 1. CodePilot 现有架构

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/handover/bridge-system.md`
- `docs/research/mobile-remote-control-overall-plan.md`
- `src/lib/bridge/channel-adapter.ts`
- `src/lib/bridge/bridge-manager.ts`
- `src/lib/bridge/channel-router.ts`
- `src/lib/bridge/conversation-engine.ts`
- `src/lib/db.ts`
- `src/app/api/bridge/settings/route.ts`
- `src/components/bridge/BridgeSection.tsx`
- `src/components/bridge/BridgeLayout.tsx`

### 2. OpenClaw 微信插件参考

- `docs/research/weixin-openclaw-plugin-review-2026-03-22.md`
- `资料/weixin-openclaw-cli/package/cli.mjs`
- `资料/weixin-openclaw-package/package/index.ts`
- `资料/weixin-openclaw-package/package/openclaw.plugin.json`
- `资料/weixin-openclaw-package/package/src/channel.ts`
- `资料/weixin-openclaw-package/package/src/api/api.ts`
- `资料/weixin-openclaw-package/package/src/api/types.ts`
- `资料/weixin-openclaw-package/package/src/auth/login-qr.ts`
- `资料/weixin-openclaw-package/package/src/auth/accounts.ts`
- `资料/weixin-openclaw-package/package/src/monitor/monitor.ts`
- `资料/weixin-openclaw-package/package/src/messaging/inbound.ts`
- `资料/weixin-openclaw-package/package/src/messaging/process-message.ts`
- `资料/weixin-openclaw-package/package/src/messaging/send.ts`
- `资料/weixin-openclaw-package/package/src/messaging/send-media.ts`
- `资料/weixin-openclaw-package/package/src/cdn/upload.ts`
- `资料/weixin-openclaw-package/package/src/media/media-download.ts`
- `资料/weixin-openclaw-package/package/README.zh_CN.md`

### 3. OpenClaw 飞书插件参考

- `资料/feishu-openclaw-plugin/package/index.js`
- `资料/feishu-openclaw-plugin/package/openclaw.plugin.json`
- `资料/feishu-openclaw-plugin/package/src/commands/index.js`

飞书插件在本任务中的作用不是“代码复用”，而是“组织方式参考”：诊断命令、onboarding、插件命令入口、能力分层。不要试图把其 OpenClaw runtime 逻辑直接复制进 CodePilot。

## 单次交付约束

- 这次交付必须一次性打通：数据层、适配器层、设置 API、Bridge UI、基础测试、文档。
- 不允许停在“只接协议 helper”或“只做设置页”。
- 代码写完后必须执行至少：
  - `npm run test`
  - `npm run test:smoke`
  - 启动 `PORT=3001 npm run dev`
  - 用 CDP 打开 Bridge 页面验证微信设置 UI、账号列表和连接流程界面
- 若因缺少真实微信账号无法做真人扫码联调，必须在结果里明确说明“已完成代码、自测和模拟验证，但真实扫码登录未实测”，不能假装已经验证过。

## 总体设计

### 1. 总体实现形态

采用 **CodePilot 原生 `BaseChannelAdapter` 实现**：

- 新建微信协议 helper、登录 helper、媒体 helper。
- 新建 `WeixinAdapter` 负责多账号长轮询、消息标准化、文本出站、typing 指示和状态跟踪。
- 不引入 `openclaw/plugin-sdk`，不在运行时调用 OpenClaw 包导出的任何插件接口。

### 2. 多账号模型

微信与 Telegram/QQ 最大不同在于：

- 一个 CodePilot 实例可能同时登录多个微信 bot 账号。
- 同一个 `peerUserId` 在不同 bot 账号下必须拥有不同上下文和不同 binding。

因此必须采用合成路由键：

- `syntheticChatId = "weixin::<accountId>::<peerUserId>"`
- `address.channelType = "weixin"`
- `address.chatId = syntheticChatId`
- `address.userId = peerUserId`
- `address.displayName = peerUserId`

这样做的好处：

- 复用现有 `channel_bindings` 唯一键 `(channel_type, chat_id)`，无需改表。
- 同一 `peerUserId` 在不同 bot 账号下会自然落到不同 `chat_session`。
- `bridge-manager` 和 `channel-router` 无需感知“多账号”概念，只处理普通地址。

必须新增一个 helper，例如：

- `encodeWeixinChatId(accountId, peerUserId): string`
- `decodeWeixinChatId(chatId): { accountId: string; peerUserId: string }`

所有微信 adapter、API、UI、permission fallback、日志都必须统一使用这套 helper，禁止散落字符串拼接。

### 3. 数据持久化设计

#### 3.1 继续复用的表

- `channel_bindings`
  继续保存微信会话绑定，key 为合成 `chatId`
- `channel_offsets`
  继续保存 `get_updates_buf`
  key 格式：`weixin:<accountId>`
- `channel_audit_logs`
  继续记录入站/出站消息摘要

#### 3.2 必须新增的表

新增 `weixin_accounts`：

- `account_id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL DEFAULT ''`
- `base_url TEXT NOT NULL DEFAULT ''`
- `cdn_base_url TEXT NOT NULL DEFAULT ''`
- `token TEXT NOT NULL DEFAULT ''`
- `name TEXT NOT NULL DEFAULT ''`
- `enabled INTEGER NOT NULL DEFAULT 1`
- `last_login_at TEXT`
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`

用途：

- 保存二维码登录后的 bot token 与账号配置
- 支撑账号列表 UI
- 支撑多账号轮询启动/停止

新增 `weixin_context_tokens`：

- `account_id TEXT NOT NULL`
- `peer_user_id TEXT NOT NULL`
- `context_token TEXT NOT NULL`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `PRIMARY KEY(account_id, peer_user_id)`

用途：

- 持久化最近一次可用的 `context_token`
- 供出站回复、Bridge 自动恢复、账号重启后续答使用

不新增 sync buf 专用表，原因：

- `channel_offsets.offset_value` 已经是 `TEXT`
- `get_updates_buf` 本身就是字符串
- 只要 offset key 改成 per-account 即可

#### 3.3 DB 层 helper

在 `src/lib/db.ts` 中新增 helper：

- `listWeixinAccounts()`
- `getWeixinAccount(accountId)`
- `upsertWeixinAccount(...)`
- `deleteWeixinAccount(accountId)`
- `setWeixinAccountEnabled(accountId, enabled)`
- `getWeixinContextToken(accountId, peerUserId)`
- `upsertWeixinContextToken(accountId, peerUserId, token)`
- `deleteWeixinContextTokensByAccount(accountId)`

同时补类型：

- `src/types/index.ts`
  - `WeixinAccount`
  - `WeixinContextTokenRecord`

### 4. 微信协议层设计

创建独立 helper，不把协议逻辑塞进 adapter 主文件：

- `src/lib/bridge/adapters/weixin/weixin-types.ts`
- `src/lib/bridge/adapters/weixin/weixin-api.ts`
- `src/lib/bridge/adapters/weixin/weixin-auth.ts`
- `src/lib/bridge/adapters/weixin/weixin-media.ts`
- `src/lib/bridge/adapters/weixin/weixin-ids.ts`
- `src/lib/bridge/adapters/weixin/weixin-session-guard.ts`

#### 4.1 API helper

`weixin-api.ts` 直接按 OpenClaw 插件协议实现：

- `getUpdates`
- `sendMessage`
- `getUploadUrl`
- `getConfig`
- `sendTyping`
- `startLoginQr`
- `pollLoginQrStatus`

必须复刻的协议细节：

- `AuthorizationType: ilink_bot_token`
- `Authorization: Bearer <token>`
- `X-WECHAT-UIN` 随机 uint32 base64
- 请求 body 携带 `base_info.channel_version`
- `getUpdates` 的客户端超时视为正常空轮询，不应报错终止
- `errcode = -14` 进入 account 级 pause 状态

#### 4.2 登录 helper

`weixin-auth.ts` 负责：

- 生成二维码登录会话
- 长轮询扫码状态
- 登录成功后写入 `weixin_accounts`
- 提供 API route 所需的 in-memory active session store

实现要求：

- 参考 OpenClaw 的 `activeLogins` 思路，但状态放在 CodePilot 服务端的 `globalThis` 挂载，避免 Next dev HMR 丢失
- session 有 TTL
- 支持二维码过期后刷新
- `accountId` 正规化使用安全字符串，不在 DB key 中保留危险字符

### 5. 媒体处理设计

#### 5.1 入站媒体

必须支持：

- 图片
- 文件
- 视频
- 语音

处理流程参考 OpenClaw 微信插件：

1. 从 `item_list` 找可下载媒体
2. 从 CDN 拉密文
3. AES-128-ECB 解密
4. 生成 `FileAttachment`
5. 交给现有 `conversation-engine.ts`

建议实现方式：

- 下载后的本地落盘可以先走临时文件，再转成 CodePilot 现有 `FileAttachment { data(base64), name, type }`
- 如果有现成统一媒体保存 helper，可复用；不要引入额外 native 依赖
- 语音优先尝试转 WAV；若无稳定转码链路，允许先按原始音频附件传入，但要明确 MIME

#### 5.2 出站媒体

本轮可选两种实现方式，优先采用 A：

- A. 先只实现文本出站，把媒体 helper 写好但不接到 `OutboundMessage`
- B. 若实现者有余力，可为微信 adapter 补齐 `sendImage/sendFile/sendVideo` 底层能力，并预留接口给未来 Bridge message tool 使用

无论选 A 还是 B，都必须把以下基础层写好：

- AES-128-ECB 加密/解密
- `getUploadUrl`
- CDN PUT 上传
- download param 回填

原因：

- 入站媒体已经需要解密
- 将来补出站媒体时不应再重新拆协议

### 6. Adapter 设计

创建 `src/lib/bridge/adapters/weixin-adapter.ts`，并在 `src/lib/bridge/adapters/index.ts` 注册。

#### 6.1 生命周期

`WeixinAdapter` 是单实例、多 worker 模型：

- `start()`
  - 读取 `bridge_weixin_enabled`
  - 拉取 DB 里所有 `enabled = true` 的微信账号
  - 每个账号启动一个长轮询 worker
- `stop()`
  - abort 所有 worker
  - 清理 waiters、queue、typing timers、pause 状态
- `isRunning()`
  - 只要至少一个 account worker 正在运行就返回 true

#### 6.2 worker 模型

每个账号一个 polling loop：

1. 从 `channel_offsets` 取 `weixin:<accountId>` 的 `get_updates_buf`
2. 循环调用 `getUpdates`
3. 成功时持久化新 `get_updates_buf`
4. 逐条标准化消息并入队
5. `errcode=-14` 时暂停该账号 1 小时

#### 6.3 标准化为 `InboundMessage`

对于每条微信消息：

- `messageId`
  优先 `message_id`，没有则退化为 `seq` 或生成值
- `address.channelType = "weixin"`
- `address.chatId = encodeWeixinChatId(accountId, from_user_id)`
- `address.userId = from_user_id`
- `text`
  从 `item_list` 提取文本，引用消息按 OpenClaw 的 quoted-text 思路展开
- `attachments`
  若有媒体则转成 `FileAttachment[]`
- `raw`
  保留原始消息和 accountId，便于调试

同时必须：

- 把 `context_token` 写入 `weixin_context_tokens`
- 写审计日志
- 对 message_id 做 account 级 dedupe，避免重复入队

#### 6.4 出站发送

`send(message: OutboundMessage)` 必须：

1. 从 `message.address.chatId` decode 出 `accountId` 和 `peerUserId`
2. 读取该 peer 最近一次 `context_token`
3. 若没有 token，返回明确错误，不要静默失败
4. 调 `sendMessage`

文本内容处理：

- 微信不支持我们当前桥接里的 HTML/Markdown 交互格式
- 统一走 plain text，必要时做轻量 markdown strip，参考 OpenClaw `markdownToPlainText`

#### 6.5 typing 指示

实现 `onMessageStart` / `onMessageEnd`：

- `onMessageStart(chatId)`
  - decode account + peer
  - 读取或缓存 `typing_ticket`
  - 调 `sendTyping(status=1)`
- `onMessageEnd(chatId)`
  - `sendTyping(status=2)`

typing ticket 获取逻辑：

- 按 `accountId + peerUserId` 或至少按 `peerUserId` 缓存
- 带退避策略，失败后不要阻塞主消息链路

#### 6.6 preview / permission

- 不实现 `getPreviewCapabilities`
- 不实现 callback query
- `permission-broker.ts` 必须把 `weixin` 归类到“无按钮渠道”，与 `qq` 同类
- `/perm` 文本审批链路保持可用

### 7. API 路由设计

新增：

- `src/app/api/settings/weixin/route.ts`
  - GET/PUT 全局微信配置
- `src/app/api/settings/weixin/accounts/route.ts`
  - GET 账号列表
- `src/app/api/settings/weixin/accounts/[accountId]/route.ts`
  - DELETE 断开账号
  - PATCH 启停账号
- `src/app/api/settings/weixin/login/start/route.ts`
  - 生成二维码
- `src/app/api/settings/weixin/login/wait/route.ts`
  - 轮询登录结果

建议保留在 settings 表中的全局 key：

- `bridge_weixin_enabled`
- `bridge_weixin_base_url`
- `bridge_weixin_cdn_base_url`
- `bridge_weixin_image_enabled`
- `bridge_weixin_media_enabled`
- `bridge_weixin_log_upload_url`

说明：

- 多账号 token 不要进 `settings` 表
- token 必须只进 `weixin_accounts`

同时更新：

- `src/app/api/bridge/settings/route.ts`
  - 把上述全局 key 加入白名单

### 8. Bridge UI 设计

新增：

- `src/components/bridge/WeixinBridgeSection.tsx`

修改：

- `src/components/bridge/BridgeLayout.tsx`
  - 增加 `weixin` section
- `src/components/bridge/BridgeSection.tsx`
  - 增加 channel 总开关
- `src/i18n/en.ts`
- `src/i18n/zh.ts`

UI 必须包含：

- 微信总开关
- base URL / CDN base URL 配置
- “连接微信账号”按钮
- 当前二维码展示区或轮询状态展示
- 已登录账号列表
- 每账号 enabled 开关
- 每账号断开按钮
- 基础状态提示：已连接 / 轮询中 / session paused / 最后错误

不要求：

- 花哨动效
- 复杂诊断页

但必须满足：

- 信息完整
- 状态可见
- 刷新后与 DB 一致

### 9. 文本审批降级

修改 `src/lib/bridge/permission-broker.ts`：

- 当前 `supportsButtons = adapter.channelType !== 'qq'`
- 必须改成明确把 `weixin` 也归到“无按钮渠道”

例如：

- `const supportsButtons = !['qq', 'weixin'].includes(adapter.channelType)`

否则微信收到的权限消息会被当作按钮卡片发送，但 adapter 根本不会处理回调。

### 10. Bridge 帮助与可见状态

建议同步更新：

- `src/lib/bridge/bridge-manager.ts`
  - `/help` 文案中增加 `weixin`
  - 若有 channel-specific 帮助入口，可增加简单说明

不是必须新增 `/weixin` 命令组，但至少总帮助里要让用户知道微信已接入。

### 11. 文档更新

实现完成后必须更新：

- `docs/handover/bridge-system.md`
  - 增加 Weixin 架构和数据流说明
- `docs/handover/README.md`
  - 如 handover 文档新增内容需要索引则同步更新
- `docs/research/weixin-openclaw-plugin-review-2026-03-22.md`
  - 如实现过程中发现协议差异或实测补充，可追加结论

## 建议修改文件清单

### 必改

- `src/lib/db.ts`
- `src/types/index.ts`
- `src/lib/bridge/adapters/index.ts`
- `src/lib/bridge/adapters/weixin-adapter.ts`
- `src/lib/bridge/permission-broker.ts`
- `src/app/api/bridge/settings/route.ts`
- `src/components/bridge/BridgeLayout.tsx`
- `src/components/bridge/BridgeSection.tsx`
- `src/components/bridge/WeixinBridgeSection.tsx`
- `src/i18n/en.ts`
- `src/i18n/zh.ts`

### 强烈建议新建

- `src/lib/bridge/adapters/weixin/weixin-types.ts`
- `src/lib/bridge/adapters/weixin/weixin-ids.ts`
- `src/lib/bridge/adapters/weixin/weixin-api.ts`
- `src/lib/bridge/adapters/weixin/weixin-auth.ts`
- `src/lib/bridge/adapters/weixin/weixin-media.ts`
- `src/lib/bridge/adapters/weixin/weixin-session-guard.ts`
- `src/app/api/settings/weixin/route.ts`
- `src/app/api/settings/weixin/accounts/route.ts`
- `src/app/api/settings/weixin/accounts/[accountId]/route.ts`
- `src/app/api/settings/weixin/login/start/route.ts`
- `src/app/api/settings/weixin/login/wait/route.ts`
- `src/__tests__/unit/weixin-*.test.ts`

## 推荐编码顺序

下面是单次交付内部的编码顺序，不是阶段拆分：

1. 先写 DB 迁移和 helper，确保账户、token、context token 有可靠存储。
2. 再写协议 helper 和 ID helper，把登录、轮询、headers、加密逻辑固定下来。
3. 然后实现 adapter 并注册，先打通文本收发和多账号轮询。
4. 接着补入站媒体解密和 `FileAttachment` 转换。
5. 然后加 settings API 和 Weixin Bridge UI。
6. 最后补 permission fallback、i18n、文档和测试。

## 验收标准

- Bridge 首页可见微信通道开关。
- Bridge 侧边栏可进入独立微信设置页。
- 用户可以发起二维码登录，并看到二维码或二维码链接。
- 登录成功后账号写入 DB，并在设置页列表中可见。
- 启动 Bridge 后，已启用的微信账号会开始长轮询。
- 私聊文本消息能创建或命中正确的 CodePilot session，并收到回复。
- 同一个 `peerUserId` 在不同微信账号下不会串 session。
- 入站图片至少能作为 `FileAttachment` 进入 `conversation-engine.ts`。
- `context_token` 在应用重启后仍可用于对同一 peer 的正常回复。
- `permission_request` 在微信中能走 `/perm` 文本审批，不会卡死。
- 停用账号后对应 worker 停止，不再收消息。
- 删除账号后 token、context token 和其 offset 能被清理。

## 必跑验证

### 自动化

- `npm run test`
- `npm run test:smoke`

至少补以下单元测试：

- `encodeWeixinChatId/decodeWeixinChatId`
- `weixin-api` 头部和 timeout 行为
- `weixin-session-guard`
- `weixin_accounts` / `weixin_context_tokens` DB helper
- `permission-broker` 对 `weixin` 的无按钮分支
- `context_token` 持久化读取

### 手动

- `PORT=3001 npm run dev`
- 打开 Bridge 页面
- 验证微信 section 可进入
- 验证设置保存、刷新后回显
- 验证“连接账号”按钮打开二维码区域
- 验证账号列表启停/删除交互
- 检查浏览器 console 无报错

### CDP

UI 改动必须用 CDP：

- 打开 `http://localhost:3001/bridge`
- 截图 Bridge 首页微信开关状态
- 截图微信设置页
- 若二维码区域能显示，截图登录面板
- 检查 console 无错误

## 实现时禁止事项

- 不要把 `@tencent-weixin/openclaw-weixin` 直接加到生产依赖后强行调用其插件入口。
- 不要把 token 继续存在 `settings` 表的平铺 key 中。
- 不要把 `context_token` 只存在内存里。
- 不要为多账号去破坏现有 `channel_bindings` 唯一键模型；优先使用合成 `chatId`。
- 不要因为微信无按钮就跳过权限审批；必须接 `/perm` 降级路径。
- 不要只做静态 UI，不接入真实 adapter 生命周期。

## Claude Code 输出要求

Claude Code 实施完成后，输出里必须明确说明：

- 改了哪些核心文件
- 是否完成真实扫码联调
- 跑了哪些测试
- CDP 验证覆盖了哪些页面
- 尚未验证的风险点是什么
