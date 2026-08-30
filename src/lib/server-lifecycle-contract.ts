export const SERVER_LIFECYCLE_CHANNEL = 'codepilot:server-lifecycle';
export const SERVER_LIFECYCLE_VERSION = 1;

export type ServerDescendantRole = 'codex-app-server' | 'managed-mcp';

export interface ServerDescendantLifecycleMessage {
  channel: typeof SERVER_LIFECYCLE_CHANNEL;
  version: typeof SERVER_LIFECYCLE_VERSION;
  generation: number;
  action: 'register' | 'unregister';
  role: ServerDescendantRole;
  pid: number;
  /** Owner-generated process-start nonce; paired with PID to reject reuse. */
  startIdentity: string;
  /** Basename only — full executable path and argv never cross the channel. */
  executableBasename: string;
  descendantsVerifiable: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseServerDescendantLifecycleMessage(
  value: unknown,
): ServerDescendantLifecycleMessage | null {
  if (!isPlainObject(value)) return null;
  if (value.channel !== SERVER_LIFECYCLE_CHANNEL) return null;
  if (value.version !== SERVER_LIFECYCLE_VERSION) return null;
  if (!Number.isSafeInteger(value.generation) || (value.generation as number) <= 0) return null;
  if (value.action !== 'register' && value.action !== 'unregister') return null;
  if (value.role !== 'codex-app-server' && value.role !== 'managed-mcp') return null;
  if (!Number.isSafeInteger(value.pid) || (value.pid as number) <= 0) return null;
  if (typeof value.startIdentity !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.startIdentity)) {
    return null;
  }
  if (
    typeof value.executableBasename !== 'string'
    || value.executableBasename.length < 1
    || value.executableBasename.length > 128
    || /[\\/\0]/.test(value.executableBasename)
  ) return null;
  if (typeof value.descendantsVerifiable !== 'boolean') return null;
  return value as unknown as ServerDescendantLifecycleMessage;
}
