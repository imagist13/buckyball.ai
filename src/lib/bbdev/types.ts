/**
 * bbdev/types.ts — 类型定义与工具元数据
 *
 * bbdev = buckyball-dev 工具链后端（编译 / 仿真 / 校验 / 综合）
 * 工具调用走 buckyball 项目自带的 MCP server：scripts/claude/run_mcp_server.sh
 */

export type BbdevTaskStatus =
  | 'queued'
  | 'processing'
  | 'success'
  | 'failure'
  | 'unknown';

/**
 * bbdev MCP 工具完整清单（来源：buckyball/scripts/claude/README.md）
 * 命名 = MCP `tools/list` 中的 originalName，会被 McpConnectionManager 自动拼成
 * `mcp__bbdev__<name>` 作为 qualifiedName。
 */
export const BBDEV_TOOL_NAMES = [
  // Validation
  'validate',

  // Config / 任务状态
  'bbdev_config_install',
  'bbdev_task_status',

  // Compiler
  'bbdev_compiler_build',
  'bbdev_compiler_clean',

  // Workload
  'bbdev_workload_clean',
  'bbdev_workload_build',
  'bbdev_workload_tohex',

  // BEMU 指令仿真（bebop 下的快速仿真）
  'bbdev_bemu_sim',
  'bbdev_bemu_batch',

  // Bebop + Verilator 仿真（FPGA-like 周期仿真）
  'bbdev_bebop_verilator_clean',
  'bbdev_bebop_verilator_verilog',
  'bbdev_bebop_verilator_build',
  'bbdev_bebop_verilator_sim',
  'bbdev_bebop_verilator_run',
  'bbdev_bebop_verilator_batch',

  // 通用 Verilator / VCS（不走 bebop）
  'bbdev_verilator_clean',
  'bbdev_verilator_verilog',
  'bbdev_verilator_build',
  'bbdev_verilator_sim',
  'bbdev_verilator_run',
  'bbdev_vcs_clean',
  'bbdev_vcs_verilog',
  'bbdev_vcs_build',
  'bbdev_vcs_sim',
  'bbdev_vcs_run',

  // Bebop P2E（FPGA bitstream）
  'bbdev_bebop_p2e_clean',
  'bbdev_bebop_p2e_verilog',
  'bbdev_bebop_p2e_buildbitstream',
  'bbdev_bebop_p2e_runworkload',
  'bbdev_bebop_p2e_batch',

  // UVM
  'bbdev_uvm_verilog',
  'bbdev_uvm_build',
  'bbdev_uvm_run',

  // Yosys 综合
  'bbdev_yosys_run',
  'bbdev_yosys_verilog',
  'bbdev_yosys_synth',

  // DC 综合
  'bbdev_dc_verilog',

  // FireSim
  'bbdev_firesim_enumeratefpgas',
  'bbdev_firesim_buildbitstream',
  'bbdev_firesim_infrasetup',
  'bbdev_firesim_runworkload',

  // Kernel
  'bbdev_kernel_build',
] as const;

export type BbdevToolName = (typeof BBDEV_TOOL_NAMES)[number];

/**
 * bbdev 连接模式
 */
export type BbdevMode = 'local' | 'remote';

/**
 * bbdev 连接配置（写入 SettingsMap 的 JSON 字符串）
 */
export interface BbdevConnectionConfig {
  /** 模式：local（std MCP） / remote（HTTP，Phase 2+） */
  mode: BbdevMode;

  /** Local 模式：buckyball 仓库根（含 bbdev/mcp/、scripts/claude/run_mcp_server.sh） */
  repoRoot: string;

  /** Local 模式：MCP 启动脚本路径（相对或绝对），留空走默认 scripts/claude/run_mcp_server.sh */
  mcpScriptPath?: string;

  /** 当前选中的 chip（默认 toy） */
  chipName: string;

  /** 当前选中的 balldomain（可空） */
  balldomain?: string;

  /** Remote 模式（预留） */
  remoteUrl?: string;
  remoteToken?: string;

  /** 自动启动本地 bbdev */
  autoStartLocal: boolean;
}

/**
 * 单个 bbdev 任务追踪
 * bbdev 的 `bbdev_*` 提交后立刻返回 trace_id，后续靠 bbdev_task_status 轮询
 */
export interface BbdevTask {
  traceId: string;
  toolName: BbdevToolName;
  args: Record<string, unknown>;
  chip?: string;
  status: BbdevTaskStatus;
  progress?: number;
  logs: string[];
  result?: {
    returncode?: number;
    stdout?: string;
    stderr?: string;
  };
  createdAt: number;
  updatedAt: number;
}

/**
 * bbdev MCP 连接状态
 */
export interface BbdevConnectionState {
  connected: boolean;
  serverName: string;        // McpConnectionManager 注册名
  mode: BbdevMode;
  toolCount: number;
  error?: string;
  startedAt?: number;
}
