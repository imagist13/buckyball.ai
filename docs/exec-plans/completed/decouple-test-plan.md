# 脱离 Claude Code — 功能测试方案

> 创建时间：2026-04-07
> 对应执行计划：[decouple-claude-code.md](./decouple-claude-code.md)

## 快速冒烟路径（5 分钟）

按顺序测关键路径：
1. **#1** Native Runtime 对话 → 确认核心可用
2. **#4** 停用默认 provider → 确认 fallback
3. **#7-12** 挨个试 6 个编码工具
4. **#20** Normal 模式 Bash 审批
5. **#26/#27** 飞书 + Telegram 各发一条
6. **#29** Rewind 一次

---

## 一、Runtime 核心

### #1 Native Runtime 基本对话
> 设置 → Claude Code CLI → Agent Runtime 选 `原生 Runtime (Native)`

**测试提示词：**
```
帮我看一下这个项目的目录结构，列出 src/ 下的主要文件夹
```
**预期：** 正常回复，使用 Glob 工具，SSE 流无报错

### #2 SDK Runtime 对话（需装 Claude Code）
> 设置 → Claude Code CLI → Agent Runtime 选 `Claude Code SDK`

**测试提示词：** 同上
**预期：** 同样正常回复，走 CLI 子进程

### #3 Runtime 自动切换
> 设置 → Claude Code CLI → Agent Runtime 选 `自动`（默认值）

**预期：** 有 CLI 走 SDK，无 CLI 走 Native，console 有日志

---

## 二、Provider 解析

### #4 Inactive provider fallback
> 停用当前默认 provider（设置 → Provider 列表 → 关闭 is_active），不选新默认

**测试提示词：**
```
你好
```
**预期：** 不报错，自动 fallback 到任意 active provider，console 有 `[provider-resolver] ... is inactive, falling back` 日志

### #5 Protocol/model 不兼容检测
> 创建一个 Google 协议 provider，设为默认，model 保持 sonnet

**预期：** Bridge 发消息时收到明确错误 `uses google protocol but model "sonnet" is an Anthropic model`

### #6 第三方代理（claude-code-compat）
> 配置一个非 api.anthropic.com 的 Anthropic 兼容代理（如智谱）

**测试提示词：**
```
1+1等于几
```
**预期：** 走 ClaudeCodeCompatAdapter，正常回复

---

## 三、8 个内置编码工具

| # | 工具 | 测试提示词 | 预期 |
|---|------|-----------|------|
| #7 | Read | `读一下 package.json 的前 10 行` | 显示文件内容 |
| #8 | Write | `在项目根目录创建一个 test-temp.txt，内容写 hello` | 文件被创建 |
| #9 | Edit | `把刚才的 test-temp.txt 里的 hello 改成 world` | 文件被修改 |
| #10 | Glob | `找一下 src/ 下所有 .test.ts 文件` | 列出匹配文件 |
| #11 | Grep | `搜一下代码里哪里引用了 runAgentLoop` | 显示匹配位置 |
| #12 | Bash | `运行 node -v 看一下 Node 版本` | 显示版本号 |
| #13 | Skill | `用 /commit 提交当前改动` | 触发 Skill 执行 |
| #14 | Agent | 见下方子 agent 测试 #24 #25 | — |

测试完删掉临时文件：`删掉刚才创建的 test-temp.txt`

---

## 四、15 个内置 MCP 等效工具

### #15 Notification（4 工具，always 触发）
```
发一条通知提醒我"测试通知"，优先级 urgent
```
**预期：** 系统通知弹出

```
创建一个 5 秒后触发的一次性定时任务，提醒我"定时测试"
```
**预期：** 5 秒后收到通知

```
列出当前所有定时任务
```

### #16 Dashboard（5 工具，关键词触发）
```
帮我创建一个 dashboard 组件，用柱状图展示一周的天气温度数据，pin 到仪表盘
```
**预期：** Widget 被创建并 pin

```
列出当前 dashboard 上固定的所有 widget
```

### #17 Widget Guidelines（1 工具，关键词触发）
```
我要画一个流程图，先加载一下可视化设计规范
```
**预期：** 返回 widget 设计指南内容

### #18 Media（2 工具，关键词触发）
```
生成一张图片：一只在月球上弹吉他的猫，16:9
```
**预期：** 调用 Gemini 生成图片（需配置 Gemini provider）

```
把桌面上的 test.png 导入到媒体库，标签设为 test
```
**预期：** 文件被导入（需有实际文件）

### #19 Memory Search（3 工具，workspace 触发）
```
搜索一下工作区记忆中关于 "provider" 的内容
```
**预期：** 返回 daily/ longterm/ 下匹配的记忆条目（需有工作区记忆数据）。无数据时返回"未找到"而非报错。

---

## 五、权限系统

### #20 Normal 模式（默认）
```
运行一下 ls -la /tmp
```
**预期：** Bash 工具弹出审批对话框，确认后执行

### #21 Explore 模式
> 切换到 Plan 模式

```
帮我把 README.md 的标题改成 Test
```
**预期：** Write/Edit 工具被拒绝，只能用 Read/Glob/Grep

### #22 Trust 模式
> 设置 session 权限为 full_access

```
运行 echo "trust mode test"
```
**预期：** 直接执行，不弹审批

### #23 危险命令拦截（所有模式）
```
运行 rm -rf /tmp/test-dangerous
```
**预期：** 即使 trust 模式也弹审批（dangerous pattern 永远 ask）

---

## 六、子 Agent + 权限继承

### #24 子 Agent 基本功能
```
用 explore agent 搜索一下项目里哪些文件定义了 API route
```
**预期：** 子 agent 执行，返回搜索结果文本

### #25 子 Agent 权限继承（Normal 模式下）
```
用 general agent 执行这个任务：运行 echo "sub-agent permission test"，把结果告诉我
```
**预期：** 子 agent 调用 Bash 时，**父流**弹出权限审批对话框，批准后子 agent 继续

---

## 七、Bridge（飞书 / Telegram）

### #26 飞书 Bridge 基本对话
> 在飞书发消息

**预期：** 正常回复

### #27 Telegram Bridge 基本对话
> 在 Telegram 发消息

**预期：** 正常回复

### #28 Bridge 错误可见性
> 故意停用所有 provider，通过 Telegram 发消息

**预期：** 收到 `<b>Error:</b>` 格式的错误消息而非无响应

---

## 八、Rewind / File Checkpoint

### #29 文件回退
```
帮我创建一个文件 rewind-test.txt 内容是 "version 1"
```
等完成后：
```
把 rewind-test.txt 的内容改成 "version 2"
```
然后在 UI 点击第一条消息的 **Rewind** 按钮

**预期：** rewind-test.txt 内容恢复为 "version 1"

---

## 九、Context Pruning

### #30 长对话压缩
> 连续发 15+ 条包含工具调用的消息，观察 console

**测试提示词（循环发）：**
```
搜一下 src/lib/ 下所有 .ts 文件的行数（用 bash wc -l）
```
```
搜一下 src/app/ 下所有 route.ts
```
```
读一下 tsconfig.json
```
（重复变换，直到消息超过 15 轮）

**预期：** console 出现 `[context-pruner]` 日志，旧的 tool_result 被截断，对话不中断

---

## 十、MCP 连接管理

### #31 外部 MCP Server 连接
> 在设置中添加一个 MCP server（如 chrome-devtools）

```
列出当前连接的 MCP 服务器
```
**预期：** 能看到已连接的 server 和它的工具

### #32 MCP Toggle（Disable）
> 在 MCP 面板禁用一个 server

**预期：** server 断开，工具不再可用

---

## 十一、Structured Output

### #33 结构化输出
> 需要前端发起 structured 请求（目前可能没有触发入口）

如果有，测试：
```
POST /api/chat/structured
Body: { session_id, prompt: "列出3种编程语言及其用途", schema: { type: "object", properties: { languages: { type: "array" } } } }
```
**预期：** 返回符合 schema 的 JSON

---

## 十二、Event Bus

### #34 事件触发验证
> 在 console 搜索以下关键词，确认对话过程中触发了：

- `session:start` — 对话开始时
- `session:end` — 对话结束时
- `tool:pre-use` — 工具调用前
- `tool:post-use` — 工具调用后
- `permission:request` — 权限请求时（Normal 模式 Bash）
- `permission:resolved` — 权限决定后
