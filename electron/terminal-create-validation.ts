/**
 * terminal-create-validation.ts — pure `terminal:create` request validation.
 *
 * Stability audit ⑦. Kept in its OWN module (no `child_process` / `spawn`
 * import) so a `src/**` unit test can import it without dragging the
 * spawn-containing terminal-manager into the browser-typed program — where
 * Node's `spawn` overloads resolve differently and would surface spurious
 * type errors. The IPC handler in electron/main.ts wires the real
 * `fs.statSync` + terminal-map predicates.
 */

/** Result of validating a `terminal:create` request before spawning. */
export type TerminalCreateValidation =
  | { ok: true }
  | { ok: false; error: 'invalid_id' | 'duplicate_id' | 'invalid_cwd'; detail: string };

/**
 * Validate a `terminal:create` request before spawning.
 *
 * Pure + dependency-injected (existence/uniqueness predicates supplied by the
 * caller) so it is unit-testable without Electron or a real filesystem.
 *
 * Guards, in order:
 *  - `invalid_id`   — id is not a non-empty string (would poison the id→terminal map);
 *  - `duplicate_id` — id already maps to a live terminal (spawning would silently
 *                     clobber it — reject instead of racing the kill+recreate path);
 *  - `invalid_cwd`  — cwd is not an existing directory (spawn would either launch
 *                     in the wrong place or surface an ambiguous ENOENT).
 */
export function validateTerminalCreateOpts(
  opts: { id?: unknown; cwd?: unknown },
  deps: { idExists: (id: string) => boolean; cwdIsDirectory: (cwd: string) => boolean },
): TerminalCreateValidation {
  if (typeof opts.id !== 'string' || opts.id.length === 0) {
    return { ok: false, error: 'invalid_id', detail: 'terminal id must be a non-empty string' };
  }
  if (deps.idExists(opts.id)) {
    return { ok: false, error: 'duplicate_id', detail: `terminal id already active: ${opts.id}` };
  }
  if (typeof opts.cwd !== 'string' || opts.cwd.length === 0 || !deps.cwdIsDirectory(opts.cwd)) {
    return { ok: false, error: 'invalid_cwd', detail: `cwd is not an existing directory: ${String(opts.cwd)}` };
  }
  return { ok: true };
}
