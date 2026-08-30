# 稳定性 / 流畅性 / Runtime 全面审计(2026-07-04)

> 类型:调研 + 代码审计。基于 v0.57.0(`cc5e6fe`)。
> 方法:三轮——①文档梳理(tech-debt tracker / exec-plans / guardrails);②逐条以当前代码 + git 历史核实文档结论(推翻 3 条"未修");③对文档未覆盖的三大区域(Electron 主进程、chat 后端主路由、ChatView 前端状态机)做只读代码审计。
> 所有高/中危发现的 文件:行号 均经人工二次核读确认;标「疑似」的为触发条件苛刻、未构造复现的推断。

## 状态速览

| 分类 | 数量 | 说明 |
|------|------|------|
| 新发现(文档未记录) | 高 1 / 中 8 / 低 8 | 见 §1,本文档主体 |
| 文档滞后(实际已修) | 3 | #23、#21/#22、#43-item3,见 §2 |
| 核实仍存在的已知债 | 见 §3 | 以 tracker 为准,本文不重复展开 |

---

## 1. 新发现(文档未记录)

### 1.1 【高·安全】`artifact:export-long-shot` 允许渲染进程任意路径写文件

- **位置**:`electron/main.ts:2203-2207`(handler 定义 ~2092;preload 暴露 `electron/preload.ts:54-66`)
- **问题**:`outPath` 由渲染进程直接传入,主进程无目录白名单、无路径规范化,直接 `fs.writeFile(outPath, buf)`。这是全 IPC 面唯一可由渲染进程指定落盘路径的点。
- **威胁模型(已按 review 收紧)**:写入内容是 `Page.captureScreenshot` 产出的 **PNG bytes**,不是任意文本 bytes;正常产品路径(`src/lib/artifact-export.ts:73`)**也不传 `outPath`**,只取 base64 走浏览器下载。因此这**不是**稳定的 `.zshrc` / LaunchAgent 文本注入 RCE。准确表述:**渲染进程被攻陷后(XSS / prompt-injection 产物),可向任意路径写 PNG 或以 PNG 覆盖任意已有文件**——破坏性(覆盖用户文件、覆盖配置使其损坏)成立,任意文本内容持久化不成立。修复优先级仍高(任意路径覆盖本身即高危)。
- **修复思路**:
  1. 主进程维护唯一合法导出目录(如 `app.getPath('downloads')` 或专用 exports 目录),对 `outPath` 做 `path.resolve` 后校验前缀在该目录内,否则拒绝;
  2. 更彻底:handler 不再接受 `outPath`,只返回 base64 / 写入主进程自选的临时路径,由主进程弹 `dialog.showSaveDialog` 让用户选目标(路径决定权收回主进程);
  3. 顺带给该 handler 加 sender 校验(见 1.6)。
- **验证**:单测 + 手动:传 `outPath: '/tmp/evil'` 断言被拒;正常导出流程回归。

### 1.2 【中】conversation-registry 无 ownership 门 —— 旧回合 finally 误删新回合的 Query

- **位置**:`src/lib/conversation-registry.ts:12-18`(裸 `Map.set/delete`,只按 sessionId);注册 `claude-client.ts:1602`,反注册 `claude-client.ts:2406`(finally);消费方 `interrupt/route.ts:58`、`rewind/route.ts:27`。
- **问题**:回合 A 被 watchdog 强制 settle 释放锁后,同 session 回合 B 注册覆盖;A 的 `finally` 随后 `unregisterConversation(sessionId)` 把 **B 的 Query 删掉**。之后对 B 点 Stop / rewind 时 `getConversation` 返回 undefined,SDK 这一路 interrupt 失效——恰好复刻"Stop 无效"家族的症状。对比:`session-lock-settle.ts:55-57` 已用 lockId 做 ownership 门,registry 没有对应机制,属一致性漏洞。
- **修复思路(与 1.9 合并为单个 ownership patch,不要分散落地)**:registry 改为 `Map<sessionId, {conversation, generation}>`;`registerConversation` 返回递增 generation(或直接复用 lockId),`unregisterConversation(sessionId, generation)` 只在 generation 匹配时删除;**同一 patch** 里把 lockId 贯穿到 `collectStreamResponse`,其 session 级 DB 写入前统一校验 ownership(见 1.9)。三处(registry generation + collect 带 lockId + 写前校验)同源同改,分开落地会留下半修状态。
- **验证**:单测模拟 A 注册 → B 覆盖注册 → A 带旧 generation 反注册 → 断言 B 仍在 map;叠加 1.9 的交错 collect 断言。

### 1.3 【中】autoTrigger 回合无 watchdog 兜底,60s 续租可无限打败 TTL 自愈

- **位置**:`src/app/api/chat/route.ts:714-716`(60s 续租 600s TTL)、`:743`(watchdog 显式 `if (!autoTrigger)`)、settle 仅由 collect 的 finally 触发(`:1220`)。
- **问题**:心跳 / onboarding 等 autoTrigger 回合若底层卡死且不发终态事件,`reader.read()` 永久挂起 → finally 不执行 → 续租 interval 永久运行(60s < 600s TTL),session 永久 `SESSION_BUSY`。这是"无限续租已修"(codex-stop-recovery Phase 3)未覆盖的分支:watchdog gate 掉 autoTrigger 是有意的(后台回合不应因请求断连被杀),但没有给它替代的兜底。
- **修复思路**:不动 watchdog gate,改为给 autoTrigger 回合加**续租次数上限**(如 30 次 = 30 分钟,心跳回合远用不满)——`lockRenewalInterval` 回调里计数,超限即 `settleLock('interrupted')` 并记诊断日志。上限从回合类型推导,避免误杀合法长任务。
- **验证**:单测:mock 永不结束的 collect,fake timers 推进,断言第 N 次续租后 settle 被调用、interval 已清。

### 1.4 【中】首轮流式期间切换会话 → 完成后被 `router.push` 拽回旧会话

- **位置**:`src/app/chat/page.tsx:1203`(done 后无条件 `router.push`)、`:1207-1208`(abort 分支同样 push);发送用的 abortController(`:834`)无卸载清理 effect。
- **问题**:`/chat` 页首条消息的 SSE 在页面内联消费,期间用户切到会话 B,首轮完成后仍执行 `router.push(/chat/${session.id})` 把用户强行拉回;且脱离的 async 循环对已卸载组件持续 setState。
- **修复思路**:
  1. 组件卸载时置 `unmountedRef = true`(或直接 abort 发送 controller——注意首轮语义:后端已接收,abort 只断前端消费,消息不丢,重定向后 DB 回读即可);
  2. `router.push` 前检查 `unmountedRef`(或比较当前 pathname),用户已导航走则跳过。
- **验证**:e2e/手动:发首条消息 → 立即点侧边栏另一会话 → 等首轮完成 → 断言仍停留在 B;切回原会话消息完整。

### 1.5 【中】排队消息是 ChatView 本地 state,切换会话即静默丢失

- **位置**:`src/components/chat/ChatView.tsx:494`(`useState<QueuedMessage[]>`);`[id]/page.tsx` 以 `key={id}` 挂载 ChatView(切换 = 重挂载)。
- **问题**:流式中排队的消息只活在组件 state 里,切走再回来队列清空,消息既不显示也未发送,无任何提示。
- **修复思路**:把队列上移到 stream-session-manager,按 sessionId 分桶(与流同生命周期):`enqueueMessage(sessionId, msg)` / `drainQueue(sessionId)`;ChatView 挂载时从 manager 恢复队列渲染,dequeue effect 改为消费 manager 队列。这同时让"流在后台完成时自动补发队列"成为可能(当前离开页面期间队列也不会被处理)。若嫌改动大,最小止血:卸载时若队列非空,toast 提示"有 N 条排队消息未发送"。
- **验证**:手动:A 流式中排队一条 → 切 B → 切回 A → 断言队列仍在(或收到丢失提示)。

### 1.6 【中·安全】IPC handler 全面缺少 sender/senderFrame 校验

- **位置**:`electron/main.ts` 全部 `ipcMain.handle/on`(全仓 `senderFrame` 校验 0 处)。高权限面:`terminal:create/write`(:2234/:2243,任意 cwd 起登录 shell + 写任意命令)、`shell:open-path`(:1995)、1.1 的导出写盘。
- **问题**:主窗口加载 `http://127.0.0.1:port`,同源内容被污染(iframe / XSS)后可直接调用全部高权限 IPC,无第二道防线。
- **修复思路**:抽一个 `assertTrustedSender(event)` 工具:校验 `event.senderFrame === mainWindow.webContents.mainFrame`(拒绝子帧)且 URL origin 等于 app origin;对 terminal / shell / artifact / install 类高权限 handler 统一套用。一次性中间件式改动,几十行。
- **验证**:单测 mock event.senderFrame;手动回归终端、打开目录、导出功能。

### 1.7 【中·安全】`will-navigate` 用 `shell.openExternal` 打开外链但不校验协议

- **位置**:`electron/main.ts:1071-1078`。对比 `setWindowOpenHandler`(:1064-1070)已正确限制 http/https,两条路径不一致。
- **问题**:页面内点击 `<a href="vscode://...">`(AI 生成内容可携带)触发顶层导航时,任意 scheme 被交给 OS 协议处理器。另 `new URL(targetUrl)` 无 try/catch,畸形 URL 会抛异常。
- **修复思路**:与 `setWindowOpenHandler` 对齐——`event.preventDefault()` 后仅当 `targetUrl.startsWith('http://') || startsWith('https://')` 才 `openExternal`;整体包 try/catch。约 5 行。
- **验证**:单测协议白名单;手动点 markdown 里的 http 链接确认仍外开。

### 1.8 【中】Next server(utilityProcess)运行期崩溃后无自愈、无提示

- **位置**:`electron/main.ts:904-909`(exit 只置空 `serverProcess`)、`:1462-1464`(child-process-gone 仅记面包屑);`startServer` 只在启动期被调。
- **问题**:运行期 server 崩溃(OOM / native 模块 / 被 Codex 连累)后所有请求 connection refused,界面白屏/卡死,用户只能重启整个 App。
- **修复思路**:exit handler 里(区分正常退出 vs 崩溃)做**有限重启**:指数退避、窗口期内最多 3 次,超限弹错误页(`mainWindow.loadURL(ERROR_HTML)`)给出"重启应用"按钮。重启成功后 `mainWindow.reload()`。注意与 before-quit 的主动 killServer 区分(用现有 `quitting` 标志 gate)。
- **验证**:手动 `kill -9` server 子进程,断言自动恢复;连杀 3 次断言进入错误页而非重启风暴。

### 1.9 【中·疑似】强制 settle 接管窗口内,旧回合的落库/DB 写可污染新回合

> **与 1.2 是同一根因(registry / collect 都缺 ownership 门),必须合并成一个 patch 落地**——见 1.2 修复思路。

两条独立表现:

- **消息顺序错乱**:`route.ts:730` collect 是 fire-and-forget,watchdog 释放锁(:745,8s grace)与 collect 完成无同步;A 未真正结束时 B 拿锁发送,DB 顺序可成 user(A)、user(B)、assistant(A)、assistant(B),下一轮历史组装(`route.ts:457-486`)读到错序上下文。
- **sdk_session_id 覆盖**:collect 内 `updateSdkSessionId` / `updateSessionModel`(`route.ts:918-921/:963-965`)是 session 级写、无 lockId 门,旧回合可把 B 刚写的 sdk_session_id 覆盖回 A 的旧值 → B 下一轮 resume 到失效会话。
- **修复思路**:与 1.2 合并处理——把 lockId 传入 `collectStreamResponse`,其内部所有 session 级 DB 写(addMessage 除外可讨论)先查 `isLockOwner(sessionId, lockId)`(db 层已有 lock 表,加一个只读查询即可);失主则丢弃写入并记诊断日志。
- **验证**:单测:两个 collect 交错,断言失主写入被丢弃。

### 1.10 【低】其余确认项(修复思路从简)

| 问题 | 位置 | 修复思路 |
|------|------|----------|
| dequeue 起流失败时 `dequeuingRef` 不复位 → 队列死锁 | `ChatView.tsx:1163-1189`(仅 `if (isStreaming)` 分支复位) | dequeue effect 用 try/finally 或在 `doStartStream` 各静默 return 分支后复位;或改为 `doStartStream` 返回 boolean,false 即复位并把消息塞回队首 |
| `reconcileWithDb` 注释称"带延迟调用"但两处调用点直呼,且只保 `cmd-*` 会抹掉未落库的 `temp-*` 乐观消息(限 tail-trim 场景) | `ChatView.tsx:157/:172-179`,调用点 `:610/:1412` | merge 时同时保留 `temp-*` 中"晚于 DB 最后一条"的项;或调用点真的加 300-500ms 延迟使注释成立 |
| `seedSnapshotPatch` 占位 stream 从不 GC | `stream-session-manager.ts:1187-1226` | 注册后即 `scheduleGC` |
| `useSSEStream()` 的 proxy 层漏转发 `onSkillNudge/onContextCompressed/onFileChanged`(经此 hook 消费的流会静默丢弃技能提示/上下文压缩/文件变更事件;生产主路径走 `consumeSSEStream` 未受影响,故当前为潜伏缺陷而非线上故障) | `useSSEStream.ts:499-519` | 补齐三个转发 |
| `content.length/slice` 在必填校验前执行,非法 body 抛 500 而非 400 | `route.ts:46-49` | 校验前置两行 |
| watchdog `setTimeout` 与 abort listener 不清理(短命闭包,影响极小) | `route.ts:744-746/:433-435` | 保存句柄,settle 后 clearTimeout |
| `terminal:create` 的 cwd / id 无前置校验 | `main.ts:2234-2241` | `fs.stat` 校验目录 + id 类型校验 |
| `curl \| bash` 安装 CLI 无完整性校验(供应链信任面,备查) | `main.ts:1785/:1848` | 短期难解,至少记录;可改为下载后校验 sha 再执行 |

---

## 2. 文档滞后修正(tracker 标"未修"、代码实际已修)

| 条目 | 实际状态 | 代码证据 |
|------|----------|----------|
| #23 Sonnet 4.6 alias 映射错误 | **已修** | `provider-resolver.ts:182`、`ai-provider.ts:97`、`provider-catalog.ts:351` 均指向 `claude-sonnet-4-6`;回归测试 `opus-4-8-sonnet-4-6.test.ts:123-167` |
| #21/#22 tool/mcp token placeholder(`0` / `names*200`) | **已修**(旧假值整体重构移除) | `src/lib/harness/auto-invoke-accounting.ts:295-337` 按真实调用字节估算;`src/lib/harness/context-accounting.ts:99-106` unsupported 隐藏行。剩余债仅"per-tool schema token 未实现"(`src/lib/harness/context-compiler.ts:539-541`) |
| #43 item3 分母对齐 | **已做** | `model-context.ts:38-42` 已移除 200K 假分母;item2 为核实后的有意 defer(非 bug) |

**待办**:同步回写 `tech-debt-tracker.md` 上述条目状态(#23 勾掉、#21/#22 改为"部分:仅剩 per-tool schema 估算"、#43 标注 item3 完成)。

---

## 3. 核实仍存在的已知问题(以 tracker 为准,本文只列结论)

> 本节各问题的**竞品更优解法**(stop/abort、密钥、能力建模、崩溃恢复、Electron 安全等)见 [competitor-runtime-security-solutions-2026-07-04.md](./competitor-runtime-security-solutions-2026-07-04.md)。

以下全部经当前代码人工核读确认仍在,细节与修法见 `tech-debt-tracker.md` 对应条目:

- **#5** `/mode plan` 与 bypass 的关系(**上一版口径已按 review 修正——不是笼统"未修"**):
  - **full_access 会话覆盖 plan:已修**。`route.ts:427` 即 `bypassPermissions = session.permission_profile === 'full_access' && effectiveMode !== 'plan'`,配合 `:423` 的 `permissionMode`,用户显式选 plan 时 full_access 不再覆盖。(我上一版只读 `claude-client.ts` 未追上游 `sessionBypassPermissions` 来源,误判为未修——特此更正。)
  - **全局 `dangerously_skip_permissions` 覆盖 plan:仍在,但属产品决策而非 bug**。`claude-client.ts:800` `globalSkip = getSetting('dangerously_skip_permissions')==='true'`,`:807` 仍会把 `permissionMode` 改成 `bypassPermissions`。这是**用户手动开的全局危险开关**(语义 = "我知道我在做什么,一律跳过"),与 full_access 的会话 profile 语义不同。**待产品决策**:全局危险开关是否也应让位于显式 plan;若应,则在 `:807` 加 `&& effectiveMode !== 'plan'` 同款 gate。
- **#40** API key 明文存 SQLite(`db.ts:151/1826/1862`,全仓无 safeStorage)——**建议提级立项**:Electron `safeStorage.encryptString` 加密落库 + 读取解密 + 一次性迁移(明文行加密回写),渲染进程永不接触明文。
- **#41** effort/thinking 不分 Runtime(`agent-loop.ts:383-427` 丢弃 + toast)——修法维持 tracker 结论:capability flag 加 per-runtime 维度。
- **#49** Native loop 吞 `tool-error`(`agent-loop.ts:556-626` 无该分支)——补 `case 'tool-error'`:enqueue `tool_result` 且 `is_error: true`,POC 文件同步。
- **#2 / #8 / #39 / #24 / #7 / #17 / #626 / #633**:均核实仍在,状态与 tracker 一致。
- **phase 卡 active 结构性缺口**(codex-stop-recovery 遗留):后端 watchdog settle 只写 DB lock,不回写前端 `snapshot.phase`(前端只由 SSE 驱动)。修复思路:watchdog settle 时向 client 流(streamForClient 侧)注入一条终态 SSE 事件;或前端 force-abort 触发后由 `runStream` 的 catch 统一收敛(现状已部分覆盖,需确认 hung reader 场景 abort 能否 reject fetch——建议纳入 codex-stop-recovery Phase 4 smoke 一并验证)。
- **codex-stop-recovery**:P1-P3 代码与单测确认落地(`interrupt/route.ts:29-63` 三路 fan-out、`codex/runtime.ts:899-957` abort 监听、`session-lock-settle.ts`),**真机 smoke 仍未跑**(`_smoke-evidence/` 无证据)——这是当前最高优先的验证债。

---

## 4. 流畅性现状(直读代码结论)

**健康面**(核实无问题):IPC 全异步;better-sqlite3 在独立 utilityProcess 不阻塞 UI;streamdown 增量渲染 + Shiki LRU;消息按回合落库;曾系统性做过内存治理(见 `handover/performance-memory.md`)。

**确认的问题**:

1. **非文本流式事件零节流(中,最值得做)**:文本有 100ms 节流(`stream-session-manager.ts:421-446`),但 `onThinking:536`、`onToolResult:560`、`onToolOutput:596`、`onToolProgress:601` 每 chunk 直接 emit 全量 snapshot → ChatView 整树重渲染。热点:thinking 模型、Bash 长输出。
   **修复思路**:同文件已有 `throttledTextEmit` 模板,抽成通用 `throttledEmit(stream)`,thinking/toolOutput/toolProgress 复用(toolUse/toolResult 保持即时——它们低频且用户在等状态翻转);终态与 `onToolUse` 前保持现有 flush 语义。预计 <50 行。
   **验证**:thinking 模型长回复 + `npm install` 长输出两个场景,DevTools performance trace 对比改前后 re-render 次数。
2. **消息列表无虚拟化(高,作者拍板要做)**:`MessageList.tsx:327` 全量 map,靠 300 条硬顶(`ChatView.tsx:101`)+ memo 压制。~~暂不动~~ **2026-07-04 作者反馈:实际使用中聊天界面非常吃性能,虚拟滚动必须好好做**——用户实测推翻"硬顶+memo 够用"的判断,提级为高优先。
   **方案要点**(实现前建议先写独立执行计划,这是 Tier 2 级 UI 改动):
   - **选型(已由竞品调研收敛)**:优先 **`@tanstack/react-virtual`**。见 [competitor-chat-scroll-perf-2026-07-04.md](./competitor-chat-scroll-perf-2026-07-04.md)——OpenCode 最新版的虚拟化建立在 `@tanstack/virtual-core@3.17.0` 上,而 react-virtual 与之**共享同一 core**,OpenCode 整套打法(`anchorTo:"end"`、包装 `resizeItem` 钉行、`measureElement` 动态测高、`takeSnapshot` 缓存、offset 夹紧补丁、扁平行模型 + 身份稳定 reconcile)可作为最贴近的实现蓝本,是最短且有实证的迁移路径。`virtua` 仅理论备选(当前只在 lockfile 里作为传递依赖出现,非直接依赖,不能当直接依赖用);`react-window` 排除(动态高度弱)。聊天消息高度不定(markdown/代码块/图片),必须支持动态测量。**依赖/打包提示**:`@tanstack/react-virtual` 目前也不是 CodePilot 的直接依赖,需显式新增并验证 Next.js/Electron 的打包链路(详见竞品滚动文档 §三 依赖/打包风险)。
   - **四个必须处理的交互**:①流式气泡置底跟随(与 `use-stick-to-bottom` 的职责重叠,虚拟化后可能要自实现 stick-to-bottom 逻辑或确认二者兼容);②"加载更早"向上翻页的 scroll anchoring(prepend 时不跳动——virtua 的 shift 模式原生支持);③rewind 按钮 / 定位到某条消息的 `scrollIntoView`(`MessageList.tsx:244`);④`ScrollOnStream` 的追加滚动。
   - **落地后收益**:300 条硬顶可以放宽甚至取消(双向修剪逻辑简化),DOM 常驻节点从几百条降到视口内十几条,富代码块长会话的滚动/切换性能质变。
   - **验证**:长会话(300+ 条、大量代码块)滚动 trace 对比;翻页锚定、流式跟随、rewind 定位三个交互回归;`npm run test` + smoke。
3. **进入历史会话触发一次可见的平滑滚动动画(中,体验差,作者反馈)**:
   - **根因**:`src/components/ai-elements/conversation.tsx:17` 给 `StickToBottom` 设了 `initial="smooth"`。打开一个已有历史消息的会话时,组件初次挂载即以**平滑动画**从顶部滚到底部——用户看到列表"唰"地滚一段,而不是直接就在底部。会话越长、动画越明显。
   - **修复思路**:初次挂载用**瞬时**定位、只有后续流式/追加才用平滑。两种改法:
     1. 最小改动:把 `initial="smooth"` 改为 `initial="instant"`(或库支持的等价瞬时值),保留 `resize="smooth"` 之类的运行期平滑。首次进入直接就在底部,无动画。
     2. 若希望"首次进入停在上次阅读位置"而非底部:需要持久化每会话滚动位置(localStorage / DB),挂载时 restore,这是更大的体验改动,单独评估。
   - **注意**:此项与 §4.2 虚拟滚动强相关——虚拟化方案落地时初始定位逻辑会重写,建议**合并到虚拟滚动执行计划里一起做**,避免改两次。若虚拟滚动排期靠后,可先用改法 1 单独止血(一行)。
   - **验证**:打开一个 100+ 条历史会话,断言直接呈现在底部、无可见滚动动画;新消息追加/流式时平滑滚动仍生效。

5. **每次 emit 深拷贝工具数组**(`stream-session-manager.ts:268-269`)+ 每工具完成派发 `refresh-file-tree`(`:562`):做完节流后大概率不再显著;file-tree 事件可 debounce 500ms。
6. **首轮独立未节流 SSE 路径**(`page.tsx:983-1187`):与 1.4 是同一片代码,修 1.4 时顺带把这套重复解析收敛到 stream-session-manager(消灭双实现)。

---

## 5. 收益 / 成本分层

按"立刻修收益大 / 缓修 / 其实还好"分三层。判断依据 = 用户可感知度 × 触发频率 ÷ 修复成本。

### A. 立刻修,收益比高(小改动 / 高频可感知 / 高危)

| 事项 | 收益 | 成本 | 备注 |
|------|------|------|------|
| **进历史会话的滚动动画**(§4.3,`src/components/ai-elements/conversation.tsx:17` `initial="smooth"→"instant"`) | 高——**每次打开有历史的会话都发生**,作者已明确体验差;一行改动 | 极低(1 行) | 若虚拟滚动近期就做,合并进那个计划;否则立即单独止血 |
| **非文本 emit 节流**(§4.1) | 高——thinking 模型 / Bash 长输出高频卡顿,模板现成 | 低(<50 行) | 直接复用同文件 `throttledTextEmit` |
| **1.1 outPath 路径校验 + 1.7 will-navigate 协议白名单** | 高——唯一高危(任意路径覆盖)+ 顺手补一致性 | 极低(<20 行) | 安全面,越早越好 |
| **#5 全局 skip 是否让位 plan** | 中——权限语义,但**是产品决策不是 bug**;full_access 已修 | 极低(决策后 1 gate) | 先拍板再改 `claude-client.ts:807` |

### B. 该做但需要正经排期(中等成本 / 高价值)

| 事项 | 收益 | 成本 | 备注 |
|------|------|------|------|
| **虚拟滚动**(§4.2) | **高——作者拍板,实测很吃性能**;根治长会话卡顿,可放宽 300 硬顶 | 中-高 | **Tier 2,先写执行计划**;把 §4.3 初始定位一并纳入 |
| **codex-stop-recovery 真机 smoke** + phase 回写缺口 | 高——stop/abort 是历史最高复发区,当前最大验证债 | 中(需真实凭据) | 代码已就绪,只差跑 |
| **1.2 + 1.9 registry/collect ownership 门**(同一 patch) | 中——消三个竞态,与 settler 设计对齐 | 低-中 | 分开落地会半修 |
| **1.4 首轮导航劫持 + 1.5 排队丢失** | 中——用户可感知的体验 bug | 低 / 中 | 1.5 彻底修需把队列上移 manager |

### C. 其实还好,触发式 / 纵深防御(低频或低感知,不急)

| 事项 | 为什么不急 |
|------|-----------|
| 1.3 autoTrigger 续租上限 | 仅后台心跳卡死才触发,概率低;有 600s TTL 兜底(虽被打败但需极端条件) |
| 1.6 IPC sender 校验、1.8 server 崩溃自愈 | 纵深防御,依赖"渲染进程已被攻陷 / server 崩溃"的前置条件;做了更稳,但非当前痛点 |
| #40 safeStorage 加密 | 安全债真实,但需迁移谨慎、单独立项;非日常可感知 |
| §1.10 全部低危项(dequeue 死锁、reconcile、seedSnapshot GC、useSSEStream 漏转发、400/500、watchdog 清理、terminal cwd 校验) | 触发条件苛刻或影响极小;`content` 400/500 顺手改即可,其余攒批 |
| #41 / #49 跨 Runtime parity | 真实但非崩溃类;#49(tool-error 气泡)补一个 case 成本低,可捎带 |

### 收尾(零成本,随手做)

- §2 的 tracker 状态回写(#23 / #21/#22 / #43-item3)——消除状态失真,几分钟。
