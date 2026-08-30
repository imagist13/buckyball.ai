# Open Issues Tracker — 2026-03-12

> Source: GitHub Issues triage on 2026-03-12. Sorted by priority.

---

## Unfixed Bugs

### P1 — Windows 发消息弹终端窗口
- **Issue:** [#244](https://github.com/op7418/CodePilot/issues/244)
- **现象:** Windows 上每次发送消息，Claude Code 子进程会弹出一个 cmd 窗口
- **根因:** `child_process.spawn()` 缺少 `windowsHide: true` 选项
- **修复方向:** 在 `claude-client.ts` 的 spawn 调用中加 `windowsHide: true`

### P1 — 中文输入法回车误发送消息
- **Issue:** [#225](https://github.com/op7418/CodePilot/issues/225)
- **现象:** macOS 中文输入法输入英文后按回车确认，消息被直接发送
- **根因:** `compositionend` 同步重置 `isComposing`，后续 `keydown(Enter)` 看到 `false` 触发提交
- **修复方向:** `handleCompositionEnd` 用 `setTimeout(0)` 延迟重置 `isComposing`（Issue 中有详细方案）

### P2 — 主题设置重启后丢失 (Windows)
- **Issue:** [#227](https://github.com/op7418/CodePilot/issues/227)
- **现象:** 设置主题后关闭软件再打开，主题恢复为默认
- **根因:** 主题存储在 localStorage，Electron 重启可能丢失（待排查）
- **修复方向:** 将主题设置迁移到 SQLite 数据库持久化

### P2 — Windows GLM exit code 1
- **Issue:** [#228](https://github.com/op7418/CodePilot/issues/228)
- **现象:** 0.30+ 版本使用 GLM coding plan 报 exit code 1，回退 0.26 正常
- **关联:** 大概率同 #241（空 env 变量覆盖凭据），该 bug 已修复待发版验证
- **状态:** 等下个版本发布后跟进

### P3 — Skills 无法加载
- **Issue:** [#247](https://github.com/op7418/CodePilot/issues/247)
- **现象:** Plugin 页面 skills 不显示
- **状态:** 信息不足，已要求补充版本号和截图

### P3 — 桥接消息中斜杠命令不识别
- **Issues:** [#231](https://github.com/op7418/CodePilot/issues/231) (飞书), [#229](https://github.com/op7418/CodePilot/issues/229) (Discord)
- **现象:** 通过桥接发送 `/compact`、`/clear` 等命令无法被识别
- **根因:** 桥接走 SDK `query()` 接口，不等同于终端输入，斜杠命令不被 CLI 处理
- **修复方向:** 在桥接层增加命令拦截，将特定斜杠命令转换为 SDK 操作

---

## Feature Requests

### 会话列表待确认状态指示
- **Issue:** [#254](https://github.com/op7418/CodePilot/issues/254)
- **描述:** Chats 列表中有确认项（permission prompt）的 session 显示黄点闪烁，免于逐个点开检查
- **复杂度:** 中 — 需要在 session 列表轮询/订阅各 session 的 pending 状态

### 自动更新
- **Issue:** [#246](https://github.com/op7418/CodePilot/issues/246)
- **描述:** 支持应用内检测新版本并一键升级，免去手动下载
- **复杂度:** 中 — 已有 electron-updater 依赖，需接入 GitHub Releases

### 多 bot 桥接 (多 Agent)
- **Issue:** [#242](https://github.com/op7418/CodePilot/issues/242)
- **描述:** 支持桥接多个 bot，实现多 agent 并行协作
- **复杂度:** 高 — 需要会话路由和上下文隔离架构

### Lark 国际版 Webhook 模式
- **Issue:** [#239](https://github.com/op7418/CodePilot/issues/239)
- **描述:** Lark 国际版不支持 WebSocket，需增加 webhook 接收模式 + Cloudflare Worker 中继
- **状态:** 社区贡献者有 PR 即将提交

### @ 自动补全文件路径 + 文件树多级目录
- **Issue:** [#236](https://github.com/op7418/CodePilot/issues/236)
- **描述:** 输入 @ 时自动检索代码库文件补全；文件树支持多级目录展开
- **复杂度:** 中 — @ 补全需要文件索引 + 模糊搜索；文件树需要递归加载

### Codex / 多 CLI 后端支持
- **Issue:** [#234](https://github.com/op7418/CodePilot/issues/234)
- **描述:** 支持 Codex OAuth 登录，或更广泛地支持多 CLI 后端（claude code / codex / opencode）
- **复杂度:** 很高 — 需要抽象 CLI 后端层，长期规划

### 1M 上下文窗口支持
- **来源:** 内部需求
- **描述:** Opus 4.6 和 Sonnet 4.6 支持 1M token 上下文窗口，但需要通过 beta header `context-1m-2025-08-07` 启用，不是独立的模型 ID
- **实现方向:** 在模型选择器或会话设置中增加「启用 1M 上下文」开关，调用时附加 `anthropic-beta: context-1m-2025-08-07` header
- **复杂度:** 中 — 需要在 SDK 调用链中传递 beta header，并在 UI 中暴露开关
- **参考:** [Anthropic 1M context docs](https://docs.anthropic.com/en/build-with-claude/context-windows#1m-token-context-window)
