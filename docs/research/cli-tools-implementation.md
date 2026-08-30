# 深度调研：CLI Tools 独立实现

> 调研日期：2026-04-06
> 状态：完成

## 1. Claude Code 核心工具（8 个）详细 Schema 和执行逻辑

### 1.1 FileReadTool (Read)

**Input Schema:**
```typescript
z.strictObject({
  file_path: z.string(),       // 绝对路径
  offset: z.number().int().nonnegative().optional(),  // 起始行号
  limit: z.number().int().positive().optional(),       // 读取行数
  pages: z.string().optional(), // PDF 页码范围，如 "1-5"
})
```

**执行逻辑：**
- 支持 6 种输出类型：text、image、notebook、pdf、parts、file_unchanged
- 文本文件：按行读取，添加行号前缀（`cat -n` 格式），支持 offset/limit 分页
- 图片文件（png/jpg/gif/webp）：读取为 base64，可压缩/缩放，返回 image source block
- PDF：支持 pages 参数指定页码范围，转为 base64 或拆分为图片
- Notebook（.ipynb）：解析 cells 返回结构化输出
- 二进制文件：拒绝读取（PDF/图片除外）
- 文件不存在时：建议相似文件名
- Token 限制：超过 maxTokens 时报错，提示用 offset/limit

**安全边界：**
- 屏蔽设备文件（/dev/zero, /dev/random 等防止挂起）
- UNC 路径检查（防止 NTLM 凭据泄漏）
- 权限系统对接：deny rule 阻止特定目录
- 记录 readFileState 时间戳用于写入冲突检测

**关键特征：**
- `maxResultSizeChars: Infinity`（不做持久化，避免循环读取）
- `isConcurrencySafe: true`（可并发执行）
- `isReadOnly: true`

---

### 1.2 FileWriteTool (Write)

**Input Schema:**
```typescript
z.strictObject({
  file_path: z.string(),  // 绝对路径
  content: z.string(),    // 完整文件内容
})
```

**执行逻辑：**
- 完整文件内容替换（非增量）
- 写入前检查文件是否已被读取过（readFileState）
- 检查文件是否在读取后被外部修改（mtime 比较）
- 自动创建父目录
- 写入后更新 readFileState 时间戳
- 返回 create/update 两种类型，update 时附带 structuredPatch（diff）
- 支持文件历史备份（fileHistoryTrackEdit）

**安全边界：**
- 必须先 Read 才能 Write（防止覆盖未知内容）
- 并发安全：mtime + content 双重检查
- UNC 路径保护

---

### 1.3 FileEditTool (Edit)

**Input Schema:**
```typescript
z.strictObject({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),  // 默认 false
})
```

**执行逻辑：**
- 查找 old_string 并替换为 new_string
- `old_string === ""` 且文件不存在 → 创建新文件
- `old_string === ""` 且文件存在但为空 → 写入内容
- 多次匹配时：replace_all=false 则报错，要求更多上下文
- 引号规范化：`findActualString()` 处理 curly quotes vs straight quotes 差异
- 写入前进行并发冲突检测（同 Write）
- 生成 structuredPatch 展示变更

**容错机制（OpenCode 实现更激进）：**
- Claude Code：精确匹配 + 引号规范化
- OpenCode：8 层 Replacer 级联回退（精确 → 行 trim → 块锚点 → 空白规范化 → 缩进弹性 → 转义规范化 → 边界 trim → 上下文感知 → 多次出现）

---

### 1.4 BashTool (Bash)

**Input Schema:**
```typescript
z.strictObject({
  command: z.string(),
  timeout: z.number().optional(),       // 毫秒，默认 120000
  description: z.string().optional(),   // 命令描述
  run_in_background: z.boolean().optional(),
  dangerouslyDisableSandbox: z.boolean().optional(),
})
```

**执行逻辑（极其复杂，是所有工具中最复杂的）：**
- 通过 `exec()` 调用系统 shell 执行命令
- 支持超时控制（最大 10 分钟）
- 支持后台运行（`run_in_background`）
- 输出截断：超大输出保存到磁盘，返回预览 + 文件路径
- 命令语义分析：识别搜索/读取/列表/静默命令
- 追踪 stdout/stderr，合并输出
- 支持沙箱模式
- 检测 `sed -i` 等隐式文件修改

**安全边界（权限系统最重要的部分）：**
- 命令解析和分类（destructive、read-only、open-world）
- 权限匹配：支持 wildcard pattern（如 `git *`）
- 路径验证：拒绝在不安全路径执行
- 模式验证：read-only 模式下拦截写入命令

---

### 1.5 GlobTool (Glob)

**Input Schema:**
```typescript
z.strictObject({
  pattern: z.string(),        // glob 模式
  path: z.string().optional(), // 搜索目录，默认 cwd
})
```

**执行逻辑：**
- 调用内部 `glob()` 函数（基于 fast-glob 或类似库）
- 默认限制 100 个结果
- 结果按修改时间排序
- 路径相对化（节省 token）
- 验证 path 是否为存在的目录

**输出：**
```typescript
{
  filenames: string[],
  durationMs: number,
  numFiles: number,
  truncated: boolean,
}
```

---

### 1.6 GrepTool (Grep)

**Input Schema:**
```typescript
z.strictObject({
  pattern: z.string(),                // 正则表达式
  path: z.string().optional(),        // 搜索路径，默认 cwd
  glob: z.string().optional(),        // 文件过滤
  output_mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
  '-B': z.number().optional(),        // before context
  '-A': z.number().optional(),        // after context
  '-C': z.number().optional(),        // context
  context: z.number().optional(),
  '-n': z.boolean().optional(),       // 行号
  '-i': z.boolean().optional(),       // 大小写不敏感
  type: z.string().optional(),        // 文件类型
  head_limit: z.number().optional(),  // 结果数限制，默认 250
  offset: z.number().optional(),      // 分页偏移
  multiline: z.boolean().optional(),  // 多行模式
})
```

**执行逻辑：**
- 底层调用 ripgrep（`rg`）命令
- 自动排除 .git/.svn/.hg 等 VCS 目录
- 限制行长度 500 字符
- 三种输出模式：内容、文件匹配、计数
- files_with_matches 模式：按 mtime 排序
- 支持 ignore patterns（从权限系统获取）
- 分页支持（head_limit + offset）

---

### 1.7 WebFetchTool (WebFetch)

**Input Schema:**
```typescript
z.strictObject({
  url: z.string().url(),
  prompt: z.string(),  // 对抓取内容的处理提示
})
```

**执行逻辑：**
- 抓取 URL 内容，转为 markdown
- **关键**：使用 `applyPromptToMarkdown()` 对内容做 LLM 摘要（调用小模型处理）
- 支持重定向检测（跨域重定向返回提示而非自动跟随）
- 预批准域名列表（官方文档等不需要 LLM 处理）
- 二进制内容（PDF 等）保存到磁盘
- 权限检查：按 hostname 授权

**OpenCode 实现更简单：**
- 直接 fetch + turndown 转 markdown，不做 LLM 摘要
- 支持 text/markdown/html 三种输出格式
- 图片返回 base64 附件

---

### 1.8 WebSearchTool (WebSearch)

**Input Schema:**
```typescript
z.strictObject({
  query: z.string().min(2),
  allowed_domains: z.array(z.string()).optional(),
  blocked_domains: z.array(z.string()).optional(),
})
```

**执行逻辑（Claude Code 特殊实现）：**
- **不是普通工具**：调用 Anthropic API 的 `web_search_20250305` server tool
- 向 Anthropic API 发送一个子请求，携带 web_search tool schema
- API 端执行搜索，返回搜索结果 + 文本摘要
- 解析 streaming 响应中的 `server_tool_use` 和 `web_search_tool_result` blocks

**OpenCode 实现（Exa API）：**
- 调用 Exa MCP API（`https://mcp.exa.ai/mcp`）
- 通过 JSON-RPC 调用 `web_search_exa` 工具
- 支持 numResults、livecrawl、type、contextMaxCharacters 参数

---

## 2. OpenCode 的工具架构

### 2.1 Tool 定义格式

```typescript
// Tool.define(id, init | config)
Tool.define("bash", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({...}),  // Zod schema
    async execute(args, ctx) {    // 执行函数
      // ctx.sessionID, ctx.messageID, ctx.abort, ctx.ask(), ctx.metadata()
      return {
        title: string,
        metadata: Record<string, any>,
        output: string,
        attachments?: FilePart[],
      }
    },
  }
})
```

### 2.2 与 AI SDK 集成方式

```typescript
// session/prompt.ts 中的转换
for (const item of await ToolRegistry.tools(model, agent)) {
  const schema = ProviderTransform.schema(model, z.toJSONSchema(item.parameters))
  tools[item.id] = tool({
    id: item.id,
    description: item.description,
    inputSchema: jsonSchema(schema),
    async execute(args, options) {
      const ctx = context(args, options)
      const result = await item.execute(args, ctx)
      return result
    },
  })
}
```

**核心转换链：**
1. `Tool.Info.parameters`（Zod schema）→ `z.toJSONSchema()` → JSON Schema
2. JSON Schema → `ProviderTransform.schema()` → 适配特定模型的 schema
3. 包装为 AI SDK 的 `tool({ inputSchema: jsonSchema(...), execute })` 格式

### 2.3 输出截断

```typescript
// tool.ts 中自动截断
const truncated = await Truncate.output(result.output, {}, initCtx?.agent)
return {
  ...result,
  output: truncated.content,
  metadata: { truncated: truncated.truncated, outputPath: truncated.outputPath },
}
```

---

## 3. Vercel AI SDK Tool 定义格式

### 3.1 核心类型

```typescript
type Tool<INPUT, OUTPUT> = {
  description?: string;
  title?: string;
  providerOptions?: ProviderOptions;
  inputSchema: FlexibleSchema<INPUT>;  // jsonSchema() 或 zodSchema()
  inputExamples?: Array<{ input: INPUT }>;
  needsApproval?: boolean | ((input) => Promise<boolean>);
  strict?: boolean;

  // 执行函数（三选一）
  execute?: (input: INPUT, options: ToolExecutionOptions) => Promise<OUTPUT>;
  outputSchema?: FlexibleSchema<OUTPUT>;

  // Streaming 钩子
  onInputStart?: (options: ToolExecutionOptions) => void;
  onInputDelta?: (options: { inputTextDelta: string }) => void;
  onInputAvailable?: (options: { input: INPUT }) => void;

  // 输出转换
  toModelOutput?: (options: { toolCallId, input, output }) => ToolResultOutput;
}
```

### 3.2 创建工具

```typescript
import { tool, jsonSchema, zodSchema } from 'ai';

// 方式 1：使用 jsonSchema
const myTool = tool({
  description: 'description',
  inputSchema: jsonSchema({
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  }),
  execute: async (input, { abortSignal, toolCallId }) => {
    return { result: '...' };
  },
});

// 方式 2：使用 zodSchema（推荐）
const myTool = tool({
  description: 'description',
  inputSchema: zodSchema(z.object({ path: z.string() })),
  execute: async (input) => { ... },
});
```

### 3.3 在 streamText 中使用

```typescript
import { streamText } from 'ai';

const result = streamText({
  model: provider(modelId),
  messages,
  tools: {
    read: readTool,
    write: writeTool,
    bash: bashTool,
    // ...
  },
  maxSteps: 50,  // Agent loop 最大步数
  toolChoice: 'auto',
  onStepFinish: (step) => {
    // 每步完成回调，包含 tool_call 和 tool_result
  },
});
```

### 3.4 `needsApproval` 机制

```typescript
const bashTool = tool({
  inputSchema: zodSchema(z.object({ command: z.string() })),
  needsApproval: async (input) => {
    // 动态判断是否��要用户批准
    return isDangerousCommand(input.command);
  },
  execute: async (input) => { ... },
});
```

当 `needsApproval` 返回 true 时，streamText 会在步骤结果中暂停，需要客户端处理批准/拒绝逻辑。

---

## 4. 每个工具的自建实现方案

### 4.1 FileReadTool — 复杂度：中

**核心依赖：**
- `fs/promises` — 文件读取
- `readline` — 按行读取
- 行号添加：`${lineNumber}\t${line}` 格式

**实现要点：**
```typescript
export const readTool = tool({
  description: 'Read a file...',
  inputSchema: zodSchema(z.object({
    file_path: z.string(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  })),
  async execute({ file_path, offset = 1, limit = 2000 }) {
    const content = await fs.readFile(file_path, 'utf-8');
    const lines = content.split('\n');
    const sliced = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = sliced.map((line, i) => `${offset + i}\t${line}`);
    return numbered.join('\n');
  },
});
```

**边界情况：**
- 大文件（>10MB）：强制要求 offset/limit
- 二进制检测：检查前 4096 字节中 null byte 和非打印字符比例
- 编码检测：UTF-8 + UTF-16LE BOM 检测
- 图片/PDF：需要 sharp 或 pdf.js 库支持（可后期添加）
- 目录读取：返回 `readdir` 结果

**可简化的部分：**
- 初版不需要图片/PDF/Notebook 支持
- 不需要 CLAUDE.md 自动注入
- 不需要 LSP 集成
- 不需要 file_unchanged 优化

---

### 4.2 FileWriteTool — 复杂度：低

**核心依赖：**
- `fs/promises` — 写文件
- `diff` 库 — 生成 diff 输出

**实现要点：**
```typescript
async execute({ file_path, content }) {
  const dir = path.dirname(file_path);
  await fs.mkdir(dir, { recursive: true });

  let oldContent: string | null = null;
  try {
    oldContent = await fs.readFile(file_path, 'utf-8');
  } catch {}

  await fs.writeFile(file_path, content, 'utf-8');
  return oldContent
    ? `File updated: ${file_path}`
    : `File created: ${file_path}`;
}
```

**必须实现的安全检查：**
- 文件是否已被读取（维护 readState Map）
- 文件是否在读取后被修改（mtime 检查）

---

### 4.3 FileEditTool — 复杂度：中高

**核心依赖：**
- 字符串查找替换
- `diff` 库 — 生成 patch

**实现要点：**
- 精确匹配 + replace/replaceAll
- 多次匹配但 replace_all=false 时报错
- old_string 为空 + 文件不存在 → 创建文件

**推荐采用 OpenCode 的多层 Replacer 策略：**
1. SimpleReplacer — 精确匹配
2. LineTrimmedReplacer — 行级 trim 后匹配
3. BlockAnchorReplacer — 首尾行锚定 + 中间相似度
4. WhitespaceNormalizedReplacer — 空白规范化
5. IndentationFlexibleReplacer — 缩进弹性
6. EscapeNormalizedReplacer — 转义字符规范化

这大幅提高编辑成功率，是 OpenCode 的核心优势之一。

---

### 4.4 BashTool — 复杂度：高

**核心依赖：**
- `child_process.spawn()` — 命令执行
- shell 检测（zsh/bash/sh）

**实现要点：**
```typescript
async execute({ command, timeout = 120000, description }) {
  const proc = spawn(command, {
    shell: detectShell(),
    cwd: projectDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  proc.stdout.on('data', chunk => { output += chunk.toString(); });
  proc.stderr.on('data', chunk => { output += chunk.toString(); });

  // 超时处理
  const timer = setTimeout(() => killTree(proc), timeout);

  await new Promise((resolve, reject) => {
    proc.once('exit', resolve);
    proc.once('error', reject);
  });

  clearTimeout(timer);
  return output;
}
```

**关键实现难点：**
1. **进程树 kill**：需要 `kill(-pid, 'SIGTERM')` 或平台特定方式
2. **输出截断**：超大输出需要截断（OpenCode 用 `Truncate.output()`，设有 MAX_LINES 和 MAX_BYTES）
3. **超时控制**：超时时优雅终止进程并报告
4. **后台运行**：detach 进程，后续通过 Read 查看输出文件
5. **abort 信号**：用户中断时终止进程

**权限是 BashTool 最核心的问题：**
- OpenCode：tree-sitter 解析命令 AST，提取命令名和参数，按模式匹配权限
- Claude Code：复杂的 bashSecurity/bashPermissions 系统
- 我们的方案：`needsApproval` 机制 + 前端权限 UI

---

### 4.5 GlobTool — 复杂度：低

**核心依赖：**
- `fast-glob` 或 `globby` npm 包
- 或调用 `rg --files --glob` (ripgrep)

**实现要点：**
```typescript
async execute({ pattern, path: searchPath }) {
  const cwd = searchPath || projectDir;
  const files = await glob(pattern, {
    cwd,
    absolute: true,
    dot: true,
    ignore: ['.git', 'node_modules'],
  });
  // 按 mtime 排序
  const withStats = await Promise.all(files.map(async f => ({
    path: f,
    mtime: (await fs.stat(f)).mtimeMs,
  })));
  withStats.sort((a, b) => b.mtime - a.mtime);
  const limited = withStats.slice(0, 100);
  return limited.map(f => f.path).join('\n');
}
```

**依赖选择：**
- `fast-glob` (推荐)：纯 JS，无需 ripgrep 二进制
- 或 OpenCode 方式：调用 `rg --files --glob` (需要 ripgrep 安装)

---

### 4.6 GrepTool — 复杂度：中

**核心依赖：**
- ripgrep (`rg`) 二进制 — 必须

**实现要点：**
```typescript
async execute({ pattern, path: searchPath, include }) {
  const args = ['-nH', '--hidden', '--no-messages', pattern];
  if (include) args.push('--glob', include);
  args.push(searchPath || projectDir);

  const proc = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const output = await text(proc.stdout);
  return output || 'No matches found';
}
```

**ripgrep 安装问题：**
- macOS：通过 `brew install ripgrep` 或打包内嵌 `@vscode/ripgrep`
- Windows：通过 `choco install ripgrep` 或内嵌二进制
- 降级方案：用 Node.js 原生 `fs.readdir` + `RegExp` 实现（性能差但可用）

---

### 4.7 WebFetchTool — 复杂度：中低

**核心依赖：**
- `fetch` API（Node.js 内置）
- `turndown` — HTML 转 Markdown

**实现要点（建议采用 OpenCode 简化版）：**
```typescript
async execute({ url, format = 'markdown' }) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'CodePilot/1.0' },
  });
  const html = await response.text();

  if (format === 'markdown') {
    const turndown = new TurndownService();
    return turndown.turndown(html);
  }
  return html;
}
```

**不建议实现 Claude Code 的 LLM 摘要功能：**
- 需要额外 API 调用，增加延迟和成本
- 让主模型自己从 markdown 中提取信息更简单
- OpenCode 方式更实用

---

### 4.8 WebSearchTool — 复杂度：高（方案选择重要）

**三种实现方案：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. Anthropic web_search server tool | 与 Claude 原生集成 | 只支持 Anthropic API |
| B. Exa API (OpenCode 方式) | 跨模型通用 | 需要 Exa API key |
| C. Tavily/Serper/SerpAPI | 成熟的搜索 API | 需要额外 API key |
| D. 不内置，通过 MCP 提供 | 最灵活 | 需要用户自行配置 |

**推荐方案：D（MCP）+ A（Anthropic 原生）**
- 当使用 Anthropic 模型时，利用 `web_search` server tool（provider-defined tool）
- 其他模型通过 MCP 服务器（如 Exa MCP）提供搜索能力
- 这与 CodePilot 的多模型定位一致

---

## 5. 工具与 Agent Loop 的集成方式

### 5.1 Vercel AI SDK 的 streamText Agent Loop

```typescript
const result = streamText({
  model,
  system: systemPrompt,
  messages,
  tools: {
    read: readTool,
    write: writeTool,
    edit: editTool,
    bash: bashTool,
    glob: globTool,
    grep: grepTool,
    webfetch: webFetchTool,
  },
  maxSteps: 50,           // 最大工具调用轮次
  toolChoice: 'auto',
  onStepFinish: async (step) => {
    // 1. 记录工具调用和结果
    // 2. 更新进度 UI
    // 3. 检查是否需要用户批准
  },
});
```

### 5.2 needsApproval 权限集成

```typescript
const bashTool = tool({
  inputSchema: zodSchema(z.object({ command: z.string() })),
  needsApproval: async ({ command }) => {
    // 自动批准的命令白名单
    if (isReadOnlyCommand(command)) return false;
    // 其他命令需要批准
    return true;
  },
  execute: async ({ command }, { abortSignal }) => {
    return runCommand(command, { signal: abortSignal });
  },
});
```

当 `needsApproval` 返回 true 时，streamText 的步骤会暂停在 `tool-call` 状态。
前端需要：
1. 检测到 `toolApprovalRequest` 事件
2. 显示权限 UI
3. 用户批准后提交 `toolApprovalResponse`
4. streamText 继续执行

### 5.3 工具上下文传递

每个工具需要访问的共享状态：
```typescript
interface ToolContext {
  projectDir: string;           // 项目根目录
  readFileState: Map<string, {  // 文件读取状态（防止覆盖冲突）
    content: string;
    timestamp: number;
  }>;
  abortSignal: AbortSignal;     // 用户中断信号
  sessionId: string;            // 会话 ID
}
```

通过闭包注入：
```typescript
function createTools(ctx: ToolContext): Record<string, Tool> {
  return {
    read: tool({
      execute: async (input) => readFile(input, ctx),
    }),
    write: tool({
      execute: async (input) => writeFile(input, ctx),
    }),
    // ...
  };
}
```

### 5.4 输出截断策略

大输出保存到临时文件，返回摘要 + 路径：
```typescript
const MAX_OUTPUT_CHARS = 20_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const preview = output.slice(0, MAX_OUTPUT_CHARS);
  // 保存完整输出到临时文件
  const tmpPath = path.join(os.tmpdir(), `tool-output-${Date.now()}.txt`);
  fs.writeFileSync(tmpPath, output);
  return `${preview}\n\n[Output truncated. Full output saved to ${tmpPath}]`;
}
```

---

## 6. 需要的文件和依赖清单

### 6.1 新建文件

```
src/lib/tools/
  index.ts              — 工具注册表，导出 createTools()
  tool-context.ts       — ToolContext 类型和 readFileState 管理
  read.ts               — FileReadTool
  write.ts              — FileWriteTool
  edit.ts               — FileEditTool（含多层 Replacer）
  bash.ts               — BashTool
  glob.ts               — GlobTool
  grep.ts               — GrepTool
  webfetch.ts           — WebFetchTool
  truncation.ts         — 输出截断工具
  file-utils.ts         — 文件操作工具（编码检测、二进制检测、路径扩展等）
  shell-utils.ts        — Shell 工具（进程 kill、shell 检测等）
```

### 6.2 NPM 依赖

| 包名 | 用途 | 必要性 |
|------|------|--------|
| `ai` | Vercel AI SDK (已有) | 必须 |
| `zod` | Schema 定义 (已有) | 必须 |
| `fast-glob` | Glob 文件搜索 | 推荐 |
| `turndown` | HTML→Markdown 转换 | 推荐 |
| `diff` | 生成文件 diff | 推荐 |
| `@vscode/ripgrep` | 内嵌 ripgrep 二进制 | 可选（可用系统 rg） |

### 6.3 系统依赖

| 工具 | 用途 | 降级方案 |
|------|------|----------|
| `rg` (ripgrep) | GrepTool | Node.js 正则搜索（性能差） |
| bash/zsh/sh | BashTool | 使用 `process.platform` 检测 |

### 6.4 实现优先级

| 优先级 | 工具 | 理由 |
|--------|------|------|
| P0 | Read, Write, Edit | 代码编辑的核心 |
| P0 | Bash | Agent 的主要执行力 |
| P1 | Glob, Grep | 代码搜索和导航 |
| P2 | WebFetch | 网页内容获取 |
| P3 | WebSearch | 可通过 MCP 提供 |

---

## 7. 关键设计决策

### 7.1 采用 OpenCode 的 Tool.define 模式还是直接用 AI SDK tool()？

**推荐：直接用 AI SDK `tool()` + 闭包注入上下文**

理由：
- CodePilot 已经在用 AI SDK 的 streamText
- 减少一层抽象
- OpenCode 的 Tool.define 主要为了 init 阶段的异步初始化，我们可以在 createTools() 中处理

### 7.2 权限系统如何实现？

**推荐：`needsApproval` + 前端审批 UI**

- 读取类工具（Read, Glob, Grep）：`needsApproval: false`
- 写入类工具（Write, Edit）：可配置自动批准
- 执行类工具（Bash）：根据命令分类决定
- 网络类工具（WebFetch）：按域名白名单决定

### 7.3 工具提示词从哪来？

Claude Code 和 OpenCode 都将工具 description 放在 `.txt` 文件中单独维护。
**推荐：用 .txt 文件存放长描述，description 字段只放简短一行**

### 7.4 readFileState 如何在工具间共享？

通过 `createTools(ctx)` 的闭包传递。每个会话维护独立的 readFileState Map。
这等同于 Claude Code 的 `FileStateCache` 和 OpenCode 的 `FileTime`。

---

## 8. 与现有 CodePilot 代码的关系

CodePilot 当前有 `src/lib/cli-tools-mcp.ts`，这是 CLI 工具**管理**系统（安装/注册/更新系统上的命令行工具），不是 Agent 的内置工具。

自建的 Agent 工具系统是全新模块，与 cli-tools-mcp 无关。两者的区别：
- **cli-tools-mcp**：管理用户机器上安装的命令行工具（brew install xxx 等）
- **Agent 内置工具**：Agent 在对话中使用的 Read/Write/Edit/Bash/Glob/Grep/WebFetch/WebSearch

---

## 9. 复杂度总结

| 工具 | 代码量估计 | 核心难点 |
|------|-----------|----------|
| Read | ~200 行 | 大文件分页、编码检测、二进制过滤 |
| Write | ~100 行 | 冲突检测（readFileState） |
| Edit | ~400 行 | 多层 Replacer、diff 生成 |
| Bash | ~300 行 | 进程管理、超时、输出截断、权限 |
| Glob | ~80 行 | 简单封装 |
| Grep | ~150 行 | ripgrep 参数构建、结果解析 |
| WebFetch | ~100 行 | HTML→Markdown 转换 |
| WebSearch | ~50 行 | 通过 MCP/provider tool 委托 |
| 工具上下文 | ~100 行 | readFileState、项目目录 |
| 截断工具 | ~50 行 | 大输出存盘 |
| **总计** | ~1,500 行 | — |

全部工具约 1,500 行代码，是整个脱离 SDK 工作中代码量较大但技术难度适中的部分。最大挑战在于 BashTool 的权限系统和 EditTool 的容错匹配。
