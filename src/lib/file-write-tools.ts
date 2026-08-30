/**
 * Shared classification for tool calls that modify a file on disk.
 *
 * Both MessageItem (DiffSummary cards) and stream-session-manager (the
 * codepilot:file-changed dispatcher) need to ask the same question
 * about an inbound tool_result: "does this imply a file was just
 * written?" Keeping the set in one module prevents drift — if a future
 * tool variant lands (e.g. `multi_edit`, `apply_diff`), both surfaces
 * pick it up the moment this list is updated.
 *
 * Names are lowercased before matching so PascalCase / snake_case
 * variants both land in the same set.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set<string>([
  'write',
  'edit',
  // Claude / Claude Code's MultiEdit applies a sequence of edits to one
  // file in one call. Without it, AI turns that touch a Markdown file
  // via MultiEdit don't fire codepilot:file-changed and DiffSummary
  // skips the card — same end-user impact as if the file weren't
  // edited at all. snake_case variant covered for MCP servers that
  // expose the same semantics under a different naming convention.
  'multiedit',
  'multi_edit',
  'writefile',
  'write_file',
  'create_file',
  'createfile',
  'notebookedit',
  'notebook_edit',
]);

/**
 * Tools whose semantics are "produce a new file" rather than "modify
 * an existing one." Used by DiffSummary to label the operation —
 * `created` vs `modified` — in the Artifact card.
 */
export const CREATE_TOOLS: ReadonlySet<string> = new Set<string>([
  'write',
  'writefile',
  'write_file',
  'create_file',
  'createfile',
]);

export function isWriteTool(name: string | null | undefined): boolean {
  if (!name) return false;
  return WRITE_TOOLS.has(name.toLowerCase());
}

export function isCreateTool(name: string | null | undefined): boolean {
  if (!name) return false;
  return CREATE_TOOLS.has(name.toLowerCase());
}

/**
 * Pull the target path from a write tool's `input`. Tools name this
 * field inconsistently across the ecosystem — `file_path` for the
 * canonical SDK Write/Edit, `notebook_path` for NotebookEdit, `path`
 * or `filePath` for various MCP servers. Returns empty string when
 * the input has no recognizable path field; callers should treat that
 * as "skip dispatch" rather than dispatching with an empty path.
 */
export function extractWritePath(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const candidate =
    obj.file_path ?? obj.notebook_path ?? obj.path ?? obj.filePath ?? '';
  return typeof candidate === 'string' ? candidate : '';
}

/**
 * Resolve a possibly-relative tool path against a working directory.
 *
 * Mirrors the helper in MessageItem.tsx so the two surfaces produce the
 * same absolute string. POSIX/Windows separator inferred from the
 * working directory itself.
 */
export function resolveToolPath(
  rawPath: string,
  workingDirectory: string | null | undefined,
): string {
  if (!rawPath) return rawPath;
  const isWindows = /^[A-Za-z]:[/\\]/.test(rawPath)
    || Boolean(workingDirectory?.match(/^[A-Za-z]:[/\\]/));
  const separator = isWindows ? '\\' : '/';
  const isAbsolute = rawPath.startsWith('/') || /^[A-Za-z]:[/\\]/.test(rawPath);
  if (!isAbsolute && !workingDirectory) return rawPath;

  const combined = isAbsolute
    ? rawPath
    : `${workingDirectory!.replace(/[/\\]+$/, '')}${separator}${rawPath}`;
  const normalized = combined.replace(/[\\/]+/g, separator);
  const drive = isWindows ? normalized.slice(0, 2) : '';
  const remainder = isWindows ? normalized.slice(2) : normalized;
  const segments: string[] = [];
  for (const segment of remainder.split(separator)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return isWindows
    ? `${drive}${separator}${segments.join(separator)}`
    : `${separator}${segments.join(separator)}`;
}
