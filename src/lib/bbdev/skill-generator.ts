/**
 * bbdev/skill-generator.ts — 动态生成 bbdev Skill Definition
 *
 * 把 bbdev MCP 工具包装成 Claude Code / Codex 可识别的 Skill。
 *
 * 设计要点：
 * - context: fork          让 Claude Code / Codex 启动子 Agent，限制工具集
 * - allowed-tools 完整列出 bbdev_* + validate + Read/Bash（子 Agent 也要看 Ball 源文件）
 * - when_to_use 描述触发条件，避免 AI 把所有硬件请求都路由到 bbdev skill
 * - body 包含 chip / balldomain 上下文，并显式说明 submit-and-poll 模型
 */

import path from 'path';
import { BBDEV_TOOL_NAMES, type BbdevConnectionConfig } from './types';
import type { SkillDefinition } from '../skill-parser';

export const BBDEV_SKILL_NAME = 'bbdev';
export const BBDEV_SKILL_FILENAME = 'SKILL.md';

/**
 * 构造完整的 SKILL.md 文件内容（写盘用）
 */
export function renderBbdevSkillMarkdown(config: BbdevConnectionConfig): string {
  const allowedTools = buildAllowedTools();
  const body = renderBbdevSkillBody(config);

  return `---
name: ${BBDEV_SKILL_NAME}
description: ${renderDescription(config)}
when_to_use: ${renderWhenToUse(config)}
allowed-tools: [${allowedTools.join(', ')}]
context: fork
user-invocable: true
arguments:
  - name: operation
    description: ${'Operation kind: build / simulate / verify / synth / clean'}
    required: true
  - name: target
    description: ${'Workload or balldomain name (e.g. matmul, sort); leave empty for chip-wide operation'}
    required: false
---

${body}
`;
}

function renderDescription(config: BbdevConnectionConfig): string {
  const chip = config.chipName || 'toy';
  const bd = config.balldomain ? ` / balldomain=${config.balldomain}` : '';
  return `Buckyball ${chip}${bd} hardware development: compile, simulate, verify, synthesize.`;
}

function renderWhenToUse(config: BbdevConnectionConfig): string {
  const chip = config.chipName || 'toy';
  return `Use this skill whenever the user asks to build, simulate, verify, or synthesize hardware for the ${chip} chip, or asks to run a bbdev / buckyball toolchain operation.`;
}

/**
 * 子 Agent 在 fork 模式下可以使用的工具
 * bbdev_* / validate 全开；再开几个让子 Agent 读 Ball 源 / 跑小命令的工具
 */
export function buildAllowedTools(): string[] {
  const bbdevTools = BBDEV_TOOL_NAMES.filter(n => n !== 'bbdev_dc_verilog'); // DC 单独门控
  return [
    ...bbdevTools,
    // 子 Agent 读 Ball 源
    'Read',
    'Glob',
    'Grep',
    // 跑小命令（查看 log 之类）
    'Bash',
  ];
}

function renderBbdevSkillBody(config: BbdevConnectionConfig): string {
  const chip = config.chipName || 'toy';
  const balldomain = config.balldomain?.trim();
  const repoRoot = config.repoRoot || '~/.cache/codepilot/buckyball';

  return `# Buckyball ${chip} Development Tools

You are a sub-agent operating on chip **${chip}**${balldomain ? ` (balldomain \`${balldomain}\`)` : ''}.
Repository root: \`${repoRoot}\`.

## Submit-and-poll model

Every \`bbdev_*\` tool is **non-blocking**. The call returns immediately with:

\`\`\`json
{ "accepted": true, "processing": true, "trace_id": "abc123..." }
\`\`\`

After submitting, you **must** poll \`bbdev_task_status(trace_id)\` until it returns
a terminal state. Only \`success=true\` with \`returncode=0\` counts as passing.
\`failure=true\` is also terminal — surface the error and stop.

\`validate\` is synchronous and returns its verdict in the same call.

## Workflow

1. **Design**: edit Ball code under \`chips/${chip}/balldomains/\` (or wherever the repo layout puts it).
2. **Validate**: \`validate(chip="${chip}"${balldomain ? `, balldomain="${balldomain}"` : ''})\` — must pass before compiling.
3. **Compile**: \`bbdev_compiler_build(chip="${chip}")\` → poll until success.
4. **Build workload**: \`bbdev_workload_build(chip="${chip}"${balldomain ? `, workload="${balldomain}"` : ''})\` → poll.
5. **Simulate (fast)**: \`bbdev_bemu_sim(chip="${chip}", binary="<path>")\` → poll.
6. **Simulate (RTL)**: \`bbdev_bebop_verilator_run(chip="${chip}", binary="<path>")\` → poll.
7. **Synthesize**: \`bbdev_yosys_synth(input="<v>", output="<out>")\` → poll.

For FPGA bitstream: \`bbdev_bebop_p2e_*\`. For UVM: \`bbdev_uvm_{verilog,build,run}\`.

## Tool reference

| Category | Tools |
|----------|-------|
| Validate | \`validate\` |
| Task state | \`bbdev_task_status\` |
| Compiler | \`bbdev_compiler_build\`, \`bbdev_compiler_clean\` |
| Workload | \`bbdev_workload_build\`, \`bbdev_workload_clean\`, \`bbdev_workload_tohex\` |
| BEMU sim | \`bbdev_bemu_sim\`, \`bbdev_bemu_batch\` |
| Bebop Verilator | \`bbdev_bebop_verilator_{clean,verilog,build,sim,run,batch}\` |
| Verilator (no bebop) | \`bbdev_verilator_{clean,verilog,build,sim,run}\` |
| VCS | \`bbdev_vcs_{clean,verilog,build,sim,run}\` |
| Bebop P2E (FPGA) | \`bbdev_bebop_p2e_{clean,verilog,buildbitstream,runworkload,batch}\` |
| UVM | \`bbdev_uvm_{verilog,build,run}\` |
| Yosys | \`bbdev_yosys_{run,verilog,synth}\` |
| FireSim | \`bbdev_firesim_{enumeratefpgas,buildbitstream,infrasetup,runworkload}\` |
| Kernel | \`bbdev_kernel_build\` |

## House rules

- Always validate after editing Ball code; never skip.
- Surface the full stderr from any failed task — do not paraphrase errors.
- Prefer BEMU (\`bbdev_bemu_sim\`) over Verilator for fast iteration; BEMU is 10-100x faster.
- Use the smallest workload that exercises the new instruction first, then scale up.
- If a tool returns \`failure=true\` with \`returncode != 0\`, do **not** retry blindly — read stderr, fix the root cause, then re-run validate.

## Inputs

- \`$operation\` — \`build\` | \`simulate\` | \`verify\` | \`synth\` | \`clean\`
- \`$target\` — workload / balldomain name (optional)
- \`${'$CLAUDE_SKILL_DIR'}\` — directory of this SKILL.md (auto-substituted by the runner)
`;
}

/**
 * 生成 SkillDefinition 对象（不写盘，用于在内存中传给 skill-discovery）
 *
 * 注意：SkillDefinition.filePath 在动态生成时用 <repoRoot>/.claude/skills/bbdev/SKILL.md，
 * 这样 skill-discovery 的 dedup（by name）能正确合并。
 */
export function generateBbdevSkillDefinition(
  config: BbdevConnectionConfig,
): SkillDefinition {
  const filePath = path.join(
    config.repoRoot || path.join(process.cwd(), '.buckyball-fallback'),
    '.claude',
    'skills',
    BBDEV_SKILL_NAME,
    BBDEV_SKILL_FILENAME,
  );

  return {
    name: BBDEV_SKILL_NAME,
    description: renderDescription(config),
    body: renderBbdevSkillBody(config).trim(),
    allowedTools: buildAllowedTools(),
    context: 'fork',
    arguments: [
      { name: 'operation', description: 'Operation kind: build / simulate / verify / synth / clean', required: true },
      { name: 'target', description: 'Workload or balldomain name', required: false },
    ],
    whenToUse: renderWhenToUse(config),
    userInvocable: true,
    filePath,
  };
}
