# 生成式 UI（Generative UI）Widget 系统

## 核心思路

模型在对话中输出 ` ```show-widget ` 代码围栏，前端检测后将其渲染为交互式可视化组件（图表、示意图、计算器等），而非纯文本。复用现有"代码围栏 → 自定义组件"模式（同 `image-gen-request` / `batch-plan`），widget HTML 在 sandbox iframe 内执行。

## 目录结构

```
src/components/chat/
├── WidgetRenderer.tsx         # iframe 渲染核心：receiver 通信、高度同步、finalize、主题跟随
├── WidgetErrorBoundary.tsx    # 错误边界，widget 崩溃不影响聊天
├── StreamingMessage.tsx       # 流式消息：show-widget 围栏检测、partial code 提取、多 widget 渲染
├── MessageItem.tsx            # 持久化消息：parseAllShowWidgets() 解析、AssistantContent 渲染

src/lib/
├── widget-sanitizer.ts        # HTML 清理 + receiver iframe srcdoc 构建
├── widget-css-bridge.ts       # CSS 变量桥接（CodePilot OKLCH → widget 标准变量名）
├── widget-guidelines.ts       # 设计指南 system prompt + 按需模块组装
```

## 数据流

```
用户发送消息
  → route.ts 追加 WIDGET_SYSTEM_PROMPT 到 system prompt
  → Claude Agent SDK (preset: claude_code, append: widgetPrompt)
  → 模型输出 text delta 流

流式阶段（StreamingMessage.tsx）：
  content 变化 → 正则检测 ```show-widget
    → 无围栏：正常 <MessageResponse> 渲染
    → 围栏未闭合：
        beforePart → <MessageResponse key="pre-text">（文字保持可见）
        fenceBody → 提取 partial widget_code（手动 JSON 反转义）
        → 截断未闭合 <script>（防止 JS 代码显示为文本）
        → <WidgetRenderer key="w-N" isStreaming={true} showOverlay={scriptsTruncated}>
    → 围栏已闭合：
        parseAllShowWidgets(content) → 交替 text/widget 分段
        → <WidgetRenderer key="w-N" isStreaming={false}>

WidgetRenderer 内部：
  mount → srcdoc 构建（CSP + receiver script + CSS 变量）→ iframe 加载
    → onLoad / widget:ready → iframeReady=true
    → isStreaming=true：sanitizeForStreaming() → widget:update postMessage（120ms debounce）
    → isStreaming=false：sanitizeForIframe() → widget:finalize postMessage
      → receiver: 分离 script/visual HTML → 仅在 visual 变化时替换 → 追加 script 执行
    → widget:resize → 更新 iframeHeight + 写入高度缓存

持久化阶段（MessageItem.tsx → AssistantContent）：
  parseAllShowWidgets(displayText)
    → <WidgetRenderer key="w-N" isStreaming={false}>（从高度缓存初始化）
```

## 安全模型

三层防护：

1. **流式清理** (`sanitizeForStreaming`)：
   - 剥离：`<iframe>` `<object>` `<embed>` `<form>` `<meta>` `<link>` `<base>`
   - 剥离：所有 `on*` 事件处理器
   - 剥离：所有 `<script>` 标签
   - 剥离：`javascript:` / `data:` URL

2. **终态清理** (`sanitizeForIframe`)：
   - 仅剥离嵌套/逃逸标签（iframe/object/embed/meta/link/base/form）
   - 保留 script 和 event handler（在 sandbox 内安全执行）

3. **iframe sandbox**：
   - `sandbox="allow-scripts"`（无 allow-same-origin/allow-top-navigation/allow-popups）
   - CSP meta：`script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh`
   - `connect-src 'none'`（禁止 fetch/XHR/WebSocket）
   - 链接拦截 → postMessage → 父窗口 `window.open(href, '_blank')`

## 关键设计决策

### 代码围栏触发（非 tool_use）

CodePilot 使用 Claude Agent SDK 的 preset 模式，无法注册自定义 tool。但已有成熟的"代码围栏 → 组件"模式。Widget 复用此模式：text delta 天然支持流式传输，无需处理 `input_json_delta`。

### Receiver iframe 模式

单个 iframe 存活于 widget 全生命周期，内容通过 postMessage 推送：
- `widget:update`：流式预览（无脚本执行）
- `widget:finalize`：完整渲染（脚本执行）
- `widget:theme`：主题同步

优于每次替换 srcdoc（会触发 iframe 重加载）。

### CSS 变量桥接

`widget-css-bridge.ts` 将 CodePilot 的 OKLCH 主题变量映射为 Anthropic 指南中的标准变量名：
```
--color-background-primary   → var(--background)
--color-text-primary          → var(--foreground)
--color-border-tertiary       → var(--border)
```
模型按指南写的 CSS 直接使用 CodePilot 主题色，深色/浅色自动切换。

### System Prompt 注入

- `WIDGET_SYSTEM_PROMPT`（~2.5KB）始终注入，告诉模型何时/如何生成 widget
- 完整模块指南（diagram/chart/interactive 等）通过 `getGuidelines()` 按需组装
- 不增加太多 context 开销

## UX 优化清单

| 问题 | 原因 | 修复 |
|------|------|------|
| 文字消失 | `parseAllShowWidgets` 对纯文本返回 `[]` | 无围栏时直接渲染 `<MessageResponse>` |
| 高度跳动（首次） | iframe 从 0px 跳到实际高度 | 首次 resize 跳过 CSS transition |
| 高度闪烁（finalize） | `innerHTML` 替换瞬间清空 DOM | `heightLockedRef` 锁定 + 仅增长 |
| 滚动回跳（remount） | streaming→persisted 组件重挂载 | 模块级高度缓存 `_heightCache` |
| Script 代码显示为文本 | `</script>` 未到达时开标签被剥离 | 在 partial code 层截断未闭合 script |
| Finalize 重绘闪烁 | `innerHTML` 整体替换触发重绘 | 分离 script/visual，visual 相同则跳过替换 |
| iframe ready 竞态 | `useEffect` 监听晚于 `widget:ready` | iframe `onLoad` 回调兜底 |
| React remount（wrapper div） | overlay 外包 div 改变组件树 | overlay 移入 WidgetRenderer 内部（`showOverlay` prop） |
| React key 不稳定 | partial→closed 路径 key 变化 | `partialWidgetKey` 与 `parseAllShowWidgets` 索引对齐 |

## 已知限制

1. **第三方 API Provider**：部分三方 provider 不处理 SDK 的 `appendSystemPrompt` 字段，模型收不到 widget 指令 → 退化为纯文本。必须使用官方 API。
2. **Widget 大小限制**：system prompt 建议每个 widget ≤ 3000 chars，但不强制。过大的 widget 可能导致流式体验下降。
3. **CDN 脚本加载**：Chart.js 等 CDN 库需要网络加载，首次可能较慢。有 shimmer overlay 缓解感知等待。
4. **高度缓存 key**：使用 widgetCode 前 200 字符作为 key，极端情况下可能碰撞（概率极低）。

## 涉及文件完整清单

| 文件 | 作用 |
|------|------|
| `src/components/chat/WidgetRenderer.tsx` | iframe 渲染核心 |
| `src/components/chat/WidgetErrorBoundary.tsx` | 错误边界 |
| `src/components/chat/StreamingMessage.tsx` | 流式 widget 检测与渲染 |
| `src/components/chat/MessageItem.tsx` | 持久化 widget 渲染（AssistantContent + parseAllShowWidgets） |
| `src/components/chat/ChatView.tsx` | `__widgetSendMessage` 桥接（widget 内按钮触发追问） |
| `src/lib/widget-sanitizer.ts` | HTML 清理 + receiver srcdoc |
| `src/lib/widget-css-bridge.ts` | CSS 变量映射 |
| `src/lib/widget-guidelines.ts` | 设计指南 + system prompt |
| `src/app/api/chat/route.ts` | system prompt 注入（lines 318-324） |
| `src/lib/claude-client.ts` | SDK preset append（line 493-501） |
| `src/app/globals.css` | `widget-shimmer` keyframes |
| `src/i18n/en.ts` / `zh.ts` | widget.* 翻译 key |
