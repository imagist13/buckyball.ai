# GitHub Issue Backlog 审计（dry-run，只读）— 2026-06-29

> 由 `scripts/github-issue-backlog-audit.mjs` 生成。**未对 GitHub 做任何改动。**
> 分桶是启发式**建议**，不是决定；关闭 / 打标签 / 评论前必须人工复核每一条。
> 报告不含 issue 正文（隐私）——只有编号、标题、派生信号。

当前稳定线 `0.56.2`；"旧版本"判定 = 提到 ≤ 0.54 的版本号。

## 总览

| 指标 | 数量 |
|------|------|
| 拉取 open issue | 399 |
| 无 label | 392 |
| 无 milestone | 392 |
| >30 天未更新 | 355 |
| >60 天未更新 | 333 |
| >90 天未更新 | 208 |
| 疑似旧版本 | 55 |
| 疑似 feature | 62 |
| 命中重复主题 | 86 |

## 分桶建议

| 桶 | 数量 | 含义 |
|------|------|------|
| `keep-p1-review` | 5 | 挂 P0/P1 label — **绝不自动处理**，留当前主线 |
| `fixed-close` | 2 | 本地决策日志已闭环、可带证据关闭（仅 allowlist） |
| `old-version-confirmation` | 54 | 疑似旧版本（≤0.54）+ 45 天无更新 → 打 old-version 先评论复测 |
| `needs-repro` | 170 | 缺复现/环境信息 → 打 needs-repro 补模板 |
| `feature-parking-lot` | 55 | 疑似功能请求 → v0.57+ parking-lot |
| `support-question-close` | 15 | 疑似 support 提问 + 45 天无更新 → 评论后关闭候选 |
| `uncategorized` | 98 | 启发式未命中 → **必须人工逐条判断** |

### `keep-p1-review`（5）

挂 P0/P1 label — **绝不自动处理**，留当前主线

| # | idle天 | label数 | 标题 |
|---|--------|---------|------|
| 635 | 9 | 2 | 0.56 版本会频繁自动中断 |
| 634 | 9 | 2 | Native Runtime: codepilot_schedule_task and related builtin tools not available… |
| 633 | 9 | 2 | Windows11，安装程序无法打开 |
| 632 | 9 | 1 | 同一项目多个会话似乎存在上下文膨胀问题，导致新会话很容易中断 |
| 626 | 9 | 1 | 【Bug】每次有新版本提示时，CPU就会占用飙升，而且是持续的 |

### `fixed-close`（2）

本地决策日志已闭环、可带证据关闭（仅 allowlist）

| # | idle天 | label数 | 标题 |
|---|--------|---------|------|
| 629 | 9 | 1 | [Bug] Claude Code 运行时 400 错误：session 恢复失败导致空 assistant 消息 |
| 628 | 9 | 1 | 通过@ 添加文件发送后的文件被单独保存，导致内容更新时更新的不是原文件 |

### `old-version-confirmation`（54）

疑似旧版本（≤0.54）+ 45 天无更新 → 打 old-version 先评论复测

| # | idle天 | label数 | 标题 |
|---|--------|---------|------|
| 83 | 125 | 0 | 几点建议 |
| 29 | 125 | 0 | 0.5版本支持图片、文件了，这是要干趴Cursor的节奏！再接再厉，把视频也加上去！ |
| 152 | 116 | 0 | [macOS] 标题栏可拖拽区域高度不足，导致窗口难以移动 - 建议增大 macOS 窗口顶部可拖拽区域高度（WebkitAppRegion） |
| 129 | 116 | 0 | ChatListPanel never loads sessions on mobile (sidebar always hidden) |
| 122 | 116 | 0 | 无法安装 |
| 116 | 116 | 0 | Bug: 文件资源展示栏折叠后无法重新展开 |
| 108 | 116 | 0 | Bug: 文档最多只能显示 500 行 |
| 177 | 114 | 0 | agent有时候会自己停下来不工作 |
| 176 | 114 | 0 | 切换会话窗口返回后，原会话窗口的输入框中已经写的但未发出的文字消失了 |
| 175 | 114 | 0 | [Feature Request] 让费用可见——为 CodePilot 增设常驻实时费用标记 /Upgrade Token Tracking to a Pe… |
| 174 | 113 | 0 | Claude Code 通过 npm 安装后在 Windows 上无法被 CodePilot 检测到 |
| 214 | 110 | 0 | 今日更新版本至0.28.1后，Claude无法连接 |
| 239 | 108 | 0 | feat: Add webhook mode for Lark international (no WebSocket support) |
| 233 | 108 | 0 | 0.30.0版本，模型选项又是只有默认的，没有自己加的模型，之前的功能是有的 |
| 231 | 108 | 0 | 飞书对话无法识别/compact、/clear等命令 |
| 228 | 108 | 0 | windows版本 升到0.30版本，出现错误，但是左上角显示已连接 内容如下，我该怎么改，前两个版本能用 一直使用的是glm-4.7的coding plan… |
| 223 | 108 | 0 | 按照0.29无法使用，切回0.26恢复正常 |
| 210 | 108 | 0 | Telegram Bot 功能需要支持代理配置（Proxy Support for Telegram Bot） |
| 192 | 107 | 0 | [bug]API Error: |
| 292 | 105 | 0 | 0.37.0 install failed in ubuntu |
| 227 | 105 | 0 | 设置的主题，在重启软件后会变回默认 |
| 309 | 104 | 0 | 豆包模型使用问题 |
| 307 | 104 | 0 | Claude Code process exits with code 1 when using GLM (CN) provider |
| 300 | 104 | 0 | 对话的前端页面为什么会加载失败 |
| 296 | 104 | 0 | [Bug] Custom API / LiteLLM provider saves successfully but models do not appear… |
| 302 | 103 | 0 | 使用 0.38 仍然无法添加Anthropic Third-party API第三方模型，运行诊断是通过的 |
| 301 | 103 | 0 | 使用 0.38 仍然无法添加火山引擎 codingplan 相关模型，运行诊断是通过的 |
| 287 | 101 | 0 | feishu bridge allow permission 报错 code 200340 0.36 版本 allow permission 时报错 |
| 367 | 98 | 0 | OAuth模式下Opus 4.6用着用着就从模型列表消失了 |
| 305 | 98 | 0 | Custom API (OpenAI-compatible)在哪填写default model name? |
| 324 | 95 | 0 | feat: 支持通过 Homebrew Cask 安装和更新 |
| 394 | 92 | 0 | 深色模式下CodeBlock样式渲染异常 |
| 354 | 92 | 0 | 添加minimax服务商后无法对话（版本0.38.4） |
| 405 | 90 | 0 | fedora rpm安装没有软件图标 |
| 172 | 90 | 0 | [feature]无法使用 @ 文件功能 |
| 445 | 83 | 0 | 在 CodePilot 中配置 Kimi Coding Plan 时，选择 **Kimi K2.5** 作为模型，但实际对话返回的是 **Claude Son… |
| 455 | 80 | 0 | Enabling multiple bridge adapters simultaneously causes both to fail (Feishu + … |
| 491 | 74 | 0 | [Feature/Bug] 第三方 Anthropic API 供应商配置中，缺少 1M 上下文模型的名称映射选项 |
| 489 | 74 | 0 | 新功能请求：补充Claude Code的rewind功能 |
| 470 | 74 | 0 | 【求救】更新提示错误； Claude Code CLI not found. |
| 448 | 74 | 0 | 0.47.0在mac上每次❌关闭后再打开都回到starting codepilot |
| 510 | 73 | 0 | 【0.50.3版】telegram桥接的连接测试失败和Anthropic兼容端点的推理深度问题 |
| 504 | 73 | 0 | [bug] 我的技能列表读取有问题 |
| 503 | 73 | 0 | [bug]: 新建技能的弹窗里UI交互更新不及时 |
| 499 | 73 | 0 | [Bug] Aliyun Bailian / qwen3.6-plus 会在 330s 后固定报 Stream idle timeout |
| 493 | 73 | 0 | 0.50.2 还是无法连接 cc-switch 配置的 Claude CLI |
| 490 | 73 | 0 | [Bug] CodePilot 已成功同步 CC-Switch 环境变量配置，但对话时报错 "Not logged in · Please run /logi… |
| 519 | 69 | 0 | bridge 切换路径要先删原 Bridge 对话才成功 |
| 497 | 66 | 0 | Codex登录授权失败 |
| 542 | 62 | 0 | 功能建议：Mac 分屏/窄窗口下允许固定显示左侧会话列表 |
| 539 | 62 | 0 | bug(telegram): non-image document attachments are silently dropped or trigger "… |
| 537 | 62 | 0 | [建议] Claude SDK可能需要更新了，现在codepilot在使用中出现了一大堆问题 |
| 546 | 61 | 0 | 执行/compact命令报错 |
| 100 | 61 | 0 | Bug: 第三方 Provider 模型选择器只改变 UI 显示名称，未传递实际模型值 |

### `needs-repro`（170）

缺复现/环境信息 → 打 needs-repro 补模板

| # | idle天 | label数 | 标题 |
|---|--------|---------|------|
| 88 | 125 | 0 | 运行中，无法发送新的指令，cli 都可以支持，这个还挺刚需 |
| 56 | 125 | 0 | API需要支持Antigravity反代而来的API |
| 46 | 125 | 0 | 自动识别本地会话空间 |
| 34 | 125 | 0 | 来个中文包啊 |
| 26 | 125 | 0 | 必须要求claude login吗？ |
| 13 | 125 | 0 | 请求支持多语言 （简体中文） |
| 30 | 121 | 0 | 自定义API和模型 |
| 148 | 116 | 0 | "Test Connection" failed；详细见图 |
| 137 | 116 | 0 | 连续交互会话后不显示思考连和最下方的时间等，看上去像是挂了，切换下会话之后就可以了，感觉应该是前端刷新的问题 |
| 135 | 116 | 0 | 配置api 无法成功 |
| 133 | 116 | 0 | 设置使用默认浏览器来打开链接，而非内置浏览器 |
| 131 | 116 | 0 | 不显示tool call |
| 130 | 116 | 0 | Telegram bridge doesn't support audio input (Telegram 不支持语音输入) |
| 117 | 116 | 0 | "New Version Available" pop-up page optimization: markdown pages not rendering … |
| 115 | 116 | 0 | 求加入服务商硅基流动的 API |
| 112 | 116 | 0 | 已安装的插件加载错误 |
| 109 | 116 | 0 | Bug: 插件加载不全 |
| 105 | 116 | 0 | 使用agents相关是否有问题 |
| 97 | 116 | 0 | 消息记录丢失，切换界面消息记录就丢失了，当前操作列表消息以及最新状态 |
| 103 | 115 | 0 | macbook m4 版本，会话还在运行中，我点击设置页面后再点击回来，发现对话缺失 |
| 189 | 114 | 0 | 关于需要用户授权时的体验优化 |
| 178 | 114 | 0 | 【功能请求】多路桥接 |
| 149 | 114 | 0 | 桥接链接失败 已按照操作指引操作 测试几遍都这个问题 |
| 209 | 113 | 0 | 把当前会话同步到飞书等渠道 |
| 208 | 113 | 0 | 添加了服务商，但是好像对话没有生效，重启APP也没效果。 |
| 207 | 113 | 0 | 添加的阿里云百炼的服务商，能正常对话，切换不同模型，但是没法正常调用 skills。 能指点下吗？ |
| 205 | 113 | 0 | 右侧文件夹最里面的文件夹内的文件显示不了 |
| 204 | 113 | 0 | 自动批准所有工作这个功能不起作用 |
| 203 | 113 | 0 | 总是自动切回plan模式 |
| 166 | 113 | 0 | 模型不match |
| 218 | 112 | 0 | [bug]同一个会话，claude cli 里的 context 和 codepilot 的 context 不一样 |
| 217 | 112 | 0 | 「QQ桥接」延时问题 |
| 216 | 112 | 0 | 页面的文字不能缩放 |
| 212 | 112 | 0 | 已经开了自动批准，还是每个指令都来要permission |
| 222 | 111 | 0 | 切换多个对话时，对话运行时间会被重置，未累计显示从头开始的总时长 |
| 262 | 108 | 0 | 最新版本，仍需要新开对话才能激活所有模型 |
| 261 | 108 | 0 | 最新版本，出现版本检测到已安装其他版本 |
| 259 | 108 | 0 | [bug]选择深色，主题为 GitHub，输出的 markdown 内容看不清楚 |
| 257 | 108 | 0 | 服务商api无法使用 |
| 252 | 108 | 0 | 界面显示 Sonnet 4.6，实际思考中连接到 claude-opus-4-6（模型标识错误） |
| 248 | 108 | 0 | 我安装了Obsidian CLI 但是界面没有显示 win10已经设置全局变量了 已经设置到path |
| 247 | 108 | 0 | pluguin内的skills无法加载 |
| 236 | 108 | 0 | 功能需求 |
| 229 | 108 | 0 | 桥接至Discord bot后，命令行指令无法被识别和正确传输 |
| 180 | 108 | 0 | 配置豆包API不成功 |
| 271 | 107 | 0 | It's not possible to add project files using the @ symbol; the project currentl… |
| 269 | 107 | 0 | 无法自动获取ollama作为服务商提高的所有模型 |
| 267 | 107 | 0 | mcp无法配置，并且配置后有时候会莫名其妙的被重置。 |
| 288 | 106 | 0 | Feishu Bridge: Long connection not detected by Feishu developer console |
| 279 | 106 | 0 | 无法看到思维链 |
| 277 | 106 | 0 | 飞书的确认太不友好了 |
| 291 | 105 | 0 | 通过飞书桥接发不了文件 |
| 286 | 105 | 0 | 飞书切换项目文件夹失败 |
| 272 | 105 | 0 | The file tree cannot properly list the files of the corresponding folder. |
| 304 | 104 | 0 | 需要sudo密码的时候，本机会弹出密码输入框，但codepilot没有任何提示，所以进程就卡着了 |
| 322 | 103 | 0 | 网络检测没问题，但是还是不能访问 |
| 321 | 103 | 0 | 发现飞书话题群，不同话题有串session的情况 |
| 320 | 103 | 0 | 切换模式在哪里呢 |
| 316 | 103 | 0 | 思考等级有时候显示不出来 |
| 294 | 103 | 0 | window版的qq桥接老是自动断掉 |
| 332 | 102 | 0 | 文件数里面选择一个文件或者文件夹之后，能够直接引用到对话框和它对话 |
| 331 | 102 | 0 | 切换会话后，原会话输入框里的文字丢失了 |
| 330 | 102 | 0 | 配置第三方的gpt中转，可选模型无显示 |
| 329 | 102 | 0 | 藏师傅，Minmax2.7出了，模型选择需要支持下 M2.7 |
| 264 | 102 | 0 | 安装SKILL失败 |
| 339 | 101 | 0 | 功能请求：国内服务商可否加上腾讯云的coding plan |
| 297 | 101 | 0 | 微信群已过期，求新码 |
| 355 | 100 | 0 | Themes use dark text on dark background. |
| 353 | 100 | 0 | 功能请求：添加其他文生图服务商 |
| 351 | 100 | 0 | 添加智普服务商一直失败 |
| 350 | 100 | 0 | 你好,我配置的阿里云百炼,配置什么都没问题,就是没法对话 |
| 326 | 100 | 0 | 删除项目麻烦加个 |
| 281 | 100 | 0 | 用户群的二维码过期了 |
| 362 | 99 | 0 | 默认模型还是有些问题 |
| 368 | 98 | 0 | [功能请求]支持导出对话 |
| 366 | 98 | 0 | 主题锁定失败 |
| 377 | 97 | 0 | 技能安装窗口，字符编码全是乱码 |
| 376 | 97 | 0 | https://jiekou.ai/API接入问题 |
| 375 | 97 | 0 | 需求：永久记忆。 |
| 319 | 97 | 0 | 无法接入Minimax国内版的订阅API |
| 382 | 96 | 0 | 当黑色主题 代码对比色太暗无法看得清楚 |
| 381 | 96 | 0 | 智普国产服务商添加不生效 |
| 379 | 96 | 0 | Bug: Stream data gets GC'd while user is still on the session page |
| 378 | 96 | 0 | BUG反馈 |
| 370 | 96 | 0 | UI 卡死了目前这个版本 |
| 383 | 95 | 0 | [BUG] chrome-devtools mcp 内置无法移除 |
| 388 | 94 | 0 | [Bug]交互式提问窗口无法出现，一直在转圈圈 |
| 392 | 93 | 0 | CodePilot提醒有版本升级,不知道下载进度 |
| 404 | 90 | 0 | 拖拽失效 |
| 401 | 90 | 0 | 文件树超过3级目录就显示不出来了 |
| 417 | 88 | 0 | UI 模型选型跳变 |
| 411 | 88 | 0 | 可以支持在软件中编辑文档内容呢，谢谢 |
| 422 | 87 | 0 | 媒体服务商可以支持第三方服务商配置吗 |
| 419 | 87 | 0 | 识别不到工作目录 |
| 430 | 85 | 0 | Custom API (OpenAl-compatible)选项消失了 |
| 429 | 85 | 0 | 有个大问题，看不到工作树.worktree的目录和文件 |
| 426 | 85 | 0 | 回滚功能不起作用 |
| 424 | 85 | 0 | 会话气泡颜色出错 |
| 420 | 85 | 0 | 自定义安装了OpenCLI工具并同步给了CodePilot，在CodePilot中识别不到 |
| 415 | 85 | 0 | cluade的订阅模式不能用么？ |
| 414 | 85 | 0 | 诊断1-6全绿，但最终实际未联通 |
| 408 | 85 | 0 | mcp连接问题 |
| 393 | 85 | 0 | 无论是按 openai 第三方来配置还是按Anthropic Third-party API 来配置，都无法连接，已经上传报错日志 |
| 380 | 85 | 0 | 配置第三方GPT，无法设置模型 |
| 438 | 84 | 0 | KIMI API检通过但是无法链接 |
| 437 | 84 | 0 | 关于自定义API，链接成功后点击保存，再测试链接就会失败 |
| 436 | 84 | 0 | MINIMAX的api用不了 |
| 431 | 84 | 0 | 三方api密钥无法保存 |
| 446 | 83 | 0 | 交流群二维码过期了 |
| 443 | 83 | 0 | 隐藏工具调用 UI |
| 416 | 80 | 0 | 火山引擎的 coding plan 还是无法使用 |
| 349 | 79 | 0 | 现在的 SKILL 并不是真正的 SKILL，而是 Command |
| 462 | 78 | 0 | 三方api与会话处理问题 |
| 473 | 77 | 0 | 能配置stt和tts么 语音交互 |
| 472 | 77 | 0 | 能配置stt和tts么 语音交互 |
| 463 | 77 | 0 | 我装了才发现，代码界面竟然无法编辑吗，就是这么设计的吗，而且代码也没有颜色区分 |
| 444 | 77 | 0 | plan模式经常无法正常启用 |
| 439 | 77 | 0 | 国内的minimax token plan，可以使用到high speed模型吗？ |
| 498 | 74 | 0 | /Office-Hours 这种Skill的互动环节，会漏掉东西，页面看不到全部内容 |
| 477 | 74 | 0 | 我不确定这个默认模型会生效，所以每次都要手动选择 |
| 465 | 74 | 0 | 这个区域总是改变不稳定 |
| 374 | 74 | 0 | CodePilot群二维码失效了，能否更新一下。 |
| 293 | 74 | 0 | 微信群已经过期 |
| 506 | 73 | 0 | 飞书的桥接不通畅 |
| 495 | 73 | 0 | 切换会话以后，上一个会话记录在输入框的内容如果没发送出去，就丢了 |
| 487 | 73 | 0 | 项目级别的mcp和skill没被加载 |
| 483 | 73 | 0 | 阿里云 codingplan 没有 3.6plus模型 |
| 476 | 73 | 0 | win最新版本配置openrouter一直提示不通过为啥，ccswitch切换后本地claude可以使用 |
| 310 | 72 | 0 | 软件更新问题 |
| 524 | 69 | 0 | 更新版本之后，连接国内大模型服务商经常出现断联 |
| 520 | 69 | 0 | 删除历史会话后选择已有或者新增新的会话，输入框被置灰无法进行输入 |
| 527 | 67 | 0 | BUG |
| 530 | 66 | 0 | 飞书客户端无法显示Markdown表格，微信正常 |
| 529 | 66 | 0 | AI_MissingToolResultsError: Tool results are missing for tool calls call_functi… |
| 518 | 66 | 0 | 心跳检查和定时任务不起作用 |
| 533 | 64 | 0 | 查看Mermind流程图无法退出 |
| 535 | 63 | 0 | 复制粘贴图片发送后 无法解读 报错 |
| 548 | 60 | 0 | Web hook Test |
| 547 | 60 | 0 | 【新需求】设计Agent能否支持导出为图片或文件 |
| 544 | 60 | 0 | Anthropic 兼容第三方 API报错 |
| 550 | 58 | 0 | Error: No output generated. Check the stream for errors. |
| 555 | 55 | 0 | G |
| 556 | 54 | 0 | 三级以上的文件夹下面的文件列表无法显示，无法加载 |
| 561 | 51 | 0 | 不更新了吗 |
| 545 | 49 | 0 | 使用的模型有时会自动变 |
| 564 | 42 | 0 | 传图片bug，复制粘贴到消息发送框的图或者从文件夹里上传的图，无法识别报错 |
| 562 | 36 | 0 | 谁能拉我进下群 谢谢 wmxzz09 |
| 568 | 33 | 0 | 调用pencil的mcp失败后，窗口就无法继续对话了 |
| 567 | 32 | 0 | 使用codepilot比单纯使用claudecode(ghostty+fish)在使用同样的token量下耗费2-3倍的钱 |
| 572 | 29 | 0 | 需要小米mimo新加坡节点 |
| 549 | 29 | 0 | 小米的 Token Plan 订阅套餐不能连接 |
| 569 | 26 | 0 | mcp配置了，但是用不了 |
| 578 | 25 | 0 | 在构建任务时，任务中断之后，重新在输入框中输入相关内容点击发送无响应 |
| 576 | 25 | 0 | codepilot中右边的文件夹目录中的文件无法打开添加到聊天框中 |
| 573 | 25 | 0 | 突然就无法对话了，连通性有问题，不知道和 CC switch 有关系吗？ |
| 606 | 24 | 0 | 需要小米mimo新加坡节点 接口 |
| 554 | 23 | 0 | 1m上下文如何来开启？设置里面打开开关，但对话下面还是显示200k，而且/context似乎没用？ |
| 617 | 22 | 0 | claude运行问题 |
| 616 | 22 | 0 | 需要小米mimo新加坡集群节点 |
| 625 | 19 | 0 | 运行就会提示这个东西但是过会自己就消失了 |
| 622 | 19 | 0 | 飞书远程桥接无法使用 |
| 532 | 16 | 0 | deepseek v4两个模型都只显示200k上下文，实际能力为1M |
| 637 | 14 | 0 | 版本 5.60 =》分屏功能优化体验需求 |
| 619 | 14 | 0 | 版本 V0.55.1 问题：概率串会话 |
| 615 | 14 | 0 | 版本 0.55.1模型不更新，截图发送被吞 |
| 627 | 13 | 0 | 0.56发送之后输入框还保留着被输入的内容（偶发） |
| 639 | 12 | 0 | Volcengine Ark新增AgentPlan支持（当前默认是Coding Plan） |
| 642 | 11 | 0 | ui问题 |
| 644 | 6 | 0 | 优惠的模型用不了也不加模型通道，只能转向workbuddy了。 |
| 646 | 1 | 0 | 最近不更新了吗？ |

### `feature-parking-lot`（55）

疑似功能请求 → v0.57+ parking-lot

| # | idle天 | label数 | 标题 |
|---|--------|---------|------|
| 69 | 125 | 0 | 能不能支持 codex 那种多项目选择的模式 |
| 52 | 125 | 0 | 能不能增加Antigravity 的授权而不是GOOGLE API 来启动这个UI？ |
| 162 | 116 | 0 | AI每一步做的事情都是摘要，无法查看他每一步详细的内容，希望可以点击展开看到它改了什么 |
| 147 | 116 | 0 | 【功能请求】 希望添加对远程服务器上CC的支持 |
| 145 | 116 | 0 | 【功能请求】希望能增加claude code的更新检测和升级功能 |
| 139 | 116 | 0 | 希望 CodePilot 可以添加 Image 模型的第三方配置，支持自己输入 Base URL 和 API Key。 |
| 132 | 116 | 0 | Feature Request: 添加上下文窗口使用百分比显示 (Context Window Usage Percentage Display) |
| 114 | 116 | 0 | 建议显示已安装的agent，可视化创建agent |
| 106 | 116 | 0 | 建议增加远程功能，PC上打开这个软件，手机使用app或者web打开一个页面继续操作 |
| 181 | 114 | 0 | 会考虑增加codex和gemini cli吗 |
| 168 | 114 | 0 | 对话列表增加关闭文件夹的建议 |
| 165 | 114 | 0 | 希望可以增加定时任务功能 |
| 201 | 113 | 0 | 希望可以完成任务之后发送通知来提醒我 |
| 215 | 112 | 0 | Feature Request: Add iMessage support to Bridge |
| 67 | 111 | 0 | 建议可以增加多分屏模式，适配Agent Teams |
| 263 | 108 | 0 | Feature：增加 Session 任务完成提醒（系统通知或声音提醒） |
| 256 | 108 | 0 | 建议 Bridge 增加企业微信（WeCom）桥接支持 |
| 242 | 108 | 0 | 【归藏最帅】希望增加多个bot桥接功能 |
| 290 | 106 | 0 | Feature request |
| 284 | 106 | 0 | 增加引导重新配置的选项 |
| 283 | 106 | 0 | 增加右键删除聊天记录 |
| 280 | 106 | 0 | 聊天记录希望增加按文件夹批量导入，并按时间戳自动排序 |
| 313 | 104 | 0 | 希望能适配ClaudeCode最新的Agent Team |
| 311 | 104 | 0 | 希望支持修改默认图片生成工具 |
| 318 | 103 | 0 | 希望能添加接入第三方vertex |
| 182 | 103 | 0 | 希望目录可以显示隐藏文件和文件夹 |
| 336 | 102 | 0 | 功能请求: 会话列表增加删除会话和删除文件夹功能 |
| 333 | 102 | 0 | 希望服务商增加codex 和 github copilot的 oauth认证登录 |
| 338 | 101 | 0 | 功能请求: 软件更新弹窗增加「不再提示」选项 |
| 363 | 98 | 0 | [Feature Request] 增加 Discord 回复自动新建thread选项 |
| 397 | 92 | 0 | 希望能增加diff内容预览和回退的功能 |
| 403 | 90 | 0 | 希望加个聊天框确认提醒通知功能 |
| 402 | 90 | 0 | 希望支持读特定目录的skills |
| 213 | 90 | 0 | 我们这里实现了远程ssh，利本地公钥，远程私钥配对，不知道能不能合并到项目中？ |
| 387 | 88 | 0 | 由衷地希望codepilot能在我的键盘上占一个键 |
| 458 | 80 | 0 | Feature Request: Support multiple OpenAI OAuth accounts |
| 460 | 79 | 0 | 希望能增加定时任务的功能 |
| 467 | 77 | 0 | Feature: Auto-transcribe WeChat voice messages when voice_item.text is missing |
| 466 | 77 | 0 | 希望加个内部测试版吧，内部测试通过才发布。 |
| 469 | 76 | 0 | Feature: One-click import and browse Claude Code conversation history |
| 482 | 75 | 0 | Feature Request: 全局/会话内搜索功能（参考 Obsidian） |
| 481 | 75 | 0 | Feature Request：Turn 级增加 meta 信息展示（Coding Agent / 模型） |
| 485 | 74 | 0 | Feature Request：支持更多 AI Agent 框架（QwenCode、OpenCode 等） |
| 409 | 73 | 0 | 希望能保留对话草稿内容 |
| 525 | 69 | 0 | 希望增加对无问芯穹 coding plan 的支持 |
| 522 | 69 | 0 | 增加对gml-5.1的支持 |
| 538 | 62 | 0 | 求增加对openai兼容格式的支持，目前无法添加openai中转站接口 |
| 557 | 54 | 0 | 建议支持添加自定义桥接渠道功能 |
| 565 | 42 | 0 | 求增加硅基流动api的支持或者openaithirdparty |
| 566 | 40 | 0 | 运行链接诊断的时候报错：Live test failed — UNSUPPORTED_FEATURE: Your Claude Code CLI versio… |
| 621 | 21 | 0 | 建议在右侧文件区域添加右键功能，直接打开文件，或者在文件夹中显示 |
| 631 | 17 | 0 | 【特性需求/RFC】引入类似 Steam 创意工坊的开放模块挂载系统，支持用户自主扩展独立 UI 组件与全局功能 |
| 630 | 17 | 0 | 1,色彩主题没匹配上，2建议增加在浏览器中打开按钮，3建议增加在文件夹中打开按钮 |
| 638 | 14 | 0 | 交互优化建议 |
| 645 | 4 | 0 | 模型的对接建议直接对接cc-switch |

### `support-question-close`（15）

疑似 support 提问 + 45 天无更新 → 评论后关闭候选

| # | idle天 | label数 | 标题 |
|---|--------|---------|------|
| 128 | 116 | 0 | 请问是否计划支持acp协议呢 |
| 121 | 116 | 0 | 环境检测问题-软件中如何切换 node 版本？ |
| 111 | 116 | 0 | 回答速度相比cli太慢了，怎么办 |
| 104 | 116 | 0 | 怎么修改Claude Code默认的启动目录？ |
| 200 | 113 | 0 | session 如何切换 |
| 278 | 106 | 0 | bug: AskUserQuestion 在飞书端未正确渲染为交互式表单 |
| 246 | 106 | 0 | 为什么没有自动更新的功能啊。 |
| 275 | 105 | 0 | 最新版本的智谱大模型如何加入 |
| 295 | 104 | 0 | 请问通过修改claude/settings.json，服务商可以生效吗？ |
| 317 | 103 | 0 | 怎么切换模式？ |
| 359 | 99 | 0 | AskUserQuestion 在Discord端未正确渲染为交互式表单 |
| 358 | 99 | 0 | Telegram 桥接怎么设置full access, 一直弹权限确认， 老中断 |
| 450 | 81 | 0 | 为什么无法同步对话框,telegram发消息都是弹出新窗口 |
| 534 | 64 | 0 | 为什么默认不读CLAUDE.md |
| 536 | 63 | 0 | 为什么无法生图？ |

### `uncategorized`（98）

启发式未命中 → **必须人工逐条判断**

| # | idle天 | label数 | 标题 |
|---|--------|---------|------|
| 84 | 125 | 0 | 桌面端报错：Claude Code process exited with code 1 |
| 82 | 125 | 0 | 支持sessions的管理吗？ |
| 76 | 125 | 0 | Code review summary: usability breakages and safety/stability gaps |
| 27 | 125 | 0 | 可以支持claude code的agent吗 |
| 63 | 123 | 0 | 没办法多开窗口对话 |
| 160 | 116 | 0 | 请求添加 TG 流式响应开关选项 |
| 140 | 116 | 0 | TG 发送消息失败 |
| 126 | 116 | 0 | 总掉线是什么原因呢 |
| 119 | 116 | 0 | bug：自动更新后无法重启更新 |
| 110 | 116 | 0 | provider |
| 102 | 116 | 0 | mac，终端正常使用，桌面端不行，自己新增的 provider 也不行 |
| 98 | 116 | 0 | ask模式正常，code模式/plan模式无法使用 |
| 136 | 115 | 0 | Original error: Claude Code process exited with code 1 |
| 194 | 114 | 0 | 无法记住窗口大小和颜色配置 |
| 190 | 114 | 0 | macOS version only showing 2 MCP servers, should show 7 |
| 185 | 114 | 0 | MAC版添加豆包模型后，telegram发送任务不能执行 |
| 154 | 114 | 0 | 提示错误，Claude Code CLI not found. |
| 173 | 113 | 0 | 连接第三方api时，对话栏模型选择列表有误 |
| 219 | 112 | 0 | 我一直没有使用起来，求大神指导 |
| 220 | 111 | 0 | 用kimi k2.5模型显示：Original error: Claude Code process exited with code 1 |
| 179 | 110 | 0 | 「feishu桥接」 |
| 254 | 108 | 0 | Chats 窗口有确认项的 session 会话，黄点闪烁 |
| 244 | 108 | 0 | [Bug] Terminal window pops up when sending messages on Windows |
| 234 | 108 | 0 | 是否支持 codex的 OAth登陆 |
| 225 | 108 | 0 | Bug: Chinese IME Enter key triggers message send during composition |
| 285 | 106 | 0 | Dependency ‘@lobehub/ui’ exists in package.json but failed to resolve after ins… |
| 276 | 106 | 0 | 版本冲突 |
| 274 | 106 | 0 | 版本冲突 |
| 199 | 106 | 0 | 飞书桥接无回应，chat界面可运行 |
| 308 | 104 | 0 | 通道报错 |
| 306 | 104 | 0 | 检测一切都通过，但是还是显示Error: Claude Code CLI not foun |
| 299 | 104 | 0 | 对话速度慢 |
| 323 | 103 | 0 | [Bug] Feishu WebSocket long connection fails: code 1000040345, system busy |
| 335 | 102 | 0 | Bug: 当同时输入命令和请求时，请求内容被隐藏只显示命令 |
| 340 | 101 | 0 | Add Provider按钮不好使 |
| 337 | 101 | 0 | 功能请求: 添加链接打开设置选项及内置浏览器数据持久化支持 |
| 270 | 100 | 0 | Windows端无法使用 |
| 365 | 98 | 0 | Sonnet 4 and Opus 4 |
| 371 | 97 | 0 | feat: 支持批量导入 CLI session（按 project 或全选） |
| 360 | 95 | 0 | 方舟 coding plan 配置失败 |
| 390 | 93 | 0 | 重启后底部栏布局异常切换 |
| 389 | 93 | 0 | 关闭窗口（不是退出应用）后台没反应了 |
| 356 | 93 | 0 | [Bug] 服务商 Kimi Coding Plan/GLM (CN) 进程退出报错 - 所有配置正确但 Live 探针超时 |
| 395 | 92 | 0 | 启动不了 |
| 385 | 89 | 0 | [Bug] 关闭软件重新打开后，主题配置丢失，永远是深色主题 |
| 428 | 85 | 0 | 功能请求：在 CodePilot 中支持 Plugin 斜杠命令 |
| 427 | 85 | 0 | OpenRouter provider: thinking mode causes crash with non-Anthropic models (e.g.… |
| 413 | 85 | 0 | KIMI 2.5 CODING plan not working |
| 412 | 85 | 0 | 阿里百炼和直接填写kimi coding 2.5 both not working |
| 410 | 85 | 0 | Windows npm下载的Claude code，会找不到Claude code cli |
| 406 | 85 | 0 | 删除多余 claude code 后，claude code 不可用 |
| 396 | 85 | 0 | 更新为何一定要用内置浏览器呢？ |
| 440 | 84 | 0 | Chat doesn't render colors correctly for coding blocks or json. Very hard to re… |
| 432 | 84 | 0 | fix: broaden Claude CLI discovery paths for pnpm and compatibility wrappers |
| 423 | 84 | 0 | 鉴权来源出错，但是我已经正确配置了我claude code |
| 434 | 81 | 0 | feat: add optional cc-switch compatibility mode |
| 459 | 80 | 0 | 左侧UI设计上能否采用codex设计，每项对话对其文案，而非图标 |
| 454 | 80 | 0 | windows11 卸载卡住 |
| 447 | 80 | 0 | BUG 配置文件确定正确，并且系统的claude code可以使用，但是CodePilot无法使用。 |
| 471 | 77 | 0 | v0.49.0 版本 Generative UI 的渲染功能以及OpenRouter Native 协议连接失败 |
| 456 | 77 | 0 | v0.48.0+ 强制要求 Provider 实体导致了 CLI 引擎的认证拦截。对于第三方 API，AI SDK 引擎与 Claude CLI 引擎在环境变… |
| 453 | 77 | 0 | codepilot好像不支持 claude code 的/btw指令 |
| 475 | 74 | 0 | GLM 5.1 一直卡在 组织回复中 CodePilot v0.49.0 |
| 474 | 74 | 0 | Provider resolution path: "Anthropic Third-party API" (anthropic) |
| 457 | 74 | 0 | 最新版本的 Claude Code CLI 或者 AI SDK 无法使用 |
| 514 | 73 | 0 | [Bug] Claude Code 状态检查间歇性失败（Windows） |
| 512 | 73 | 0 | 同步 Claude Code 历史 |
| 500 | 73 | 0 | 我想用kimi 2.5 coding plan作为模型使用，竟然折腾了2周都不能实现，大家都可以用吗？ |
| 464 | 72 | 0 | OpenAI OAuth 登录报错：Token exchange failed: Token exchange failed: 403 - [object O… |
| 523 | 69 | 0 | 配置第三方服务总是出错 |
| 461 | 69 | 0 | 升级最新版本后，claude code 无法连接？ |
| 517 | 68 | 0 | ubuntu系统下版本更新的推荐下载文件不对 |
| 505 | 68 | 0 | [Bug] 指令补全异常：文件型本地指令刷新滞后，且未支持解析 enabledPlugins (如 superpowers) |
| 521 | 66 | 0 | 更新后百炼code plan无法使用 |
| 511 | 65 | 0 | 【v.50.3版本】识别不到默认的CLI里面claude订阅会员，一直卡在模型选择 |
| 528 | 64 | 0 | codepilot右边的文件树索引不显示深层子文件夹内容 |
| 501 | 64 | 0 | [Critical Bug] v0.50.3 上持续出现 macOS 钥匙串错误“无法找到钥匙串来存储‘apple’” |
| 543 | 62 | 0 | windows下安装默认C盘 |
| 541 | 62 | 0 | 聊天时显示报错 |
| 314 | 62 | 0 | Claude Code process exited with an error |
| 551 | 58 | 0 | Support codex，please！ |
| 552 | 57 | 0 | 第三方 Anthropic 代理 (gaccode 等) 测试连接使用模型别名导致失败，更新时 base_url 空字符串校验问题 |
| 560 | 52 | 0 | 我在终端用 claude cli 就可以,在桌面网页就不行,已经更新了 |
| 559 | 52 | 0 | GPT做看板 好像一直有问题，但是其他模型（DeepSeek、kimi等）就可以 |
| 558 | 52 | 0 | win下有时会清空 ~/.claude/ 文件夹下的agent和skills |
| 563 | 37 | 0 | 会清空掉claude code的历史对话，严重Bug。另外图2图3这个bug经常第一次发送不回复要发两次 |
| 570 | 31 | 0 | 无法配置OpenRouter |
| 571 | 30 | 0 | deepSeek用不了 |
| 478 | 26 | 0 | 使用 cc-switch 后一直报错无法使用 |
| 577 | 25 | 0 | 使用期间每一次正常对话后都会出现一次Error: An unexpected error occurred (Provider: Anthropic Thir… |
| 574 | 25 | 0 | 在claude code最新版本中可以使用workflow，codepilot中最新的用不了 |
| 613 | 23 | 0 | codex 切换其他模型总是失败。 |
| 612 | 23 | 0 | codepilot_generate_image MCP 工具在 HTTP 代理环境下 TLS 握手失败 |
| 618 | 22 | 0 | win11下运行后闪退，下面是日志，删除 .cc-switch 目录后重启还是闪退 |
| 623 | 20 | 0 | claude code一直误报：1 other Claude CLI installation(s) detected |
| 624 | 19 | 0 | Clarify quota/billing behavior for Claude Agent SDK runtime |
| 641 | 12 | 0 | 这个版本的 CodePilot 不能直接用 Claude Pro 登录态跑 Claude Code SDK，必须配 API Provider |
| 640 | 12 | 0 | Effort selector dropdown hidden for GLM models — blocks access to GLM-5.2 High/… |

## 重复主题聚类（仅候选，canonical 需人工选）

> 仅按**标题**关键词命中归类（不看正文，避免正文偶然命中误聚）；**不自动推荐 canonical**——同主题下留哪个作主 issue 须人工判断后再评论 / 关闭。

### install-update（35）

- #646（idle 1d）最近不更新了吗？
- #633（idle 9d）Windows11，安装程序无法打开
- #628（idle 9d）通过@ 添加文件发送后的文件被单独保存，导致内容更新时更新的不是原文件
- #623（idle 20d）claude code一直误报：1 other Claude CLI installation(s) detected
- #615（idle 14d）版本 0.55.1模型不更新，截图发送被吞
- #576（idle 25d）codepilot中右边的文件夹目录中的文件无法打开添加到聊天框中
- #561（idle 51d）不更新了吗
- #560（idle 52d）我在终端用 claude cli 就可以,在桌面网页就不行,已经更新了
- #552（idle 57d）第三方 Anthropic 代理 (gaccode 等) 测试连接使用模型别名导致失败，更新时 base_url 空字符串校验问题
- #543（idle 62d）windows下安装默认C盘
- #537（idle 62d）[建议] Claude SDK可能需要更新了，现在codepilot在使用中出现了一大堆问题
- #524（idle 69d）更新版本之后，连接国内大模型服务商经常出现断联
- #521（idle 66d）更新后百炼code plan无法使用
- #517（idle 68d）ubuntu系统下版本更新的推荐下载文件不对
- #503（idle 73d）[bug]: 新建技能的弹窗里UI交互更新不及时
- #420（idle 85d）自定义安装了OpenCLI工具并同步给了CodePilot，在CodePilot中识别不到
- #405（idle 90d）fedora rpm安装没有软件图标
- #396（idle 85d）更新为何一定要用内置浏览器呢？
- #377（idle 97d）技能安装窗口，字符编码全是乱码
- #374（idle 74d）CodePilot群二维码失效了，能否更新一下。
- #338（idle 101d）功能请求: 软件更新弹窗增加「不再提示」选项
- #324（idle 95d）feat: 支持通过 Homebrew Cask 安装和更新
- #310（idle 72d）软件更新问题
- #292（idle 105d）0.37.0 install failed in ubuntu
- #285（idle 106d）Dependency ‘@lobehub/ui’ exists in package.json but failed to resolve…
- #264（idle 102d）安装SKILL失败
- #261（idle 108d）最新版本，出现版本检测到已安装其他版本
- #248（idle 108d）我安装了Obsidian CLI 但是界面没有显示 win10已经设置全局变量了 已经设置到path
- #246（idle 106d）为什么没有自动更新的功能啊。
- #174（idle 113d）Claude Code 通过 npm 安装后在 Windows 上无法被 CodePilot 检测到
- #145（idle 116d）【功能请求】希望能增加claude code的更新检测和升级功能
- #122（idle 116d）无法安装
- #119（idle 116d）bug：自动更新后无法重启更新
- #114（idle 116d）建议显示已安装的agent，可视化创建agent
- #112（idle 116d）已安装的插件加载错误

### crash-interrupt（5）

- #635（idle 9d）0.56 版本会频繁自动中断
- #632（idle 9d）同一项目多个会话似乎存在上下文膨胀问题，导致新会话很容易中断
- #618（idle 22d）win11下运行后闪退，下面是日志，删除 .cc-switch 目录后重启还是闪退
- #578（idle 25d）在构建任务时，任务中断之后，重新在输入框中输入相关内容点击发送无响应
- #427（idle 85d）OpenRouter provider: thinking mode causes crash with non-Anthropic mo…

### bridge（36）

- #622（idle 19d）飞书远程桥接无法使用
- #557（idle 54d）建议支持添加自定义桥接渠道功能
- #539（idle 62d）bug(telegram): non-image document attachments are silently dropped or…
- #530（idle 66d）飞书客户端无法显示Markdown表格，微信正常
- #519（idle 69d）bridge 切换路径要先删原 Bridge 对话才成功
- #510（idle 73d）【0.50.3版】telegram桥接的连接测试失败和Anthropic兼容端点的推理深度问题
- #506（idle 73d）飞书的桥接不通畅
- #455（idle 80d）Enabling multiple bridge adapters simultaneously causes both to fail …
- #450（idle 81d）为什么无法同步对话框,telegram发消息都是弹出新窗口
- #363（idle 98d）[Feature Request] 增加 Discord 回复自动新建thread选项
- #359（idle 99d）AskUserQuestion 在Discord端未正确渲染为交互式表单
- #358（idle 99d）Telegram 桥接怎么设置full access, 一直弹权限确认， 老中断
- #321（idle 103d）发现飞书话题群，不同话题有串session的情况
- #297（idle 101d）微信群已过期，求新码
- #294（idle 103d）window版的qq桥接老是自动断掉
- #293（idle 74d）微信群已经过期
- #291（idle 105d）通过飞书桥接发不了文件
- #288（idle 106d）Feishu Bridge: Long connection not detected by Feishu developer conso…
- #287（idle 101d）feishu bridge allow permission 报错 code 200340 0.36 版本 allow permissio…
- #286（idle 105d）飞书切换项目文件夹失败
- #278（idle 106d）bug: AskUserQuestion 在飞书端未正确渲染为交互式表单
- #277（idle 106d）飞书的确认太不友好了
- #256（idle 108d）建议 Bridge 增加企业微信（WeCom）桥接支持
- #242（idle 108d）【归藏最帅】希望增加多个bot桥接功能
- #231（idle 108d）飞书对话无法识别/compact、/clear等命令
- #229（idle 108d）桥接至Discord bot后，命令行指令无法被识别和正确传输
- #217（idle 112d）「QQ桥接」延时问题
- #215（idle 112d）Feature Request: Add iMessage support to Bridge
- #210（idle 108d）Telegram Bot 功能需要支持代理配置（Proxy Support for Telegram Bot）
- #209（idle 113d）把当前会话同步到飞书等渠道
- #199（idle 106d）飞书桥接无回应，chat界面可运行
- #185（idle 114d）MAC版添加豆包模型后，telegram发送任务不能执行
- #179（idle 110d）「feishu桥接」
- #178（idle 114d）【功能请求】多路桥接
- #149（idle 114d）桥接链接失败 已按照操作指引操作 测试几遍都这个问题
- #130（idle 116d）Telegram bridge doesn't support audio input (Telegram 不支持语音输入)

### provider-connect（7）

- #493（idle 73d）0.50.2 还是无法连接 cc-switch 配置的 Claude CLI
- #471（idle 77d）v0.49.0 版本 Generative UI 的渲染功能以及OpenRouter Native 协议连接失败
- #461（idle 69d）升级最新版本后，claude code 无法连接？
- #393（idle 85d）无论是按 openai 第三方来配置还是按Anthropic Third-party API 来配置，都无法连接，已经上传报错日志
- #323（idle 103d）[Bug] Feishu WebSocket long connection fails: code 1000040345, system…
- #214（idle 110d）今日更新版本至0.28.1后，Claude无法连接
- #148（idle 116d）"Test Connection" failed；详细见图

### claude-cli-missing（2）

- #470（idle 74d）【求救】更新提示错误； Claude Code CLI not found.
- #154（idle 114d）提示错误，Claude Code CLI not found.

## 下一步（不在本脚本内执行）

1. 人工复核本报告，尤其 `uncategorized` 和所有 `*-close` 候选。
2. `fixed-close`（#628/#629）可带本地修复证据关闭。
3. `old-version-confirmation` / `support-question-close`：先打 label + 评论，14 天宽限后再关（需用户确认）。
4. P0/P1 一律不在此流程自动处理。
