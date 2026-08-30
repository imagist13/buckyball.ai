import type {
  SubagentExecutionStatus,
  SubagentStatusError,
  SubagentStatusErrorCode,
} from './subagent-status';

export const SUBAGENT_OUTCOME_PREFIX = '__CODEPILOT_SUBAGENT_OUTCOME__';

export const SUBAGENT_OUTCOME_INSTRUCTION =
  'Your final response MUST start with exactly one machine-readable line: '
  + '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"completed"}, '
  + '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"partial"}, or '
  + '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"failed","error":{"code":"CAPABILITY_UNAVAILABLE","retryable":true}}. '
  + 'Choose completed only when the assigned task itself succeeded; finishing your response is not task completion. '
  + 'Put the user-facing result after that line.';

export interface ReportedSubagentOutcome {
  status?: Extract<SubagentExecutionStatus, 'completed' | 'partial' | 'failed'>;
  text: string;
  error?: SubagentStatusError;
}

const REPORTED_ERROR_CODES: ReadonlySet<SubagentStatusErrorCode> = new Set([
  'AUTH_FORBIDDEN',
  'ENTITLEMENT',
  'RATE_LIMITED',
  'MODEL_UNAVAILABLE',
  'ROUTE_MISMATCH',
  'LOGICAL_RUN_STILL_RUNNING',
  'LOGICAL_RUN_ALREADY_COMPLETED',
  'INVALID_SUBAGENT_SPEC',
  'INVALID_DEPENDENCY_SPEC',
  'DEPENDENCY_DECLARATION_REQUIRED',
  'DEPENDENCY_NOT_FOUND',
  'DEPENDENCY_TIMEOUT',
  'DEPENDENCY_FAILED',
  'DUPLICATE_TASK_KEY',
  'CAPABILITY_UNAVAILABLE',
  'CONCURRENCY_LIMIT',
  'TIMEOUT',
  'MAX_TURNS',
  'MAX_BUDGET',
  'RUNTIME_ERROR',
  'EMPTY_RESULT',
]);

/**
 * Parse the common child-authored outcome marker. Runtime adapters still own
 * transport/turn facts; this parser only prevents "the model stopped talking"
 * from being mistaken for "the assigned task succeeded".
 */
export function parseReportedSubagentOutcome(text: string): ReportedSubagentOutcome {
  const trimmed = text.trim();
  const markerIndex = trimmed.indexOf(SUBAGENT_OUTCOME_PREFIX);
  if (markerIndex === -1) return { text: trimmed };
  const jsonStart = markerIndex + SUBAGENT_OUTCOME_PREFIX.length;
  const jsonEnd = findJsonObjectEnd(trimmed, jsonStart);
  if (jsonEnd === -1) return { text: trimmed };
  const raw = trimmed.slice(jsonStart, jsonEnd);
  const body = [
    trimmed.slice(0, markerIndex).trim(),
    trimmed.slice(jsonEnd).trim(),
  ].filter(Boolean).join('\n').trim();
  try {
    const parsed = JSON.parse(raw) as {
      status?: unknown;
      error?: { code?: unknown; retryable?: unknown };
    };
    if (
      parsed.status !== 'completed'
      && parsed.status !== 'partial'
      && parsed.status !== 'failed'
    ) {
      return { text: trimmed };
    }
    const error = parseReportedStatusError(parsed.error);
    return {
      status: parsed.status,
      text: body,
      ...(error ? { error } : {}),
    };
  } catch {
    return { text: trimmed };
  }
}

export function explicitlyReportsSubagentTaskFailure(text: string): boolean {
  return /(?:^|\n)\s*(?:\*{0,2}(?:无法完成(?:此|该|这个)?任务|不能完成(?:此|该|这个)?任务|任务无法完成|命令未能执行|工具调用(?:被|遭).*拒绝|unable to complete (?:this|the) task|cannot complete (?:this|the) task|could not complete (?:this|the) task|the command (?:could not|was not) (?:be )?executed|permission denied)\*{0,2})(?:\s|[:：]|$)/im.test(text)
    || /\bSUBAGENT_(?:CAPABILITY_UNAVAILABLE|CANNOT_COMPLETE)\b/i.test(text);
}

export function classifyReportedSubagentTaskFailure(text: string): SubagentStatusError {
  if (
    /(?:network|联网|网络|DNS|tool|工具|command|命令|permission|权限|browser|浏览器|capabilit|sandbox|沙箱)[\s\S]{0,120}(?:unavailable|不可用|受限|阻断|无法|未能|拒绝|denied|missing|没有)/i.test(text)
    || /(?:unavailable|不可用|受限|阻断|无法|未能|拒绝|denied|missing|没有)[\s\S]{0,120}(?:network|联网|网络|DNS|tool|工具|command|命令|permission|权限|browser|浏览器|capabilit|sandbox|沙箱)/i.test(text)
  ) {
    return { code: 'CAPABILITY_UNAVAILABLE', retryable: true };
  }
  return { code: 'RUNTIME_ERROR', retryable: true };
}

function findJsonObjectEnd(text: string, start: number): number {
  if (text[start] !== '{') return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function parseReportedStatusError(
  error: { code?: unknown; retryable?: unknown } | undefined,
): SubagentStatusError | undefined {
  if (
    !error
    || typeof error.code !== 'string'
    || !REPORTED_ERROR_CODES.has(error.code as SubagentStatusErrorCode)
  ) {
    return undefined;
  }
  return {
    code: error.code as SubagentStatusErrorCode,
    ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
  };
}
