# New-chat Greeting — time + context aware

> 产品思考见 [docs/insights/new-chat-greeting.md](../insights/new-chat-greeting.md)

## 是什么

新对话页 / 空会话页 composer 上方的欢迎语，从「随机 6 句通用问句」升级为
「{时段问候}{分隔}{场景问句}」的组合，对**时间**和**场景**敏感。实现在
`src/components/chat/NewChatWelcome.tsx`。

## 组成逻辑

`欢迎语 = 时段问候 + 分隔符 + 场景问句`

- **时段问候**（读 `new Date().getHours()`）：morning 5–11 / afternoon 12–17 /
  evening 18–22 / night 23–4 → `chat.newChat.greet.{morning|afternoon|evening|night}`。
- **场景问句**（优先级 `assistant > project > general`，命中即止；池内随机选一句）：
  - assistant：`chat.newChat.welcome.assistant.1..3`（陪伴语气）。
  - project：`chat.newChat.welcome.project.1..3`，项目名（working dir basename）
    经 `t(key, { project })` 插值进句子。
  - general：`chat.newChat.welcome.1..6`（通用；问句**不含时间词**，避免和问候重复）。
- **分隔符** `chat.newChat.greet.sep`：zh `，` / en `. `。en 问句首字母大写，读作问候后的第二句
  （"Good morning. Back to {project}?"）。

i18n key 在 `src/i18n/en.ts` + `zh.ts` 同步维护，仅 `NewChatWelcome.tsx` 消费。

## 上下文从哪来

`NewChatWelcome` 接 props `{ workingDir?, isAssistant? }`：

| 调用点 | 传入 | 结果 |
|---|---|---|
| `src/app/chat/page.tsx`（新空白页） | `workingDir`（本地 state，来自 last-working-directory / `/api/setup` defaultProject） | project / general（**不传 isAssistant**） |
| `src/components/chat/ChatView.tsx`（已有会话空状态） | `workingDir={workingDirectory}` + `isAssistant={isAssistantProject}`（ChatView 经 `/api/settings/workspace` 比对算出） | 助理工作区会出助理语气 |

## SSR / 水合（关键约束，勿动）

时段、场景、随机选句**全在 client-only `useEffect` 里决定**。首屏（SSR + 首次 client
render）`greeting` 初始为 `null` → fallback 到中性问句 `welcome.1`；effect 跑完
`setGreeting` 换成组合句。server / client 首屏因此一致，规避历史上
`useMemo(() => Math.random())` 两次取值不同导致的水合 mismatch（其 console 噪音曾
干扰 Phase 7b vibrancy smoke）。**不要把非确定计算挪回 render。**

## 验证

- `npm run test`（typecheck + unit）通过。
- live dev（:3001）实测渲染 `晚上好，opus-4.6-test 接下来做点什么？`（时段=晚上、
  project 名注入），**0 水合告警、0 console error**。

## 已知局限

- 新空白 `/chat` 页不识别助理工作区（判断需额外 fetch `/api/settings/workspace`
  比对 workingDir，成本高，未接）→ 该页只走 project/general。要补：在 page.tsx
  fetch workspace path 比对，或把检测下沉进 `NewChatWelcome`。
