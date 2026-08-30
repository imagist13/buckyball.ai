# 在桌面端复刻 Claude 的生成式 UI：从方案设计到体验打磨

## 这个能力是什么

生成式 UI 让 AI 不再只输出文字。当你问"解释一下 LLM 的训练流程"，模型可以在对话中直接输出一张交互式流程图；问"最近的销售数据趋势"，它会给你一个可以拖动时间轴的 Chart.js 图表。

这些不是预置的模板，而是模型根据对话内容**实时生成**的 HTML/SVG/JavaScript 代码，嵌入在聊天消息中渲染。每次生成的内容都不一样，完全取决于用户问的问题。

### 具体能做什么

- **SVG 示意图**：流程图、时间线、层级结构、对比图、循环图——模型根据内容自动选择最合适的图表类型
- **交互式图表**：基于 Chart.js 的折线图、柱状图、饼图，支持滑块控制、数据切换等交互
- **计算器/工具**：带滑块和实时计算结果的小工具，比如贷款计算器、单位换算
- **多 Widget 叙事**：一个回复中可以穿插多个 widget 和文字，用不同类型的可视化从多个角度解释一个复杂话题
- **钻取交互**：点击图表中的节点，自动发送一条追问消息，深入了解细节

### 好处

1. **信息密度高**：一张好的图表抵得上几百字的描述，理解效率指数级提升
2. **交互探索**：不是静态截图，是可以点击、拖动、切换的活组件
3. **零配置**：不需要用户主动开启，模型自主判断何时适合使用可视化
4. **主题融合**：widget 自动继承应用的深色/浅色主题，视觉上浑然一体
5. **持久化**：切换聊天再回来，widget 会重新渲染，不会丢失

## Claude.ai 的原始方案

Claude.ai 官方的生成式 UI（artifacts/canvas）使用的是 **tool_use 机制**：模型调用一个专用 tool 来输出结构化的 widget 内容，前端解析 tool 调用的 input 参数来渲染。

这个方案在 Claude.ai 的架构下工作得很好，但在 CodePilot 的场景下有几个问题：

1. **SDK 限制**：CodePilot 使用 Claude Agent SDK 的 `preset: 'claude_code'` 模式，无法注册自定义 tool。SDK 暴露的是 text delta 流，不支持在 tool 层面扩展。
2. **流式体验**：tool_use 的结果需要完整的 `input_json_delta` 拼接完成后才能渲染，不支持 HTML 的增量渲染。而代码围栏方式下，HTML 随文本流式到达，可以做到边生成边预览。
3. **渲染隔离**：Claude.ai 使用 Shadow DOM 做隔离，我们选择了 sandbox iframe。iframe 的隔离更彻底——完全独立的 JS 执行环境，CSP 可以精确控制资源加载，不存在样式泄漏和脚本逃逸的风险。

## 我们的实现方案

### 触发机制：代码围栏

模型输出一段特殊的 Markdown 代码围栏来触发 widget 渲染：

````
```show-widget
{"title":"training_flow","widget_code":"<svg width=\"100%\" viewBox=\"0 0 680 400\">...</svg>"}
```
````

这个格式复用了 CodePilot 已有的代码围栏模式（`image-gen-request`、`batch-plan` 等），前端的 parser 链天然支持。

### 渲染架构：Receiver iframe

每个 widget 渲染在一个 `sandbox="allow-scripts"` 的 iframe 中。iframe 的 srcdoc 是一个精心构建的"receiver"页面，包含：

- **CSP 策略**：只允许 4 个 CDN 域名的外部脚本，禁止所有网络请求（`connect-src 'none'`）
- **消息监听**：通过 postMessage 接收内容更新，分为流式预览（`widget:update`，不执行脚本）和终态渲染（`widget:finalize`，执行脚本）
- **高度同步**：ResizeObserver 监听内容高度变化，通过 postMessage 报告给父页面
- **链接拦截**：所有 `<a>` 点击被拦截，通过 postMessage 转发给父页面在新窗口打开
- **主题同步**：监听父页面的 `class` 变化，实时切换深色/浅色模式

### CSS 变量桥接

这是让 widget 与应用视觉融合的关键。CodePilot 使用 OKLCH 色彩空间的 CSS 变量，而 Anthropic 的 widget 设计指南使用 `--color-background-primary` 这样的标准变量名。

桥接层在 iframe 初始化时将 CodePilot 的变量值注入 iframe 的 `:root`，模型按指南写的 CSS 就能直接使用当前主题的颜色。深色模式切换时，父页面检测到 `class` 变化，重新计算变量值并推送给 iframe。

### 流式渲染

widget 的流式体验是整个实现中最复杂的部分。因为模型是逐 token 生成的，我们在任意时刻收到的 widget 代码都可能是不完整的 JSON、不完整的 HTML、不完整的 `<script>` 标签。

处理流程：

1. **围栏检测**：正则匹配 ` ```show-widget `，区分"未闭合"和"已闭合"状态
2. **Partial JSON 提取**：手动定位 `"widget_code":"` 后的内容，逐字符反转义（不能用 `JSON.parse`，因为 JSON 不完整）
3. **Script 截断**：检测到未闭合的 `<script>` 标签时，在 `<script` 之前截断，避免 JavaScript 代码显示为可见文本
4. **防抖更新**：120ms debounce 避免过于频繁的 iframe 更新
5. **安全清理**：流式内容剥离所有脚本和事件处理器（预览阶段不需要交互）

## 体验优化：那些"不应该被注意到"的细节

一个好的体验往往意味着用户根本不会注意到它的存在。以下是我们解决的一系列微妙的体验问题：

### 文字消失问题

**现象**：模型先输出一段介绍文字（"我来为你可视化解释..."），然后开始输出 widget 围栏。当围栏出现时，前面的文字突然消失，直到 widget 渲染完成才回来。

**原因**：`parseAllShowWidgets()` 函数对纯文本（不含任何 widget 围栏的字符串）返回空数组。当围栏刚出现但尚未闭合时，围栏前的文字被传入这个函数，结果被丢弃了。

**修复**：检测到围栏前的文本不含已完成的 widget 围栏时，直接渲染为 `<MessageResponse>`，绕过解析函数。

### 高度跳变

**现象**：widget 渲染完成的瞬间，整个聊天区域会抖一下。

**原因**：iframe 初始高度为 0px，当内容第一次报告实际高度时（可能是 400px+），CSS transition 让这个变化在 300ms 内完成，造成明显的动画跳变。

**修复**：首次高度报告时临时禁用 CSS transition，让高度瞬间到位。只在后续高度微调时才使用平滑过渡。

### Finalize 闪烁

**现象**：widget 从流式预览切换到最终渲染时，内容会闪一下。

**原因**：receiver iframe 在 finalize 时执行 `root.innerHTML = html` 整体替换 DOM。即使新旧内容完全相同（纯 SVG widget），浏览器也会触发一帧重绘。

**修复**：finalize 时先将新 HTML 解析到临时容器中，分离出 script 元素。比较去掉 script 后的 visual HTML 与当前 DOM——如果相同则跳过 innerHTML 替换，直接追加 script 执行。对于 SVG widget 实现了零重绘 finalize。

### 滚动位置回跳

**现象**：聊天正在自动滚动到底部，突然跳回到几百像素之前的位置，然后再跳回来。

**原因**：streaming 结束时，`StreamingMessage` 组件卸载，`MessageItem` 组件挂载。这是两个完全不同的 React 组件，内部的 `WidgetRenderer` 会被销毁并重新创建。新实例的 iframe 高度从 0 开始，造成内容区高度骤降，`use-stick-to-bottom` 的滚动追踪检测到高度变化，触发滚动调整。

**修复**：模块级高度缓存。每当 widget 报告高度时，以 widgetCode 前 200 字符为 key 写入缓存。新的 WidgetRenderer 实例在 `useState` 初始化时从缓存读取高度，iframe 以正确的高度开始渲染，不存在 0→实际的过渡。

### Script 代码泄露

**现象**：带 Chart.js 的 widget 在加载时，底部会显示一大段 JavaScript 代码作为可见文本。

**原因**：模型输出的 `<script>` 标签在流式传输中被逐字符接收。当 `<script>` 开标签到达但 `</script>` 关闭标签未到时，`sanitizeForStreaming` 剥离了开标签，但标签内的 JavaScript 代码变成了裸文本节点，被浏览器渲染为可见内容。

**修复**：在 StreamingMessage 的 partial code 提取后，检测最后一个 `<script` 是否有匹配的 `</script>`。如果没有，在 `<script` 位置截断 partial code。由于 widget 指南规定 script 始终放在最后，截断不会影响视觉内容。截断期间展示 shimmer 遮罩，状态栏显示"正在为可视化添加交互动画"。

### iframe Ready 竞态

**现象**：极少数情况下 widget 完全不渲染，停在 0px 高度。

**原因**：WidgetRenderer 通过 `useEffect` 注册 `message` 事件监听。但 iframe 的 receiver script 在加载完成后立刻发送 `widget:ready`。如果 iframe 加载速度快于 React effect 执行，`widget:ready` 在监听器注册之前就已发出，`iframeReady` 永远不会变成 `true`。

**修复**：在 iframe 元素上添加 `onLoad` 回调作为兜底。`onLoad` 触发时 receiver script 必然已执行完毕，是可靠的就绪信号。

### React 组件树稳定性

**现象**：widget 在围栏闭合瞬间闪烁一次。

**原因**：两个独立的问题导致 React 重新挂载 iframe：
1. 流式 partial widget 没有 React key，闭合后获得 `key="w-0"` → key 变化导致 remount
2. shimmer overlay 用外包 `<div>` 实现，改变了组件树结构 → type 变化导致 remount

**修复**：
1. 给 partial widget 计算稳定的 key（`w-N`，N 为在最终 segments 数组中的预期位置），与闭合后的 key 一致
2. shimmer overlay 移入 WidgetRenderer 内部，通过 `showOverlay` prop 控制，组件树始终为 `<WidgetRenderer key="w-N">`

## 技术总结

整个生成式 UI 系统的核心挑战不是"让一段 HTML 在 iframe 里跑起来"——那很简单。真正的复杂度在于：让这个 iframe 在流式传输、组件生命周期切换、主题变化等各种状态转换中**保持视觉稳定**。每一个"闪一下""跳一下""消失一下"都需要深入理解 React 的 reconciliation、浏览器的渲染管线、以及 `postMessage` 的时序特性。

最终的效果是：用户看到模型的回复中自然地穿插着图表和示意图，就像它们本来就应该在那里一样。
