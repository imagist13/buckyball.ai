# Issue 分析与分类 — 2026-04-02

> 分析范围：GitHub Issues #356-#417
> 目的：识别根因聚类、排定优先级、找出可行动项

## Top 3 可行动聚类

### 聚类 1: 第三方 Provider CLI 进程崩溃（exit code 1）

**影响 Issues:** #417, #416, #414, #413, #412, #393, #381, #380, #376, #360, #356

**影响用户数:** 11+ 个独立报告，占总 issue 的 ~25%

**现象:**
- 诊断通过（network reachable, provider resolves ok）
- 但实际对话时 Claude Code CLI 进程立即退出（exit code 1）
- 覆盖多个 provider：GLM、火山引擎/方舟、Kimi、阿里百炼、jiekou.ai

**日志分析:**

Log 1（Windows + GLM）：
- Provider 解析正常，网络可达
- 进程在第一条消息就崩溃（exit code 1），重复 2 次
- 关键点：不是超时或网络问题，是 CLI 启动后立即崩溃

Log 2（macOS + MiniMax）：
- Live test **通过**（模型正常回复）
- 但后续会话中 CLI 崩溃（exit code 1），重复 4 次
- CLI 版本 2.0.76（过时，当前 2.1.x）
- 关键洞察：探针能通但会话不行，说明不是连接问题，而是会话建立/功能协商阶段的问题

**根因推测:**
1. CLI 版本过旧（2.0.x vs 2.1.x），新版 SDK 的功能协商参数与旧 CLI 不兼容
2. 第三方 API 返回了 CLI 无法解析的响应格式（非标准 OpenAI-compatible 端点的边缘情况）
3. session resume 路径在特定 provider 上失败，且失败方式不是 graceful fallback 而是 crash

**建议行动:**
- [ ] 在 doctor 中检查 CLI 版本，低于 2.1.0 时显示升级建议
- [ ] 收集 exit code 1 时的 stderr 输出（当前可能被吞掉了）
- [ ] 对 Log 2 场景（probe 通但 session 崩）单独复现，确认是 resume 还是 feature negotiation

**优先级: P0** — 占所有 issue 的 1/4，用户无法使用核心功能

---

### 聚类 2: 重启后配置丢失/重置

**影响 Issues:** #417, #390, #385, #378, #366, #362

**影响用户数:** 6+ 个独立报告

**现象:**
- 重启后默认模型/主题/底部栏布局被重置
- #417 特别：UI 显示正常模型列表，但第一次响应后跳变为不同的模型列表
- #385/#378/#366 是同一问题的不同报告：主题和默认模型持久化失败

**根因推测:**
- 全局默认模型机制（v0.38.4 引入）的 localStorage vs DB 双写竞态
- Electron 窗口关闭时 renderer process 先于 main process 被杀，localStorage 写入可能丢失
- #417 的"跳变"可能是 provider-changed 事件触发了 model list 重新 fetch，覆盖了正确的初始值

**相关代码:**
- `src/lib/db.ts` — `global_default_model`, `global_default_model_provider`
- `src/app/chat/page.tsx` — 模型初始化 + `checkProvider` + `modelReady` 门控
- `src/components/settings/ProviderManager.tsx` — 全局默认模型 UI
- 参见 `docs/handover/global-default-model.md` 的竞态防护章节

**建议行动:**
- [ ] 确认重启后 DB 中的 `global_default_model` 值是否正确（排除 DB 写入丢失）
- [ ] 检查 Electron app.on('before-quit') 是否给 renderer 足够时间完成持久化
- [ ] #417 需要 GLM provider 的完整模型列表配置来复现跳变

**优先级: P1** — 回归性问题，影响日常使用体验，但不阻塞核心功能

---

### 聚类 3: Windows 平台兼容性问题

**影响 Issues:** #410, #405, #395, #414, #377

**影响用户数:** 5+ 个独立报告

**现象:**
- #410: npm 安装的 Claude Code CLI 找不到——`.cmd` 文件识别问题（用户已提供临时解决方案）
- #395: Windows 10 启动直接崩溃——GPU process crash
- #414: Windows + GLM 进程退出（与聚类 1 重叠）
- #405: Fedora RPM 无桌面图标（Linux 但归入平台兼容性）
- #377: 技能安装窗口字符编码乱码（可能是 Windows 的 GBK/UTF-8 问题）

**根因推测:**
- CLI 发现逻辑只找 unix-style 可执行文件，不处理 `.cmd` wrapper（#410 用户已确认）
- GPU 进程崩溃可能与 Electron 版本和 Windows 10 的 GPU 驱动兼容性相关
- 字符编码问题是 Windows 的 `chcp` 与 Node.js 子进程 encoding 不匹配

**建议行动:**
- [ ] #410: 将用户提供的 `.cmd` 识别 PR 合入或参考实现
- [ ] #395: 添加 `--disable-gpu` fallback flag（Electron app.commandLine）
- [ ] #377: 子进程 spawn 时强制 UTF-8 encoding（`env: { ...process.env, PYTHONIOENCODING: 'utf-8' }`）

**优先级: P1** — Windows 用户占一定比例，但多数有 workaround

---

## 完整分类

### Bug — 核心功能

| Issue | 摘要 | 聚类 | 信息充分度 |
|-------|------|------|-----------|
| #417 | 模型选择跳变（GLM） | 聚类 1+2 | 中 — 需要 provider 配置 |
| #416 | 火山引擎 coding plan 不可用 | 聚类 1 | 高 — 有 doctor json |
| #414 | 诊断全绿但实际未联通（GLM, Win） | 聚类 1+3 | 高 — 有 doctor json |
| #413 | Kimi 2.5 不可用 | 聚类 1 | 高 — 有 doctor json |
| #412 | 阿里百炼和 Kimi 都不行 | 聚类 1 | 高 — 有 doctor json |
| #393 | 第三方 API 全部无法连接 | 聚类 1 | 低 — 无日志 |
| #381 | 智普国产服务商添加不生效 | 聚类 1 | 低 |
| #380 | 第三方 GPT 无法设置模型 | 聚类 1 | 低 |
| #376 | jiekou.ai 配置无法设模型名 | 聚类 1 | 中 |
| #360 | 方舟 coding plan 配置失败 | 聚类 1 | 低 |
| #356 | Kimi/GLM 进程退出报错 | 聚类 1 | 中 |
| #388 | 交互式提问窗口无法出现 | 独立 | 低 — 需要复现步骤 |
| #379 | Stream data 被 GC | 独立 | 中 — 已知 bug |
| #370 | UI 卡死 | 独立 | 低 — 无复现步骤 |

### Bug — 配置/持久化

| Issue | 摘要 | 聚类 | 信息充分度 |
|-------|------|------|-----------|
| #385 | 关闭重开主题配置丢失 | 聚类 2 | 中 |
| #378 | 默认模型和主题重启后重置 | 聚类 2 | 中 |
| #390 | 重启后底部栏布局异常 | 聚类 2 | 低 |
| #366 | 主题锁定失败（同 #385） | 聚类 2 | 重复 |
| #362 | 默认模型问题 | 聚类 2 | 重复 |

### Bug — 平台兼容性

| Issue | 摘要 | 聚类 | 信息充分度 |
|-------|------|------|-----------|
| #410 | Windows npm CLI 找不到（.cmd） | 聚类 3 | 高 — 有解决方案 |
| #395 | Windows 10 启动崩溃（GPU） | 聚类 3 | 中 |
| #405 | Fedora RPM 无图标 | 聚类 3 | 低 |
| #377 | 技能安装编码乱码 | 聚类 3 | 中 |
| #406 | NVM 删除后找不到 CLI | 独立 | 中 — 路径解析问题 |

### Bug — UI/样式

| Issue | 摘要 | 聚类 | 信息充分度 |
|-------|------|------|-----------|
| #394 | 深色模式 CodeBlock 渲染异常 | 独立 | 中 |
| #382 | 深色主题代码对比色太暗 | 独立 | 中 |
| #401 | 文件树超 3 级不显示 | 独立 | 中 |
| #404 | 拖拽区域太小 | 独立 | 低 |

### Bug — Bridge/MCP

| Issue | 摘要 | 聚类 | 信息充分度 |
|-------|------|------|-----------|
| #408 | MCP 连接问题（CLI 能连 CodePilot 不行） | 独立 | 中 |
| #389 | Mac 关闭窗口后 Telegram 断连 | 独立 | 中 |
| #383 | chrome-devtools MCP 无法移除 | 独立 | 高 — 设计如此 |
| #359 | AskUserQuestion 在 Discord 渲染问题 | 独立 | 中 |
| #358 | Telegram 桥接 full access 设置 | 独立 | 中 |

### Bug — OAuth/模型

| Issue | 摘要 | 聚类 | 信息充分度 |
|-------|------|------|-----------|
| #415 | Claude 订阅模式不能用 | 独立 | 低 — 无内容 |
| #367 | OAuth 模式 Opus 4.6 消失 | 独立 | 中 |
| #365 | 显示 Sonnet 4/Opus 4 而非 4.6 | 独立 | 中 |

### 功能请求

| Issue | 摘要 | 复杂度 | 价值 |
|-------|------|--------|------|
| #411 | 在软件中编辑文档内容 | 高 | 中 |
| #409 | 保留对话草稿内容 | 低 | 中 |
| #403 | 聊天框确认提醒通知 | 中 | 中 |
| #402 | 读取 .claude/skills 目录 | 中 | 高 |
| #398 | 允许禁用冲突检查 | 低 | 低 |
| #397 | diff 预览和回退功能 | 高 | 高 |
| #396 | 更新不用内置浏览器 | 低 | 中 |
| #392 | 版本升级下载进度显示 | 中 | 中 |
| #387 | 一键唤醒快捷键 | 低 | 中 |
| #375 | 永久记忆（向量数据库） | 高 | 高 |
| #371 | 批量导入 CLI session | 中 | 中 |
| #368 | 支持导出对话 | 中 | 中 |
| #363 | Discord 自动创建 thread | 低 | 低 |

### 非技术/社区

| Issue | 摘要 |
|-------|------|
| #374 | 群二维码失效 |

## 日志深度分析

### Log 1: codepilot-doctor-2026-04-01.json

```
平台: Windows
Provider: GLM (CN)
CLI: 版本未记录
诊断: Git Bash missing (warning), 其余全绿
```

**时间线重建:**
1. 用户配置 GLM provider → 诊断通过
2. 发送第一条消息 → Claude Code CLI 启动
3. CLI 立即退出（exit code 1）— 发生在同一个 session，重复 2 次

**推断:** CLI 启动后在 provider handshake 阶段崩溃。可能原因：
- GLM API 返回了非标准的错误响应格式
- CLI 版本不支持该 provider 的 auth 方式
- Windows 环境变量传递问题（Git Bash missing 可能导致 PATH 不完整）

**验证方法:** 在 Windows 上用同版本 CLI + GLM provider 直接执行 `claude --print-only` 看 stderr

### Log 2: codepilot-doctor-2026-04-02.json

```
平台: macOS
Provider: MiniMax (CN)
CLI: 2.0.76 (outdated, current 2.1.x)
诊断: Live test PASSES
```

**时间线重建:**
1. Doctor live test → MiniMax API 正常响应
2. 用户开始对话 → session 创建
3. 连续 4 次 exit code 1 — 都在同一个 session

**关键洞察:**
- Live probe 用的是 `generateTextViaSdk`（无 session state），通过
- 实际对话用的是 `query()`（有 session resume / feature negotiation），崩溃
- 差异点在于 session 机制，而非网络连接

**最可能的根因:** CLI 2.0.76 的 session resume 逻辑与当前 SDK 版本的参数不兼容。旧版 CLI 不理解新版 SDK 传递的某些 option（如 `context1m`、`effort` 等字段），导致参数校验失败后 crash。

**验证方法:** 
- 让用户升级 CLI 到 2.1.x 后复测
- 如果升级解决问题，在 doctor 中添加 CLI 版本检查

## 总结与建议

### 立即行动（本周）

1. **doctor 添加 CLI 版本检查** — 低于 2.1.0 时显示升级建议并标黄。这一项可能直接解决聚类 1 中的大量 issue
2. **收集 CLI stderr** — 当前 exit code 1 的错误信息可能被吞掉了，在 `claude-client.ts` 的进程错误处理中输出 stderr
3. **合入 #410 的 .cmd 修复** — 用户已提供解决方案

### 短期跟进（两周内）

4. **配置持久化审计** — 排查 Electron 窗口关闭时序，确认 localStorage 和 DB 的写入完整性
5. **Windows GPU fallback** — 添加 `--disable-gpu` 作为启动参数 fallback
6. **深色模式代码样式** — #394 和 #382 是同类问题，统一修复

### 需要更多信息的 Issues

- #388（交互式提问窗口卡住）— 需要复现步骤和日志
- #370（UI 卡死）— 需要复现步骤
- #415（Claude 订阅模式）— issue 无内容，需要用户补充
