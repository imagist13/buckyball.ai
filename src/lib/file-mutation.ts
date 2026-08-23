export type FileMutationKind = "rename" | "delete";
export type FileMutationNodeType = "file" | "directory";

export interface FileMutationRequest {
  kind: FileMutationKind;
  targetPath: string;
  nodeType: FileMutationNodeType;
  baseDir: string;
  newPath?: string;
  recursive?: boolean;
}

export interface FileMutationTransaction extends FileMutationRequest {
  transactionId: string;
}

export interface FileMutationCommitDetail extends FileMutationTransaction {
  result: Record<string, unknown>;
}

export interface FileMutationParticipant<Snapshot = unknown> {
  id: string;
  priority?: number;
  matches: (transaction: FileMutationTransaction) => boolean;
  isDirty?: (transaction: FileMutationTransaction) => boolean;
  prepare?: (transaction: FileMutationTransaction) => Snapshot | Promise<Snapshot>;
  commit?: (
    transaction: FileMutationTransaction,
    snapshot: Snapshot,
  ) => void | Promise<void>;
  rollback?: (
    transaction: FileMutationTransaction,
    snapshot: Snapshot,
  ) => void | Promise<void>;
}

export const FILE_MUTATION_COMMIT_EVENT = "codepilot:file-mutation-committed";

export class FileMutationError extends Error {
  constructor(
    message: string,
    readonly code = "write_failed",
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FileMutationError";
  }
}

function normalized(path: string): string {
  const value = path.replace(/\\/g, "/");
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

/** Boundary-safe descendant check (`foo` never matches `foobar`). */
export function pathIsWithin(path: string, ancestor: string): boolean {
  const candidate = normalized(path);
  const root = normalized(ancestor);
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function remapMutationPath(
  path: string,
  targetPath: string,
  newPath: string,
): string {
  if (!pathIsWithin(path, targetPath)) return path;
  const candidate = normalized(path);
  const target = normalized(targetPath);
  const destination = normalized(newPath);
  return `${destination}${candidate.slice(target.length)}`;
}

export function isProtectedFileTreePath(path: string): boolean {
  const blocked = new Set([
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    ".turbo",
    ".cache",
    "Library",
    "System",
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "System32",
  ]);
  return normalized(path)
    .split("/")
    .filter(Boolean)
    .some((segment) => blocked.has(segment) || segment.startsWith(".env"));
}

export function fileMutationTargetPath(
  parentPath: string,
  nextName: string,
): string {
  const separator = parentPath.includes("\\") ? "\\" : "/";
  return `${parentPath.replace(/[\\/]+$/, "")}${separator}${nextName}`;
}

export async function executeFileMutation(
  transaction: FileMutationTransaction,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const rename = transaction.kind === "rename";
  const response = await fetchImpl(
    rename ? "/api/files/rename" : "/api/files/delete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        rename
          ? {
              from: transaction.targetPath,
              to: transaction.newPath,
              baseDir: transaction.baseDir,
              overwrite: false,
            }
          : {
              path: transaction.targetPath,
              baseDir: transaction.baseDir,
              recursive: transaction.recursive === true,
            },
      ),
    },
  );
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new FileMutationError(
      typeof data.error === "string" ? data.error : response.statusText,
      typeof data.code === "string" ? data.code : "write_failed",
      data,
    );
  }
  return data;
}

export class FileMutationCoordinator {
  private readonly participants = new Map<string, FileMutationParticipant>();
  private inFlight = false;
  private sequence = 0;

  constructor(
    private readonly executor: (
      transaction: FileMutationTransaction,
    ) => Promise<Record<string, unknown>> = executeFileMutation,
  ) {}

  registerParticipant(participant: FileMutationParticipant): () => void {
    this.participants.set(participant.id, participant);
    return () => {
      if (this.participants.get(participant.id) === participant) {
        this.participants.delete(participant.id);
      }
    };
  }

  isMutationInFlight(): boolean {
    return this.inFlight;
  }

  hasUnsavedChanges(request: FileMutationRequest): boolean {
    const transaction = {
      ...request,
      transactionId: "file-mutation-inspect",
    };
    return [...this.participants.values()].some(
      (participant) =>
        participant.matches(transaction) &&
        participant.isDirty?.(transaction) === true,
    );
  }

  async run(
    request: FileMutationRequest,
  ): Promise<FileMutationCommitDetail> {
    if (this.inFlight) {
      throw new Error("Another file operation is already in progress");
    }
    this.inFlight = true;
    const transaction: FileMutationTransaction = {
      ...request,
      transactionId: `file-mutation-${Date.now()}-${++this.sequence}`,
    };
    const participants = [...this.participants.values()]
      .filter((participant) => participant.matches(transaction))
      .sort((left, right) => (left.priority ?? 100) - (right.priority ?? 100));
    const prepared: Array<{
      participant: FileMutationParticipant;
      snapshot: unknown;
    }> = [];
    let executed = false;

    try {
      for (const participant of participants) {
        const entry = { participant, snapshot: undefined as unknown };
        prepared.push(entry);
        entry.snapshot = await participant.prepare?.(transaction);
      }

      const result = await this.executor(transaction);
      executed = true;
      const acknowledgements = prepared.map(({ participant, snapshot }) =>
        Promise.resolve(participant.commit?.(transaction, snapshot)),
      );
      await Promise.all(acknowledgements);
      return { ...transaction, result };
    } catch (error) {
      if (!executed) {
        for (const { participant, snapshot } of prepared.reverse()) {
          await participant.rollback?.(transaction, snapshot);
        }
      }
      throw error;
    } finally {
      this.inFlight = false;
    }
  }
}
