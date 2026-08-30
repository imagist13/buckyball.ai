# Phase 7 Smoke Ledger — 7.7 反例验证

> 日期：2026-05-20
> Phase 7 commit: `80eb959`
> Worktree: `product-refactor-research`
> Dev server: `localhost:3001` (HTTP 200)

## ClaudeCode Runtime (主要痛点 — 已 verify)

Session `2bbe8d0ff545097345fe4cf27666051f` (Widget session, glm-5-turbo, workspace `/Users/op7418/Documents/test-workspace2`)

### 反例 baseline — 无 tool_use → entries omit (no fabrication) ✅

| Field | Value |
|---|---|
| DB row | `f2b2503d2a64bed66f3014997525dd2c` |
| Time | 2026-05-20 17:55:37 |
| User prompt | "用 humanizer-zh 优化一下：AI 真的不仅仅是一个强大的工具..." |
| Claude tool_use count | 0 (Claude 走 inline 推理，没 invoke 任何 tool) |

```json
"context_accounting": {
  "entries": {
    "rules": { "tokens": 93, "source": "workspace/CLAUDE.md", "detail": "CLAUDE.md" }
  },
  "unsupported": ["system_prompt", "memory", "files_attachments"],
  "producedBy": "claude_code"
}
```

**结论**：
- `entries.skills` / `entries.mcp` / `entries.tools` **正确 omit**（Phase 7 spec: no tool_use → no entry，防 hallucination）
- `unsupported` 已收编到 3 项（去掉了 tools/mcp/skills，正是 Phase 7 期望）
- `producedBy: 'claude_code'` ✓

### 触发 case — 1 个 Bash tool_use → entries.tools 出现 ✅

| Field | Value |
|---|---|
| DB row | `033fd7853ca2dd43a24f9f80293a42fb` |
| Time | 2026-05-20 17:57:30 |
| User prompt | "运行 ls 看看当前目录有哪些文件，然后用 humanizer-zh 优化这句..." |
| Claude tool_use count | 1 Bash (id `call_8d8909fa72dc4bd`) |
| Tool_result count | 1 (91 chars) — 100% paired ✓ |

```json
"context_accounting": {
  "entries": {
    "rules": { "tokens": 93, "source": "workspace/CLAUDE.md", "detail": "CLAUDE.md" },
    "tools": { "tokens": 48, "source": "tool_use/tool/Bash", "detail": "Bash × 1" }
  },
  "unsupported": ["system_prompt", "memory", "files_attachments"],
  "producedBy": "claude_code"
}
```

**Popover UI 验证** (`phase7-claudecode-bash-1call-popover.png`):
```
工具 (Tools): 48
规则 (Rules): 93
对话历史 (Conversation): 39K
缓存/上轮 (Cache): 68.5K
```

**结论**：
- `entries.tools` 字段填充：tokens=48 / source=`tool_use/tool/Bash` / detail=`Bash × 1` ✓
- UI popover **真实显示 "工具 48" 行**（之前 Phase 2-4 该行永远 hide）✓
- 反例对比铁证：相同 session、相邻两条消息，0 tool_use 对应 entries.tools=undefined；1 Bash 对应 entries.tools=48
- console clean

### v6 用户反馈链路修复确认

用户 v6 报告 "Skills/MCP/Tools 都不显示" → Phase 7 后 tools 已显示。还差 Skills + MCP 的真实 invocation case (Claude 自主决定 invoke Skill / MCP 时)，会在下一轮等 Claude 自然触发时验证；机制层已通过 1 Bash case 验证可行（统计 + UI 渲染链路全打通）。

## Native Runtime ⏳

待用户切到 Native session 跑等效 prompt：
- 反例 baseline: 不触发 tool_use → entries.{rules} only
- 触发 case: 调 Bash → entries.tools 含 "Bash × N"
- `producedBy: 'codepilot_runtime'` ✓

## Codex Runtime ⏳

待用户切到 Codex session 跑等效 prompt：
- 反例 baseline: 不触发 tool → entries.{rules} only
- 触发 case: 调 Codex 内置 Bash 或 MCP → entries.tools / entries.mcp 非空
- `producedBy: 'codex_runtime'` + `providerBackend` 字段透传
- run_completed → supplementary result event 写 context_accounting（Phase 4 P2 通道）

## 单元层反向校验 (已 commit 80eb959)

Widget 原始 message golden fixture (DB row `487c190a72ce51e030e706ca7ab3cea8`, 5 tool_use 100% tool_result 配对) 跑 collectAutoInvokeSnapshot → 产 entries.skills(humanizer-zh) + entries.mcp(codepilot-widget × 1, codepilot-memory × 1) + entries.tools(Bash × 2)。同输入 v6 bug 修复 ✓。

## 测试覆盖

| 类型 | 数量 | 状态 |
|---|---|---|
| Phase 7 contract + fixture unit | 27 | ✅ |
| 全套单元测试 | 2948 | ✅ |
| TypeScript strict | full | ✅ |
| 真实 UI smoke (ClaudeCode 反例 + 触发) | 2 | ✅ |
| Native / Codex 真实 UI smoke | 0 | ⏳ user |
