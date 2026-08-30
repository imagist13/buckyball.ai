import type {
  ServerDescendantLifecycleMessage,
  ServerDescendantRole,
} from '../src/lib/server-lifecycle-contract';

export { parseServerDescendantLifecycleMessage } from '../src/lib/server-lifecycle-contract';

interface RegisteredDescendant {
  role: ServerDescendantRole;
  pid: number;
  startIdentity: string;
  executableBasename: string;
  descendantsVerifiable: boolean;
}

export interface ServerRestartOwnershipDecision {
  allowed: boolean;
  reason: 'ownership_clear' | 'live_registered_descendant' | 'descendant_tree_unverifiable';
  livePids: number[];
}

/**
 * Tracks only descendants explicitly registered by the current utility
 * process. It never kills a PID. Restart admission fails closed when a live
 * registered process remains or when a registered owner may have spawned an
 * unobservable deeper tree (the current Codex app-server contract).
 */
export class ServerDescendantRegistry {
  private readonly entries = new Map<string, RegisteredDescendant>();

  constructor(readonly generation: number) {}

  apply(message: ServerDescendantLifecycleMessage): boolean {
    if (message.generation !== this.generation) return false;
    if (message.action === 'register') {
      this.entries.set(message.startIdentity, {
        role: message.role,
        pid: message.pid,
        startIdentity: message.startIdentity,
        executableBasename: message.executableBasename,
        descendantsVerifiable: message.descendantsVerifiable,
      });
      return true;
    }

    const current = this.entries.get(message.startIdentity);
    if (
      !current
      || current.pid !== message.pid
      || current.role !== message.role
      || current.executableBasename !== message.executableBasename
    ) return false;
    this.entries.delete(message.startIdentity);
    return true;
  }

  evaluateRestartOwnership(
    isPidAlive: (pid: number) => boolean,
  ): ServerRestartOwnershipDecision {
    const livePids = [...this.entries.values()]
      .filter((entry) => isPidAlive(entry.pid))
      .map((entry) => entry.pid)
      .sort((a, b) => a - b);
    if (livePids.length > 0) {
      return { allowed: false, reason: 'live_registered_descendant', livePids };
    }
    if ([...this.entries.values()].some((entry) => !entry.descendantsVerifiable)) {
      return { allowed: false, reason: 'descendant_tree_unverifiable', livePids: [] };
    }
    return { allowed: true, reason: 'ownership_clear', livePids: [] };
  }
}
