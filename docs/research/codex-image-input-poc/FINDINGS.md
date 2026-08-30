# Codex app-server `turn/start` 图片输入格式 — POC 结论（#632 / Phase 2 #3）

> 边界：本 POC **只探格式、不改产品代码**。运行于隔离 `CODEX_HOME=/tmp/codex-image-poc/home`，从不碰真实 `~/.codex`。脚本 `probe-image-format.mjs`，原始数据 `probe-results.json` / `probe-timeline.json`。

## 背景

`src/lib/codex/runtime.ts:940` 的 `turn/start` 写死 `input: [{ type:'text', text }]`，图片附件一路从输入框传到 runtime 层后在这里被丢弃 → Codex 只收到文字。要接图片，需要 app-server `turn/start` 接受的图片块 wire format，但仓库里查不到（裸 JSON-RPC 驱动 codex 二进制，无 SDK 源）。

## 方法

app-server 是 Rust/serde，`turn/start` 参数在 **auth gate 之前** 反序列化，所以非法块会立即报 `-32600 Invalid request: ...`（且枚举合法变体 / 指明缺失字段），**无需 model auth**。逐个候选块发 `turn/start`，按"是否过 schema 校验"分类。

环境：`/Applications/Codex.app/Contents/Resources/codex`，`codex-cli 0.142.0-alpha.1`。auth：`requiresOpenaiAuth: true`（隔离 home 未登录 → 预期）。

## 结论（已确证）

**合法 input 块变体**（serde 错误直接枚举）：`text` · `image` · `localImage` · `skill` · `mention`

**图片有两种被接受的写法：**

| 写法 | 结果 | 说明 |
|---|---|---|
| `{ type: 'image', url: <dataUrl 或 https url>, detail?: null }` | ✅ ACCEPTED | 远程/Data URL 图片。`url` 必填，`detail` 可选（回显为 null）。 |
| `{ type: 'localImage', path: <绝对路径> }` | ✅ ACCEPTED | 本地文件路径。 |

server 在接受 `image` 块后把它**回显进 userMessage 内容**并随即发起模型请求：
```
item/started … content:[
  {"type":"text","text":"Describe the attached image in one word.","text_elements":[]},
  {"type":"image","detail":null,"url":"data:image/png;base64,iVBORw0KGgo…"}
]
server-stderr: ERROR codex_api … failed to connect to websocket: HTTP 401 Unauthorized … wss://api.openai.com/v1/responses
```
→ 图片确实被注入发往模型的请求；**401 仅因隔离 home 无 auth，非格式问题**。模型"真正看见并描述图片"留给后续**真实 Codex 冒烟**（用户已将其列为格式确认后的独立步骤）。

**被拒写法（排除）：**

| 写法 | 错误 |
|---|---|
| `{ type:'image', image_url: <dataUrl> }` | `missing field 'url'`（字段名是 `url` 不是 `image_url`） |
| `{ type:'image', image_url: { url } }` | `missing field 'url'` |
| `{ type:'image', image: <dataUrl> }` | `missing field 'url'` |
| `{ type:'image', path: <path> }` | `missing field 'url'`（`image` 变体不吃 path，要用 `localImage`） |
| `{ type:'input_image', image_url }` | `unknown variant 'input_image'` |
| `{ type:'local_image', path }` | `unknown variant 'local_image'`（是驼峰 `localImage`） |

## 对 runtime 修复的指引（下一步，单独做，不在本 POC 内）

`src/lib/codex/runtime.ts` 的 `turn/start` 应把 `options.runtimeOptions.files`（或等价入口）里的 image 附件转成块拼进 `input`：

- 有 base64 `data`（CodePilot FileAttachment 常见）→ `{ type:'image', url:'data:<mime>;base64,<data>' }`（无文件路径依赖，最稳）。
- 仅有持久化 `filePath` 的本地图 → `{ type:'localImage', path:<absPath> }`（避免超大 data URL）。
- 仅对 **image/\*** mime 的附件转图片块；非图片文件维持现状（另议，本 issue 只要图文）。
- 同步更新 `src/lib/codex/types.ts` 的 `CodexTurnStartParams.input` 类型（当前只类型化了 `text`）。
- guardrail：单测 pin `turn/start` 对 image 附件产出 image/localImage 块 + 文本块；真实 Codex 账号冒烟确认模型确实读到图（闭合"模型是否真的看见图片"）。
