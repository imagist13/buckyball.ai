export interface ActiveCodexTurn {
  threadId: string;
  turnId: string;
}

export interface CodexInterruptClient {
  request(
    method: 'turn/interrupt',
    params: ActiveCodexTurn,
  ): Promise<unknown>;
}

interface CodexTurnAbortOwner {
  readonly token: object;
  readonly controller: AbortController;
}

const CODEX_TURN_ABORT_REGISTRY_KEY = Symbol.for(
  'codepilot.codex.turn-abort-registry.v1',
);

function getCodexTurnAbortRegistry(): Map<string, CodexTurnAbortOwner> {
  const holder = globalThis as typeof globalThis & {
    [CODEX_TURN_ABORT_REGISTRY_KEY]?: Map<string, CodexTurnAbortOwner>;
  };
  if (!holder[CODEX_TURN_ABORT_REGISTRY_KEY]) {
    holder[CODEX_TURN_ABORT_REGISTRY_KEY] = new Map();
  }
  return holder[CODEX_TURN_ABORT_REGISTRY_KEY]!;
}

/**
 * HMR-safe ownership of the chat route's AbortController. `turn/interrupt`
 * alone cannot cancel a parent blocked inside a dynamic-tool server request;
 * aborting this controller also reaches the managed child signal and the chat
 * route's lock watchdog.
 */
export function registerCodexTurnAbortController(
  sessionId: string,
  controller: AbortController,
): () => void {
  const registry = getCodexTurnAbortRegistry();
  const owner: CodexTurnAbortOwner = { token: {}, controller };
  registry.set(sessionId, owner);
  return () => {
    if (registry.get(sessionId) === owner) registry.delete(sessionId);
  };
}

export function abortCodexTurnController(sessionId: string): boolean {
  const owner = getCodexTurnAbortRegistry().get(sessionId);
  if (!owner) return false;
  if (!owner.controller.signal.aborted) {
    owner.controller.abort(new Error('CodePilot parent turn interrupted'));
  }
  return true;
}

/**
 * Small testable owner for the transient turn identity required by
 * turn/interrupt. Runtime wiring still decides when a turn starts/ends, while
 * this class owns the lookup/no-active semantics without source-text regexes.
 */
export class CodexTurnInterruptRegistry {
  private readonly turns = new Map<string, ActiveCodexTurn>();

  set(sessionId: string, turn: ActiveCodexTurn): void {
    this.turns.set(sessionId, turn);
  }

  get(sessionId: string): ActiveCodexTurn | undefined {
    return this.turns.get(sessionId);
  }

  delete(sessionId: string): boolean {
    return this.turns.delete(sessionId);
  }

  issue(
    sessionId: string,
    request: (turn: ActiveCodexTurn) => void,
  ): boolean {
    const active = this.turns.get(sessionId);
    if (!active) return false;
    request(active);
    return true;
  }
}

export async function requestCodexTurnInterrupt(
  client: CodexInterruptClient,
  active: ActiveCodexTurn,
): Promise<void> {
  await client.request('turn/interrupt', {
    threadId: active.threadId,
    turnId: active.turnId,
  });
}
